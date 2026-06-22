export type ConnectionStatus = 'Waiting for phone' | 'Connecting' | 'Live' | 'Reconnecting';
export type PhoneOrientation = 'portrait' | 'landscape';

export interface LiveStats {
  rttMs: number | null;
  bitrateMbps: number | null;
  fps: number | null;
  resolution: string | null;
}

export interface ReceiverHandlers {
  wsUrl: string;
  pin: string;
  onStream: (peerId: string, stream: MediaStream | null) => void;
  onStatus: (status: ConnectionStatus) => void;
  onStats: (peerId: string, stats: LiveStats) => void;
  onPhoneCommand?: (peerId: string, action: string) => void;
  onPhoneOrientation?: (peerId: string, orientation: PhoneOrientation) => void;
}

export interface Receiver {
  close: () => void;
  sendControl: (message: unknown, peerId?: string) => void;
}

interface PeerState {
  pc: RTCPeerConnection;
  statsTimer: ReturnType<typeof setInterval> | null;
  lastBytes: number;
  lastStatsTs: number;
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };
const EMPTY_STATS: LiveStats = { rttMs: null, bitrateMbps: null, fps: null, resolution: null };

export function createReceiver({ wsUrl, pin, onStream, onStatus, onStats, onPhoneCommand, onPhoneOrientation }: ReceiverHandlers): Receiver {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const peers = new Map<string, PeerState>();

  const send = (message: unknown, peerId?: string): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(peerId ? { ...(message as Record<string, unknown>), to: peerId } : message));
    }
  };

  const updateGlobalStatus = (): void => {
    if (Array.from(peers.values()).some((peer) => peer.pc.connectionState === 'connected')) {
      onStatus('Live');
    } else if (peers.size > 0) {
      onStatus('Connecting');
    } else {
      onStatus('Waiting for phone');
    }
  };

  const stopStats = (peer: PeerState): void => {
    if (peer.statsTimer) clearInterval(peer.statsTimer);
    peer.statsTimer = null;
    peer.lastBytes = 0;
    peer.lastStatsTs = 0;
  };

  const closePeer = (peerId: string): void => {
    const peer = peers.get(peerId);
    if (!peer) return;
    stopStats(peer);
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peers.delete(peerId);
    onStream(peerId, null);
    onStats(peerId, EMPTY_STATS);
    updateGlobalStatus();
  };

  const startStats = (peerId: string, peer: PeerState): void => {
    stopStats(peer);
    peer.statsTimer = setInterval(async () => {
      const report = await peer.pc.getStats();
      let rttMs: number | null = null;
      let bitrateMbps: number | null = null;
      let fps: number | null = null;
      let resolution: string | null = null;

      report.forEach((stat) => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
          const now = stat.timestamp as number;
          const bytes = stat.bytesReceived as number;
          if (peer.lastStatsTs && now > peer.lastStatsTs) {
            const deltaBits = (bytes - peer.lastBytes) * 8;
            const deltaSec = (now - peer.lastStatsTs) / 1000;
            bitrateMbps = deltaSec > 0 ? deltaBits / deltaSec / 1_000_000 : null;
          }
          peer.lastBytes = bytes;
          peer.lastStatsTs = now;
          if (typeof stat.framesPerSecond === 'number') fps = stat.framesPerSecond;
          if (stat.frameWidth && stat.frameHeight) resolution = `${stat.frameWidth}x${stat.frameHeight}`;
        }
        if (stat.type === 'candidate-pair' && stat.nominated && typeof stat.currentRoundTripTime === 'number') {
          rttMs = Math.round(stat.currentRoundTripTime * 1000);
        }
      });

      onStats(peerId, { rttMs, bitrateMbps, fps, resolution });
    }, 1000);
  };

  const handleOffer = async (peerId: string, offer: RTCSessionDescriptionInit): Promise<void> => {
    closePeer(peerId);
    onStatus('Connecting');
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer: PeerState = { pc, statsTimer: null, lastBytes: 0, lastStatsTs: 0 };
    peers.set(peerId, peer);

    pc.ontrack = (event) => onStream(peerId, event.streams[0] ?? new MediaStream([event.track]));
    pc.onicecandidate = (event) => {
      if (event.candidate) send({ type: 'ice', candidate: event.candidate }, peerId);
    };
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          startStats(peerId, peer);
          break;
        case 'disconnected':
        case 'failed':
          stopStats(peer);
          break;
        case 'closed':
          stopStats(peer);
          break;
      }
      updateGlobalStatus();
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: 'answer', answer }, peerId);
  };

  const handleMessage = async (raw: string): Promise<void> => {
    let message: {
      type?: string;
      from?: string;
      phones?: Array<{ id: string }>;
      offer?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
      action?: string;
      orientation?: PhoneOrientation;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const peerId = message.from;
    switch (message.type) {
      case 'peers': {
        const liveIds = new Set((message.phones ?? []).map((phone) => phone.id));
        for (const id of Array.from(peers.keys())) {
          if (!liveIds.has(id)) closePeer(id);
        }
        updateGlobalStatus();
        break;
      }
      case 'offer':
        if (peerId && message.offer) await handleOffer(peerId, message.offer);
        break;
      case 'ice': {
        const peer = peerId ? peers.get(peerId) : null;
        if (peer && message.candidate) {
          try { await peer.pc.addIceCandidate(message.candidate); } catch {}
        }
        break;
      }
      case 'cmd':
        if (peerId && message.action) onPhoneCommand?.(peerId, message.action);
        break;
      case 'phone-state':
        if (peerId && (message.orientation === 'portrait' || message.orientation === 'landscape')) {
          onPhoneOrientation?.(peerId, message.orientation);
        }
        break;
    }
  };

  const connect = (): void => {
    if (closed) return;
    onStatus('Waiting for phone');
    ws = new WebSocket(wsUrl);
    ws.onopen = () => send({ type: 'hello', role: 'pc', pin });
    ws.onmessage = (event) => void handleMessage(typeof event.data === 'string' ? event.data : '');
    ws.onclose = () => {
      if (closed) return;
      for (const id of Array.from(peers.keys())) closePeer(id);
      onStatus('Reconnecting');
      reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const id of Array.from(peers.keys())) closePeer(id);
      ws?.close();
      ws = null;
    },
    sendControl: send,
  };
}
