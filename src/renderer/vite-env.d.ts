/// <reference types="vite/client" />

type RecordingResolution = 'source' | '1920x1080' | '1280x720' | '2560x1440';

interface VideoAdjustments {
  brightness: number;
  contrast: number;
  exposure: number;
  vibrance: number;
  saturation: number;
}

interface AppSettings {
  outputFolder: string;
  recordingResolution: RecordingResolution;
  adjustments: VideoAdjustments;
}

interface RecordingStopOptions {
  rotation: number;
  flip: boolean;
  resolution: RecordingResolution;
  targetWidth: number | null;
  targetHeight: number | null;
  adjustments: VideoAdjustments;
}

interface LanAdapter {
  name: string;
  address: string;
}

interface ServerInfo {
  url: string;
  certUrl: string;
  port: number;
  lanIp: string;
  adapterName: string;
  certPath: string;
  pin: string;
  qrDataUrl: string;
  adapters: LanAdapter[];
}

interface ServerState {
  serverInfo: ServerInfo | null;
  serverError: string | null;
}

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes: string }
  | { status: 'not-available' }
  | { status: 'downloading'; version?: string; percent: number }
  | { status: 'downloaded'; version?: string }
  | { status: 'error'; message: string };

interface Window {
  ificam: {
    appName: string;
    milestone: number;
    getServerInfo: () => Promise<ServerState>;
    setAdapter: (ip: string) => Promise<ServerState>;
    onServerInfo: (callback: (state: ServerState) => void) => () => void;
    getSettings: () => Promise<AppSettings>;
    updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    chooseOutputFolder: () => Promise<AppSettings>;
    onSettings: (callback: (settings: AppSettings) => void) => () => void;
    recStart: (ext: 'mp4' | 'webm', recordingId?: string, label?: string, includeDeviceLabel?: boolean) => Promise<{ outputPath: string }>;
    recChunk: (chunk: ArrayBuffer, recordingId?: string) => Promise<void>;
    recStop: (options: RecordingStopOptions, recordingId?: string) => Promise<{ filePath: string }>;
    reveal: (filePath: string) => Promise<void>;
    play: (filePath: string) => Promise<void>;
    getUpdateState: () => Promise<UpdateState>;
    checkForUpdates: () => Promise<UpdateState>;
    downloadUpdate: () => Promise<UpdateState>;
    installUpdate: () => Promise<void>;
    onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  };
}
