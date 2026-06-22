import type { Server } from 'node:https';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

type SignalRole = 'pc' | 'phone';

interface SignalSocket extends WebSocket {
  role?: SignalRole;
  paired?: boolean;
  peerId?: string;
}

const safeId = (): string => randomUUID().slice(0, 8);

export const attachSignaling = (httpsServer: Server, pin: string): WebSocketServer => {
  const wss = new WebSocketServer({ server: httpsServer, path: '/ws' });
  let pcSocket: SignalSocket | null = null;
  const phoneSockets = new Map<string, SignalSocket>();

  const isOpen = (socket: SignalSocket | null | undefined): socket is SignalSocket =>
    Boolean(socket) && socket!.readyState === WebSocket.OPEN;

  const phoneList = (): Array<{ id: string }> =>
    Array.from(phoneSockets.entries())
      .filter(([, socket]) => isOpen(socket))
      .map(([id]) => ({ id }));

  const broadcastPeers = (): void => {
    const message = JSON.stringify({ type: 'peers', pc: isOpen(pcSocket), phones: phoneList(), phone: phoneList().length > 0 });
    if (isOpen(pcSocket)) pcSocket.send(message);
    for (const socket of phoneSockets.values()) {
      if (isOpen(socket)) socket.send(message);
    }
  };

  wss.on('connection', (socket: SignalSocket) => {
    socket.on('message', (raw) => {
      let message: { type?: string; role?: SignalRole; pin?: string; to?: string };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.type === 'hello' && (message.role === 'pc' || message.role === 'phone')) {
        if (message.pin !== pin) {
          socket.send(JSON.stringify({ type: 'error', reason: 'bad-pin' }));
          socket.close();
          return;
        }

        socket.role = message.role;
        socket.paired = true;
        if (message.role === 'pc') {
          if (pcSocket && pcSocket !== socket) pcSocket.close();
          pcSocket = socket;
          socket.peerId = 'pc';
          socket.send(JSON.stringify({ type: 'hello-ok', id: 'pc' }));
        } else {
          const id = safeId();
          socket.peerId = id;
          phoneSockets.set(id, socket);
          socket.send(JSON.stringify({ type: 'hello-ok', id }));
        }
        broadcastPeers();
        return;
      }

      if (!socket.paired) return;

      if (socket.role === 'phone') {
        if (isOpen(pcSocket)) {
          const forwarded = { ...message, from: socket.peerId };
          pcSocket.send(JSON.stringify(forwarded));
        }
        return;
      }

      if (socket.role === 'pc') {
        if (message.to) {
          const target = phoneSockets.get(message.to);
          if (isOpen(target)) target.send(raw.toString());
          return;
        }
        for (const target of phoneSockets.values()) {
          if (isOpen(target)) target.send(raw.toString());
        }
      }
    });

    socket.on('close', () => {
      if (socket === pcSocket) pcSocket = null;
      if (socket.role === 'phone' && socket.peerId) phoneSockets.delete(socket.peerId);
      broadcastPeers();
    });

    socket.on('error', () => socket.close());
  });

  return wss;
};


