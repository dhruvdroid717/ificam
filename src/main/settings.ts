import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type RecordingResolution = 'source' | '1920x1080' | '1280x720' | '2560x1440';

export interface VideoAdjustments {
  brightness: number;
  contrast: number;
  exposure: number;
  vibrance: number;
  saturation: number;
}

export interface AppSettings {
  outputFolder: string;
  recordingResolution: RecordingResolution;
  adjustments: VideoAdjustments;
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');

export const defaultAdjustments = (): VideoAdjustments => ({
  brightness: 100,
  contrast: 100,
  exposure: 0,
  vibrance: 0,
  saturation: 100,
});

export const defaultSettings = (): AppSettings => ({
  outputFolder: join(app.getPath('videos'), 'iFicam'),
  recordingResolution: '1920x1080',
  adjustments: defaultAdjustments(),
});

export const readSettings = async (): Promise<AppSettings> => {
  const defaults = defaultSettings();
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<AppSettings>;
    return normalizeSettings(parsed, defaults);
  } catch {
    return defaults;
  }
};

export const writeSettings = async (next: AppSettings): Promise<AppSettings> => {
  const normalized = normalizeSettings(next, defaultSettings());
  await mkdir(dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
};

export const updateSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
  const current = await readSettings();
  return writeSettings({
    ...current,
    ...patch,
    adjustments: {
      ...current.adjustments,
      ...(patch.adjustments ?? {}),
    },
  });
};

const normalizeSettings = (value: Partial<AppSettings>, defaults: AppSettings): AppSettings => ({
  outputFolder: typeof value.outputFolder === 'string' && value.outputFolder.trim() ? value.outputFolder : defaults.outputFolder,
  recordingResolution: isRecordingResolution(value.recordingResolution) ? value.recordingResolution : defaults.recordingResolution,
  adjustments: normalizeAdjustments(value.adjustments, defaults.adjustments),
});

const normalizeAdjustments = (value: unknown, defaults: VideoAdjustments): VideoAdjustments => {
  const raw = typeof value === 'object' && value ? value as Partial<VideoAdjustments> : {};
  return {
    brightness: clampNumber(raw.brightness, 50, 150, defaults.brightness),
    contrast: clampNumber(raw.contrast, 50, 150, defaults.contrast),
    exposure: clampNumber(raw.exposure, -50, 50, defaults.exposure),
    vibrance: clampNumber(raw.vibrance, -50, 50, defaults.vibrance),
    saturation: clampNumber(raw.saturation, 0, 200, defaults.saturation),
  };
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const isRecordingResolution = (value: unknown): value is RecordingResolution =>
  value === 'source' || value === '1920x1080' || value === '1280x720' || value === '2560x1440';
