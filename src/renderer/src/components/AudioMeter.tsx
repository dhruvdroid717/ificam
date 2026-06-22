import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

// Live mic-level meter for the incoming stream. Remote WebRTC streams won't feed
// an AnalyserNode unless they're also "pulled" by a media element, so we attach a
// muted <audio> to keep the graph flowing without playing sound on the PC.
export function AudioMeter({ stream }: { stream: MediaStream | null }): JSX.Element | null {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const tracks = stream?.getAudioTracks() ?? [];
    if (!stream || tracks.length === 0) {
      setActive(false);
      setLevel(0);
      return;
    }
    setActive(tracks[0].enabled);

    const pump = new Audio();
    pump.srcObject = stream;
    pump.muted = true;
    void pump.play().catch(() => undefined);
    audioRef.current = pump;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return; // ~20fps is plenty for a meter
      last = t;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.6));
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
      pump.srcObject = null;
      audioRef.current = null;
    };
  }, [stream]);

  

  const segments = 12;
  const lit = Math.round(level * segments);

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-md">
      {active ? <Mic className="h-4 w-4 text-white/72" /> : <MicOff className="h-4 w-4 text-red-400" />}
      <div className="flex items-end gap-[3px]" aria-label="Microphone level">
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            className={`w-[3px] rounded-sm transition-colors ${
              i < lit ? (i > segments * 0.85 ? 'bg-red-400' : i > segments * 0.6 ? 'bg-amber-300' : 'bg-emerald-400') : 'bg-white/26'
            }`}
            style={{ height: `${6 + i * 1.3}px` }}
          />
        ))}
      </div>
    </div>
  );
}

