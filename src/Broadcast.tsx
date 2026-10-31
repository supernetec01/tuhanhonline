import { AltarDecorations } from './AltarDecorations';
import { TempleAudioManager } from './AudioManager';
import { AudioControls } from './AudioControls';
import { Experience } from './Experience';
import { useEffect, useRef, useState } from 'react';
import { api, type Outfit } from './api';
import { useTemple } from './useTemple';
import { TempleGame } from './TempleGame';
import { type Product } from '../server/store-config';
import { Lotus } from './Art';
export function Broadcast() {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [enabled, setEnabled] = useState(false),
    [deviceVoice, setDeviceVoice] = useState(false),
    [caption, setCaption] = useState(''),
    [error, setError] = useState(''),
    [outfits, setOutfits] = useState<Outfit[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [npcCount, setNpcCount] = useState(0);
  const { room, gift } = useTemple(null);
  const playing = useRef(false);
  const [manager] = useState(() => new TempleAudioManager());
  useEffect(() => {
    manager.activate();
    return () => {
      void manager.dispose();
    };
  }, [manager]);
  const audioConfig = JSON.stringify(
    room ? { audio: room.config.audio, mix: room.config.audioMix } : null,
  );
  useEffect(() => {
    if (room) manager.configure(room.config.audio, room.config.audioMix);
  }, [audioConfig]);
  useEffect(() => {
    history.replaceState(null, '', location.pathname);
  }, []);
  useEffect(() => {
    if (room)
      void Promise.all([api('/catalog'), api('/store')]).then(([c, s]) => {
        setOutfits(c.outfits);
        setProducts(s.products);
      });
  }, [room?.configVersion]);
  useEffect(() => {
    if (!enabled || !token) return;
    let mounted = true;
    let controller: AbortController | null = null;
    let cancelPlayback: (() => void) | null = null;
    async function next() {
      if (playing.current) return;
      playing.current = true;
      let job: any = null;
      let watchdog: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await api('/broadcast/claim', {}, { 'X-Broadcast-Token': token });
        job = result.job;
        if (!job) return;
        if (!mounted) return;
        setCaption(job.text);
        controller = new AbortController();
        setError('');
        const interrupted = new Promise<void>((resolve) => {
          cancelPlayback = resolve;
          timeout = setTimeout(() => {
            controller?.abort();
            resolve();
          }, 10000);
        });
        watchdog = setInterval(() => {
          void api(`/broadcast/state/${job.id}`, undefined, { 'X-Broadcast-Token': token })
            .then((state) => {
              if (state.status !== 'PLAYING') {
                controller?.abort();
                window.speechSynthesis?.cancel();
                setCaption('');
                cancelPlayback?.();
              }
            })
            .catch(() => {});
        }, 1000);
        if (job.mode === 'openai' || job.mode === 'static' || deviceVoice) {
          manager.setSpeaking(true);
          await manager.effect('blessing', job.id, true, controller.signal);
          if (!mounted || controller.signal.aborted) return;
        }
        if (job.mode === 'openai' || job.mode === 'static') {
          const response = await fetch(`/api/broadcast/audio/${job.id}`, {
            headers: { 'X-Broadcast-Token': token },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('Không tải được giọng đọc AI.');
          await Promise.race([
            interrupted,
            manager.voice(await response.arrayBuffer(), controller.signal),
          ]);
        } else if (deviceVoice && 'speechSynthesis' in window) {
          const voice = speechSynthesis
            .getVoices()
            .find((v) => v.lang.toLowerCase().startsWith('vi'));
          if (!voice)
            throw new Error('Thiết bị chưa có giọng Việt; lời chúc vẫn hiển thị trên màn hình.');
          await Promise.race([
            interrupted,
            new Promise<void>((resolve, reject) => {
              const speech = new SpeechSynthesisUtterance(job.text);
              speech.lang = 'vi-VN';
              speech.voice = voice;
              speech.rate = 0.9;
              speech.volume = manager.state.muted ? 0 : manager.state.volumes.voice;
              speech.onend = () => resolve();
              speech.onerror = () => reject(new Error('Giọng thiết bị không khả dụng.'));
              speechSynthesis.speak(speech);
            }),
          ]);
        } else
          await Promise.race([interrupted, new Promise((resolve) => setTimeout(resolve, 5000))]);
      } catch (e) {
        if (mounted && !controller?.signal.aborted) setError((e as Error).message);
      } finally {
        manager.setSpeaking(false);
        if (watchdog) clearInterval(watchdog);
        if (timeout) clearTimeout(timeout);
        cancelPlayback = null;
        controller?.abort();
        window.speechSynthesis?.cancel();
        if (job)
          await api('/broadcast/complete', { id: job.id }, { 'X-Broadcast-Token': token }).catch(
            () => {},
          );
        playing.current = false;
      }
    }
    const id = setInterval(() => void next(), 2000);
    void next();
    return () => {
      mounted = false;
      clearInterval(id);
      controller?.abort();
      window.speechSynthesis?.cancel();
      cancelPlayback?.();
    };
  }, [enabled, token, deviceVoice]);
  return (
    <div className="broadcast-page">
      <div className="broadcast-canvas">
        <div className="broadcast-title">
          <Lotus size={36} />
          <h1>{room?.config.title ?? 'Tu Hành Online'}</h1>
          <p>{room?.config.roomName ?? 'Chánh điện'}</p>
        </div>
        <div className="scene broadcast-scene npc-broadcast-scene">
          <TempleGame
            room={room}
            outfits={outfits}
            products={products}
            onSeat={() => {}}
            quiet={false}
            portraitMode
            readOnly
            onNpcCount={setNpcCount}
          />
          {room && <AltarDecorations config={room.config.decorations} portraitMode />}
          <Experience room={room} />
        </div>
        <div className="broadcast-caption">
          <Lotus size={28} />
          <p>{caption || 'Một hơi thở nhẹ, một niệm an lành.'}</p>
          {gift && (
            <small>
              {gift.provider === 'mock' ? 'MÔ PHỎNG · ' : ''}Cảm ơn {gift.name} · {gift.quantity}{' '}
              quà
            </small>
          )}
          <small>Giọng AI khi dùng dịch vụ TTS · Chế độ mặc định: lời chúc bằng chữ</small>
        </div>
        <div className="broadcast-count">
          {room?.activeCount ?? 0}/{room?.capacity ?? 36} người thật · {npcCount} NPC hệ thống ·{' '}
          {room?.status === 'open' ? (room.available ?? 0) : 0} chỗ có thể đăng ký ·{' '}
          {room?.waiting ?? 0} đang chờ
        </div>
      </div>
      <aside className="broadcast-controls">
        <h2>Điều khiển phát sóng</h2>
        <p>
          Màn hình dọc 9:16. Đặt vùng nội dung trong OBS; không đưa bảng điều khiển này lên LIVE.
        </p>
        {!token ? (
          <p className="form-error">Tạo liên kết có thời hạn tại trang Admin trước khi phát.</p>
        ) : (
          <button
            className="primary-button"
            onClick={() => {
              if (enabled) {
                setEnabled(false);
                manager.pause();
              } else
                void manager.unlock().then((ok) => {
                  if (ok) setEnabled(true);
                });
            }}
          >
            {enabled ? 'Tạm dừng nhận lời chúc' : 'Bật nhận lời chúc / cho phép âm thanh'}
          </button>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={deviceVoice}
            onChange={(e) => setDeviceVoice(e.target.checked)}
            disabled={enabled}
          />
          Dùng giọng thiết bị cho mock (không phải dịch vụ AI)
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <AudioControls manager={manager} />
        <a href="/admin">Trở về Admin</a>
      </aside>
    </div>
  );
}
