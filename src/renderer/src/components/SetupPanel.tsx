import React, { useState } from 'react';
import { Copy, QrCode, Wifi } from 'lucide-react';

export function SetupPanel({ state }: { state: ServerState }): JSX.Element {
  const { serverInfo, serverError } = state;
  const [copied, setCopied] = useState(false);

  const copyUrl = async (): Promise<void> => {
    if (serverInfo) {
      await navigator.clipboard.writeText(serverInfo.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white/82">Scan to connect</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              serverInfo ? 'bg-emerald-400/12 text-emerald-300' : 'bg-red-400/12 text-red-300'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${serverInfo ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {serverInfo ? 'Ready' : 'Offline'}
          </span>
        </div>
        <QrCode className="h-5 w-5 text-brand-cyan" />
      </div>

      {serverError ? <p className="mt-2 text-xs leading-5 text-red-300">{serverError}</p> : null}

      <div className="mt-3 grid place-items-center rounded-2xl border border-white/10 bg-white p-3">
        {serverInfo ? (
          <img src={serverInfo.qrDataUrl} alt="iFicam connect QR code" className="h-44 w-44" />
        ) : (
          <div className="grid h-44 w-44 place-items-center text-center text-xs text-black/50">QR unavailable</div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-brand-cyan/20 bg-brand-cyan/[0.07] px-3 py-2.5">
        <span className="text-xs uppercase tracking-wide text-white/44">Pairing PIN</span>
        <span className="font-mono text-2xl font-semibold tracking-[0.3em] text-brand-cyan">{serverInfo?.pin ?? '----'}</span>
      </div>

      <div className="mt-3 space-y-3">
        <InfoRow icon={<Wifi />} label="LAN URL" value={serverInfo?.url ?? 'Unavailable'} />
      </div>

      <button
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] text-sm text-white/72 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={copyUrl}
        disabled={!serverInfo}
      >
        <Copy className="h-4 w-4" />
        {copied ? 'Copied' : 'Copy URL'}
      </button>
    </section>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactElement; label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/18 px-3 py-3">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-white/58">
        {React.cloneElement(icon, { className: 'h-4 w-4' })}
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase text-white/34">{label}</p>
        <p className="truncate text-sm text-white/72">{value}</p>
      </div>
    </div>
  );
}
