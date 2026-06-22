import { app } from 'electron';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

interface StartRecordingOptions {
  ext: 'mp4' | 'webm';
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

let writeStream: WriteStream | null = null;
let tempPath: string | null = null;
let finalPath: string | null = null;

const defaultOutputDir = (): string => join(app.getPath('videos'), 'iFicam');

const fileStamp = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `iFicam_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

export const startRecording = async ({ ext, outputFolder }: StartRecordingOptions): Promise<{ outputPath: string }> => {
  if (writeStream) {
    throw new Error('A recording is already in progress.');
  }
  const dir = outputFolder?.trim() || defaultOutputDir();
  await mkdir(dir, { recursive: true });
  const base = fileStamp();
  tempPath = join(dir, `~${base}.${ext}`);
  finalPath = join(dir, `${base}.mp4`);
  writeStream = createWriteStream(tempPath);
  return { outputPath: finalPath };
};

export const writeChunk = (chunk: Buffer): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!writeStream) {
      resolve();
      return;
    }
    writeStream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
};

export const stopRecording = async (options: StopRecordingOptions = {}): Promise<{ filePath: string }> => {
  if (!writeStream || !tempPath || !finalPath) {
    throw new Error('No active recording to stop.');
  }
  const input = tempPath;
  const output = finalPath;
  const stream = writeStream;
  writeStream = null;
  tempPath = null;
  finalPath = null;

  await new Promise<void>((resolve) => stream.end(resolve));
  await remuxToMp4(input, output, options);
  await rm(input, { force: true });
  return { filePath: output };
};

const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('Bundled ffmpeg binary was not found.'));
      return;
    }
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`));
    });
  });

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
