export interface RecordingOptions {
  recordingId: string;
  label: string;
  video: HTMLVideoElement;
  stream: MediaStream;
  rotation: number;
  flip: boolean;
  resolution: RecordingResolution;
  orientation: 'portrait' | 'landscape';
  adjustments: VideoAdjustments;
}

export interface RecordingHandle {
  pause: () => void;
  resume: () => void;
  stop: () => Promise<string>;
}

const FPS = 30;
const VIDEO_BITRATE = 12_000_000;
const MIME_CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
];

const pickMimeType = (): string => {
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return 'video/webm';
};

const waitForVideoFrame = async (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The live preview was not ready to record yet. Wait for motion in the preview, then try again.'));
    }, 5000);

    const cleanup = (): void => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('resize', onReady);
    };

    const onReady = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('resize', onReady);
  });
};

const parseResolution = (
  resolution: RecordingResolution,
  sourceWidth: number,
  sourceHeight: number,
  orientation: 'portrait' | 'landscape',
): { width: number; height: number } | null => {
  if (resolution === 'source') return null;

  const [baseWidth, baseHeight] = resolution.split('x').map(Number);
  return orientation === 'portrait'
    ? { width: Math.min(baseWidth, baseHeight), height: Math.max(baseWidth, baseHeight) }
    : { width: Math.max(baseWidth, baseHeight), height: Math.min(baseWidth, baseHeight) };
};

type VideoFrameCallback = (now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => void;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const fitInside = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } => {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
};

export const startRecording = async ({ recordingId, label, video, stream, rotation, flip, resolution, orientation, adjustments }: RecordingOptions): Promise<RecordingHandle> => {
  await waitForVideoFrame(video);

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotated = normalizedRotation === 90 || normalizedRotation === 270;
  const outputOrientation = rotated ? (orientation === 'portrait' ? 'landscape' : 'portrait') : orientation;
  const target = parseResolution(
    resolution,
    rotated ? video.videoHeight : video.videoWidth,
    rotated ? video.videoWidth : video.videoHeight,
    outputOrientation,
  );

  const canvas = document.createElement('canvas');
  canvas.width = target ? (rotated ? target.height : target.width) : video.videoWidth;
  canvas.height = target ? (rotated ? target.width : target.height) : video.videoHeight;

  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) throw new Error('Could not create the recording canvas.');

  const canvasStream = canvas.captureStream(0);
  const canvasTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!canvasTrack) throw new Error('Could not create a recording video track.');
  canvasTrack.contentHint = 'motion';

  let stopped = false;
  let frameHandle: number | null = null;
  let intervalHandle: number | null = null;
  let lastMediaTime = -1;
  const frameVideo = video as FrameVideo;

  const draw = (): void => {
    if (stopped || video.videoWidth === 0 || video.videoHeight === 0) return;
    if (!target && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const fitted = fitInside(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
    ctx.drawImage(video, fitted.x, fitted.y, fitted.width, fitted.height);
    canvasTrack.requestFrame();
  };

  const scheduleFrameCallback = (): void => {
    if (stopped || !frameVideo.requestVideoFrameCallback) return;
    frameHandle = frameVideo.requestVideoFrameCallback((_now, metadata) => {
      if (metadata.mediaTime !== lastMediaTime) {
        lastMediaTime = metadata.mediaTime;
        draw();
      }
      scheduleFrameCallback();
    });
  };

  draw();
  if (typeof frameVideo.requestVideoFrameCallback === 'function') {
    scheduleFrameCallback();
  } else {
    intervalHandle = window.setInterval(draw, 1000 / FPS);
  }

  const recordingStream = new MediaStream([
    canvasTrack,
    ...stream.getAudioTracks(),
  ]);

  const mimeType = pickMimeType();
  await window.ificam.recStart('webm', recordingId, label);

  const recorder = new MediaRecorder(recordingStream, {
    mimeType,
    videoBitsPerSecond: VIDEO_BITRATE,
    audioBitsPerSecond: 192_000,
  });

  let pump: Promise<void> = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) return;
    pump = pump.then(async () => {
      const buffer = await event.data.arrayBuffer();
      await window.ificam.recChunk(buffer, recordingId);
    });
  };

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    if (frameHandle !== null && frameVideo.cancelVideoFrameCallback) frameVideo.cancelVideoFrameCallback(frameHandle);
    if (intervalHandle !== null) window.clearInterval(intervalHandle);
    for (const track of canvasStream.getTracks()) track.stop();
  };

  const finished = new Promise<string>((resolve, reject) => {
    recorder.onstop = () => {
      cleanup();
      pump
        .then(() => window.ificam.recStop({
          rotation: normalizedRotation,
          flip,
          resolution,
          targetWidth: target?.width ?? null,
          targetHeight: target?.height ?? null,
          adjustments,
        }, recordingId))
        .then(({ filePath }) => resolve(filePath))
        .catch(reject);
    };
    recorder.onerror = (event) => {
      cleanup();
      reject((event as ErrorEvent).error ?? new Error('MediaRecorder error'));
    };
  });

  recorder.start(1500);

  return {
    pause: () => {
      if (recorder.state === 'recording') recorder.pause();
    },
    resume: () => {
      if (recorder.state === 'paused') recorder.resume();
    },
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return finished;
    },
  };
};
