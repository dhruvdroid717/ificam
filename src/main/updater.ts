import { app, BrowserWindow, ipcMain } from 'electron';
import updaterPkg from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';

const { autoUpdater } = updaterPkg;

export type UpdateBridgeState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes: string }
  | { status: 'not-available' }
  | { status: 'downloading'; version?: string; percent: number }
  | { status: 'downloaded'; version?: string }
  | { status: 'error'; message: string };

let currentState: UpdateBridgeState = { status: 'idle' };
let lastInfo: UpdateInfo | null = null;
let downloadStarted = false;

const friendlyUpdateError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  if (/YOUR_GITHUB_USERNAME|404|latest\.yml|app-update\.yml|No published versions|Cannot find/i.test(raw)) {
    return 'The update channel is not ready yet. Please install the latest iFicam release from GitHub and try again later.';
  }
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|offline|network/i.test(raw)) {
    return 'Could not reach the update server. Check your internet connection and try again.';
  }
  return 'Could not check for updates right now. Please try again in a few minutes.';
};

const stripReleaseMarkup = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const notesToText = (notes: UpdateInfo['releaseNotes']): string => {
  if (!notes) return 'No changelog was provided for this release.';
  if (typeof notes === 'string') return stripReleaseMarkup(notes);
  return notes.map((entry) => `${entry.version}\n${stripReleaseMarkup(entry.note)}`).join('\n\n').trim();
};

const publish = (window: BrowserWindow | null, state: UpdateBridgeState): void => {
  currentState = state;
  window?.webContents.send('ificam:update-state', state);
};

export const setupAutoUpdater = (getWindow: () => BrowserWindow | null): void => {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => publish(getWindow(), { status: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    lastInfo = info;
    publish(getWindow(), {
      status: 'available',
      version: info.version,
      releaseNotes: notesToText(info.releaseNotes),
    });
  });
  autoUpdater.on('update-not-available', () => publish(getWindow(), { status: 'not-available' }));
  autoUpdater.on('download-progress', (progress) => {
    publish(getWindow(), {
      status: 'downloading',
      version: lastInfo?.version,
      percent: Math.max(0, Math.min(100, progress.percent || 0)),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    lastInfo = info;
    publish(getWindow(), { status: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (error) => {
    publish(getWindow(), { status: 'error', message: friendlyUpdateError(error) });
  });

  ipcMain.handle('ificam:update-get-state', () => currentState);
  ipcMain.handle('ificam:update-check', async () => {
    if (!app.isPackaged) {
      return currentState;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publish(getWindow(), { status: 'error', message: friendlyUpdateError(error) });
    }
    return currentState;
  });
  ipcMain.handle('ificam:update-download', async () => {
    if (!app.isPackaged) {
      publish(getWindow(), { status: 'error', message: 'Updates are available only in the packaged app.' });
      return currentState;
    }
    if (downloadStarted) return currentState;
    downloadStarted = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      downloadStarted = false;
      publish(getWindow(), { status: 'error', message: friendlyUpdateError(error) });
    }
    return currentState;
  });
  ipcMain.handle('ificam:update-install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  app.whenReady().then(() => {
    if (!app.isPackaged) return;
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((error) => {
        publish(getWindow(), { status: 'error', message: friendlyUpdateError(error) });
      });
    }, 3500);
  });
};

