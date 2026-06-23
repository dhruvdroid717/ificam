import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { createIFiCamServer, type IFiCamServer, type IFiCamServerInfo } from './server';
import { startRecording, stopRecording, writeChunk } from './recorder';
import { readSettings, updateSettings, type AppSettings, type RecordingResolution } from './settings';
import { setupAutoUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;
let server: IFiCamServer | null = null;
let serverInfo: IFiCamServerInfo | null = null;
let serverError: string | null = null;
let appSettings: AppSettings | null = null;

setupAutoUpdater(() => mainWindow);

const broadcastServerState = (): void => {
  mainWindow?.webContents.send('ificam:server-info', { serverInfo, serverError });
};

const broadcastSettings = (): void => {
  if (appSettings) {
    mainWindow?.webContents.send('ificam:settings', appSettings);
  }
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0B0D10',
    title: 'iFicam by @Ungyani',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(process.cwd(), 'build', 'icon.ico'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 540,
          minWidth: 360,
          minHeight: 240,
          backgroundColor: '#000000',
          title: 'iFicam OBS Preview',
          autoHideMenuBar: true,
          alwaysOnTop: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

const startHttpsServer = async (preferredIp?: string): Promise<void> => {
  if (server) {
    await server.close();
    server = null;
  }
  server = await createIFiCamServer(app.getPath('userData'), preferredIp);
  serverInfo = server.info;
  serverError = null;
};

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  if (serverInfo) {
    const host = `${serverInfo.lanIp}:${serverInfo.port}`;
    if (url.startsWith(`wss://${host}`) || url.startsWith(`https://${host}`)) {
      event.preventDefault();
      callback(true);
      return;
    }
  }
  callback(false);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('app.ificam.desktop');
  appSettings = await readSettings();

  ipcMain.handle('ificam:get-server-info', () => ({
    serverInfo,
    serverError,
  }));

  ipcMain.handle('ificam:set-adapter', async (_event, ip: string) => {
    try {
      await startHttpsServer(ip);
    } catch (error) {
      serverError = error instanceof Error ? error.message : 'Unable to restart iFicam HTTPS server.';
      console.error('iFicam server restart failed:', error);
    }
    broadcastServerState();
    return { serverInfo, serverError };
  });

  ipcMain.handle('ificam:get-settings', async () => {
    appSettings = await readSettings();
    return appSettings;
  });

  ipcMain.handle('ificam:update-settings', async (_event, patch: Partial<AppSettings>) => {
    appSettings = await updateSettings(patch);
    broadcastSettings();
    return appSettings;
  });

  ipcMain.handle('ificam:choose-output-folder', async () => {
    const current = appSettings ?? (await readSettings());
    const options = {
      title: 'Choose iFicam output folder',
      defaultPath: current.outputFolder,
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return current;
    }
    appSettings = await updateSettings({ outputFolder: result.filePaths[0] });
    broadcastSettings();
    return appSettings;
  });

  ipcMain.handle('ificam:rec-start', async (_event, ext: 'mp4' | 'webm', recordingId?: string, label?: string, includeDeviceLabel?: boolean) => {
    const settings = appSettings ?? (await readSettings());
    return startRecording({ ext, recordingId, label, includeDeviceLabel, outputFolder: settings.outputFolder });
  });
  ipcMain.handle('ificam:rec-chunk', (_event, chunk: ArrayBuffer, recordingId?: string) => writeChunk(Buffer.from(chunk), recordingId));
  ipcMain.handle('ificam:rec-stop', (_event, options, recordingId?: string) => stopRecording(options, recordingId));
  ipcMain.handle('ificam:reveal', (_event, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle('ificam:play', (_event, filePath: string) => shell.openPath(filePath));

  createWindow();

  startHttpsServer()
    .catch((error) => {
      serverError = error instanceof Error ? error.message : 'Unable to start iFicam HTTPS server.';
      console.error('iFicam server failed:', error);
    })
    .finally(broadcastServerState);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

