/**
 * MpvController
 *
 * Windows: loads libmpv-2.dll via koffi and uses MPV_RENDER_API_TYPE_SW to
 * render video frames into a CPU pixel buffer. Frames are painted to a native
 * WS_CHILD HWND via GDI StretchDIBits. Because no WGL context is created on
 * the HWND, there is no Z-order conflict with Chromium's render widget, and
 * we always hold the last rendered frame in RAM — so the video stays visible
 * even when paused and the window loses focus.
 *
 * macOS/Linux: spawns mpv.exe as a child process and communicates via JSON IPC
 * over a Unix socket (existing approach; screen capture works natively there).
 *
 * The public interface (EventEmitter events, method signatures) is identical
 * on both paths, so index.ts and App.vue need no changes.
 */

import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'
import { join } from 'path'
import { app } from 'electron'
import koffi from 'koffi'

// ─── libmpv path ──────────────────────────────────────────────────────────────

function getLibmpvPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'libmpv-2.dll')
  // __dirname = out/main  →  ../../resources = project root/resources
  return join(__dirname, '../../resources/libmpv-2.dll')
}

// ─── Unix IPC layer (macOS/Linux only) ───────────────────────────────────────

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
    throw new Error('Could not connect to mpv IPC')
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
  id: number
  index: number
  title: string
  language: string
  selected: boolean
}

// ─── libmpv constants ─────────────────────────────────────────────────────────

const MPV_FORMAT_DOUBLE = 5
const MPV_FORMAT_FLAG   = 3
const MPV_FORMAT_STRING = 1

const MPV_EVENT_NONE            = 0
const MPV_EVENT_FILE_LOADED     = 8
const MPV_EVENT_END_FILE        = 7
const MPV_EVENT_PROPERTY_CHANGE = 22

const MPV_RENDER_PARAM_API_TYPE   = 1
const MPV_RENDER_PARAM_SW_SIZE    = 17
const MPV_RENDER_PARAM_SW_FORMAT  = 18
const MPV_RENDER_PARAM_SW_STRIDE  = 19
const MPV_RENDER_PARAM_SW_POINTER = 20
const MPV_RENDER_UPDATE_FRAME     = 1

// Build a binary mpv_render_param[] array.
// Each entry is 16 bytes on x64: [int32 type][int32 pad][uint64 data_ptr].
// koffi.address(buf) gives the native address of a Node.js Buffer.
// Passing the resulting Buffer as void* to mpv_render_context_create/render
// bypasses koffi struct marshaling and ensures correct pointer embedding.
function buildMpvRenderParams(entries: Array<{ type: number; data: Buffer | null }>): Buffer {
  const ENTRY = 16
  const buf = Buffer.alloc((entries.length + 1) * ENTRY)  // +1 for {0, NULL} terminator
  for (let i = 0; i < entries.length; i++) {
    buf.writeInt32LE(entries[i].type, i * ENTRY)
    if (entries[i].data) {
      buf.writeBigUInt64LE(koffi.address(entries[i].data!), i * ENTRY + 8)
    }
  }
  // terminator: {0, NULL} — Buffer is zero-initialised
  return buf
}

// ─── Win32 constants (WS_CHILD management) ────────────────────────────────────

const WS_CHILD          = 0x40000000
const WS_VISIBLE        = 0x10000000
const WS_CLIPSIBLINGS   = 0x04000000
const WS_CLIPCHILDREN   = 0x02000000
const WS_EX_NOACTIVATE  = 0x08000000
const GWL_STYLE         = -16
const SW_HIDE           = 0
const SW_SHOWNOACTIVATE = 4
const SWP_NOACTIVATE    = 0x0010

// ─── koffi struct/proto declarations (module-level, Windows only) ─────────────
// These are pure type registrations — no DLL is touched until getLibmpv() is called.

const MpvEvent = koffi.struct('MpvEvent', {
  event_id:       'int32',
  error:          'int32',
  reply_userdata: 'uint64',
  data:           'void *',
})

const MpvEventProperty = koffi.struct('MpvEventProperty', {
  name:   'str',    // const char* → JS string
  format: 'int32',
  data:   'void *', // points to typed value; decoded per format below
})

