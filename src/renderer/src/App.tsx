import React, { useEffect, useRef, useState } from 'react';
import { Aperture, Bell, ChevronDown, CircleDot, Download, FlipHorizontal2, FolderOpen, Instagram, MonitorUp, PackageCheck, Play, Power, RefreshCw, RotateCcw, RotateCw, Settings, SlidersHorizontal, X } from 'lucide-react';
import { ControlBar } from './components/ControlBar';
import type { RecorderState } from './components/ControlBar';
import { SetupPanel } from './components/SetupPanel';
import { AudioMeter } from './components/AudioMeter';
import { createReceiver, type ConnectionStatus, type LiveStats, type PhoneOrientation, type Receiver } from './webrtc/receiver';
import { startRecording as startRec, type RecordingHandle } from './webrtc/recording';
import logoUrl from './assets/iFi.png';

const STATUS_DOT: Record<ConnectionStatus, string> = {
  'Waiting for phone': 'bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.8)]',
  Connecting: 'bg-sky-300 shadow-[0_0_16px_rgba(125,211,252,0.8)]',
  Live: 'bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.85)]',
  Reconnecting: 'bg-orange-400 shadow-[0_0_16px_rgba(251,146,60,0.85)]',
};

const DEFAULT_ADJUSTMENTS: VideoAdjustments = {
  brightness: 100,
  contrast: 100,
  exposure: 0,
  vibrance: 0,
  saturation: 100,
};

const DEFAULT_SETTINGS: AppSettings = {
  outputFolder: 'Videos\\iFicam',
  recordingResolution: '1920x1080',
  adjustments: DEFAULT_ADJUSTMENTS,
};

const RESOLUTION_OPTIONS: Array<{ value: RecordingResolution; label: string }> = [
  { value: '1920x1080', label: '1920 x 1080' },
  { value: '1280x720', label: '1280 x 720' },
  { value: '2560x1440', label: '2560 x 1440' },
  { value: 'source', label: 'Match phone stream' },
];

const videoFilter = (adjustments: VideoAdjustments): string => {
  const brightness = adjustments.brightness + adjustments.exposure * 0.7;
  const saturation = adjustments.saturation + adjustments.vibrance * 0.8;
  return `brightness(${brightness}%) contrast(${adjustments.contrast}%) saturate(${saturation}%)`;
};

const recordingErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/remote method|spawn|ffmpeg|encoder|rec-stop|Program Files|app\.asar/i.test(message)) {
    return 'Recording could not be saved. Please reinstall iFicam if this keeps happening.';
  }
  return message || 'Recording failed to save.';
};

const feedLabel = (index: number): string => `Phone ${index + 1}`;

const openObsPreviewWindow = (stream: MediaStream, style: React.CSSProperties, label: string): Window => {
  const popup = window.open('', `iFicam OBS Preview - ${label}`, 'popup,width=960,height=540');
  if (!popup) {
    throw new Error('Could not open the OBS preview window.');
  }

  popup.document.title = `iFicam OBS Preview - ${label}`;
  popup.document.body.innerHTML = `
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #000;
      }
      video {
        width: 100vw;
        height: 100vh;
        object-fit: contain;
        background: #000;
      }
    </style>
    <video autoplay muted playsinline></video>
  `;

  const video = popup.document.querySelector('video');
  if (!video) return popup;
  video.srcObject = stream;
  video.style.transform = String(style.transform ?? '');
  video.style.filter = String(style.filter ?? '');
  void video.play().catch(() => undefined);
  popup.focus();
  return popup;
};

interface Feed {
  id: string;
  stream: MediaStream;
  orientation: PhoneOrientation;
  stats: LiveStats;
}

const fmt = (value: number | null, suffix: string, digits = 0): string =>
  value === null || Number.isNaN(value) ? '--' : `${value.toFixed(digits)}${suffix}`;

