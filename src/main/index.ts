import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import {
  fetchFFLogsToken,
  invalidateToken,
  queryFFLogsReport,
  queryFFLogsDeaths
} from './fflogs'

const store = new Store<{
  fflogsClientId: string
  fflogsClientSecret: string
  savedEncounters: Record<string, { offset: number; name: string }>
}>()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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
    mainWindow.show()
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
  electronApp.setAppUserModelId('com.xivod.local')

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

  // IPC: electron-store access
  ipcMain.handle('store:get', (_event, key: string) => store.get(key))
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => store.set(key, value))
  ipcMain.handle('store:delete', (_event, key: string) => store.delete(key))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