// Prototype for mpv_render_update_fn callback (name inline, koffi v3 syntax)
const UpdateFnProto = koffi.proto('void __cdecl UpdateFn(void *)')

// ─── koffi lazy loaders ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _libmpv: Record<string, any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLibmpv(): Record<string, any> {
  if (_libmpv) return _libmpv
  // Temporarily change working directory to the folder containing libmpv-2.dll
  // so the Windows DLL loader finds any companion DLLs via current-dir search.
  const libPath = getLibmpvPath()
  const libDir  = join(libPath, '..')
  const origDir = process.cwd()
  process.chdir(libDir)
  let lib: ReturnType<typeof koffi.load>
  try {
    lib = koffi.load(libPath)
  } catch (e) {
    process.chdir(origDir)
    throw e
  }
  process.chdir(origDir)
  // All opaque handles (mpv_handle*, mpv_render_context*) are declared as uint64
  // so koffi maps them as BigInt — avoids void* reference/pointer-to-pointer issues.
  // render_context_create: first arg is void** (out param) — pass a Buffer(8) and
  // read the handle back with readBigUInt64LE after the call.
  _libmpv = {
    create:               lib.func('uint64 __cdecl mpv_create()'),
    initialize:           lib.func('int32  __cdecl mpv_initialize(uint64)'),
    terminate_destroy:    lib.func('void   __cdecl mpv_terminate_destroy(uint64)'),
    set_option_string:    lib.func('int32  __cdecl mpv_set_option_string(uint64, str, str)'),
    set_property_string:  lib.func('int32  __cdecl mpv_set_property_string(uint64, str, str)'),
    observe_property:     lib.func('int32  __cdecl mpv_observe_property(uint64, uint64, str, int32)'),
    wait_event:           lib.func('MpvEvent * __cdecl mpv_wait_event(uint64, double)'),
    command_string:       lib.func('int32  __cdecl mpv_command_string(uint64, str)'),
    // returns char* — koffi copies to JS string on return; underlying C memory leaks (negligible)
    get_property_string:  lib.func('str    __cdecl mpv_get_property_string(uint64, str)'),
    error_string:         lib.func('str    __cdecl mpv_error_string(int32)'),
    // void** out param — caller passes Buffer(8); mpv writes the handle into it
    // render params passed as void* — caller manually builds binary param array
    render_context_create:              lib.func('int32  __cdecl mpv_render_context_create(void *, uint64, void *)'),
    render_context_set_update_callback: lib.func('mpv_render_context_set_update_callback', 'void', ['uint64', koffi.pointer(UpdateFnProto), 'void *']),
    render_context_update:              lib.func('uint32 __cdecl mpv_render_context_update(uint64)'),
    render_context_render:              lib.func('int32  __cdecl mpv_render_context_render(uint64, void *)'),
    render_context_report_swap:         lib.func('void   __cdecl mpv_render_context_report_swap(uint64)'),
    render_context_free:                lib.func('void   __cdecl mpv_render_context_free(uint64)'),
  }
  return _libmpv
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _w32: Record<string, any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getWin32(): Record<string, any> {
  if (_w32) return _w32
  const u32 = koffi.load('user32.dll')
  const g32 = koffi.load('gdi32.dll')
  _w32 = {
    CreateWindowExW: u32.func('uint64 __stdcall CreateWindowExW(uint64, str16, str16, uint32, int, int, int, int, uint64, uint64, uint64, uint64)'),
    SetWindowPos:    u32.func('bool   __stdcall SetWindowPos(uint64, uint64, int, int, int, int, uint32)'),
    ShowWindow:      u32.func('bool   __stdcall ShowWindow(uint64, int)'),
    DestroyWindow:   u32.func('bool   __stdcall DestroyWindow(uint64)'),
    SetWindowLongW:  u32.func('int32  __stdcall SetWindowLongW(uint64, int32, int32)'),
    GetWindowLongW:  u32.func('int32  __stdcall GetWindowLongW(uint64, int32)'),
    GetDC:           u32.func('uint64 __stdcall GetDC(uint64)'),
    ReleaseDC:       u32.func('int32  __stdcall ReleaseDC(uint64, uint64)'),
    StretchDIBits:   g32.func('int32  __stdcall StretchDIBits(uint64, int, int, int, int, int, int, int, int, void *, void *, uint32, uint32)'),
  }
  return _w32
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class MpvController extends EventEmitter {
  // Windows — libmpv handles (BigInt = uint64 pointer values)
  private mpvCtx: bigint = 0n
  private renderCtx: bigint = 0n
  private updateCb: unknown = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

  // Windows — pixel buffer for SW render
  private pixelBuf: Buffer | null = null
  private pixelW = 0
  private pixelH = 0
  private currentW = 0
  private currentH = 0
  // Kept as instance vars so GC doesn't collect them while an async render is in flight
  private paramSizeBuf = Buffer.alloc(8)
  private paramFmtBuf = Buffer.from('bgr0\0')
  private paramStrideBuf = Buffer.alloc(8)
  private renderInProgress = false
  private needsRender = false

  // Windows — WS_CHILD HWND
  private containerHwnd: bigint = 0n

  // macOS/Linux — child process + IPC + BrowserWindow
  private proc: ChildProcess | null = null
  private ipc = new MpvIpc()
  private containerWin: BrowserWindow | null = null
  private pipeName: string
  private pauseOnLoad = true

  private fileOpened = false

  readonly ready: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (e: Error) => void

  constructor(private mainWindow: BrowserWindow) {
    super()
    this.pipeName = process.platform === 'win32'
      ? `\\\\.\\pipe\\xivodreview-${process.pid}`
      : `/tmp/xivodreview-${process.pid}.sock`
    this.ready = new Promise((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    })
  }

  // ─── Launch ─────────────────────────────────────────────────────────────────

  async launch(mpvBin: string): Promise<void> {
    if (process.platform === 'win32') {
      try { await this.launchLibmpv() } catch (e) { this.readyReject(e as Error); throw e }
    } else {
      try { await this.launchSpawn(mpvBin) } catch (e) { this.readyReject(e as Error); throw e }
    }
  }

  // Windows: libmpv SW render path
  private async launchLibmpv(): Promise<void> {
    const api = getLibmpv()

    this.mpvCtx = api.create() as bigint
    if (!this.mpvCtx) throw new Error('mpv_create() failed — is libmpv-2.dll present in resources/?')

    // mpv_set_option_string uses canonical option names (no '--no-*' prefix aliases)
    const opts: [string, string][] = [
      ['keep-open',              'yes'],
      ['idle',                   'yes'],
      ['config',                 'no'],
      ['terminal',               'no'],
      ['osc',                    'no'],
      ['osd-level',              '0'],
      ['input-default-bindings', 'no'],
      ['input-vo-keyboard',      'no'],
      ['hwdec',                  'no'],    // SW render: no GPU readback needed; CPU decode is fast and non-blocking
      ['vo',                     'libmpv'],   // required for render API
    ]
    for (const [k, v] of opts) {
      const err = api.set_option_string(this.mpvCtx, k, v) as number
      if (err !== 0) console.warn(`[mpv] set_option_string('${k}', '${v}') = ${err}`)
    }
    const initErr = api.initialize(this.mpvCtx) as number
    if (initErr !== 0) throw new Error(`mpv_initialize() failed: ${initErr}`)

    // Observe scalar properties; track-list is fetched explicitly after file load
    api.observe_property(this.mpvCtx, 1, 'time-pos', MPV_FORMAT_DOUBLE)
    api.observe_property(this.mpvCtx, 2, 'duration',  MPV_FORMAT_DOUBLE)
    api.observe_property(this.mpvCtx, 3, 'pause',     MPV_FORMAT_FLAG)

    // Create WS_CHILD — no WS_EX_TRANSPARENT since mpv no longer owns the HWND
    const mainHwndBuf = this.mainWindow.getNativeWindowHandle()
    const mainHwnd: bigint = mainHwndBuf.length >= 8
      ? mainHwndBuf.readBigUInt64LE(0)
      : BigInt(mainHwndBuf.readUInt32LE(0))

    const win32 = getWin32()
    this.containerHwnd = win32.CreateWindowExW(
      BigInt(WS_EX_NOACTIVATE),
      'Static', '',
      WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
      -640, -360, 640, 360,
      mainHwnd, 0n, 0n, 0n
    ) as bigint
    if (!this.containerHwnd) throw new Error('Failed to create WS_CHILD window')

    // WS_CLIPCHILDREN on the main window so GDI clips around our child area
    const mainStyle = win32.GetWindowLongW(mainHwnd, GWL_STYLE) as number
    win32.SetWindowLongW(mainHwnd, GWL_STYLE, mainStyle | WS_CLIPCHILDREN)

    // Create SW render context
    // Use buildMpvRenderParams to embed Buffer addresses directly (bypasses koffi struct marshaling)
    const swStr = Buffer.from('sw\0')
    const initParams = buildMpvRenderParams([
      { type: MPV_RENDER_PARAM_API_TYPE, data: swStr },
    ])
    // Pass an 8-byte Buffer as the void** out param; mpv writes the handle into it
    const rcBuf = Buffer.alloc(8)
    const rcErr = api.render_context_create(rcBuf, this.mpvCtx, initParams) as number
    if (rcErr !== 0) throw new Error(`mpv_render_context_create failed: ${rcErr}`)
    this.renderCtx = rcBuf.readBigUInt64LE(0)

    // Register update callback — koffi marshals cross-thread call to JS event loop
    this.updateCb = koffi.register(
      (): void => { this.scheduleRender() },
      koffi.pointer(UpdateFnProto)
    )
    api.render_context_set_update_callback(this.renderCtx, this.updateCb, null)

    // Poll mpv event queue
    this.pollTimer = setInterval(() => this.drainEvents(), 8)

    this.readyResolve()
  }

  // macOS/Linux: spawn mpv + JSON IPC
  private async launchSpawn(mpvBin: string): Promise<void> {
    // WS_CHILD not applicable; use a frameless BrowserWindow as container
    this.containerWin = new BrowserWindow({
      parent: this.mainWindow,
      x: -9999, y: -9999,
      width: 640, height: 360,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })
    this.containerWin.showInactive()
    this.containerWin.setIgnoreMouseEvents(true, { forward: true })

    const hwndBuf = this.containerWin.getNativeWindowHandle()
    const hwnd: bigint = hwndBuf.length >= 8
      ? hwndBuf.readBigUInt64LE(0)
      : BigInt(hwndBuf.readUInt32LE(0))

    this.proc = spawn(mpvBin, [
      `--wid=${hwnd}`,
      `--input-ipc-server=${this.pipeName}`,
      '--no-config', '--no-terminal', '--no-osc',
      '--no-input-default-bindings', '--input-vo-keyboard=no',
      '--keep-open=yes', '--idle=yes', '--force-window=yes',
      '--vo=gpu', '--hwdec=auto',
    ])

    this.proc.on('error', (e: NodeJS.ErrnoException) => {
      const msg = e.code === 'ENOENT' ? `mpv not found at "${mpvBin}"` : `mpv process error: ${e.message}`
      console.error('[mpv]', msg)
      this.readyReject(new Error(msg))
    })
    this.proc.on('exit', (code, signal) => console.log(`[mpv] exited: code=${code} signal=${signal}`))
    this.proc.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) console.log('[mpv]', l) })

    try { await this.ipc.connect(this.pipeName) } catch (e) { this.readyReject(e as Error); throw e }

    await this.ipc.send(['observe_property', 1, 'time-pos'])
    await this.ipc.send(['observe_property', 2, 'duration'])
    await this.ipc.send(['observe_property', 3, 'pause'])
    await this.ipc.send(['observe_property', 4, 'track-list'])

    this.ipc.on('mpvEvent', (e: MpvMsg) => this.handleIpcEvent(e))
    this.ipc.on('close', () => this.emit('closed'))
    this.readyResolve()
  }

  // ─── libmpv event loop (Windows) ────────────────────────────────────────────

  private drainEvents(): void {
    if (!this.mpvCtx) return
    const api = getLibmpv()
    for (let i = 0; i < 64; i++) {
      // wait_event returns MpvEvent* — koffi gives back an opaque pointer; decode manually
      const evPtr = api.wait_event(this.mpvCtx, 0)
      if (!evPtr) break
      const ev = koffi.decode(evPtr, MpvEvent) as { event_id: number; error: number; data: unknown }
      if (ev.event_id === MPV_EVENT_NONE) break
      switch (ev.event_id) {
        case MPV_EVENT_FILE_LOADED:
          this.emit('fileLoaded')
          this.fetchTrackList()
          break
        case MPV_EVENT_END_FILE:
          this.emit('fileEnded')
          break
        case MPV_EVENT_PROPERTY_CHANGE: {
          try {
            const prop = koffi.decode(ev.data, MpvEventProperty) as { name: string; format: number; data: unknown }
            this.handleLibmpvProperty(prop.name, prop.format, prop.data)
          } catch { /* ignore malformed event */ }
          break
        }
      }
    }
    // Render after draining — ensures mpv's VO thread has processed events first
    if (this.needsRender && !this.renderInProgress && this.containerHwnd) {
      this.needsRender = false
      this.renderFrame()
    }
  }

  private handleLibmpvProperty(name: string, format: number, dataPtr: unknown): void {
    switch (name) {
      case 'time-pos':
        if (format === MPV_FORMAT_DOUBLE)
          this.emit('timeUpdate', koffi.decode(dataPtr, 'double') as number)
        break
      case 'duration':
        if (format === MPV_FORMAT_DOUBLE)
          this.emit('durationChange', koffi.decode(dataPtr, 'double') as number)
        break
      case 'pause':
        if (format === MPV_FORMAT_FLAG)
          this.emit('pauseChange', !!(koffi.decode(dataPtr, 'int32') as number))
        break
      // track-list is fetched explicitly via fetchTrackList() on file load
    }
  }

  private fetchTrackList(): void {
    if (!this.mpvCtx) return
    const api = getLibmpv()
    try {
      // koffi copies the char* to a JS string on return; C memory is not freed (negligible)
      const json = api.get_property_string(this.mpvCtx, 'track-list') as string
      if (json) {

        this.emit('tracksChange', this.parseAudioTracks(JSON.parse(json)))
      }
    } catch (e) {
      console.warn(`[mpv] fetchTrackList error: ${e}`)
    }
  }

  // ─── libmpv render + GDI paint (Windows) ────────────────────────────────────

  private scheduleRender(): void {
    if (!this.renderCtx || !this.fileOpened) return
    const api = getLibmpv()
    const flags = api.render_context_update(this.renderCtx) as number
    if (flags & MPV_RENDER_UPDATE_FRAME) this.needsRender = true
  }

  private renderFrame(): void {
    if (!this.renderCtx || this.renderInProgress) return
    const w = Math.max(1, this.pixelW)
    const h = Math.max(1, this.pixelH)
    const stride = w * 4

    if (!this.pixelBuf || this.pixelBuf.length !== stride * h) {
      this.pixelBuf = Buffer.alloc(stride * h)
    }

    // Update instance-variable param buffers (stay alive across the async C call)
    this.paramSizeBuf.writeInt32LE(w, 0)
    this.paramSizeBuf.writeInt32LE(h, 4)
    this.paramStrideBuf.writeBigUInt64LE(BigInt(stride), 0)

    // Build params with explicit native Buffer addresses — bypasses koffi struct marshaling
    const renderParams = buildMpvRenderParams([
      { type: MPV_RENDER_PARAM_SW_SIZE,    data: this.paramSizeBuf },
      { type: MPV_RENDER_PARAM_SW_FORMAT,  data: this.paramFmtBuf },
      { type: MPV_RENDER_PARAM_SW_STRIDE,  data: this.paramStrideBuf },
      { type: MPV_RENDER_PARAM_SW_POINTER, data: this.pixelBuf! },
    ])

    this.renderInProgress = true
    const api = getLibmpv()
    const rc = api.render_context_render(this.renderCtx, renderParams) as number
    this.renderInProgress = false
    if (rc !== 0) return
    api.render_context_report_swap(this.renderCtx)
    this.paintToHwnd(w, h, stride)
  }

  private paintToHwnd(srcW: number, srcH: number, _stride: number): void {
    if (!this.containerHwnd || !this.pixelBuf) return
    const win32 = getWin32()
    const dc = win32.GetDC(this.containerHwnd) as bigint
    if (!dc) return
    try {
      // BITMAPINFOHEADER (40 bytes) + BITMAPINFO padding
      const bmi = Buffer.alloc(44)
      bmi.writeUInt32LE(40, 0)      // biSize
      bmi.writeInt32LE(srcW, 4)     // biWidth
      bmi.writeInt32LE(-srcH, 8)    // biHeight (negative = top-down scan order)
      bmi.writeUInt16LE(1, 12)      // biPlanes
      bmi.writeUInt16LE(32, 14)     // biBitCount
      // biCompression=0 (BI_RGB), remaining fields default to 0

      const dstW = Math.max(1, this.currentW)
      const dstH = Math.max(1, this.currentH)

      win32.StretchDIBits(
        dc,
        0, 0, dstW, dstH,     // dest rect
        0, 0, srcW, srcH,     // src rect
        this.pixelBuf,
        bmi,
        0,           // DIB_RGB_COLORS
        0x00CC0020   // SRCCOPY
      )
    } finally {
      win32.ReleaseDC(this.containerHwnd, dc)
    }
  }

  // ─── macOS/Linux IPC event handler ───────────────────────────────────────────

  private handleIpcEvent(e: MpvMsg) {
    if (e.event === 'property-change') {
      switch (e.name) {
        case 'time-pos':   this.emit('timeUpdate',    typeof e.data === 'number' ? e.data : 0); break
        case 'duration':   this.emit('durationChange', typeof e.data === 'number' ? e.data : 0); break
        case 'pause':      this.emit('pauseChange',    !!e.data); break
        case 'track-list': this.emit('tracksChange',   this.parseAudioTracks(e.data as MpvTrackEntry[])); break
      }
    } else if (e.event === 'file-loaded') {
      if (this.pauseOnLoad) this.ipc.send(['set_property', 'pause', true]).catch(() => {})
      this.emit('fileLoaded')
    } else if (e.event === 'end-file') {
      this.emit('fileEnded')
    }
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

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

  // ─── Playback commands ───────────────────────────────────────────────────────

  async openFile(path: string): Promise<void> {
    this.fileOpened = true
    if (process.platform === 'win32') {
      this.pixelW = Math.max(1, this.currentW)
      this.pixelH = Math.max(1, this.currentH)
      const escaped = path.replace(/\\/g, '/').replace(/"/g, '\\"')
      const cmd = `loadfile "${escaped}"`
      const cmdErr = getLibmpv().command_string(this.mpvCtx, cmd) as number
    } else {
      this.pauseOnLoad = true
      await this.ipc.send(['loadfile', path, 'replace'])
    }
  }

  async play(): Promise<void> {
    if (process.platform === 'win32') getLibmpv().set_property_string(this.mpvCtx, 'pause', 'no')
    else await this.ipc.send(['set_property', 'pause', false])
  }

  async pause(): Promise<void> {
    if (process.platform === 'win32') getLibmpv().set_property_string(this.mpvCtx, 'pause', 'yes')
    else await this.ipc.send(['set_property', 'pause', true])
  }

  async togglePause(): Promise<void> {
    if (process.platform === 'win32') getLibmpv().command_string(this.mpvCtx, 'cycle pause')
    else await this.ipc.send(['cycle', 'pause'])
  }

  async seek(seconds: number, type: 'absolute' | 'relative' = 'absolute'): Promise<void> {
    if (process.platform === 'win32') getLibmpv().command_string(this.mpvCtx, `seek ${seconds} ${type}`)
    else await this.ipc.send(['seek', seconds, type])
  }

  async frameStep(): Promise<void> {
    if (process.platform === 'win32') getLibmpv().command_string(this.mpvCtx, 'frame-step')
    else await this.ipc.send(['frame-step'])
  }

  async frameBackStep(): Promise<void> {
    if (process.platform === 'win32') getLibmpv().command_string(this.mpvCtx, 'frame-back-step')
    else await this.ipc.send(['frame-back-step'])
  }

  async setVolume(level: number): Promise<void> {
    const v = String(Math.round(Math.max(0, Math.min(1, level)) * 100))
    if (process.platform === 'win32') getLibmpv().set_property_string(this.mpvCtx, 'volume', v)
    else await this.ipc.send(['set_property', 'volume', Math.round(Math.max(0, Math.min(1, level)) * 100)])
  }

  async addVolume(delta: number): Promise<void> {
    if (process.platform === 'win32') getLibmpv().command_string(this.mpvCtx, `add volume ${Math.round(delta * 100)}`)
    else await this.ipc.send(['add', 'volume', Math.round(delta * 100)])
  }

  async setMute(muted: boolean): Promise<void> {
    if (process.platform === 'win32') getLibmpv().set_property_string(this.mpvCtx, 'mute', muted ? 'yes' : 'no')
    else await this.ipc.send(['set_property', 'mute', muted])
  }

  async setAudioTrack(trackId: number): Promise<void> {
    if (process.platform === 'win32') getLibmpv().set_property_string(this.mpvCtx, 'aid', String(trackId))
    else await this.ipc.send(['set_property', 'aid', trackId])
  }

  async command(args: unknown[]): Promise<unknown> {
    if (process.platform === 'win32') {
      getLibmpv().command_string(this.mpvCtx, args.map(String).join(' '))
      return undefined
    }
    return this.ipc.send(args)
  }

  // ─── Window management ───────────────────────────────────────────────────────

  setVideoBounds(x: number, y: number, width: number, height: number): void {
    const rx = Math.round(x)
    const ry = Math.round(y)
    const w  = Math.max(1, Math.round(width))
    const h  = Math.max(1, Math.round(height))
    this.currentW = w
    this.currentH = h

    if (process.platform === 'win32') {
      if (!this.containerHwnd) return
      if (this.fileOpened) {
        this.pixelW = w
        this.pixelH = h
        const win32 = getWin32()
        win32.ShowWindow(this.containerHwnd, SW_SHOWNOACTIVATE)
        win32.SetWindowPos(this.containerHwnd, 0n, rx, ry, w, h, SWP_NOACTIVATE)
        // Repaint last frame at new dimensions immediately
        if (this.renderCtx && this.pixelBuf) this.renderFrame()
      }
    } else {
      if (!this.containerWin || this.containerWin.isDestroyed()) return
      if (this.fileOpened) this.containerWin.setBounds({ x: rx, y: ry, width: w, height: h })
      else this.containerWin.setBounds({ x: -9999, y: -9999, width: w, height: h })
    }
  }

  hideVideo(): void {
    if (process.platform === 'win32') {
      if (this.containerHwnd) getWin32().ShowWindow(this.containerHwnd, SW_HIDE)
    } else {
      if (this.containerWin && !this.containerWin.isDestroyed())
        this.containerWin.setBounds({ x: -9999, y: -9999, width: 640, height: 360 })
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  quit(): void {
    if (process.platform === 'win32') {
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (this.updateCb) { koffi.unregister(this.updateCb as any); this.updateCb = null }
      if (this.renderCtx) { getLibmpv().render_context_free(this.renderCtx); this.renderCtx = 0n }
      if (this.mpvCtx) { getLibmpv().terminate_destroy(this.mpvCtx); this.mpvCtx = 0n }
      if (this.containerHwnd) { getWin32().DestroyWindow(this.containerHwnd); this.containerHwnd = 0n }
    } else {
      this.ipc.close()
      try { this.ipc.send(['quit']).catch(() => {}) } catch { /* already closed */ }
      this.proc?.kill()
      this.proc = null
      if (this.containerWin && !this.containerWin.isDestroyed()) this.containerWin.destroy()
      this.containerWin = null
    }
  }
}
