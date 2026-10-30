import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, type User } from './api';
import { type RoomService } from '../server/room';
export type RoomSnapshot = Awaited<ReturnType<RoomService['snapshot']>> & {
  clockOffsetMs?: number;
};
export function useTemple(user: User | null) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null),
    [entry, setEntry] = useState<any>(null),
    [myAction, setMyAction] = useState<any>(null),
    [connected, setConnected] = useState(false),
    [gift, setGift] = useState<any>(null);
  const inFlight = useRef(-1),
    generation = useRef(0),
    seenGift = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const gen = generation.current;
    if (inFlight.current === gen) return;
    inFlight.current = gen;
    try {
      const [snapshot, me] = await Promise.all([
        api('/room'),
        user ? api('/room/me') : Promise.resolve({ entry: null, action: null }),
      ]);
      if (gen !== generation.current) return;
      setRoom({ ...snapshot, clockOffsetMs: new Date(snapshot.serverTime).getTime() - Date.now() });
      setEntry(me.entry);
      setMyAction(me.action);
      setConnected(true);
    } catch (e) {
      if (gen === generation.current) {
        setConnected(false);
        if ((e as any).status === 401) {
          setEntry(null);
          setMyAction(null);
        }
      }
    } finally {
      if (inFlight.current === gen) inFlight.current = -1;
    }
  }, [user?.id]);
  useEffect(() => {
    generation.current++;
    void refresh();
    const socket = io({
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    const update = () => void refresh();
    socket.on('connect', update);
    socket.on('resync.required', update);
    socket.on('temple.event', (event) => {
      update();
      if (event.kind === 'live.gift' && !seenGift.current.has(event.payload.id)) {
        seenGift.current.add(event.payload.id);
        if (seenGift.current.size > 100)
          seenGift.current.delete(seenGift.current.values().next().value!);
        setGift(event.payload);
      }
    });
    const polling = setInterval(update, 5000),
      heartbeat = setInterval(() => {
        if (user) void api('/room/heartbeat', {}).catch(() => {});
      }, 20000);
    return () => {
      generation.current++;
      clearInterval(polling);
      clearInterval(heartbeat);
      socket.disconnect();
    };
  }, [refresh, user?.id]);
  useEffect(() => {
    if (!gift) return;
    const id = setTimeout(() => setGift(null), 8000);
    return () => clearTimeout(id);
  }, [gift]);
  return { room, entry, myAction, connected, gift, refresh, sitting: entry?.status === 'ACTIVE' };
}
