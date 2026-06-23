import { app } from 'electron';
import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

interface StartRecordingOptions {
  ext: 'mp4' | 'webm';
  recordingId?: string;
  label?: string;
  outputFolder?: string;
}

interface VideoAdjustments {
  brightness: number;
  contrast: number;
  exposure: number;
  vibrance: number;
  saturation: number;
}

export interface StopRecordingOptions {
  rotation?: number;
  flip?: boolean;
  resolution?: 'source' | '1920x1080' | '1280x720' | '2560x1440';
  targetWidth?: number | null;
  targetHeight?: number | null;
  adjustments?: VideoAdjustments;
}

interface RecordingSession {
  writeStream: WriteStream;
  tempPath: string;
  finalPath: string;
}

const sessions = new Map<string, RecordingSession>();

const defaultOutputDir = (): string => join(app.getPath('videos'), 'iFicam');

const resolveFfmpegPath = async (): Promise<string> => {
  if (!ffmpegPath) {
    throw new Error('Bundled ffmpeg binary was not found.');
  }

  const executable = app.isPackaged && ffmpegPath.includes('app.asar')
    ? ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    : ffmpegPath;

  try {
    await access(executable);
  } catch {
    throw new Error('The bundled video encoder is missing. Please reinstall iFicam and try again.');
  }

  return executable;
};

const fileStamp = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `iFicam_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

const sanitizeNamePart = (value: string): string =>
  value
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const startRecording = async ({ ext, recordingId = 'default', label, outputFolder }: StartRecordingOptions): Promise<{ outputPath: string }> => {
  if (sessions.has(recordingId)) {
    throw new Error('A recording is already in progress.');
  }
  const dir = outputFolder?.trim() || defaultOutputDir();
  await mkdir(dir, { recursive: true });
  const suffix = sanitizeNamePart(label ?? recordingId);
  const base = suffix ? `${fileStamp()}_${suffix}` : fileStamp();
  const tempPath = join(dir, `~${base}.${ext}`);
  const finalPath = join(dir, `${base}.mp4`);
  const writeStream = createWriteStream(tempPath);
  sessions.set(recordingId, { writeStream, tempPath, finalPath });
  return { outputPath: finalPath };
};

export const writeChunk = (chunk: Buffer, recordingId = 'default'): Promise<void> => {
  return new Promise((resolve, reject) => {
    const session = sessions.get(recordingId);
    if (!session) {
      resolve();
      return;
    }
    session.writeStream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
};

export const stopRecording = async (options: StopRecordingOptions = {}, recordingId = 'default'): Promise<{ filePath: string }> => {
  const session = sessions.get(recordingId);
  if (!session) {
    throw new Error('No active recording to stop.');
  }
  sessions.delete(recordingId);

  await new Promise<void>((resolve) => session.writeStream.end(resolve));
  await remuxToMp4(session.tempPath, session.finalPath, options);
  await rm(session.tempPath, { force: true });
  return { filePath: session.finalPath };
};

const runFfmpeg = async (args: string[]): Promise<void> => {
  const executable = await resolveFfmpegPath();

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (error) => {
      console.error('iFicam ffmpeg spawn failed:', error);
      reject(new Error('Could not start the video encoder. Please reinstall iFicam and try again.'));
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        console.error('iFicam ffmpeg conversion failed:', stderr);
        reject(new Error('Recording could not be converted to MP4. Please try recording again.'));
      }
    });
  });
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const buildVideoFilter = ({ rotation = 0, flip = false, targetWidth, targetHeight, adjustments }: StopRecordingOptions): string => {
  const filters: string[] = ['fps=30'];
  const normalizedRotation = ((rotation % 360) + 360) % 360;

  if (normalizedRotation === 90) filters.push('transpose=1');
  if (normalizedRotation === 180) filters.push('hflip', 'vflip');
  if (normalizedRotation === 270) filters.push('transpose=2');
  if (flip) filters.push('hflip');

  if (adjustments) {
    const brightnessPct = adjustments.brightness + adjustments.exposure * 0.7;
    const saturationPct = adjustments.saturation + adjustments.vibrance * 0.8;
    const brightness = clamp((brightnessPct - 100) / 100, -1, 1).toFixed(3);
    const contrast = clamp(adjustments.contrast / 100, 0, 3).toFixed(3);
    const saturation = clamp(saturationPct / 100, 0, 3).toFixed(3);
    filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
  }

  if (targetWidth && targetHeight) {
    filters.push(`scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`);
    filters.push(`pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`);
    filters.push('setsar=1');
  }

  return filters.join(',');
};

const remuxToMp4 = async (input: string, output: string, options: StopRecordingOptions): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-fflags', '+genpts',
    '-i', input,
    '-vf', buildVideoFilter(options),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'aresample=async=1',
    '-movflags', '+faststart',
    output,
  ]);
};
