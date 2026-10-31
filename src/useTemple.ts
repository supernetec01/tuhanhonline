import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, type User } from './api';
import { type RoomService } from '../server/room';
export type RoomSnapshot = Awaited<ReturnType<RoomService['snapshot']>> & {
  clockOffsetMs?: number;
};
export function useTemple(user: User | null, chatOpen = false) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null),
    [entry, setEntry] = useState<any>(null),
    [wallet, setWallet] = useState<{ coins: number; merit: number; dots: number } | null>(null),
    [completedAction, setCompletedAction] = useState<any>(null),
    [coinReward, setCoinReward] = useState<any>(null),
    [myAction, setMyAction] = useState<any>(null),
    [connected, setConnected] = useState(false),
    [gift, setGift] = useState<any>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const [chatVersion, setChatVersion] = useState(0);
  useEffect(() => {
    socketRef.current?.emit('chat.subscribe', chatOpen);
  }, [chatOpen]);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
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
      setCompletedAction(me.completedAction ?? null);
      setCoinReward(me.coinReward ?? null);
      setWallet(me.wallet ?? null);
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
  const refreshRef = useRef(refresh),
    userRef = useRef(user);
  refreshRef.current = refresh;
  userRef.current = user;
  useEffect(() => {
    generation.current++;
    void refresh();
  }, [refresh]);
  useEffect(() => {
    generation.current++;
    void refreshRef.current();
    const socket = io({
      forceNew: true,
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('chat.subscribe', chatOpenRef.current));
    let refreshTimer: ReturnType<typeof setTimeout> | undefined,
      lastEventRefresh = 0;
    const update = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(
        () => {
          refreshTimer = undefined;
          lastEventRefresh = Date.now();
          void refreshRef.current();
        },
        Math.max(100, 1000 - (Date.now() - lastEventRefresh)),
      );
    };
    socket.on('connect', update);
    socket.on('resync.required', update);
    socket.on('temple.event', (event) => {
      if (event.kind.startsWith('chat.')) {
        setChatVersion((v) => v + 1);
        return;
      }
      update();
      if (event.kind === 'live.gift' && !seenGift.current.has(event.payload.id)) {
        seenGift.current.add(event.payload.id);
        if (seenGift.current.size > 100)
          seenGift.current.delete(seenGift.current.values().next().value!);
        setGift(event.payload);
      }
    });
    const polling = setInterval(update, 10000),
      heartbeat = setInterval(() => {
        if (userRef.current) void api('/room/heartbeat', {}).catch(() => {});
      }, 20000);
    return () => {
      generation.current++;
      clearInterval(polling);
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(heartbeat);
      socket.removeAllListeners();
      socket.disconnect();
      socket.io.engine?.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!gift) return;
    const id = setTimeout(() => setGift(null), 8000);
    return () => clearTimeout(id);
  }, [gift]);
  return {
    wallet,
    completedAction,
    coinReward,
    chatVersion,
    room,
    entry,
    myAction,
    connected,
    gift,
    refresh,
    sitting: entry?.status === 'ACTIVE',
  };
}
