import { TempleAudioManager } from './AudioManager';
import { AudioControls, useAudioState } from './AudioControls';
import { StorePanel } from './StorePanel';
import { type Appearance, type Product } from '../server/store-config';
import { ChatPanel, ProgressPanel } from './Community';
import { useEffect, useRef, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  UserRound,
  Volume2,
  VolumeX,
  Shirt,
  Flame,
  Heart,
  LogOut,
  X,
  Maximize2,
  Leaf,
  ArrowRight,
  Check,
} from 'lucide-react';
import { api, type User, type Outfit } from './api';
import { useTemple } from './useTemple';
import { TempleGame } from './TempleGame';
import { Experience } from './Experience';
import { Avatar, Lotus } from './Art';
type Popup =
  | 'store'
  | 'chat'
  | 'journal'
  | 'prayers'
  | 'ranks'
  | 'dots'
  | 'find'
  | 'login'
  | 'register'
  | 'account'
  | 'audio'
  | 'wardrobe'
  | 'queue'
  | 'forgot'
  | 'reset'
  | null;
export function GameScreen() {
  const [user, setUser] = useState<User | null>(null),
    [outfits, setOutfits] = useState<Outfit[]>([]),
    [popup, setPopup] = useState<Popup>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [selected, setSelected] = useState('saffron'),
    [accessory, setAccessory] = useState<'none' | 'beads' | 'lotus'>('none'),
    [front, setFront] = useState(true),
    [confirmBuy, setConfirmBuy] = useState(false),
    [quiet, setQuiet] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches),
    [now, setNow] = useState(Date.now()),
    [resetToken, setResetToken] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const inspectBar = useRef<HTMLDivElement>(null);
  useEffect(() => setInspecting(false), [popup]);
  const [zoom, setZoom] = useState(1),
    [focusSeat, setFocusSeat] = useState<number | undefined>(),
    [showNames, setShowNames] = useState(false),
    [movingMode, setMovingMode] = useState(false);
  const [npcCount, setNpcCount] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [preview, setPreview] = useState<Appearance | null>(null);
  const [eco, setEco] = useState(false),
    [find, setFind] = useState('');
  const [audioManager] = useState(() => new TempleAudioManager());
  const audioState = useAudioState(audioManager),
    muted = audioState.muted;
  useEffect(() => {
    audioManager.activate();
    return () => {
      void audioManager.dispose();
    };
  }, [audioManager]);
  const temple = useTemple(user, popup === 'chat'),
    { room, entry, myAction, connected } = temple;
  useEffect(() => {
    if (temple.wallet) setUser((u) => (u ? { ...u, ...temple.wallet } : u));
  }, [temple.wallet?.coins, temple.wallet?.merit, temple.wallet?.dots]);
  useEffect(() => {
    if (room)
      void api('/store')
        .then((r) => setProducts(r.products))
        .catch(() => {});
  }, [room?.configVersion]);
  const pendingSeat = useRef<number | undefined>(undefined),
    pendingJoin = useRef(false),
    dialog = useRef<HTMLDivElement>(null),
    screen = useRef<HTMLDivElement>(null),
    focusReturn = useRef<HTMLElement | null>(null),
    busyRef = useRef(false),
    proofKey = useRef(crypto.randomUUID()),
    handledLink = useRef(false);
  busyRef.current = busy;
  const robe = outfits.find((o) => o.id === selected),
    owned = !!user?.inventory.includes(selected),
    equipped = user?.equipped === selected && user?.accessory === accessory;
  useEffect(() => {
    void Promise.all([api('/me'), api('/catalog')])
      .then(([me, c]) => {
        setUser(me.user);
        setOutfits(c.outfits);
      })
      .catch(() => setToast('Chưa kết nối được máy chủ. Vui lòng thử tải lại.'));
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(
      () =>
        void api('/me')
          .then((r) => setUser(r.user))
          .catch(() => {}),
      15000,
    );
    return () => clearInterval(timer);
  }, [user?.id]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (entry?.status === 'WAITING' || entry?.status === 'INVITED') setPopup('queue');
  }, [entry?.id, entry?.status]);
  useEffect(() => {
    setError('');
    setConfirmBuy(false);
    if (!popup) {
      focusReturn.current?.focus();
      focusReturn.current = null;
      return;
    }
    if (!focusReturn.current) focusReturn.current = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () =>
        (inspecting ? inspectBar.current : dialog.current)
          ?.querySelector<HTMLElement>('input:not([tabindex="-1"]),button')
          ?.focus(),
      20,
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) setPopup(null);
      if (e.key === 'Tab') {
        const list = (
          inspecting ? inspectBar.current : dialog.current
        )?.querySelectorAll<HTMLElement>(
          'input:not([tabindex="-1"]),button:not(:disabled),a[href]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', key);
    };
  }, [popup, inspecting]);
  useEffect(() => {
    if (handledLink.current) return;
    handledLink.current = true;
    const params = new URLSearchParams(location.search);
    const verify = params.get('verify'),
      reset = params.get('reset');
    if (verify || reset) history.replaceState(null, '', location.pathname);
    if (reset) {
      setResetToken(reset);
      setPopup('reset');
    }
    if (verify)
      void api('/auth/verify-email', { token: verify })
        .then(async () => {
          setUser((await api('/me')).user);
          setToast('Đã xác minh email khôi phục.');
        })
        .catch((e) => setToast(e.message));
  }, []);
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
      setToast((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function chooseSeat(id?: number) {
    if (!connected || entry?.status === 'ACTIVE') return;
    if (entry) {
      setPopup('queue');
      return;
    }
    pendingSeat.current = id;
    pendingJoin.current = true;
    if (!user) {
      setPopup('register');
      return;
    }
    await run(async () => {
      const result = await api('/room/join', {
        requestKey: crypto.randomUUID(),
        ...(id ? { seatId: id } : {}),
      });
      if (result.entry.status === 'WAITING') setPopup('queue');
      else setToast('Bạn đã có chỗ. Hít thở nhẹ nhàng và trở về hiện tại.');
      await temple.refresh();
    });
  }
  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      let result;
      if (popup === 'register') {
        const challenge = await api('/auth/challenge');
        let solution = 0;
        const encoder = new TextEncoder();
        while (
          !bytesToHex(sha256(encoder.encode(`${challenge.nonce}:${solution}`))).startsWith('000')
        ) {
          solution++;
          if (solution % 2000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        result = await api('/auth/register', {
          username: data.get('username'),
          dharmaName: data.get('dharmaName'),
          password: data.get('password'),
          appearanceType: data.get('appearanceType') ?? 'male',
          email: data.get('email') || undefined,
          website: data.get('website') || '',
          challenge: { id: challenge.id, solution },
        });
      } else
        result = await api('/auth/login', {
          username: data.get('username'),
          password: data.get('password'),
        });
      setUser(result.user);
      setPopup(null);
      setToast(`Mừng ${result.user.dharmaName} trở về.`);
      if (pendingJoin.current) {
        pendingJoin.current = false;
        const id = pendingSeat.current;
        pendingSeat.current = undefined;
        try {
          await api('/room/join', {
            requestKey: crypto.randomUUID(),
            ...(id ? { seatId: id } : {}),
          });
        } catch (e) {
          setToast((e as Error).message);
        }
      }
    });
  }
  const audioConfig = JSON.stringify(
    room ? { audio: room.config.audio, mix: room.config.audioMix } : null,
  );
  useEffect(() => {
    if (room) audioManager.configure(room.config.audio, room.config.audioMix);
  }, [audioConfig]);
  useEffect(
    () =>
      audioManager.setPresence(
        entry?.status === 'WAITING' || entry?.status === 'INVITED' ? 'waiting' : 'temple',
      ),
    [entry?.status],
  );
  const priorAudio = useRef<{
    entry: any;
    completed: string | null;
    coin: string | null;
    initialized: boolean;
    userId: string | null;
  }>({ entry: null, completed: null, coin: null, initialized: false, userId: null });
  useEffect(() => {
    if (!room) return;
    if (priorAudio.current.userId !== (user?.id ?? null))
      priorAudio.current = {
        entry: null,
        completed: null,
        coin: null,
        initialized: false,
        userId: user?.id ?? null,
      };
    const previous = priorAudio.current;
    if (
      entry?.status === 'ACTIVE' &&
      (previous.entry?.id !== entry.id || previous.entry?.status !== 'ACTIVE')
    )
      void audioManager.effect('seat', entry.id);
    if (entry?.status === 'INVITED' && previous.entry?.status !== 'INVITED')
      void audioManager.effect('invitation', entry.id);
    if (!entry && previous.entry?.status === 'ACTIVE')
      void audioManager.effect('leave', previous.entry.id);
    if (
      myAction?.status === 'RUNNING' &&
      myAction.type !== 'incense' &&
      new Date(myAction.ends_at).getTime() > Date.now() + (room.clockOffsetMs ?? 0)
    ) {
      void audioManager.effect(myAction.type as 'bow' | 'prostrate', myAction.id);
      void audioManager.effect('woodblock', 'ritual:' + myAction.id);
    }
    // Incense is sounded only after a server-confirmed completion, never on queue/start/cancel.
    if (
      previous.initialized &&
      temple.completedAction?.id !== previous.completed &&
      temple.completedAction?.type === 'incense'
    )
      void audioManager.effect('incense', temple.completedAction.id);
    if (previous.initialized && temple.coinReward?.id !== previous.coin && temple.coinReward)
      void audioManager.effect('coin', temple.coinReward.id);
    priorAudio.current = {
      entry,
      completed: temple.completedAction?.id ?? null,
      coin: temple.coinReward?.id ?? null,
      initialized: true,
      userId: user?.id ?? null,
    };
  }, [
    entry?.id,
    entry?.status,
    myAction?.id,
    myAction?.status,
    temple.completedAction?.id,
    temple.coinReward?.id,
    !!room,
    user?.id,
  ]);
  useEffect(() => {
    if (room?.ceremony) void audioManager.effect('meditation', room.ceremony.id);
  }, [room?.ceremony?.id]);
  async function ritual(type: string) {
    await run(async () => {
      const response = await api(`/actions/${type}`, { requestKey: crypto.randomUUID() });
      if (response.action.status === 'QUEUED') setToast('Đã vào hàng chờ dâng hương.');

      await temple.refresh();
    });
  }
  async function buy() {
    if (!user) {
      setPopup('login');
      return;
    }
    if (!owned && !confirmBuy) {
      setConfirmBuy(true);
      return;
    }
    await run(async () => {
      const result = await api(
        owned ? '/wardrobe/equip' : '/wardrobe/buy',
        owned
          ? { outfitId: selected, accessory }
          : { outfitId: selected, requestKey: proofKey.current },
      );
      setUser(result.user);
      if (!owned) void audioManager.effect('purchase', proofKey.current);
      setConfirmBuy(false);
      proofKey.current = crypto.randomUUID();
      setToast(owned ? 'Đã mặc trang phục.' : 'Đã thêm áo vào tủ đồ. Chọn mặc để sử dụng.');
      await temple.refresh();
    });
  }
  return (
    <div className="single-game" ref={screen}>
      <header className="game-topbar">
        <div className="game-brand">
          <Lotus size={29} />
          <span>
            {room?.config.title ?? 'Tu Hành Online'}
            <small>MỘT NIỆM AN LÀNH</small>
          </span>
        </div>
        <div className="game-room-count">
          <span className={connected ? 'live-dot' : 'offline-dot'} />
          {room?.activeCount ?? 0}/{room?.capacity ?? 36} người thật <span>·</span> {npcCount} NPC{' '}
          <span>·</span> {room?.waiting ?? 0} chờ
        </div>
        <div className="game-tools">
          <button
            aria-label="Tủ đồ"
            onClick={() => {
              setSelected(user?.equipped ?? 'saffron');
              setAccessory(user?.accessory ?? 'none');
              setPopup('wardrobe');
            }}
          >
            <Shirt size={19} />
            <span>Tủ đồ</span>
          </button>
          <button onClick={() => setPopup('store')}>Bảo Các</button>
          <button onClick={() => setPopup('chat')}>Chat</button>
          <button onClick={() => setPopup('journal')}>Nhật ký</button>
          <button onClick={() => setPopup('prayers')}>Lời nguyện</button>
          <button onClick={() => setPopup('ranks')}>Công đức</button>
          <button onClick={() => setPopup('dots')}>Chấm sáng</button>
          <button onClick={() => setPopup('find')}>Tìm người</button>
          <button aria-label="Âm thanh" onClick={() => setPopup('audio')}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            <span>Âm thanh</span>
          </button>
          <button aria-label="Tài khoản" onClick={() => setPopup(user ? 'account' : 'login')}>
            <UserRound size={19} />
            <span>{user?.dharmaName ?? 'Đăng nhập'}</span>
          </button>
          <button
            aria-label="Toàn màn hình"
            onClick={() => {
              if (!document.fullscreenElement)
                void screen.current
                  ?.requestFullscreen?.()
                  .catch(() => setToast('Thiết bị chưa hỗ trợ toàn màn hình.'));
              else void document.exitFullscreen();
            }}
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </header>
      <main className="game-stage">
        {(!audioState.unlocked || audioState.needsGesture) && (
          <button
            className="sound-start"
            onClick={() => {
              void audioManager.unlock();
            }}
          >
            Vào chánh điện và bật âm thanh
          </button>
        )}
        <div className="game-world">
          <TempleGame
            room={room}
            outfits={outfits}
            userId={user?.id}
            onSeat={(id) => void chooseSeat(id)}
            quiet={quiet}
            zoom={zoom}
            focusSeat={focusSeat}
            showNames={showNames}
            movingMode={movingMode}
            onInspect={(id) => {
              setFocusSeat(id);
              setZoom(1.8);
            }}
            onMove={(nodeId) =>
              void run(async () => {
                await api('/character/move', { nodeId, requestKey: crypto.randomUUID() });
                await temple.refresh();
              })
            }
            eco={eco}
            preview={preview}
            products={products}
            onNpcCount={setNpcCount}
          />
          <div className="camera-tools" aria-label="Điều khiển camera">
            <button aria-label="Thu nhỏ" onClick={() => setZoom((v) => Math.max(1, v - 0.25))}>
              −
            </button>
            <span>{zoom.toFixed(2)}×</span>
            <button aria-label="Phóng to" onClick={() => setZoom((v) => Math.min(2.5, v + 0.25))}>
              +
            </button>
            <button
              onClick={() => {
                setFocusSeat(entry?.seat_id);
                setZoom(1.8);
              }}
              disabled={!entry?.seat_id}
            >
              Theo tôi
            </button>
            <button
              onClick={() => {
                setFocusSeat(undefined);
                setZoom(1);
              }}
            >
              Toàn cảnh
            </button>
            <button aria-pressed={showNames} onClick={() => setShowNames((v) => !v)}>
              Hiện tên
            </button>
          </div>
          {movingMode && (
            <div className="movement-hint" role="status">
              Chạm điểm sáng ở lối đi để di chuyển. Ghế được giữ tối đa 3 phút; đi dạo không nhận
              xu.
            </div>
          )}
          <div
            className="temple-lighting"
            data-mode={
              room?.config.lighting === 'auto'
                ? new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Asia/Bangkok',
                    hour: '2-digit',
                    hourCycle: 'h23',
                  }).format(now) >= '18' ||
                  new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Asia/Bangkok',
                    hour: '2-digit',
                    hourCycle: 'h23',
                  }).format(now) < '06'
                  ? 'night'
                  : 'day'
                : room?.config.lighting
            }
          />
          <Experience room={room} />
          <div className="npc-disclosure">
            {room?.status === 'open' ? (room.available ?? 0) : 0} chỗ có thể đăng ký · NPC hệ thống
            là nhân vật nền, luôn nhường ghế
          </div>
          {room && (
            <aside className="waiting-lobby" aria-label="Sảnh chờ">
              <strong>Sảnh chờ · {room.waiting} người</strong>
              <div>
                {room.waitingPlayers.map((p: any, i: number) => (
                  <span key={i} title={p.name}>
                    <Avatar outfitId={p.equipped} accessory={p.accessory} />
                    <small>{p.name}</small>
                  </span>
                ))}
              </div>
            </aside>
          )}
          {find.trim() &&
            room?.seats
              .filter(
                (s: any) =>
                  s.player?.name.toLocaleLowerCase('vi').includes(find.toLocaleLowerCase('vi')) &&
                  find.trim(),
              )
              .map((s: any) => (
                <div
                  key={s.id}
                  className="seat-search-highlight"
                  style={{ left: s.x + '%', top: s.y + '%' }}
                >
                  ◉ {s.code} · {s.player!.name}
                </div>
              ))}
          <div className="world-motto">
            <span />
            Bình yên trong từng hơi thở
          </div>
          {!connected && (
            <div className="game-connection" role="status">
              Đang đồng bộ với chánh điện…
            </div>
          )}
          {room?.config.announcement && (
            <div className="game-announcement">{room.config.announcement}</div>
          )}
        </div>
      </main>
      <footer className="game-dock">
        <div className="dock-presence">
          <span>
            {entry?.status === 'ACTIVE'
              ? `Đang ngồi · ${entry.seat_code ?? 'Đệm của bạn'}`
              : entry
                ? 'Đang chờ nhận chỗ'
                : 'Chọn một đệm trống để bắt đầu'}
          </span>
          <small>
            {myAction?.status === 'QUEUED'
              ? 'Đang chờ dâng hương'
              : 'Chỗ ngồi miễn phí · Trang phục chỉ thay đổi diện mạo'}
          </small>
        </div>
        {entry?.status === 'ACTIVE' && room?.config.movement.enabled && (
          <div className="movement-controls">
            <button
              aria-pressed={movingMode}
              disabled={
                busy ||
                !!myAction ||
                !!entry.movement_path ||
                entry.character_state?.startsWith('INCENSE')
              }
              onClick={() => setMovingMode((v) => !v)}
            >
              Đi dạo
            </button>
            <button
              disabled={
                busy ||
                !!entry.movement_path ||
                entry.character_state === 'SEATED' ||
                entry.character_state?.startsWith('INCENSE')
              }
              onClick={() =>
                void run(async () => {
                  await api('/character/return', { requestKey: crypto.randomUUID() });
                  setMovingMode(false);
                  await temple.refresh();
                })
              }
            >
              Về ghế
            </button>
            {entry.leave_deadline && (
              <small>
                Giữ ghế:{' '}
                {Math.max(
                  0,
                  Math.ceil(
                    (new Date(entry.leave_deadline).getTime() - now - (room.clockOffsetMs ?? 0)) /
                      1000,
                  ),
                )}{' '}
                giây
              </small>
            )}
            {entry.character_state?.startsWith('INCENSE') && (
              <small>
                {entry.character_state === 'INCENSE_PENDING'
                  ? 'Đang ngồi chờ gọi dâng hương'
                  : entry.character_state === 'INCENSE_ACTIVE'
                    ? 'Đang thắp hương · 5 giây'
                    : entry.character_state === 'INCENSE_RETURNING'
                      ? 'Đang trở về ghế'
                      : 'Đang đi / xếp hàng dâng hương'}
              </small>
            )}
          </div>
        )}
        <div className="dock-actions">
          <button onClick={() => setPopup('audio')}>
            <Volume2 size={23} />
            <span>Nghe kinh</span>
          </button>
          <button
            disabled={
              !temple.sitting ||
              (entry?.character_state && entry.character_state !== 'SEATED') ||
              !!myAction ||
              busy ||
              !connected ||
              !room?.config.actionsEnabled
            }
            onClick={() => void ritual('bow')}
          >
            <Lotus size={25} />
            <span>Vái</span>
          </button>
          <button
            disabled={
              !temple.sitting ||
              (entry?.character_state && entry.character_state !== 'SEATED') ||
              !!myAction ||
              busy ||
              !connected ||
              !room?.config.actionsEnabled
            }
            onClick={() => void ritual('prostrate')}
          >
            <Heart size={23} />
            <span>Lạy</span>
          </button>
          <button
            disabled={
              !temple.sitting ||
              (entry?.character_state && entry.character_state !== 'SEATED') ||
              !!myAction ||
              busy ||
              !connected ||
              !room?.config.actionsEnabled
            }
            onClick={() => void ritual('incense')}
          >
            <Flame size={23} />
            <span>Dâng hương</span>
          </button>
        </div>
        <button
          className="dock-join"
          disabled={busy || !connected}
          onClick={() =>
            entry
              ? void run(async () => {
                  await api('/room/leave', {});
                  setPopup(null);
                  await temple.refresh();
                })
              : void chooseSeat()
          }
        >
          {entry ? 'Rời phòng' : 'Vào chánh điện'}
          <ArrowRight size={16} />
        </button>
      </footer>
      {toast && (
        <div className="game-toast" role="status">
          <Leaf size={16} />
          <span>{toast}</span>
          <button aria-label="Đóng thông báo" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {popup && (
        <div
          className={`game-scrim ${popup === 'store' && inspecting ? 'store-inspecting' : ''}`}
          onClick={(e) => {
            if (e.currentTarget === e.target && !busy) setPopup(null);
          }}
        >
          {popup === 'store' && inspecting && (
            <div
              ref={inspectBar}
              className="store-inspect-bar"
              role="dialog"
              aria-label="Xem thử tại ghế"
            >
              <span>Đang xem thử trên máy bạn</span>
              <button onClick={() => setInspecting(false)}>Quay lại cửa hàng</button>
              <button onClick={() => setPopup(null)}>Hủy và đóng</button>
            </div>
          )}
          <section
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-dialog-title"
            className={`game-dialog dialog-${popup}`}
          >
            <button
              className="dialog-close"
              aria-label="Đóng cửa sổ"
              disabled={busy}
              onClick={() => setPopup(null)}
            >
              <X size={21} />
            </button>
            {(popup === 'login' || popup === 'register') && (
              <>
                <div className="dialog-lotus">
                  <Lotus size={42} />
                </div>
                <div className="dialog-kicker">MỘT CHỐN TRỞ VỀ</div>
                <h1 id="game-dialog-title">
                  {popup === 'register' ? 'Gieo một duyên lành' : 'Mừng bạn trở về'}
                </h1>
                <p>
                  {pendingSeat.current
                    ? 'Đăng nhập hoặc tạo tài khoản để nhận đệm vừa chọn.'
                    : 'Một khoảng lặng đang chờ bạn.'}
                </p>
                <div className="auth-tabs">
                  <button aria-pressed={popup === 'login'} onClick={() => setPopup('login')}>
                    Đăng nhập
                  </button>
                  <button aria-pressed={popup === 'register'} onClick={() => setPopup('register')}>
                    Đăng ký
                  </button>
                </div>
                <form onSubmit={authenticate}>
                  <label>
                    Tên đăng nhập
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={popup === 'register' ? 24 : 254}
                      placeholder={
                        popup === 'register'
                          ? '3–24 chữ không dấu, số hoặc _'
                          : 'Username hoặc email tài khoản cũ'
                      }
                    />
                  </label>
                  {popup === 'register' && (
                    <label>
                      Pháp danh
                      <input
                        name="dharmaName"
                        required
                        minLength={2}
                        maxLength={32}
                        autoComplete="nickname"
                        placeholder="Tên hiển thị trong chánh điện"
                      />
                    </label>
                  )}
                  {popup === 'register' && (
                    <label>
                      Kiểu nhân vật
                      <select name="appearanceType" aria-label="Kiểu nhân vật" defaultValue="male">
                        <option value="male">Nam</option>
                        <option value="female">Nữ</option>
                      </select>
                    </label>
                  )}
                  <label>
                    Mật khẩu
                    <input
                      type="password"
                      name="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete={popup === 'register' ? 'new-password' : 'current-password'}
                      placeholder="Ít nhất 12 ký tự"
                    />
                  </label>
                  {popup === 'register' && (
                    <>
                      <label>
                        Email khôi phục (không bắt buộc)
                        <input
                          type="email"
                          name="email"
                          autoComplete="email"
                          maxLength={254}
                          placeholder="Có thể để trống"
                        />
                      </label>
                      <label className="bot-honey" aria-hidden="true">
                        Website
                        <input name="website" tabIndex={-1} autoComplete="off" />
                      </label>
                      <p className="form-hint">
                        Không cần xác minh email để vào phòng. Nếu không thêm email, bạn chưa có
                        cách tự khôi phục khi quên mật khẩu.
                      </p>
                    </>
                  )}
                  {error && (
                    <p className="game-form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="game-primary" disabled={busy}>
                    {busy
                      ? 'Đang xử lý an toàn…'
                      : popup === 'register'
                        ? 'Tạo tài khoản & bước vào'
                        : 'Đăng nhập'}
                    <ArrowRight size={17} />
                  </button>
                </form>
                {popup === 'login' && (
                  <button className="text-link" onClick={() => setPopup('forgot')}>
                    Quên mật khẩu?
                  </button>
                )}
                <p className="form-hint">Mật khẩu được băm Argon2id · Chống đăng ký tự động</p>
              </>
            )}
            {popup === 'store' && (
              <StorePanel
                dotLayout={room?.config.dotLayout}
                user={user}
                onUser={setUser}
                onPurchase={(key) => {
                  void audioManager.effect('purchase', key);
                }}
                onPreview={setPreview}
                onInspect={() => setInspecting(true)}
              />
            )}
            {popup === 'chat' && <ChatPanel user={user} version={temple.chatVersion} />}
            {['journal', 'prayers', 'ranks', 'dots'].includes(popup ?? '') && (
              <ProgressPanel kind={popup!} user={user} onUser={setUser} />
            )}
            {popup === 'find' && (
              <>
                <h1 id="game-dialog-title">Tìm nhân vật</h1>
                <label>
                  Pháp danh
                  <input value={find} onChange={(e) => setFind(e.target.value)} maxLength={32} />
                </label>
                {room?.seats
                  .filter(
                    (s: any) =>
                      find.trim() &&
                      s.player?.name.toLocaleLowerCase('vi').includes(find.toLocaleLowerCase('vi')),
                  )
                  .map((s: any) => (
                    <p key={s.id}>
                      <button
                        onClick={() => {
                          setFocusSeat(s.id);
                          setZoom(1.8);
                          setPopup(null);
                        }}
                      >
                        {s.player!.name} · Đệm {s.code} · Xem gần
                      </button>
                    </p>
                  ))}
                <button onClick={() => setPopup(null)}>Xem vị trí trên chánh điện</button>
              </>
            )}
            {popup === 'queue' && (
              <>
                <Lotus size={40} />
                <h1 id="game-dialog-title">
                  {entry?.status === 'INVITED' ? 'Đã có chỗ cho bạn' : 'Xin chờ một duyên lành'}
                </h1>
                {entry?.status === 'INVITED' ? (
                  <>
                    <p>
                      Đệm {entry.seat_code}. Còn{' '}
                      {Math.max(
                        0,
                        Math.ceil(
                          (new Date(entry.expires_at).getTime() -
                            now -
                            (room?.clockOffsetMs ?? 0)) /
                            1000,
                        ),
                      )}{' '}
                      giây để xác nhận.
                    </p>
                    <button
                      className="game-primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api('/waitlist/accept', {});
                          setPopup(null);
                          await temple.refresh();
                        })
                      }
                    >
                      Nhận chỗ ngồi
                    </button>
                  </>
                ) : (
                  <p>
                    Bạn đang ở vị trí <strong>{entry?.position ?? '…'}</strong> trong hàng chờ.
                    Chúng mình sẽ thông báo khi có chỗ trống.
                  </p>
                )}
                <p className="form-hint">
                  Mời theo thứ tự FIFO, không phụ thuộc quà LIVE hay trang phục.
                </p>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('/waitlist/cancel', {});
                      setPopup(null);
                      await temple.refresh();
                    })
                  }
                >
                  Rời hàng chờ
                </button>
              </>
            )}
            {popup === 'account' && user && (
              <>
                <div className="account-avatar">
                  <Avatar
                    front
                    dots={user.dots}
                    appearanceType={user.appearanceType}
                    dotLayout={room?.config.dotLayout}
                    outfitId={user.equipped}
                    accessory={user.accessory}
                    color={outfits.find((o) => o.id === user.equipped)?.color}
                    accent={outfits.find((o) => o.id === user.equipped)?.accent}
                  />
                </div>
                <label>
                  Kiểu nhân vật
                  <select
                    aria-label="Kiểu nhân vật"
                    value={user.appearanceType ?? 'male'}
                    disabled={busy}
                    onChange={(e) => {
                      const appearanceType = e.target.value;
                      void run(async () => {
                        setUser((await api('/character/appearance', { appearanceType })).user);
                        await temple.refresh();
                      });
                    }}
                  >
                    <option value="male">Nam</option>
                    <option value="female">Nữ</option>
                  </select>
                </label>
                <h1 id="game-dialog-title">{user.dharmaName}</h1>
                <p>
                  @{user.username} · {user.coins} xu
                </p>
                <p className="form-hint">
                  {user.hasRecoveryEmail
                    ? 'Đã lưu email khôi phục.'
                    : 'Tài khoản chưa có email khôi phục. Hãy ghi nhớ username và mật khẩu.'}
                </p>
                {user.hasRecoveryEmail && !user.verified && (
                  <button
                    className="text-link"
                    onClick={() =>
                      void run(async () => {
                        await api('/auth/resend-verification', {});
                        setToast(
                          'Đã gửi thư xác minh email khôi phục. Việc ngồi trong chánh điện không bị ảnh hưởng.',
                        );
                      })
                    }
                  >
                    Xác minh email khôi phục (tùy chọn)
                  </button>
                )}
                <button
                  className="game-primary"
                  onClick={() => {
                    setSelected(user.equipped);
                    setAccessory(user.accessory);
                    setPopup('wardrobe');
                  }}
                >
                  <Shirt size={18} />
                  Mở tủ đồ
                </button>
                {user.role !== 'USER' && (
                  <a className="text-link" href="/admin">
                    Trung tâm quản trị →
                  </a>
                )}
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('/auth/logout', {});
                      void audioManager.effect('leave', entry?.id ?? 'logout');
                      setUser(null);
                      setPopup(null);
                      setToast('Đã đăng xuất an toàn.');
                    })
                  }
                >
                  <LogOut size={15} />
                  Đăng xuất
                </button>
              </>
            )}
            {popup === 'audio' && (
              <>
                <Lotus size={39} />
                <h1 id="game-dialog-title">Lắng nghe & tĩnh tâm</h1>
                <AudioControls manager={audioManager} />
                <label className="game-check">
                  <input
                    type="checkbox"
                    checked={quiet}
                    onChange={(e) => setQuiet(e.target.checked)}
                  />
                  Giảm chuyển động
                </label>
                <label className="game-check">
                  <input type="checkbox" checked={eco} onChange={(e) => setEco(e.target.checked)} />
                  Chế độ tiết kiệm · 20 FPS
                </label>
              </>
            )}
            {popup === 'wardrobe' && (
              <>
                <div className="dialog-kicker">MỘT CHÚT RIÊNG, MỘT CHÚT BẠN</div>
                <h1 id="game-dialog-title">Tủ áo an nhiên</h1>
                <p>{user ? `${user.coins} xu` : 'Thử áo miễn phí · Đăng nhập để lưu trang phục'}</p>
                <div className="wardrobe-room">
                  <div className="robe-preview">
                    <Avatar
                      front={front}
                      appearanceType={user?.appearanceType}
                      color={robe?.color}
                      accent={robe?.accent}
                      outfitId={robe?.id}
                      accessory={accessory}
                    />
                    <h2>{robe?.name}</h2>
                    <div className="auth-tabs">
                      <button aria-pressed={front} onClick={() => setFront(true)}>
                        Mặt trước
                      </button>
                      <button aria-pressed={!front} onClick={() => setFront(false)}>
                        Mặt sau
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="game-robe-grid">
                      {outfits.map((o) => (
                        <button
                          aria-pressed={selected === o.id}
                          key={o.id}
                          onClick={() => {
                            setSelected(o.id);
                            setConfirmBuy(false);
                            proofKey.current = crypto.randomUUID();
                          }}
                        >
                          <Avatar front outfitId={o.id} color={o.color} accent={o.accent} />
                          <strong>{o.name}</strong>
                          <small>
                            {user?.inventory.includes(o.id)
                              ? 'Đã sở hữu'
                              : o.price === 0
                                ? 'Khởi đầu'
                                : `${o.price} xu`}
                          </small>
                        </button>
                      ))}
                    </div>
                    <p className="form-hint">Phụ kiện miễn phí · Tách lớp với áo</p>
                    <div className="accessory-buttons">
                      {(
                        [
                          ['none', 'Không'],
                          ['beads', 'Chuỗi hạt'],
                          ['lotus', 'Hoa sen'],
                        ] as const
                      ).map(([id, name]) => (
                        <button
                          key={id}
                          aria-pressed={accessory === id}
                          onClick={() => setAccessory(id)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    {error && (
                      <p className="game-form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button
                      className="game-primary"
                      disabled={
                        busy || equipped || (!!user && !owned && user.coins < (robe?.price ?? 0))
                      }
                      onClick={() => void buy()}
                    >
                      {equipped ? (
                        <>
                          <Check size={17} />
                          Đang mặc
                        </>
                      ) : !user ? (
                        'Đăng nhập để sở hữu'
                      ) : owned ? (
                        'Mặc trang phục'
                      ) : user.coins < (robe?.price ?? 0) ? (
                        'Chưa đủ xu'
                      ) : confirmBuy ? (
                        `Xác nhận mua · ${robe?.price} xu`
                      ) : (
                        `Sở hữu với ${robe?.price} xu`
                      )}
                    </button>
                    <p className="form-hint">
                      Không nạp tiền thật. Không ảnh hưởng thứ tự nhận ghế.
                    </p>
                  </div>
                </div>
              </>
            )}
            {(popup === 'forgot' || popup === 'reset') && (
              <>
                <h1 id="game-dialog-title">
                  {popup === 'forgot' ? 'Tìm lại tài khoản' : 'Đặt mật khẩu mới'}
                </h1>
                <p>
                  {popup === 'forgot'
                    ? 'Dùng email đã lưu khi đăng ký. Tài khoản không có email chưa hỗ trợ tự khôi phục.'
                    : 'Liên kết có hạn và chỉ dùng được một lần.'}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void run(async () => {
                      await api(
                        popup === 'forgot' ? '/auth/forgot-password' : '/auth/reset-password',
                        popup === 'forgot'
                          ? { email: data.get('email') }
                          : { token: resetToken, password: data.get('password') },
                      );
                      setPopup('login');
                      setToast(
                        popup === 'forgot'
                          ? 'Nếu email đã được lưu, hướng dẫn khôi phục sẽ được gửi.'
                          : 'Mật khẩu đã đổi. Các phiên cũ đã được thu hồi.',
                      );
                    });
                  }}
                >
                  {popup === 'forgot' ? (
                    <label>
                      Email khôi phục
                      <input name="email" type="email" required autoComplete="email" />
                    </label>
                  ) : (
                    <label>
                      Mật khẩu mới
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </label>
                  )}
                  {error && (
                    <p className="game-form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="game-primary" disabled={busy}>
                    Tiếp tục
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
