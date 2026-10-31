import { renderToStaticMarkup } from 'react-dom/server';
import { AltarDecorations } from './AltarDecorations';
import { PhaserRig } from './phaserRig';
import { buildRigAtlas } from './rigAtlas';
import {
  sampleMotion,
  queuePoint,
  distance,
  type Motion,
  type NavNode,
} from '../server/navigation';
import { type RigAction, type Facing } from './CharacterRig';
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
  zoom = 1,
  focusSeat,
  showNames = false,
  movingMode = false,
  onMove,
  onInspect,
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
  zoom?: number;
  focusSeat?: number;
  showNames?: boolean;
  movingMode?: boolean;
  onMove?: (node: string) => void;
  onInspect?: (seat: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef({
      room,
      outfits,
      userId,
      onSeat,
      quiet,
      preview,
      onNpcCount,
      readOnly,
      zoom,
      focusSeat,
      showNames,
      movingMode,
      onMove,
      onInspect,
    });
  state.current = {
    room,
    outfits,
    userId,
    onSeat,
    quiet,
    preview,
    onNpcCount,
    readOnly,
    zoom,
    focusSeat,
    showNames,
    movingMode,
    onMove,
    onInspect,
  };
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
      buildRigAtlas([...products, ...npcTextureProducts]),
    ])
      .then(([{ default: P }, atlas, rigAtlas]) => {
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
          private lastStats = 0;
          private players = new Map<number, PhaserRig>();
          private focused = 0;
          private cameraZoom = 1;
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
            const altarSvg = renderToStaticMarkup(
              <AltarDecorations
                config={state.current.room!.config.decorations}
                portraitMode={false}
              />,
            );
            const encoded = btoa(
              Array.from(new TextEncoder().encode(altarSvg), (byte) =>
                String.fromCharCode(byte),
              ).join(''),
            );
            this.load.svg('altar', 'data:image/svg+xml;base64,' + encoded, {
              width: 1400,
              height: 1000,
            });
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
            this.textures.addAtlas('rig-atlas', rigAtlas.image, rigAtlas.data);
            host.current?.setAttribute('data-rig-frames', String(rigAtlas.frames));
            host.current?.setAttribute('data-rig-bytes', String(rigAtlas.bytes));
            this.cameras.main.setBounds(0, 0, W, H);
            this.input.on('pointerup', (pointer: import('phaser').Input.Pointer) => {
              const current = state.current;
              if (!current.movingMode || !current.onMove) return;
              const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
              const y = portrait ? 52.7 + (((p.y / H) * 100 - 45) / 47) * 37.5 : (p.y / H) * 100;
              const target = current.room?.navigation
                ?.map((n: NavNode) => ({ ...n, d: distance(n, { x: (p.x / W) * 100, y }) }))
                .sort((a: NavNode & { d: number }, b: NavNode & { d: number }) => a.d - b.d)[0];
              if (target && target.d < 7) current.onMove(target.id);
            });
            this.add.image(W / 2, H / 2, 'sanctuary').setDisplaySize(W, H);
            this.add
              .image(portrait ? -305 : 0, 0, 'altar')
              .setOrigin(0, 0)
              .setDisplaySize(portrait ? 1610 : 1400, portrait ? 1150 : 1000)
              .setDepth(479);
            this.floor = this.add.container(0, 0).setDepth(480);
            if (!disposed) setReady(true);
          }
          update() {
            const current = state.current,
              r = current.room;
            if (!r) return;
            if (this.cameraZoom !== current.zoom) {
              this.cameraZoom = current.zoom;
              this.cameras.main.setZoom(current.zoom);
              if (current.zoom === 1) this.cameras.main.centerOn(W / 2, H / 2);
            }
            const now = Date.now() + (r.clockOffsetMs ?? 0);
            if (now - this.lastStats > 1000) {
              this.lastStats = now;
              host.current?.setAttribute(
                'data-fps',
                String(Math.round(this.game.loop.actualFps * 10) / 10),
              );
              host.current?.setAttribute(
                'data-human-count',
                String(r.seats.filter((s: any) => !!s.player).length),
              );
            }
            const signature = JSON.stringify([
              current.movingMode,
              r.seats.map(
                (s: { id: number; x: number; y: number; scale: number; enabled: boolean }) => ({
                  id: s.id,
                  x: s.x,
                  y: s.y,
                  scale: s.scale,
                  enabled: s.enabled,
                }),
              ),
            ]);
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
            if (current.movingMode && current.focusSeat === undefined) {
              /* Floor clicks are resolved through the server node list. */
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
              const cosmetics = { ...baseCosmetics, ...player.cosmetics };
              let sprite = this.players.get(seat.id);
              if (!sprite) {
                sprite = new PhaserRig(this, () => state.current.onInspect?.(seat.id));
                this.players.set(seat.id, sprite);
              }
              let x = (seat.x * W) / 100,
                y = (projectY(seat.y) * H) / 100 - 7;
              const motion: Motion | null =
                player.movement_path && player.move_started_at
                  ? {
                      path: player.movement_path,
                      startedAt: new Date(player.move_started_at).getTime(),
                      endsAt: new Date(player.move_ends_at).getTime(),
                      target: player.movement_path.at(-1)?.id,
                    }
                  : null;
              let facing: Facing = 'back',
                rigAction: RigAction = 'seated',
                rigPhase = 0,
                sy = 1;
              const stateName = player.character_state ?? 'SEATED';
              const started = new Date(player.started_at).getTime(),
                ends = new Date(player.ends_at).getTime();
              const active = !!player.action && now < ends;
              const phase = ceremonyPhase(r.ceremony, now);
              if (motion) {
                const point = sampleMotion(motion, now);
                x = (point.x * W) / 100;
                y = (projectY(point.y) * H) / 100 - 7;
                facing = point.direction;
                const elapsed = now - motion.startedAt;
                const last = motion.path.at(-1)!,
                  before = motion.path.at(-2)!;
                if (elapsed < 500 && motion.path[0].id.startsWith('seat:')) {
                  rigAction = 'standUp';
                  rigPhase = Math.max(0, elapsed / 500);
                } else if (
                  (stateName === 'RETURNING' || stateName === 'INCENSE_RETURNING') &&
                  elapsed >= before.ms &&
                  last.id === before.id
                ) {
                  rigAction = 'sitDown';
                  rigPhase = Math.min(1, (elapsed - before.ms) / 500);
                } else {
                  rigAction = point.walking
                    ? 'walk'
                    : stateName.startsWith('INCENSE')
                      ? 'holdIncense'
                      : 'standing';
                  rigPhase = current.quiet ? 0 : (elapsed % 800) / 800;
                }
              } else if (stateName !== 'SEATED' && stateName !== 'INCENSE_PENDING') {
                const node = player.position_node?.startsWith('queue:')
                  ? queuePoint(Number(player.position_node.split(':')[1]))
                  : player.position_node === 'station:A'
                    ? { x: 43, y: 49.5 }
                    : player.position_node === 'station:B'
                      ? { x: 57, y: 49.5 }
                      : r.navigation.find((n: NavNode) => n.id === player.position_node);
                if (node) {
                  x = (node.x * W) / 100;
                  y = (projectY(node.y) * H) / 100 - 7;
                }
                rigAction =
                  stateName === 'INCENSE_ACTIVE'
                    ? 'incense'
                    : stateName.startsWith('INCENSE')
                      ? 'holdIncense'
                      : 'standing';
              }
              if (
                (stateName === 'SEATED' || stateName === 'INCENSE_PENDING') &&
                (active || phase === 'bow' || phase === 'prostrate')
              ) {
                if (player.action === 'bow' || player.action === 'prostrate')
                  rigAction = player.action;
                else if (phase === 'bow' || phase === 'prostrate') rigAction = phase;
                rigPhase = current.quiet
                  ? 0.5
                  : active
                    ? Math.max(0, Math.min(1, (now - started) / (ends - started)))
                    : 0.5;
              }

              const depthScale = Math.max(
                0.65,
                Math.min(1.1, 1 + (y - (projectY(seat.y) * H) / 100) / (H * 1.5)),
              );
              const width = ((seat.scale * W) / 100) * 1.16 * depthScale;
              const pose = sprite.draw({
                x,
                y,
                width,
                alpha: humanAlpha,
                robe: player.equipped,
                appearance: player.appearance_type ?? 'male',
                facing,
                action: rigAction,
                phase: rigPhase,
              });
              sy = pose.torso.sy;
              if (current.focusSeat === seat.id) {
                this.cameras.main.centerOn(x, y - width * 0.5);
                this.focused = seat.id;
              } else if (!current.focusSeat && this.focused) {
                this.focused = 0;
                this.cameras.main.centerOn(W / 2, H / 2);
              }
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
              const carried = true;
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
              const dotLayout = r.config.dotLayout;
              dots.list.forEach((o, n) => {
                const image = o as import('phaser').GameObjects.Image;
                layerTexture(image, cosmetics.dotStyle, 'dots_brown')
                  .setPosition(
                    (((n % 4) - 1.5) * width * dotLayout.spacing) / 120,
                    (Math.floor(n / 4) * width * dotLayout.spacing) / 120,
                  )
                  .setDisplaySize((width * dotLayout.size) / 120, (width * dotLayout.size) / 120);
              });
              dots
                .setPosition(
                  x + ((dotLayout.x - 60) * width) / 120,
                  y - ((138 - pose.head.y + 18 - (dotLayout.y - 26)) * width) / 120,
                )
                .setDepth(y + 2)
                .setAlpha(humanAlpha)
                .setVisible(
                  current.showNames ||
                    current.zoom > 1.3 ||
                    current.focusSeat === seat.id ||
                    player.player_id === current.userId,
                );
              const reveal =
                current.showNames ||
                current.focusSeat === seat.id ||
                player.player_id === current.userId ||
                (current.zoom >= 2 &&
                  Math.abs(x - this.cameras.main.midPoint.x) < W * 0.12 &&
                  Math.abs(y - this.cameras.main.midPoint.y) < H * 0.1);
              let name = this.names.get(seat.id);
              if (!name) {
                name = this.add
                  .text(0, 0, '', {
                    fontFamily: 'sans-serif',
                    fontSize: '10px',
                    color: '#e6c998',
                    backgroundColor: '#261c18cc',
                    padding: { x: 7, y: 4 },
                  })
                  .setOrigin(0.5, 0);
                this.names.set(seat.id, name);
              }
              name
                .setText(
                  (Array.from(player.name as string).length > 13
                    ? Array.from(player.name as string)
                        .slice(0, 12)
                        .join('') + '…'
                    : player.name) + (player.player_id === current.userId ? ' · Bạn' : ''),
                )
                .setScale(1 / current.zoom)
                .setPosition(x, y + 12)
                .setDepth(950)
                .setVisible(reveal)
                .setAlpha(humanAlpha);
              layerTexture(layers.frame, cosmetics.nameFrame, 'frame_none')
                .setPosition(name.x, name.y + name.height / (2 * current.zoom))
                .setDisplaySize((name.width + 8) / current.zoom, (name.height + 4) / current.zoom)
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
      .catch((error) => {
        console.error('TempleGame initialization failed', error);
        if (!disposed) setError('Chưa tải được bộ máy game. Hãy tải lại trang.');
      });
    return () => {
      disposed = true;
      game?.destroy(true);
    };
  }, [outfits.length > 0, portrait, eco, atlasSignature, JSON.stringify(room?.config.decorations)]);
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
      {!readOnly && movingMode && zoom === 1 && (
        <div className="walkway-targets">
          {room?.navigation.map((node: NavNode) => (
            <button
              key={node.id}
              aria-label={`Đi tới ${node.id}`}
              style={{ left: `${node.x}%`, top: `${projectY(node.y)}%` }}
              onClick={() => onMove?.(node.id)}
            />
          ))}
        </div>
      )}
      {!readOnly && zoom === 1 && (
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
