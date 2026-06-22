import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'

// Must be called before app is ready. Disables Chrome's DirectComposition
// GPU overlay so mpv's WS_CHILD window (via --wid) is not covered.
if (process.platform === 'win32') app.disableHardwareAcceleration()

if (process.platform === 'win32') app.setAppUserModelId('com.xivodreview.local')
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import {
  fetchFFLogsToken,
  invalidateToken,
  queryFFLogsReport,
  queryFFLogsDeaths
} from './fflogs'
import { MpvController } from './mpv'

const store = new Store<{
  fflogsClientId: string
  fflogsClientSecret: string
  savedEncounters: Record<string, { offset: number; name: string }>
  windowBounds: { x: number; y: number; width: number; height: number }
  windowMaximized: boolean
  windowFullScreen: boolean
}>()

// mpv binary: bundled in resources/ for packaged builds, otherwise expect in PATH
function getMpvBin(): string {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, process.platform === 'win32' ? 'mpv.exe' : 'mpv')
    if (existsSync(bundled)) return bundled
  }
  return process.platform === 'win32' ? 'mpv.exe' : 'mpv'
}

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
    }
  })

  // ─── mpv setup ─────────────────────────────────────────────────────────────

  const mpv = new MpvController(mainWindow)

  // Viewport-relative bounds of the video-container div sent by the renderer.
  // Combined with mainWindow.getContentBounds() to get absolute screen position.
  let vpBounds = { left: 0, top: 38, width: 100, height: 100 }

  function updateMpvBounds() {
    const cb = mainWindow.getContentBounds()
    mpv.setVideoBounds(
      cb.x + vpBounds.left,
      cb.y + vpBounds.top,
      vpBounds.width,
      vpBounds.height
    )
  }

  mainWindow.on('move',     updateMpvBounds)
  mainWindow.on('resize',   updateMpvBounds)
  // Keep mpv on top only while this app is focused so it doesn't float
  // above unrelated applications when the user switches away.
  // Hide mpv's window when the main window is minimized/restored.
  mainWindow.on('minimize', () => mpv.hideVideo())
  mainWindow.on('restore',  () => updateMpvBounds())

  // Launch mpv eagerly — should be connected before the user opens a file
  mpv.launch(getMpvBin())
    .then(() => {
      console.log('[mpv] ready')
      // Wire up events → renderer
      mpv.on('timeUpdate',    (t) => mainWindow.webContents.send('mpv:timeUpdate', t))
      mpv.on('durationChange',(d) => mainWindow.webContents.send('mpv:durationChange', d))
      mpv.on('pauseChange',   (p) => {
        mainWindow.webContents.send('mpv:pauseChange', p)
        // Clicking the video area gives focus to mpv's window.
        // Return it to the main window so keyboard hotkeys keep working.
        if (!mainWindow.isFocused()) mainWindow.focus()
      })
      mpv.on('tracksChange',  (t) => mainWindow.webContents.send('mpv:tracksChange', t))
      mpv.on('fileLoaded',    ()  => mainWindow.webContents.send('mpv:fileLoaded'))
      mpv.on('fileEnded',     ()  => mainWindow.webContents.send('mpv:fileEnded'))
    })
    .catch(e => console.error('[mpv] launch failed:', e))

  // ─── Window lifecycle ───────────────────────────────────────────────────────

  mainWindow.on('ready-to-show', () => {
    if (savedFullScreen) mainWindow.setFullScreen(true)
    else if (savedMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getNormalBounds())
    store.set('windowMaximized', mainWindow.isMaximized())
    store.set('windowFullScreen', mainWindow.isFullScreen())
    mpv.quit()
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

  // ─── mpv IPC handlers ───────────────────────────────────────────────────────

  // Renderer reports the video-container div's bounds (viewport-relative).
  // We combine this with the window's content bounds to position the mpv child window.
  ipcMain.on('mpv:setViewportBounds', (_, bounds: typeof vpBounds) => {
    vpBounds = bounds
    updateMpvBounds()
  })

  ipcMain.handle('mpv:setHidden',    (_, hidden: boolean)                          => hidden ? mpv.hideVideo() : updateMpvBounds())
  ipcMain.handle('mpv:openFile',     async (_, path: string)                       => { await mpv.openFile(path); updateMpvBounds() })
  ipcMain.handle('mpv:play',         async ()                                       => mpv.play())
  ipcMain.handle('mpv:pause',        async ()                                       => mpv.pause())
  ipcMain.handle('mpv:togglePause',  async ()                                       => mpv.togglePause())
  ipcMain.handle('mpv:seek',         async (_, s: number, t: 'absolute'|'relative') => mpv.seek(s, t))
  ipcMain.handle('mpv:frameStep',    async ()                                       => mpv.frameStep())
  ipcMain.handle('mpv:frameBackStep',async ()                                       => mpv.frameBackStep())
  ipcMain.handle('mpv:setVolume',    async (_, level: number)                       => mpv.setVolume(level))
  ipcMain.handle('mpv:addVolume',    async (_, delta: number)                       => mpv.addVolume(delta))
  ipcMain.handle('mpv:setMute',      async (_, muted: boolean)                      => mpv.setMute(muted))
  ipcMain.handle('mpv:setAudioTrack',async (_, id: number)                          => mpv.setAudioTrack(id))
  ipcMain.handle('mpv:command',      async (_, args: unknown[])                     => mpv.command(args))
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ─── Dialog ──────────────────────────────────────────────────────────────────

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

  // ─── Window controls ─────────────────────────────────────────────────────────

  ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('window:close', () => BrowserWindow.getFocusedWindow()?.close())

  // ─── FFLogs ──────────────────────────────────────────────────────────────────

  ipcMain.handle('fflogs:testCredentials', async (_event, clientId: string, clientSecret: string) => {
    try {
      await fetchFFLogsToken(clientId, clientSecret)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('fflogs:fetchReport', async (_event, reportCode: string) => {
    const clientId = store.get('fflogsClientId', '')
    const clientSecret = store.get('fflogsClientSecret', '')
    if (!clientId || !clientSecret) throw new Error('FFLogs credentials not configured. Open Settings to add them.')
    try {
      const token = await fetchFFLogsToken(clientId, clientSecret)
      return await queryFFLogsReport(reportCode, token)
    } catch (err) {
      invalidateToken(); throw err
    }
  })

  ipcMain.handle('fflogs:fetchDeaths', async (_event, reportCode: string, startTime: number, endTime: number) => {
    const clientId = store.get('fflogsClientId', '')
    const clientSecret = store.get('fflogsClientSecret', '')
    if (!clientId || !clientSecret) throw new Error('FFLogs credentials not configured.')
    try {
      const token = await fetchFFLogsToken(clientId, clientSecret)
      return await queryFFLogsDeaths(reportCode, startTime, endTime, token)
    } catch (err) {
      invalidateToken(); throw err
    }
  })

  // ─── Store / filesystem ───────────────────────────────────────────────────────

  ipcMain.handle('fs:exists', (_event, filePath: string) => existsSync(filePath))
  ipcMain.handle('store:get',    (_event, key: string)                => store.get(key))
  ipcMain.handle('store:set',    (_event, key: string, value: unknown) => store.set(key, value))
  ipcMain.handle('store:delete', (_event, key: string)                => store.delete(key))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
