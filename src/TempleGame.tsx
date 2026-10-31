import { useEffect, useRef, useState } from 'react';
import { VirtualNpcState, npcPoses } from './virtualNpcs';
import { npcTextureProducts, npcRobe } from './npcArt';
import { buildStoreAtlas } from './storeAtlas';
import { baseCosmetics, type Appearance, type Product } from '../server/store-config';
import { type RoomSnapshot } from './useTemple';
import { type Outfit } from './api';
import { ceremonyPhase } from './Experience';
export function TempleGame({
  room,
  outfits,
  userId,
  onSeat,
  quiet,
  eco = false,
  preview = null,
  products,
  onNpcCount,
  portraitMode,
  readOnly = false,
}: {
  room: RoomSnapshot | null;
  outfits: Outfit[];
  userId?: string;
  onSeat: (id: number) => void;
  quiet: boolean;
  eco?: boolean;
  preview?: Appearance | null;
  products: Product[];
  onNpcCount?: (count: number) => void;
  portraitMode?: boolean;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef({ room, outfits, userId, onSeat, quiet, preview, onNpcCount, readOnly });
  state.current = { room, outfits, userId, onSeat, quiet, preview, onNpcCount, readOnly };
  const [portrait, setPortrait] = useState(
    () => portraitMode ?? matchMedia('(max-width:650px)').matches,
  );
  useEffect(() => {
    const query = matchMedia('(max-width:650px)');
    const update = () => setPortrait(portraitMode ?? query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [portraitMode]);
  const projectY = (value: number) => (portrait ? 45 + ((value - 52.7) / 37.5) * 47 : value);
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const atlasSignature = JSON.stringify(
    products
      .map(({ id, category, color, accent, design, imageId }) => ({
        id,
        category,
        color,
        accent,
        design,
        imageId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  useEffect(() => {
    if (!outfits.length || !room || !products.length) return;
    setReady(false);
    let disposed = false;
    const W = portrait ? 1000 : 1400,
      H = portrait ? 1600 : 1000;
    let game: import('phaser').Game | undefined;
    const extras: Product[] = ['beads', 'lotus'].map(
      (v): Product => ({
        ...products.find(
          (p) => p.id === (v === 'beads' ? 'accessory_beads' : 'accessory_lantern'),
        )!,
        id: 'legacy_' + v,
      }),
    );
    void Promise.all([
      import('phaser'),
      buildStoreAtlas([...products, ...extras, ...npcTextureProducts]),
    ])
      .then(([{ default: P }, atlas]) => {
        if (disposed || !host.current) return;
        class Sanctuary extends P.Scene {
          private virtual = new VirtualNpcState();
          private npcs = new Map<
            number,
            {
              image: import('phaser').GameObjects.Image;
              seat: import('phaser').GameObjects.Image;
              label: import('phaser').GameObjects.Text;
              last?: {
                x: number;
                y: number;
                width: number;
                sy: number;
                alpha: number;
                robe: string;
              };
            }
          >();
          private reportedNpcCount = -1;
          private players = new Map<number, import('phaser').GameObjects.Image>();
          private dots = new Map<number, import('phaser').GameObjects.Container>();
          private layers = new Map<
            number,
            {
              seat: import('phaser').GameObjects.Image;
              accessory: import('phaser').GameObjects.Image;
              frame: import('phaser').GameObjects.Image;
            }
          >();
          private arrivals = new Map<number, { key: string; at: number }>();
          private names = new Map<number, import('phaser').GameObjects.Text>();
          private floor?: import('phaser').GameObjects.Container;
          private layout = '';
          preload() {
            this.load.svg('sanctuary', portrait ? '/sanctuary-portrait.svg' : '/sanctuary.svg', {
              width: W,
              height: H,
            });
            this.load.on('loaderror', () => {
              if (!disposed) setError('Không tải được hình ảnh. Vui lòng tải lại trang.');
            });
          }
          create() {
            this.textures.addAtlas('store-atlas', atlas.image, atlas.data);
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
                const padX = Math.min(8, w * 0.2),
                  padY = Math.min(6, h * 0.2);
                g.lineStyle(1, 0xc7a56d, 0.2).strokeRoundedRect(
                  x - w / 2 + padX,
                  y - h / 2 + padY,
                  w - 2 * padX,
                  h - 2 * padY,
                  Math.min(5, (h - 2 * padY) / 2),
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
                  if (!state.current.readOnly && live?.enabled && !live.player && !live.reserved)
                    state.current.onSeat(seat.id);
                });
                this.floor?.add(zone);
              }
            }
            const visualNow = performance.now();
            const staticNpcs =
              current.quiet ||
              eco ||
              document.hidden ||
              (matchMedia('(max-width:650px)').matches &&
                ((navigator.hardwareConcurrency ?? 8) <= 4 ||
                  ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4));
            const actors = this.virtual.step(r.seats, r.config.npc, visualNow, current.quiet);
            const frameMs = r.config.npc.motion === 'medium' ? 80 : 125,
              npcClock = Math.floor(now / frameMs) * frameMs;
            const poses = npcPoses(
              [...actors.values()]
                .filter((a) => a.phase === 'visible')
                .map((a) => a.seatId)
                .sort((a, b) => a - b),
              npcClock,
              r.config.npc.motion,
              staticNpcs,
            );
            for (const actor of actors.values()) {
              const seat = r.seats.find((s: { id: number }) => s.id === actor.seatId);
              if (!seat) continue;
              let npc = this.npcs.get(seat.id);
              if (!npc) {
                npc = {
                  image: this.add
                    .image(0, 0, 'store-atlas', npcRobe(seat.id, r.config.npc.seed))
                    .setOrigin(0.5, 1),
                  seat: this.add.image(0, 0, 'store-atlas', '@npc/seat').setOrigin(0.5, 1),
                  label: this.add
                    .text(0, 0, 'NPC hệ thống', {
                      fontFamily: 'sans-serif',
                      fontSize: '9px',
                      color: '#c0b69f',
                      backgroundColor: '#211e1bc9',
                      padding: { x: 3, y: 2 },
                    })
                    .setOrigin(0.5, 0),
                };
                this.npcs.set(seat.id, npc);
              }
              const x = (seat.x * W) / 100,
                y = (projectY(seat.y) * H) / 100 - 7,
                width = ((seat.scale * W) / 100) * 1.16;
              const breathing =
                staticNpcs || r.config.npc.motion === 'static'
                  ? 1
                  : 1 + Math.sin(npcClock / 3500 + seat.id) * 0.006;
              const sy = (poses.get(seat.id)?.scaleY ?? 1) * breathing;
              const robe = npcRobe(seat.id, r.config.npc.seed);
              const previous = npc.last;
              if (
                !previous ||
                previous.x !== x ||
                previous.y !== y ||
                previous.width !== width ||
                previous.sy !== sy ||
                previous.alpha !== actor.alpha ||
                previous.robe !== robe
              ) {
                if (npc.image.frame.name !== robe) npc.image.setFrame(robe);
                npc.image
                  .setPosition(x, y)
                  .setDisplaySize(width, ((width * 140) / 120) * sy)
                  .setDepth(y - 1)
                  .setAlpha(actor.alpha * 0.82);
                npc.seat
                  .setPosition(x, y + 12)
                  .setDisplaySize(
                    ((seat.scale * W) / 100) * 1.24,
                    (((seat.scale * W) / 100) * 1.24 * 140) / 120,
                  )
                  .setDepth(y - 2)
                  .setAlpha(actor.alpha * 0.85);
                npc.label
                  .setPosition(x, y + 25)
                  .setDepth(y + 2)
                  .setAlpha(actor.alpha);
                npc.last = { x, y, width, sy, alpha: actor.alpha, robe };
              }
            }
            for (const [id, npc] of this.npcs)
              if (!actors.has(id)) {
                npc.image.destroy();
                npc.seat.destroy();
                npc.label.destroy();
                this.npcs.delete(id);
              }
            if (host.current) {
              const rendered = [...actors.values()]
                .filter((a) => a.alpha > 0)
                .map((a) => a.seatId)
                .sort((a, b) => a - b)
                .join(',');
              if (host.current.dataset.npcRendered !== rendered)
                host.current.dataset.npcRendered = rendered;
              const motion =
                staticNpcs || r.config.npc.motion === 'static' ? 'static' : r.config.npc.motion;
              if (host.current.dataset.npcMotion !== motion)
                host.current.dataset.npcMotion = motion;
            }
            const count = this.virtual.visibleCount;
            if (count !== this.reportedNpcCount) {
              this.reportedNpcCount = count;
              if (!disposed) current.onNpcCount?.(count);
            }
            const present = new Set<number>();
            for (const seat of r.seats) {
              const original = seat.player;
              const player =
                original && original.player_id === current.userId && current.preview
                  ? {
                      ...original,
                      equipped: current.preview.robe,
                      cosmetics: current.preview.cosmetics,
                    }
                  : original;
              if (!player) continue;
              present.add(seat.id);
              const humanAlpha = this.virtual.humanAlpha(seat.id, visualNow);
              const texture = player.equipped;
              const cosmetics = { ...baseCosmetics, ...player.cosmetics };
              let sprite = this.players.get(seat.id);
              if (!sprite) {
                sprite = this.add
                  .image(
                    0,
                    0,
                    'store-atlas',
                    this.textures.get('store-atlas').has(texture) ? texture : 'linen',
                  )
                  .setOrigin(0.5, 1);
                this.players.set(seat.id, sprite);
              }
              if (this.textures.get('store-atlas').has(texture) && sprite.frame.name !== texture)
                sprite.setTexture('store-atlas', texture);
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
                .setDepth(y)
                .setAlpha(humanAlpha);
              let layers = this.layers.get(seat.id);
              if (!layers) {
                layers = {
                  seat: this.add.image(0, 0, 'store-atlas', 'seat_moc').setOrigin(0.5, 1),
                  accessory: this.add
                    .image(0, 0, 'store-atlas', 'accessory_none')
                    .setOrigin(0.5, 1),
                  frame: this.add.image(0, 0, 'store-atlas', 'frame_none').setOrigin(0.5, 0.5),
                };
                this.layers.set(seat.id, layers);
              }
              const layerTexture = (
                image: import('phaser').GameObjects.Image,
                id: string,
                fallback: string,
              ) => {
                const frame = this.textures.get('store-atlas').has(id) ? id : fallback;
                if (image.frame.name !== frame) image.setTexture('store-atlas', frame);
                return image;
              };
              const arrivalKey = player.player_id + ':' + cosmetics.seat;
              if (this.arrivals.get(seat.id)?.key !== arrivalKey)
                this.arrivals.set(seat.id, { key: arrivalKey, at: now });
              const bloom =
                !current.quiet &&
                !eco &&
                (products.find((p) => p.id === cosmetics.seat)?.tier ?? 1) >= 5
                  ? 0.94 +
                    0.06 * Math.min(1, Math.max(0, (now - this.arrivals.get(seat.id)!.at) / 600))
                  : 1;
              layerTexture(layers.seat, cosmetics.seat, 'seat_moc')
                .setPosition((seat.x * W) / 100, (projectY(seat.y) * H) / 100 + 5)
                .setDisplaySize(
                  ((seat.scale * W) / 100) * 1.24 * bloom,
                  (((seat.scale * W) / 100) * 1.24 * 140 * bloom) / 120,
                )
                .setDepth((projectY(seat.y) * H) / 100 - 9)
                .setAlpha(humanAlpha);
              const accessory =
                cosmetics.accessory === 'accessory_none' && player.accessory !== 'none'
                  ? 'legacy_' + player.accessory
                  : cosmetics.accessory;
              const carried = accessory.includes('beads');
              layerTexture(layers.accessory, accessory, 'accessory_none')
                .setPosition(
                  carried ? x : (seat.x * W) / 100,
                  carried ? y : (projectY(seat.y) * H) / 100 - 7,
                )
                .setDisplaySize(width, ((width * 140) / 120) * (carried ? sy : 1))
                .setDepth(carried ? y + 1 : (projectY(seat.y) * H) / 100 + 1)
                .setAlpha(humanAlpha);
              let dots = this.dots.get(seat.id);
              if (!dots) {
                dots = this.add.container(0, 0);
                this.dots.set(seat.id, dots);
              }
              const count = Math.min(8, player.dots ?? 0);
              if (dots.length !== count) {
                dots.removeAll(true);
                for (let n = 0; n < count; n++)
                  dots.add(this.add.image(0, 0, 'store-atlas', 'dots_brown'));
              }
              dots.list.forEach((o, n) => {
                const image = o as import('phaser').GameObjects.Image;
                layerTexture(image, cosmetics.dotStyle, 'dots_brown')
                  .setPosition(((n % 4) - 1.5) * width * 0.065, Math.floor(n / 4) * width * 0.065)
                  .setDisplaySize(width * 0.065, width * 0.065);
              });
              dots
                .setPosition(x, y - width * 0.95 * sy)
                .setDepth(y + 2)
                .setAlpha(humanAlpha);
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
                .setVisible(r.config.live.showNames || player.player_id === current.userId)
                .setAlpha(humanAlpha);
              layerTexture(layers.frame, cosmetics.nameFrame, 'frame_none')
                .setPosition(name.x, name.y + name.height / 2)
                .setDisplaySize(name.width + 8, name.height + 4)
                .setDepth(949)
                .setVisible(name.visible)
                .setAlpha(humanAlpha);
            }
            for (const [id, sprite] of this.players)
              if (!present.has(id)) {
                sprite.destroy();
                this.players.delete(id);
                const layers = this.layers.get(id);
                if (layers) Object.values(layers).forEach((v) => v.destroy());
                this.layers.delete(id);
                this.arrivals.delete(id);
                this.dots.get(id)?.destroy();
                this.dots.delete(id);
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
          fps: { target: eco ? 20 : portrait ? 30 : 60, forceSetTimeOut: true },
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
  }, [outfits.length > 0, portrait, eco, atlasSignature]);
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
      {!readOnly && (
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
                aria-description={
                  !seat.player && !seat.reserved
                    ? 'Ghế trống có thể hiển thị NPC hệ thống. NPC luôn nhường cho người chơi.'
                    : undefined
                }
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
      )}
    </>
  );
}
