import { Circle, Pause, Play, Square } from 'lucide-react';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

interface ControlBarProps {
  state: RecorderState;
  elapsed: number;
  canRecord: boolean;
  onRecord: () => void;
  onTogglePause: () => void;
  onStop: () => void;
}

const formatElapsed = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export function ControlBar({ state, elapsed, canRecord, onRecord, onTogglePause, onStop }: ControlBarProps): JSX.Element {
  const idle = state === 'idle';
  const paused = state === 'paused';
  const saving = state === 'saving';

  return (
    <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/12 bg-black/48 px-4 py-3 shadow-2xl backdrop-blur-xl">
      {idle ? (
        <button
          className="flex h-12 items-center gap-2 rounded-full bg-red-500 px-5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(239,68,68,0.34)] transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none"
          onClick={onRecord}
          disabled={!canRecord}
          title={canRecord ? 'Start recording' : 'Connect a phone first'}
          aria-label="Start recording"
        >
          <Circle className="h-4 w-4 fill-current" />
          Record
        </button>
      ) : saving ? (
        <div className="flex h-12 items-center gap-3 rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-5 text-sm font-semibold text-brand-cyan">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-cyan/30 border-t-brand-cyan" />
          Saving video
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 pl-1 pr-2">
            <span className={`h-3 w-3 rounded-full bg-red-500 ${paused ? '' : 'animate-pulse'}`} />
            <span className="min-w-16 font-mono text-lg text-white/90">{formatElapsed(elapsed)}</span>
          </div>
          <button
            className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:bg-white/12 hover:text-white"
            onClick={onTogglePause}
            aria-label={paused ? 'Resume recording' : 'Pause recording'}
          >
            {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          </button>
          <button
            className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-black transition hover:bg-white"
            onClick={onStop}
            aria-label="Stop recording"
          >
            <Square className="h-5 w-5 fill-current" />
          </button>
        </>
      )}
    </div>
  );
}

