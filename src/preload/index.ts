import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),

  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),


  testCredentials: (clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fflogs:testCredentials', clientId, clientSecret),

  fetchReport: (reportCode: string): Promise<unknown> =>
    ipcRenderer.invoke('fflogs:fetchReport', reportCode),

  fetchDeaths: (reportCode: string, startTime: number, endTime: number): Promise<unknown> =>
    ipcRenderer.invoke('fflogs:fetchDeaths', reportCode, startTime, endTime),

  getAudioTracks: (filePath: string): Promise<{ index: number; title: string; language: string }[]> =>
    ipcRenderer.invoke('video:getAudioTracks', filePath),

  remuxWithTrack: (filePath: string, audioTrackIndex: number): Promise<string> =>
    ipcRenderer.invoke('video:remuxWithTrack', filePath, audioTrackIndex),

  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),

  storeGet: (key: string): Promise<unknown> => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('store:set', key, value),
  storeDelete: (key: string): Promise<void> => ipcRenderer.invoke('store:delete', key)
})