export default function App(): JSX.Element {
  const [serverState, setServerState] = useState<ServerState>({ serverInfo: null, serverError: null });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<ConnectionStatus>('Waiting for phone');
  const [stats, setStats] = useState<LiveStats>({ rttMs: null, bitrateMbps: null, fps: null, resolution: null });
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [recorder, setRecorder] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [savedFiles, setSavedFiles] = useState<string[]>([]);
  const [recError, setRecError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const recordingRef = useRef<Map<string, RecordingHandle>>(new Map());
  const receiverRef = useRef<Receiver | null>(null);
  const obsWindowRef = useRef<Map<string, Window>>(new Map());
  const startRecordingRef = useRef<() => void>(() => undefined);
  const stopRecordingRef = useRef<() => void>(() => undefined);
  const primaryFeed = feeds[0] ?? null;
  const stream = primaryFeed?.stream ?? null;
  const hasStream = feeds.length > 0;


  const videoStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    transform: `rotate(${rotation}deg) scaleX(${flip ? -1 : 1})`,
    filter: videoFilter(settings.adjustments),
    willChange: 'filter, transform',
  };

  useEffect(() => {
    if (recorder !== 'recording') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recorder]);

  const startRecording = async (): Promise<void> => {
    if (feeds.length === 0 || recordingRef.current.size > 0) return;
    setRecError(null);
    setSavedFiles([]);
    setElapsed(0);
    const started = new Map<string, RecordingHandle>();
    try {
      for (const [index, feed] of feeds.entries()) {
        const video = videoRefs.current.get(feed.id);
        if (!video) {
          throw new Error(`${feedLabel(index)} preview is not ready yet.`);
        }
        const handle = await startRec({
          recordingId: feed.id,
          label: feedLabel(index),
          includeDeviceLabel: feeds.length > 1,
          video,
          stream: feed.stream,
          rotation,
          flip,
          resolution: settings.recordingResolution,
          orientation: feed.orientation,
          adjustments: settings.adjustments,
        });
        started.set(feed.id, handle);
      }
      recordingRef.current = started;
      receiverRef.current?.sendControl({ type: 'cmd', action: 'record.started' });
      setRecorder('recording');
    } catch (error) {
      for (const handle of started.values()) {
        void handle.stop().catch(() => undefined);
      }
      recordingRef.current = new Map();
      setRecError(error instanceof Error ? error.message : 'Could not start recording.');
    }
  };

  const togglePause = (): void => {
    const handles = Array.from(recordingRef.current.values());
    if (handles.length === 0) return;
    setRecorder((r) => {
      if (r === 'recording') {
        for (const handle of handles) handle.pause();
        return 'paused';
      }
      for (const handle of handles) handle.resume();
      return 'recording';
    });
  };

  const stopRecording = async (): Promise<void> => {
    const handles = Array.from(recordingRef.current.entries());
    recordingRef.current = new Map();
    if (handles.length === 0) return;
    setRecorder('saving');
    try {
      const results = await Promise.allSettled(handles.map(async ([, handle]) => handle.stop()));
      const files = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (files.length > 0) setSavedFiles(files);
      if (errors.length > 0) setRecError(recordingErrorMessage(errors[0].reason));
      receiverRef.current?.sendControl({ type: 'cmd', action: 'record.stopped' });
    } catch (error) {
      setRecError(recordingErrorMessage(error));
      receiverRef.current?.sendControl({ type: 'cmd', action: 'record.stopped' });
    } finally {
      setRecorder('idle');
      setElapsed(0);
    }
  };

  const chooseOutputFolder = async (): Promise<void> => {
    try {
      setSettings(await window.ificam.chooseOutputFolder());
    } catch (error) {
      setRecError(error instanceof Error ? error.message : 'Could not choose output folder.');
    }
  };

  const updateResolution = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const recordingResolution = event.target.value as RecordingResolution;
    setSettings(await window.ificam.updateSettings({ recordingResolution }));
  };

  const updateAdjustment = async (key: keyof VideoAdjustments, value: number): Promise<void> => {
    const adjustments = { ...settings.adjustments, [key]: value };
    setSettings({ ...settings, adjustments });
    setSettings(await window.ificam.updateSettings({ adjustments }));
  };

  const openObsPreviews = (): void => {
    if (feeds.length === 0) return;
    try {
      feeds.forEach((feed, index) => {
        obsWindowRef.current.set(feed.id, openObsPreviewWindow(feed.stream, videoStyle, feedLabel(index)));
      });
    } catch (error) {
      setRecError(error instanceof Error ? error.message : 'Could not open OBS preview.');
    }
  };

  useEffect(() => {
    const liveIds = new Set(feeds.map((feed) => feed.id));
    for (const [id, popup] of obsWindowRef.current.entries()) {
      if (!liveIds.has(id) || popup.closed) {
        obsWindowRef.current.delete(id);
        continue;
      }
      const feed = feeds.find((item) => item.id === id);
      const video = popup.document.querySelector('video');
      if (!feed || !video) continue;
      video.srcObject = feed.stream;
      video.style.transform = String(videoStyle.transform ?? '');
      video.style.filter = String(videoStyle.filter ?? '');
      void video.play().catch(() => undefined);
    }
  }, [feeds, videoStyle.transform, videoStyle.filter]);

  const resetAdjustments = async (): Promise<void> => {
    const adjustments = { ...DEFAULT_ADJUSTMENTS };
    setSettings({ ...settings, adjustments });
    setSettings(await window.ificam.updateSettings({ adjustments }));
  };

  const openUpdateCheck = (): void => {
    setUpdateModalOpen(true);
    void window.ificam.checkForUpdates().catch(() => undefined);
  };

  startRecordingRef.current = () => void startRecording();
  stopRecordingRef.current = () => void stopRecording();

  const isRecording = recorder !== 'idle';

  useEffect(() => {
    if (!window.ificam) {
      setServerState({ serverInfo: null, serverError: 'Preload bridge unavailable.' });
      return;
    }

    window.ificam.getServerInfo().then(setServerState).catch((error) => {
      setServerState({
        serverInfo: null,
        serverError: error instanceof Error ? error.message : 'Unable to read HTTPS server status.',
      });
    });

    window.ificam.getSettings().then(setSettings).catch(() => setSettings(DEFAULT_SETTINGS));

    const unsubscribeServer = window.ificam.onServerInfo(setServerState);
    const unsubscribeSettings = window.ificam.onSettings(setSettings);
    return () => {
      unsubscribeServer();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (!window.ificam) return;
    window.ificam.getUpdateState().then(setUpdateState).catch(() => undefined);
    const unsubscribe = window.ificam.onUpdateState((state) => {
      setUpdateState(state);
      if (state.status === 'downloading' || state.status === 'downloaded') {
        setUpdateModalOpen(true);
      }
    });
    void window.ificam.checkForUpdates().catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const info = serverState.serverInfo;
    if (!info) return;

    const wsUrl = `${info.url.replace(/^https:/, 'wss:')}/ws`;
    const receiver = createReceiver({
      wsUrl,
      pin: info.pin,
      onStatus: setStatus,
      onStats: (peerId, nextStats) => {
        setFeeds((current) => current.map((feed) => feed.id === peerId ? { ...feed, stats: nextStats } : feed));
        setStats(nextStats);
      },
      onStream: (peerId, incoming) => {
        setFeeds((current) => {
          if (!incoming) return current.filter((feed) => feed.id !== peerId);
          const existing = current.find((feed) => feed.id === peerId);
          if (existing) return current.map((feed) => feed.id === peerId ? { ...feed, stream: incoming } : feed);
          return [...current, { id: peerId, stream: incoming, orientation: 'portrait', stats: { rttMs: null, bitrateMbps: null, fps: null, resolution: null } }];
        });
      },
      onPhoneOrientation: (peerId, orientation) => {
        setFeeds((current) => current.map((feed) => feed.id === peerId ? { ...feed, orientation } : feed));
      },
      onPhoneCommand: (_peerId, action) => {
        if (action === 'record.start') startRecordingRef.current();
        if (action === 'record.stop') stopRecordingRef.current();
      },
    });
    receiverRef.current = receiver;

    return () => {
      receiverRef.current = null;
      receiver.close();
    };
  }, [serverState.serverInfo]);

  const statusItems = [
    { label: 'Status', value: status },
    { label: 'Resolution', value: stats.resolution ?? '--' },
    { label: 'Latency', value: fmt(stats.rttMs, ' ms') },
    { label: 'Bitrate', value: fmt(stats.bitrateMbps, ' Mbps', 1) },
  ];

  return (
    <main className="relative h-screen overflow-hidden bg-[#07080A] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,255,255,0.105),transparent_28%),radial-gradient(circle_at_88%_16%,rgba(105,114,255,0.12),transparent_30%),linear-gradient(180deg,#101114_0%,#07080A_52%,#050506_100%)]" />
      {updateState.status === 'available' && !updateModalOpen && (
        <button
          className="absolute right-5 top-5 z-50 flex items-center gap-2 rounded-full border border-brand-cyan/25 bg-[#101114]/90 px-4 py-2 text-sm font-semibold text-white/86 shadow-[0_0_32px_rgba(34,211,238,0.22)] backdrop-blur-xl transition hover:border-brand-cyan/45 hover:bg-[#151820]"
          onClick={() => setUpdateModalOpen(true)}
        >
          <PackageCheck className="h-4 w-4 text-brand-cyan" />
          Update Available
          <span className="text-brand-cyan">✦</span>
        </button>
      )}
      {updateModalOpen && (
        <UpdateModal
          state={updateState}
          onClose={() => setUpdateModalOpen(false)}
          onCheck={() => void window.ificam.checkForUpdates()}
          onDownload={() => void window.ificam.downloadUpdate()}
          onInstall={() => void window.ificam.installUpdate()}
        />
      )}
      <div className="relative flex h-screen">
        <section className="flex min-w-0 flex-1 flex-col p-5">
          <header className="mb-5 flex items-center justify-between rounded-[22px] border border-white/[0.08] bg-white/[0.055] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
            <div className="flex items-center gap-3.5">
              <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-[15px] border border-white/10 bg-black/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_30px_rgba(0,0,0,0.35)]">
                <img src={logoUrl} alt="iFicam logo" className="h-10 w-10 object-contain" />
              </div>
              <div className="leading-tight">
                <div className="flex items-baseline gap-2">
                  <h1 className="font-['Segoe_UI_Variable_Display','SF_Pro_Display','Inter',system-ui,sans-serif] text-[1.72rem] font-semibold tracking-[-0.02em] text-white">iFicam</h1>
                  <span className="text-xs font-medium text-white/50">@ungyani</span>
                </div>
                <p className="mt-0.5 text-xs font-medium tracking-[0.16em] text-white/36">Wireless Phone Camera</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:flex">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                {status}
              </div>
              <button
                onClick={openUpdateCheck}
                aria-label="Check for updates"
                title="Check for updates"
                className={`relative grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.055] text-white/76 transition hover:border-white/18 hover:bg-white/[0.11] hover:text-white ${
                  updateState.status === 'available' ? 'shadow-[0_0_26px_rgba(34,211,238,0.22)]' : ''
                }`}
              >
                <Bell className="h-5 w-5" />
                {updateState.status === 'available' && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand-cyan shadow-[0_0_10px_rgba(34,211,238,0.9)]" />}
              </button>
              <a
                href="https://www.instagram.com/ungyani"
                target="_blank"
                rel="noreferrer"
                aria-label="Open @ungyani on Instagram"
                title="Open @ungyani on Instagram"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.055] text-white/76 transition hover:border-white/18 hover:bg-white/[0.11] hover:text-white"
              >
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </header>

          <div
            ref={stageRef}
            className={`relative isolate min-h-0 flex-1 overflow-hidden rounded-[30px] border bg-[#030303] shadow-[0_24px_90px_rgba(0,0,0,0.45)] transition-colors ${
              isRecording ? 'border-red-500/70 shadow-[0_0_0_2px_rgba(239,68,68,0.25),0_0_60px_rgba(239,68,68,0.18)_inset]' : 'border-line'
            }`}
          >
            {hasStream && (
              <div className={`absolute inset-0 z-0 grid gap-3 p-3 ${feeds.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {feeds.map((feed, index) => (
                  <LiveFeed
                    key={feed.id}
                    feed={feed}
                    style={videoStyle}
                    refCallback={(node) => {
                      if (node) videoRefs.current.set(feed.id, node);
                      else videoRefs.current.delete(feed.id);
                    }}
                  />
                ))}
              </div>
            )}
            {hasStream && (
              <div className="absolute right-5 top-5 z-10 flex gap-2">
                <button
                  className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-black/35 text-white/72 backdrop-blur-md transition hover:text-white"
                  onClick={openObsPreviews}
                  aria-label="Open OBS preview windows"
                  title="Open clean OBS preview windows"
                >
                  <MonitorUp className="h-5 w-5" />
                </button>
                <button
                  className={`grid h-10 w-10 place-items-center rounded-2xl border backdrop-blur-md transition ${
                    flip ? 'border-brand-cyan/50 bg-brand-cyan/15 text-brand-cyan' : 'border-white/10 bg-black/35 text-white/72 hover:text-white'
                  }`}
                  onClick={() => setFlip((f) => !f)}
                  aria-label="Flip horizontally"
                  title="Flip horizontally (mirror)"
                >
                  <FlipHorizontal2 className="h-5 w-5" />
                </button>
                <button
                  className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-black/35 text-white/72 backdrop-blur-md transition hover:text-white"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  aria-label="Rotate 90 degrees"
                  title="Rotate 90 degrees"
                >
                  <RotateCw className="h-5 w-5" />
                </button>
              </div>
            )}

            {!hasStream && (
              <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))]">
                <div className="max-w-lg px-6 text-center">
                  <div className="relative mx-auto mb-7 grid h-32 w-32 place-items-center">
                    <div className="absolute inset-0 rounded-[36px] border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_22px_70px_rgba(0,0,0,0.36)] backdrop-blur-xl" />
                    <Aperture className="relative h-12 w-12 text-white/82" strokeWidth={1.45} />
                    <div className="absolute -bottom-5 h-2 w-20 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
                      <div className="h-full w-1/2 animate-[loading-pill_1.25s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-brand-cyan via-white to-brand-indigo" />
                    </div>
                  </div>
                  <p className="font-['Segoe_UI_Variable_Display','SF_Pro_Display','Inter',system-ui,sans-serif] text-4xl font-semibold tracking-[-0.035em] text-white">waiting for your phone to connect</p>
                  <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-white/46">
                    Scan the QR code from your iPhone and keep both devices on the same WiFi.
                  </p>
                </div>
              </div>
            )}

            <div className="absolute left-5 top-5 z-10 flex flex-wrap items-stretch gap-2">
              {statusItems.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-md">
                  <p className="text-[11px] uppercase text-white/38">{item.label}</p>
                  <p className="text-sm font-medium text-white/82">{item.value}</p>
                </div>
              ))}
              <AudioMeter stream={stream} />
            </div>

            <ControlBar
              state={recorder}
              elapsed={elapsed}
              canRecord={hasStream}
              onRecord={startRecording}
              onTogglePause={togglePause}
              onStop={stopRecording}
            />

            {savedFiles.length > 0 && (
              <Toast
                message={savedFiles.length === 1 ? 'Recording saved' : 'Recordings saved'}
                detail={savedFiles.length === 1 ? savedFiles[0] : `${savedFiles.length} MP4 files saved separately`}
                onReveal={() => window.ificam.reveal(savedFiles[0])}
                onPlay={savedFiles.length === 1 ? () => window.ificam.play(savedFiles[0]) : undefined}
                onClose={() => setSavedFiles([])}
              />
            )}
            {recError && <Toast message="Recording error" detail={recError} error onClose={() => setRecError(null)} />}
          </div>
        </section>

        <aside className="scrollbar-none relative z-30 flex w-[360px] flex-col overflow-y-auto border-l border-white/[0.075] bg-[#101114] p-5 shadow-[-24px_0_70px_rgba(0,0,0,0.42)]">
          <SetupPanel state={serverState} />
          <SettingsPanel settings={settings} onChooseOutputFolder={chooseOutputFolder} onResolutionChange={updateResolution} />
          <AdjustPanel adjustments={settings.adjustments} onAdjust={updateAdjustment} onReset={resetAdjustments} />
          <div className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/82">
              <CircleDot className="h-4 w-4 text-red-400" />
              Note
            </div>
            <p className="mt-3 text-sm leading-6 text-white/52">
              Recordings are saved as Mp4 (H.264 + AAC) and not on your phone.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function UpdateModal({
  state,
  onClose,
  onCheck,
  onDownload,
  onInstall,
}: {
  state: UpdateState;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}): JSX.Element {
  const version = 'version' in state && state.version ? state.version : 'latest';
  const title =
    state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded'
      ? `iFicam v${version} is available`
      : state.status === 'checking'
        ? 'Checking for updates'
        : state.status === 'not-available'
          ? 'iFicam is up to date'
          : state.status === 'error'
            ? 'Update check unavailable'
            : 'Check for updates';
  const notes =
    state.status === 'available'
      ? state.releaseNotes
      : state.status === 'not-available'
        ? 'You are running the latest installed version of iFicam.'
        : state.status === 'checking'
          ? 'Looking for a newer GitHub release...'
          : state.status === 'error'
            ? state.message
            : 'Choose check for updates to contact the release server.';
  const percent = state.status === 'downloading' ? Math.round(state.percent) : state.status === 'downloaded' ? 100 : 0;
  const label =
    state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded'
      ? 'Update available'
      : state.status === 'checking'
        ? 'Checking'
        : state.status === 'not-available'
          ? 'Up to date'
          : state.status === 'error'
            ? 'Update unavailable'
            : 'Updates';

  return (
    <div className="absolute inset-0 z-[60] grid place-items-center bg-black/54 px-6 backdrop-blur-md">
      <div className="w-[min(92vw,520px)] rounded-[28px] border border-white/10 bg-[#101114]/96 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-1 text-xs font-semibold text-brand-cyan">
              {state.status === 'checking' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
              {label}
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-white/52">
              {state.status === 'not-available'
                ? 'No action is needed right now.'
                : state.status === 'error'
                  ? 'iFicam could not confirm the latest release right now.'
                  : 'Install the latest release from GitHub when you are ready.'}
            </p>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-white/50 transition hover:text-white" onClick={onClose} aria-label="Close update dialog">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 max-h-44 overflow-y-auto rounded-2xl border border-white/8 bg-black/24 p-4 text-sm leading-6 text-white/64">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/36">{state.status === 'error' ? 'Status' : 'Update Version'}</p>
          <pre className="whitespace-pre-wrap font-sans">{notes}</pre>
        </div>

        {(state.status === 'downloading' || state.status === 'downloaded') && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs text-white/46">
              <span>{state.status === 'downloaded' ? 'Ready to apply' : 'Downloading update'}</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan via-white to-brand-indigo transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {state.status === 'error' && <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">You can keep using iFicam normally. Try again later or download the newest installer from GitHub Releases.</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-2.5 text-sm font-medium text-white/62 transition hover:bg-white/10 hover:text-white" onClick={onClose}>
            Remind Me Later
          </button>
          {state.status === 'not-available' || state.status === 'checking' ? null : state.status === 'idle' || state.status === 'error' ? (
            <button className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-brand-cyan" onClick={onCheck}>
              <RefreshCw className="h-4 w-4" />
              Check Again
            </button>
          ) : state.status === 'downloaded' ? (
            <button className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-brand-cyan" onClick={onInstall}>
              <Power className="h-4 w-4" />
              Restart to Apply
            </button>
          ) : (
            <button className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-brand-cyan disabled:cursor-not-allowed disabled:opacity-60" onClick={onDownload} disabled={state.status === 'downloading'}>
              <Download className="h-4 w-4" />
              {state.status === 'downloading' ? 'Downloading' : 'Update Now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveFeed({
  feed,
  style,
  refCallback,
}: {
  feed: Feed;
  style: React.CSSProperties;
  refCallback: (node: HTMLVideoElement | null) => void;
}): JSX.Element {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = feed.stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [feed.stream]);

  return (
    <div className="relative isolate min-h-0 overflow-hidden rounded-[24px] bg-black [contain:paint]">
      <video
        ref={(node) => {
          ref.current = node;
          refCallback(node);
        }}
        autoPlay
        muted
        playsInline
        style={style}
        className="bg-black transition-opacity duration-300"
      />
      <div className="absolute bottom-3 left-3 z-10 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-xs font-medium text-white/72 shadow-lg">
        Phone {feed.id.toUpperCase()}
      </div>
    </div>
  );
}
function SettingsPanel({
  settings,
  onChooseOutputFolder,
  onResolutionChange,
}: {
  settings: AppSettings;
  onChooseOutputFolder: () => void;
  onResolutionChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-white/50" />
          <h2 className="text-sm font-semibold text-white/82">Settings</h2>
        </div>
        <ChevronDown className={`h-4 w-4 text-white/44 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs uppercase text-white/34">Output folder</p>
            <div className="rounded-2xl border border-white/8 bg-black/18 p-3">
              <p className="truncate text-sm text-white/72" title={settings.outputFolder}>{settings.outputFolder}</p>
              <button
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] text-sm text-white/72 transition hover:bg-white/12"
                onClick={onChooseOutputFolder}
              >
                <FolderOpen className="h-4 w-4" />
                Change folder
              </button>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs uppercase text-white/34">Saved video resolution</span>
            <select
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/82 outline-none focus:border-brand-cyan/50"
              value={settings.recordingResolution}
              onChange={onResolutionChange}
            >
              {RESOLUTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

function AdjustPanel({
  adjustments,
  onAdjust,
  onReset,
}: {
  adjustments: VideoAdjustments;
  onAdjust: (key: keyof VideoAdjustments, value: number) => void;
  onReset: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const sliders: Array<{ key: keyof VideoAdjustments; label: string; min: number; max: number; step?: number }> = [
    { key: 'brightness', label: 'Brightness', min: 50, max: 150 },
    { key: 'contrast', label: 'Contrast', min: 50, max: 150 },
    { key: 'exposure', label: 'Exposure', min: -50, max: 50 },
    { key: 'vibrance', label: 'Vibrance', min: -50, max: 50 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 200 },
  ];

  return (
    <section className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-brand-cyan" />
          <h2 className="text-sm font-semibold text-white/82">Adjust</h2>
        </div>
        <ChevronDown className={`h-4 w-4 text-white/44 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <button
            className="flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] text-xs font-medium text-white/62 transition hover:bg-white/10 hover:text-white"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset adjustments
          </button>
          {sliders.map((slider) => {
            const defaultValue = DEFAULT_ADJUSTMENTS[slider.key];
            return (
              <label key={slider.key} className="block">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="uppercase text-white/34">{slider.label}</span>
                  <span className="font-mono text-white/58">{adjustments[slider.key]}</span>
                </div>
                <input
                  className="w-full accent-cyan-300"
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step ?? 1}
                  value={adjustments[slider.key]}
                  onChange={(event) => onAdjust(slider.key, Number(event.target.value))}
                  onDoubleClick={() => onAdjust(slider.key, defaultValue)}
                />
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
function Toast({
  message,
  detail,
  error,
  onReveal,
  onPlay,
  onClose,
}: {
  message: string;
  detail: string;
  error?: boolean;
  onReveal?: () => void;
  onPlay?: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="absolute bottom-24 left-1/2 w-[min(92%,520px)] -translate-x-1/2 rounded-2xl border border-white/12 bg-black/72 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${error ? 'bg-red-400' : 'bg-emerald-400'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/88">{message}</p>
          <p className="truncate text-xs text-white/52" title={detail}>{detail}</p>
          {(onReveal || onPlay) && (
            <div className="mt-3 flex gap-2">
              {onPlay && (
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-1.5 text-xs font-medium text-brand-cyan transition hover:bg-brand-cyan/16"
                  onClick={onPlay}
                >
                  <Play className="h-3.5 w-3.5" /> Play
                </button>
              )}
              {onReveal && (
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/72 transition hover:bg-white/12"
                  onClick={onReveal}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open Folder
                </button>
              )}
            </div>
          )}
        </div>
        <button className="text-white/40 transition hover:text-white/80" onClick={onClose} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}



















