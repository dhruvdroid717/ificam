import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('ificam', {
  appName: 'iFicam',
  milestone: 5,
  getServerInfo: () => ipcRenderer.invoke('ificam:get-server-info'),
  setAdapter: (ip: string) => ipcRenderer.invoke('ificam:set-adapter', ip),
  onServerInfo: (callback: (state: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown): void => callback(state);
    ipcRenderer.on('ificam:server-info', listener);
    return () => ipcRenderer.removeListener('ificam:server-info', listener);
  },
  getSettings: () => ipcRenderer.invoke('ificam:get-settings'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('ificam:update-settings', patch),
  chooseOutputFolder: () => ipcRenderer.invoke('ificam:choose-output-folder'),
  onSettings: (callback: (settings: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, settings: unknown): void => callback(settings);
    ipcRenderer.on('ificam:settings', listener);
    return () => ipcRenderer.removeListener('ificam:settings', listener);
  },
  recStart: (ext: 'mp4' | 'webm') => ipcRenderer.invoke('ificam:rec-start', ext),
  recChunk: (chunk: ArrayBuffer) => ipcRenderer.invoke('ificam:rec-chunk', chunk),
  recStop: (options: unknown) => ipcRenderer.invoke('ificam:rec-stop', options) as Promise<{ filePath: string }>,
  reveal: (filePath: string) => ipcRenderer.invoke('ificam:reveal', filePath),
  play: (filePath: string) => ipcRenderer.invoke('ificam:play', filePath),
  getUpdateState: () => ipcRenderer.invoke('ificam:update-get-state'),
  checkForUpdates: () => ipcRenderer.invoke('ificam:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('ificam:update-download'),
  installUpdate: () => ipcRenderer.invoke('ificam:update-install'),
  onUpdateState: (callback: (state: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown): void => callback(state);
    ipcRenderer.on('ificam:update-state', listener);
    return () => ipcRenderer.removeListener('ificam:update-state', listener);
  },
});
