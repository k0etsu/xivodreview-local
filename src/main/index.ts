import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'

if (process.platform === 'win32') app.setAppUserModelId('com.xivodreview.local')
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { execFile, spawn } from 'child_process'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import {
  fetchFFLogsToken,
  invalidateToken,
  queryFFLogsReport,
  queryFFLogsDeaths
} from './fflogs'

// Temp files created when remuxing audio tracks; cleaned up on quit.
const tempFiles = new Set<string>()

const store = new Store<{
  fflogsClientId: string
  fflogsClientSecret: string
  savedEncounters: Record<string, { offset: number; name: string }>
  windowBounds: { x: number; y: number; width: number; height: number }
  windowMaximized: boolean
  windowFullScreen: boolean
}>()

function createWindow(): void {
  const savedBounds = store.get('windowBounds') as { x: number; y: number; width: number; height: number } | undefined
  const savedMaximized = store.get('windowMaximized') as boolean | undefined
  const savedFullScreen = store.get('windowFullScreen') as boolean | undefined

  const mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1440,
    height: savedBounds?.height ?? 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow local file video playback
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (savedFullScreen) {
      mainWindow.setFullScreen(true)
    } else if (savedMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getNormalBounds())
    store.set('windowMaximized', mainWindow.isMaximized())
    store.set('windowFullScreen', mainWindow.isFullScreen())
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC: open video file dialog
  ipcMain.handle('dialog:openVideo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Video File',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov', 'ts', 'm4v'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // IPC: window controls
  ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('window:close', () => BrowserWindow.getFocusedWindow()?.close())

  // IPC: test FFLogs credentials by attempting a token fetch
  ipcMain.handle('fflogs:testCredentials', async (_event, clientId: string, clientSecret: string) => {
    try {
      await fetchFFLogsToken(clientId, clientSecret)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // IPC: fetch FFLogs report (fights + masterData + phases)
  ipcMain.handle('fflogs:fetchReport', async (_event, reportCode: string) => {
    const clientId = store.get('fflogsClientId', '')
    const clientSecret = store.get('fflogsClientSecret', '')
    if (!clientId || !clientSecret) {
      throw new Error('FFLogs credentials not configured. Open Settings to add them.')
    }
    try {
      const token = await fetchFFLogsToken(clientId, clientSecret)
      return await queryFFLogsReport(reportCode, token)
    } catch (err) {
      invalidateToken()
      throw err
    }
  })

  // IPC: fetch death events for a specific fight window
  ipcMain.handle(
    'fflogs:fetchDeaths',
    async (_event, reportCode: string, startTime: number, endTime: number) => {
      const clientId = store.get('fflogsClientId', '')
      const clientSecret = store.get('fflogsClientSecret', '')
      if (!clientId || !clientSecret) {
        throw new Error('FFLogs credentials not configured.')
      }
      try {
        const token = await fetchFFLogsToken(clientId, clientSecret)
        return await queryFFLogsDeaths(reportCode, startTime, endTime, token)
      } catch (err) {
        invalidateToken()
        throw err
      }
    }
  )

  // IPC: probe audio tracks in a video file via ffprobe
  ipcMain.handle('video:getAudioTracks', (_event, filePath: string) =>
    new Promise<{ index: number; title: string; language: string }[]>((resolve, reject) => {
      execFile(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'a', filePath],
        { maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code
            return reject(new Error(code === 'ENOENT' ? 'ffprobe not found in PATH' : `ffprobe: ${err.message}`))
          }
          try {
            const streams = (JSON.parse(stdout) as { streams: Record<string, unknown>[] }).streams
            resolve(streams.map((s, i) => {
              const tags = (s.tags ?? {}) as Record<string, string>
              return {
                index: i,
                title: tags.title ?? tags.TITLE ?? `Track ${i + 1}`,
                language: tags.language ?? tags.LANGUAGE ?? ''
              }
            }))
          } catch (e) {
            reject(new Error(`Failed to parse ffprobe output: ${e}`))
          }
        }
      )
    })
  )

  // IPC: remux video keeping only the specified audio track into a temp file
  ipcMain.handle('video:remuxWithTrack', (_event, filePath: string, audioTrackIndex: number) =>
    new Promise<string>((resolve, reject) => {
      const tmpPath = join(tmpdir(), `xivodreview-${randomUUID()}.mkv`)
      const proc = spawn('ffmpeg', [
        '-y', '-i', filePath,
        '-map', '0:v:0',
        '-map', `0:a:${audioTrackIndex}`,
        '-c', 'copy',
        tmpPath
      ])
      let stderr = ''
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('error', (e: NodeJS.ErrnoException) =>
        reject(new Error(e.code === 'ENOENT' ? 'ffmpeg not found in PATH' : e.message))
      )
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`))
        tempFiles.add(tmpPath)
        resolve(tmpPath)
      })
    })
  )

  // IPC: check whether a file path exists on disk
  ipcMain.handle('fs:exists', (_event, filePath: string) => existsSync(filePath))

  // IPC: electron-store access
  ipcMain.handle('store:get', (_event, key: string) => store.get(key))
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => store.set(key, value))
  ipcMain.handle('store:delete', (_event, key: string) => store.delete(key))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  for (const f of tempFiles) { try { unlinkSync(f) } catch (_) {} }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
