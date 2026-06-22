/**
 * MpvController — spawns mpv as a child process, embeds its video output into
 * a native child BrowserWindow (via --wid), and controls playback through
 * mpv's JSON IPC protocol over a Windows named pipe.
 */

import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'

// ─── IPC layer ────────────────────────────────────────────────────────────────

interface MpvMsg {
  event?: string
  name?: string
  data?: unknown
  error?: string
  request_id?: number
}

class MpvIpc extends EventEmitter {
  private socket: net.Socket | null = null
  private buf = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  async connect(pipePath: string, maxAttempts = 25): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const s = net.createConnection(pipePath)
          const onErr = (e: Error) => { s.destroy(); reject(e) }
          s.once('error', onErr)
          s.once('connect', () => {
            s.removeListener('error', onErr)
            s.on('data', (d: Buffer) => this.feed(d.toString()))
            s.on('error', (e) => console.error('[mpv ipc] socket error:', e))
            s.on('close', () => this.emit('close'))
            this.socket = s
            resolve()
          })
        })
        return
      } catch {
        await new Promise<void>(r => setTimeout(r, 200))
      }
    }
    throw new Error('Could not connect to mpv IPC — mpv may have failed to start')
  }

  private feed(raw: string) {
    this.buf += raw
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line) as MpvMsg
        if (msg.event) {
          this.emit('mpvEvent', msg)
        } else if (typeof msg.request_id === 'number') {
          const p = this.pending.get(msg.request_id)
          if (p) {
            this.pending.delete(msg.request_id)
            msg.error === 'success' ? p.resolve(msg.data) : p.reject(new Error(String(msg.error)))
          }
        }
      } catch { /* malformed JSON — ignore */ }
    }
  }

  send(command: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('mpv IPC not connected'))
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.socket.write(JSON.stringify({ command, request_id: id }) + '\n')
    })
  }

  close() {
    for (const { reject } of this.pending.values()) reject(new Error('IPC closed'))
    this.pending.clear()
    this.socket?.destroy()
    this.socket = null
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MpvTrackEntry {
  id: number
  type: string
  title?: string
  lang?: string
  selected?: boolean
}

export interface MpvAudioTrack {
  id: number        // mpv 1-based track id — used with set_property aid
  index: number     // 0-based index among audio tracks
  title: string
  language: string
  selected: boolean
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class MpvController extends EventEmitter {
  private proc: ChildProcess | null = null
  private ipc = new MpvIpc()
  private containerWin: BrowserWindow | null = null
  private pipeName: string
  private pauseOnLoad = true   // always start paused after loadfile

  // Resolved once IPC is connected and observers are set up
  readonly ready: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (e: Error) => void

  constructor(private mainWindow: BrowserWindow) {
    super()
    this.pipeName = `\\\\.\\pipe\\xivodreview-${process.pid}`
    this.ready = new Promise((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    })
  }

  async launch(mpvBin: string): Promise<void> {
    // Blank native child window — mpv renders its video into this HWND
    this.containerWin = new BrowserWindow({
      parent: this.mainWindow,
      x: 0, y: 38,
      width: 100, height: 100,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      show: false,   // hidden until a file is opened
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })
    // Do NOT load any URL — loading about:blank lets Chromium's compositor
    // paint over mpv's child window, producing a black screen.
    // Forward all mouse events to the main window so click-to-pause works
    this.containerWin.setIgnoreMouseEvents(true, { forward: true })

    const hwndBuf = this.containerWin.getNativeWindowHandle()
    const hwnd = hwndBuf.length >= 8
      ? Number(hwndBuf.readBigUInt64LE(0))
      : hwndBuf.readUInt32LE(0)

    this.proc = spawn(mpvBin, [
      `--wid=${hwnd}`,
      `--input-ipc-server=${this.pipeName}`,
      '--no-terminal',
      '--no-osc',
      '--no-input-default-bindings',
      '--input-vo-keyboard=no',
      '--keep-open=yes',
      '--idle=yes',
      '--force-window=yes',
      '--vo=gpu',
      '--gpu-api=d3d11',
      '--hwdec=d3d11va-copy',
    ])

    this.proc.on('error', (e: NodeJS.ErrnoException) => {
      const msg = e.code === 'ENOENT'
        ? `mpv not found at "${mpvBin}"`
        : `mpv process error: ${e.message}`
      console.error('[mpv]', msg)
      this.readyReject(new Error(msg))
    })
    this.proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line && !line.startsWith('[vo/gpu]')) console.log('[mpv]', line)
    })

    try {
      await this.ipc.connect(this.pipeName)
    } catch (e) {
      this.readyReject(e as Error)
      throw e
    }

    // Observe properties we care about
    await this.ipc.send(['observe_property', 1, 'time-pos'])
    await this.ipc.send(['observe_property', 2, 'duration'])
    await this.ipc.send(['observe_property', 3, 'pause'])
    await this.ipc.send(['observe_property', 4, 'track-list'])

    this.ipc.on('mpvEvent', (e: MpvMsg) => this.handleEvent(e))
    this.ipc.on('close', () => this.emit('closed'))

    this.readyResolve()
  }

  private handleEvent(e: MpvMsg) {
    if (e.event === 'property-change') {
      switch (e.name) {
        case 'time-pos':
          this.emit('timeUpdate', typeof e.data === 'number' ? e.data : 0)
          break
        case 'duration':
          this.emit('durationChange', typeof e.data === 'number' ? e.data : 0)
          break
        case 'pause':
          this.emit('pauseChange', !!e.data)
          break
        case 'track-list':
          this.emit('tracksChange', this.parseAudioTracks(e.data as MpvTrackEntry[]))
          break
      }
    } else if (e.event === 'file-loaded') {
      if (this.pauseOnLoad) {
        this.ipc.send(['set_property', 'pause', true]).catch(() => {})
      }
      this.emit('fileLoaded')
    } else if (e.event === 'end-file') {
      this.emit('fileEnded')
    }
  }

  private parseAudioTracks(list: MpvTrackEntry[] = []): MpvAudioTrack[] {
    return list
      .filter(t => t.type === 'audio')
      .map((t, i) => ({
        id: t.id,
        index: i,
        title: t.title || `Track ${i + 1}`,
        language: t.lang || '',
        selected: !!t.selected
      }))
  }

  // ─── Playback commands ──────────────────────────────────────────────────────

  async openFile(path: string): Promise<void> {
    this.pauseOnLoad = true
    // Show the container the first time a file is opened (not on startup —
    // we want the placeholder to remain visible until the user picks a file).
    if (this.containerWin && !this.containerWin.isDestroyed() && !this.containerWin.isVisible()) {
      this.containerWin.showInactive()
    }
    await this.ipc.send(['loadfile', path, 'replace'])
  }

  async play(): Promise<void> {
    await this.ipc.send(['set_property', 'pause', false])
  }

  async pause(): Promise<void> {
    await this.ipc.send(['set_property', 'pause', true])
  }

  async togglePause(): Promise<void> {
    await this.ipc.send(['cycle', 'pause'])
  }

  async seek(seconds: number, type: 'absolute' | 'relative' = 'absolute'): Promise<void> {
    await this.ipc.send(['seek', seconds, type])
  }

  async frameStep(): Promise<void> {
    await this.ipc.send(['frame-step'])
  }

  async frameBackStep(): Promise<void> {
    await this.ipc.send(['frame-back-step'])
  }

  /** level is 0–1 (Electron convention); mpv uses 0–100 */
  async setVolume(level: number): Promise<void> {
    await this.ipc.send(['set_property', 'volume', Math.round(Math.max(0, Math.min(1, level)) * 100)])
  }

  /** delta is 0–1 fraction; translates to ±N in mpv's 0–100 scale */
  async addVolume(delta: number): Promise<void> {
    await this.ipc.send(['add', 'volume', Math.round(delta * 100)])
  }

  async setMute(muted: boolean): Promise<void> {
    await this.ipc.send(['set_property', 'mute', muted])
  }

  async setAudioTrack(trackId: number): Promise<void> {
    await this.ipc.send(['set_property', 'aid', trackId])
  }

  async command(args: unknown[]): Promise<unknown> {
    return this.ipc.send(args)
  }

  // ─── Window management ──────────────────────────────────────────────────────

  setVideoBounds(x: number, y: number, width: number, height: number): void {
    if (!this.containerWin || this.containerWin.isDestroyed()) return
    const b = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    }
    this.containerWin.setBounds(b)
  }

  hideVideo(): void {
    if (this.containerWin && !this.containerWin.isDestroyed()) this.containerWin.hide()
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  quit(): void {
    this.ipc.close()
    try { this.ipc.send(['quit']).catch(() => {}) } catch { /* already closed */ }
    this.proc?.kill()
    if (this.containerWin && !this.containerWin.isDestroyed()) this.containerWin.destroy()
    this.containerWin = null
    this.proc = null
  }
}
