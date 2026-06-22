import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // ─── File dialog ────────────────────────────────────────────────────────────
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),

  // ─── Window controls ────────────────────────────────────────────────────────
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  windowClose:    (): Promise<void> => ipcRenderer.invoke('window:close'),

  // ─── FFLogs ─────────────────────────────────────────────────────────────────
  testCredentials: (clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fflogs:testCredentials', clientId, clientSecret),

  fetchReport: (reportCode: string): Promise<unknown> =>
    ipcRenderer.invoke('fflogs:fetchReport', reportCode),

  fetchDeaths: (reportCode: string, startTime: number, endTime: number): Promise<unknown> =>
    ipcRenderer.invoke('fflogs:fetchDeaths', reportCode, startTime, endTime),

  // ─── Filesystem ─────────────────────────────────────────────────────────────
  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),

  // ─── Store ──────────────────────────────────────────────────────────────────
  storeGet:    (key: string): Promise<unknown>         => ipcRenderer.invoke('store:get', key),
  storeSet:    (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('store:set', key, value),
  storeDelete: (key: string): Promise<void>            => ipcRenderer.invoke('store:delete', key),

  // ─── mpv playback commands ───────────────────────────────────────────────────
  mpvOpenFile:      (path: string): Promise<void>                         => ipcRenderer.invoke('mpv:openFile', path),
  mpvPlay:          (): Promise<void>                                      => ipcRenderer.invoke('mpv:play'),
  mpvPause:         (): Promise<void>                                      => ipcRenderer.invoke('mpv:pause'),
  mpvTogglePause:   (): Promise<void>                                      => ipcRenderer.invoke('mpv:togglePause'),
  mpvSeek:          (s: number, type: 'absolute' | 'relative'): Promise<void> => ipcRenderer.invoke('mpv:seek', s, type),
  mpvFrameStep:     (): Promise<void>                                      => ipcRenderer.invoke('mpv:frameStep'),
  mpvFrameBackStep: (): Promise<void>                                      => ipcRenderer.invoke('mpv:frameBackStep'),
  mpvSetVolume:     (level: number): Promise<void>                         => ipcRenderer.invoke('mpv:setVolume', level),
  mpvAddVolume:     (delta: number): Promise<void>                         => ipcRenderer.invoke('mpv:addVolume', delta),
  mpvSetMute:       (muted: boolean): Promise<void>                        => ipcRenderer.invoke('mpv:setMute', muted),
  mpvSetAudioTrack: (id: number): Promise<void>                            => ipcRenderer.invoke('mpv:setAudioTrack', id),
  mpvCommand:       (args: unknown[]): Promise<unknown>                    => ipcRenderer.invoke('mpv:command', args),

  // Renderer reports video-container bounds (viewport-relative) so the main
  // process can position the mpv child window correctly.
  mpvSetViewportBounds: (bounds: { left: number; top: number; width: number; height: number }): void =>
    ipcRenderer.send('mpv:setViewportBounds', bounds),

  // ─── mpv event subscriptions ─────────────────────────────────────────────────
  // Each mpvOn* registers a persistent listener; call mpvOffAll on unmount.
  mpvOnTimeUpdate:  (cb: (t: number) => void): void      => { ipcRenderer.on('mpv:timeUpdate',    (_, t) => cb(t as number)) },
  mpvOnDuration:    (cb: (d: number) => void): void      => { ipcRenderer.on('mpv:durationChange',(_, d) => cb(d as number)) },
  mpvOnPause:       (cb: (p: boolean) => void): void     => { ipcRenderer.on('mpv:pauseChange',   (_, p) => cb(p as boolean)) },
  mpvOnTracks:      (cb: (t: unknown[]) => void): void   => { ipcRenderer.on('mpv:tracksChange',  (_, t) => cb(t as unknown[])) },
  mpvOnFileLoaded:  (cb: () => void): void               => { ipcRenderer.on('mpv:fileLoaded',    () => cb()) },
  mpvOnFileEnded:   (cb: () => void): void               => { ipcRenderer.on('mpv:fileEnded',     () => cb()) },

  mpvOffAll: (): void => {
    for (const ch of ['mpv:timeUpdate','mpv:durationChange','mpv:pauseChange','mpv:tracksChange','mpv:fileLoaded','mpv:fileEnded']) {
      ipcRenderer.removeAllListeners(ch)
    }
  }
})
