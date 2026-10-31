import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RigSvg, rigPose, partBoxes, type RigAction } from '../src/CharacterRig.js';
import { defaultSettings } from '../server/config.js';
import { storeProducts } from '../server/store.js';
import { standardSeatLayout } from '../server/npc-config.js';
test('V12 both appearances, four directions and every built-in robe keep four independently posed limbs', () => {
  for (const robe of storeProducts(defaultSettings).filter((p) => p.category === 'robe'))
    for (const appearance of ['male', 'female'] as const)
      for (const facing of ['front', 'back', 'left', 'right'] as const) {
        const svg = renderToStaticMarkup(
          createElement(RigSvg, {
            color: robe.color,
            accent: robe.accent,
            design: robe.design,
            appearance,
            facing,
            action: 'seated',
            dots: 8,
          }),
        );
        for (const limb of ['armLeft', 'armRight', 'legLeft', 'legRight'])
          assert.ok(svg.includes(`data-layer="${limb}"`));
        assert.ok(svg.includes(`data-appearance="${appearance}"`));
        assert.ok(svg.includes(`data-direction="${facing}"`));
        assert.ok(!svg.includes('NaN'));
        assert.ok(svg.includes(robe.color));
      }
});
test('V12 poses stay finite and retain head/feet through walking, sitting, bowing and prostration', () => {
  for (const action of [
    'standing',
    'walk',
    'seated',
    'standUp',
    'sitDown',
    'bow',
    'prostrate',
    'holdIncense',
    'incense',
  ] as RigAction[])
    for (let i = 0; i <= 8; i++)
      for (const p of Object.values(rigPose(action, i / 8)))
        assert.ok(Object.values(p).every(Number.isFinite));
  const standing = rigPose('standing');
  const ratio = (partBoxes.head.h * 0.84) / (138 - (standing.head.y - 25));
  assert.ok(ratio >= 0.39 && ratio <= 0.45);
  assert.notEqual(rigPose('walk', 0.25).armLeft.angle, rigPose('walk', 0.75).armLeft.angle);
  for (const count of [36, 72] as const) {
    const seats = standardSeatLayout(count);
    for (let i = 6; i < seats.length; i++) {
      const rowGap = seats[i].y - seats[i - 6].y;
      const bodyHeight = (seats[i].scale * 1.16 * (138 - (rigPose('seated').head.y - 25))) / 120;
      assert.ok(bodyHeight < rowGap);
    }
  }
});
