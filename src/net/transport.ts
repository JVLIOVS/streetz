/**
 * Peer-to-peer transport. The game only sees this interface, so the free P2P
 * implementation (WebRTC via public Nostr relays, no server to run) can later be
 * swapped for a dedicated server (Colyseus…) without touching the game code.
 */
export interface Transport {
  readonly selfId: string;
  onJoin: (peer: string) => void;
  onLeave: (peer: string) => void;
  onMessage: (msg: unknown, from: string) => void;
  /** Sends to one peer, or to everybody when `to` is omitted. */
  send(msg: unknown, to?: string): void;
  leave(): void;
}

const APP_ID = 'streetz-proto-v2';

/** Internet transport: WebRTC data channels, matchmaking through public Nostr relays. */
export async function joinOnlineRoom(code: string): Promise<Transport> {
  const { joinRoom, selfId } = await import('trystero/nostr');
  const room = joinRoom({ appId: APP_ID }, `room-${code}`);
  const t: Transport = {
    selfId,
    onJoin: () => {},
    onLeave: () => {},
    onMessage: () => {},
    send: (msg, to) => {
      void action.send(msg as never, to ? { target: to } : undefined).catch(() => {});
    },
    leave: () => void room.leave(),
  };
  const action = room.makeAction<never>('m', { onMessage: (data, ctx) => t.onMessage(data, ctx.peerId) });
  room.onPeerJoin = (peer) => t.onJoin(peer);
  room.onPeerLeave = (peer) => t.onLeave(peer);
  return t;
}

/**
 * Same-device transport (BroadcastChannel between tabs). Used by the automated tests and
 * for local debugging with `?net=local`.
 */
export function joinLocalRoom(code: string): Transport {
  const selfId = Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel(`streetz-${code}`);
  const peers = new Set<string>();
  let open = true;
  const t: Transport = {
    selfId,
    onJoin: () => {},
    onLeave: () => {},
    onMessage: () => {},
    send: (msg, to) => open && ch.postMessage({ k: 'msg', from: selfId, to, msg }),
    leave: () => {
      if (!open) return;
      open = false;
      ch.postMessage({ k: 'bye', from: selfId });
      ch.close();
    },
  };
  ch.onmessage = (e) => {
    const d = e.data as { k: string; from: string; to?: string; msg?: unknown };
    if (d.from === selfId) return;
    if (d.k === 'hello' || d.k === 'here') {
      if (!peers.has(d.from)) {
        peers.add(d.from);
        if (d.k === 'hello') ch.postMessage({ k: 'here', from: selfId });
        t.onJoin(d.from);
      }
    } else if (d.k === 'bye') {
      if (peers.delete(d.from)) t.onLeave(d.from);
    } else if (d.k === 'msg' && (!d.to || d.to === selfId)) {
      if (!peers.has(d.from)) {
        peers.add(d.from);
        t.onJoin(d.from);
      }
      t.onMessage(d.msg, d.from);
    }
  };
  addEventListener('pagehide', () => t.leave());
  queueMicrotask(() => ch.postMessage({ k: 'hello', from: selfId }));
  return t;
}

/** Short, easy-to-read room codes (no 0/O, 1/I). */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}
