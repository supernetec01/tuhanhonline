import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from './Art';
import { type RoomSnapshot } from './useTemple';
import { type Outfit } from './api';
import { ceremonyPhase } from './Experience';
export function TempleGame({
  room,
  outfits,
  userId,
  onSeat,
  quiet,
}: {
  room: RoomSnapshot | null;
  outfits: Outfit[];
  userId?: string;
  onSeat: (id: number) => void;
  quiet: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef({ room, outfits, userId, onSeat, quiet });
  state.current = { room, outfits, userId, onSeat, quiet };
  const [portrait, setPortrait] = useState(() => matchMedia('(max-width:650px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width:650px)');
    const update = () => setPortrait(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const projectY = (value: number) => (portrait ? 45 + ((value - 52.7) / 37.5) * 47 : value);
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  useEffect(() => {
    if (!outfits.length) return;
    setReady(false);
    let disposed = false;
    const W = portrait ? 1000 : 1400,
      H = portrait ? 1600 : 1000;
    let game: import('phaser').Game | undefined;
    void import('phaser')
      .then(({ default: P }) => {
        if (disposed || !host.current) return;
        class Sanctuary extends P.Scene {
          private players = new Map<number, import('phaser').GameObjects.Image>();
          private names = new Map<number, import('phaser').GameObjects.Text>();
          private floor?: import('phaser').GameObjects.Container;
          private layout = '';
          preload() {
            this.load.svg('sanctuary', portrait ? '/sanctuary-portrait.svg' : '/sanctuary.svg', {
              width: W,
              height: H,
            });
            for (const robe of state.current.outfits)
              for (const accessory of ['none', 'beads', 'lotus']) {
                const svg = renderToStaticMarkup(
                  <Avatar
                    color={robe.color}
                    accent={robe.accent}
                    outfitId={robe.id}
                    accessory={accessory}
                  />,
                );
                this.load.svg(`${robe.id}-${accessory}`, 'data:image/svg+xml;base64,' + btoa(svg), {
                  width: 240,
                  height: 280,
                });
              }
            this.load.on('loaderror', () => {
              if (!disposed) setError('Không tải được hình ảnh. Vui lòng tải lại trang.');
            });
          }
          create() {
            this.add.image(W / 2, H / 2, 'sanctuary').setDisplaySize(W, H);
            this.floor = this.add.container(0, 0).setDepth(480);
            if (!disposed) setReady(true);
          }
          update() {
            const current = state.current,
              r = current.room;
            if (!r) return;
            const now = Date.now() + (r.clockOffsetMs ?? 0);
            const signature = JSON.stringify(
              r.seats.map(
                (s: { id: number; x: number; y: number; scale: number; enabled: boolean }) => ({
                  id: s.id,
                  x: s.x,
                  y: s.y,
                  scale: s.scale,
                  enabled: s.enabled,
                }),
              ),
            );
            if (signature !== this.layout) {
              this.layout = signature;
              this.floor?.removeAll(true);
              for (const seat of r.seats) {
                const x = (seat.x * W) / 100,
                  y = (projectY(seat.y) * H) / 100,
                  w = (seat.scale * W) / 100,
                  h = w * 0.32;
                const g = this.add.graphics();
                g.fillStyle(0x120f12, 0.6).fillEllipse(x, y + 12, w * 1.1, h * 0.8);
                g.fillStyle(0x463b3d).fillRoundedRect(x - w / 2, y - h / 2, w, h, 8);
                g.lineStyle(2, 0x927149, 0.7).strokeRoundedRect(
                  x - w / 2 + 2,
                  y - h / 2 + 2,
                  w - 4,
                  h - 4,
                  7,
                );
                g.lineStyle(1, 0xc7a56d, 0.2).strokeRoundedRect(
                  x - w / 2 + 8,
                  y - h / 2 + 6,
                  w - 16,
                  h - 12,
                  5,
                );
                g.setAlpha(seat.enabled ? 1 : 0.25);
                this.floor?.add(g);
                const zone = this.add
                  .zone(x, y, w, h * 1.4)
                  .setInteractive({ useHandCursor: true });
                zone.on('pointerdown', () => {
                  const live = state.current.room?.seats.find(
                    (s: { id: number }) => s.id === seat.id,
                  );
                  if (live?.enabled && !live.player && !live.reserved)
                    state.current.onSeat(seat.id);
                });
                this.floor?.add(zone);
              }
            }
            const present = new Set<number>();
            for (const seat of r.seats) {
              const player = seat.player;
              if (!player) continue;
              present.add(seat.id);
              const texture = `${player.equipped}-${player.accessory ?? 'none'}`;
              let sprite = this.players.get(seat.id);
              if (!sprite) {
                sprite = this.add
                  .image(0, 0, this.textures.exists(texture) ? texture : 'linen-none')
                  .setOrigin(0.5, 1);
                this.players.set(seat.id, sprite);
              }
              if (this.textures.exists(texture)) sprite.setTexture(texture);
              let x = (seat.x * W) / 100,
                y = (projectY(seat.y) * H) / 100 - 7,
                scale = 1,
                sy = 1;
              const started = new Date(player.started_at).getTime(),
                ends = new Date(player.ends_at).getTime();
              const active = !!player.action && now < ends;
              const phase = ceremonyPhase(r.ceremony, now);
              const action = active
                ? player.action
                : phase === 'bow'
                  ? 'bow'
                  : phase === 'prostrate'
                    ? 'prostrate'
                    : 'idle';
              if (action === 'incense' && !current.quiet) {
                const t = Math.max(0, Math.min(1, (now - started) / (ends - started)));
                const baseX = x,
                  baseY = y;
                const p = t < 0.5 ? t : 1 - t;
                if (p < 0.15) x = baseX + ((W / 2 - baseX) * p) / 0.15;
                else {
                  x = W / 2;
                  y = baseY + ((portrait ? 480 : 372) - baseY) * Math.min(1, (p - 0.15) / 0.2);
                }
                scale = 1 - (baseY - y) / (portrait ? 3000 : 1500);
              }
              if (action === 'bow')
                sy = current.quiet
                  ? 0.82
                  : 0.82 +
                    0.18 *
                      Math.cos(
                        (active ? (now - started) / Math.max(1, ends - started) : 0.5) *
                          Math.PI *
                          2,
                      );
              if (action === 'prostrate')
                sy = current.quiet
                  ? 0.55
                  : 0.55 +
                    0.45 *
                      Math.abs(
                        Math.cos(
                          (active ? (now - started) / Math.max(1, ends - started) : 0.5) * Math.PI,
                        ),
                      );
              const width = ((seat.scale * W) / 100) * 1.16 * scale;
              sprite
                .setPosition(x, y)
                .setDisplaySize(width, ((width * 140) / 120) * sy)
                .setDepth(y);
              let name = this.names.get(seat.id);
              if (!name) {
                name = this.add
                  .text(0, 0, '', {
                    fontFamily: 'sans-serif',
                    fontSize: '12px',
                    color: '#e6c998',
                    backgroundColor: '#261c18cc',
                    padding: { x: 7, y: 4 },
                  })
                  .setOrigin(0.5, 0);
                this.names.set(seat.id, name);
              }
              name
                .setText(player.name + (player.player_id === current.userId ? ' · Bạn' : ''))
                .setPosition((seat.x * W) / 100, (projectY(seat.y) * H) / 100 + 18)
                .setDepth(950)
                .setVisible(r.config.live.showNames || player.player_id === current.userId);
            }
            for (const [id, sprite] of this.players)
              if (!present.has(id)) {
                sprite.destroy();
                this.players.delete(id);
                this.names.get(id)?.destroy();
                this.names.delete(id);
              }
          }
        }
        game = new P.Game({
          type: P.CANVAS,
          parent: host.current,
          width: W,
          height: H,
          backgroundColor: '#161113',
          scene: Sanctuary,
          scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH },
          render: { antialias: true },
          fps: { target: 30, forceSetTimeOut: true },
          audio: { noAudio: true },
          banner: false,
        });
      })
      .catch(() => {
        if (!disposed) setError('Chưa tải được bộ máy game. Hãy tải lại trang.');
      });
    return () => {
      disposed = true;
      game?.destroy(true);
    };
  }, [outfits.length > 0, portrait]);
  return (
    <>
      <div
        ref={host}
        className="phaser-host"
        aria-label="Chánh điện Phaser 2D"
        data-ready={ready}
      />
      {error && (
        <p className="game-load-error" role="alert">
          {error}
        </p>
      )}
      {!ready && !error && <div className="game-loading">Đang mở cửa chánh điện…</div>}
      <div className="accessible-seats" aria-label="Chọn đệm ngồi">
        {room?.seats.map(
          (seat: {
            id: number;
            code: string;
            x: number;
            y: number;
            scale: number;
            player: unknown;
            reserved: boolean;
            enabled: boolean;
          }) => (
            <button
              key={seat.id}
              className="seat-target"
              aria-label={`Ghế ${seat.code}${seat.player ? ' đã có người' : seat.reserved ? ' đang giữ chỗ' : ' trống'}`}
              disabled={!ready || !!seat.player || seat.reserved || !seat.enabled}
              style={{ left: `${seat.x}%`, top: `${projectY(seat.y)}%`, width: `${seat.scale}%` }}
              onClick={() => onSeat(seat.id)}
            >
              <span>{seat.code}</span>
            </button>
          ),
        )}
      </div>
    </>
  );
}
