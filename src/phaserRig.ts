import {
  rigPose,
  partBoxes,
  type BodyPart,
  type Facing,
  type AppearanceType,
  type RigAction,
} from './CharacterRig';
import { rigFrame } from './rigAtlas';
export class PhaserRig {
  readonly container: import('phaser').GameObjects.Container;
  private lastKey = '';
  private lastPose = rigPose('seated');
  private parts = new Map<BodyPart, import('phaser').GameObjects.Image>();
  private incense: import('phaser').GameObjects.Graphics;
  readonly shadow: import('phaser').GameObjects.Ellipse;
  constructor(scene: import('phaser').Scene, onSelect?: () => void) {
    this.container = scene.add.container(0, 0);
    this.incense = scene.add.graphics();
    this.container.add(this.incense);
    this.shadow = scene.add.ellipse(0, 0, 20, 5, 0x191317, 0.25);
    for (const part of [
      'legLeft',
      'legRight',
      'torso',
      'armLeft',
      'armRight',
      'head',
    ] as BodyPart[]) {
      const box = partBoxes[part],
        image = scene.add
          .image(0, 0, 'rig-atlas', rigFrame('linen', part, 'back', 'male'))
          .setOrigin(-box.x / box.w, -box.y / box.h);
      this.parts.set(part, image);
      this.container.add(image);
      if (onSelect)
        image
          .setInteractive({ useHandCursor: true })
          .on(
            'pointerup',
            (_p: unknown, _x: unknown, _y: unknown, event: { stopPropagation: () => void }) => {
              event.stopPropagation();
              onSelect();
            },
          );
    }
  }
  draw({
    x,
    y,
    width,
    alpha = 1,
    robe = 'linen',
    appearance = 'male',
    facing = 'back',
    action = 'seated',
    phase = 0,
  }: {
    x: number;
    y: number;
    width: number;
    alpha?: number;
    robe?: string;
    appearance?: AppearanceType;
    facing?: Facing;
    action?: RigAction;
    phase?: number;
  }) {
    const steps = action === 'walk' ? 8 : 32;
    const frame = Math.floor(phase * steps) / steps;
    width = Math.round(width * 4) / 4;
    const key = `${robe}:${appearance}:${facing}:${action}:${frame}:${width}`;
    const pose = key === this.lastKey ? this.lastPose : rigPose(action, frame),
      factor = width / 120;
    this.container.setPosition(x, y).setDepth(y).setAlpha(alpha);
    this.shadow
      .setPosition(x, y + 1)
      .setSize(width * 0.7, width * 0.13)
      .setDepth(y - 0.2)
      .setAlpha(alpha * 0.25);
    if (key === this.lastKey) return pose;
    this.lastKey = key;
    this.lastPose = pose;
    for (const [part, image] of this.parts) {
      const p = pose[part],
        box = partBoxes[part],
        frame = rigFrame(robe, part, facing, appearance);
      if (image.frame.name !== frame && image.scene.textures.get('rig-atlas').has(frame))
        image.setTexture('rig-atlas', frame);
      image
        .setPosition((p.x - 60) * factor, (p.y - 138) * factor)
        .setDisplaySize(box.w * factor * p.sx, box.h * factor * p.sy)
        .setAngle(p.angle);
    }
    this.incense.clear();
    if (action === 'incense' || action === 'holdIncense') {
      this.incense
        .lineStyle(Math.max(0.7, factor), 0xba9660)
        .lineBetween(-2 * factor, -43 * factor, -2 * factor, -66 * factor)
        .lineBetween(2 * factor, -43 * factor, 2 * factor, -66 * factor);
      this.incense.fillStyle(0xe7aa65, 0.7).fillCircle(0, -67 * factor, 1.2 * factor);
      this.container.bringToTop(this.incense);
    }
    return pose;
  }
  destroy() {
    this.container.destroy(true);
    this.shadow.destroy();
  }
}
