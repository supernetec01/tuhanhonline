import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  npcSchema,
  selectNpcSeats,
  standardSeatLayout,
  expandLegacySeats,
  type NpcSeat,
} from '../server/npc-config.js';
import { VirtualNpcState, npcPoses } from '../src/virtualNpcs.js';
const seats = (count = 72): NpcSeat[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    enabled: true,
    player: null,
    reserved: false,
  }));
test('V11 NPC policy counts 0/1/36/72 humans, excludes invitations/disabled seats, and never changes occupancy', () => {
  const config = npcSchema.parse({});
  for (const humans of [0, 1, 36, 72]) {
    const rows = seats();
    rows.slice(0, humans).forEach((s) => (s.player = { id: 'human' }));
    const original = structuredClone(rows);
    assert.equal(selectNpcSeats(rows, config).length, 72 - humans);
    assert.deepEqual(rows, original);
  }
  const rows = seats();
  rows[0].reserved = true;
  rows[1].enabled = false;
  rows[2].player = { id: 'human' };
  const ids = selectNpcSeats(rows, config);
  assert.equal(ids.length, 69);
  for (const id of [1, 2, 3]) assert.ok(!ids.includes(id));
  assert.equal(selectNpcSeats(rows, { ...config, mode: 'half' }).length, 34);
  assert.equal(selectNpcSeats(rows, { ...config, maxCount: 4 }).length, 4);
  assert.equal(selectNpcSeats(rows, { ...config, mode: 'off' }).length, 0);
  assert.deepEqual(selectNpcSeats(rows.toReversed(), config), ids);
});
test('V11 yielding fade never overlaps a human and respawn waits for authoritative release plus 4 seconds', () => {
  const rows = seats(1),
    settings = npcSchema.parse({}),
    state = new VirtualNpcState();
  state.step(rows, settings, 0);
  state.step(rows, settings, 400);
  assert.equal(state.visibleCount, 1);
  rows[0].player = { id: 'first' };
  state.step(rows, settings, 500);
  assert.equal(state.visibleCount, 0);
  assert.equal(state.humanAlpha(1, 500), 0);
  for (const now of [600, 800, 899]) {
    state.step(rows, settings, now);
    assert.ok(state.actors.get(1)!.alpha > 0);
    assert.equal(state.humanAlpha(1, now), 0);
  }
  state.step(rows, settings, 900);
  assert.equal(state.actors.size, 0);
  assert.equal(state.humanAlpha(1, 900), 1);
  rows[0].player = null;
  state.step(rows, settings, 1000);
  state.step(rows, settings, 4999);
  assert.equal(state.actors.size, 0);
  state.step(rows, settings, 5000);
  state.step(rows, settings, 5400);
  assert.equal(state.visibleCount, 1);
});
test('V11 FIFO invitations suppress returning NPCs and refresh can reconstruct visuals without persistent NPC state', () => {
  const rows = seats(2),
    settings = npcSchema.parse({}),
    state = new VirtualNpcState();
  state.step(rows, settings, 0);
  state.step(rows, settings, 400);
  rows[0].reserved = true;
  state.step(rows, settings, 500);
  state.step(rows, settings, 900);
  assert.equal(state.actors.has(1), false);
  state.step(rows, settings, 15000);
  assert.equal(state.actors.has(1), false);
  rows[0].player = { id: 'invited-user' };
  rows[0].reserved = false;
  state.step(rows, settings, 15500);
  assert.equal(state.actors.has(1), false);
  const refreshed = new VirtualNpcState();
  refreshed.step(rows, settings, 20000, true);
  assert.equal(refreshed.actors.has(1), false);
  assert.equal(refreshed.visibleCount, 1);
  rows[0].player = null;
  state.step(rows, settings, 21000);
  rows[0].reserved = true;
  state.step(rows, settings, 22000);
  state.step(rows, settings, 30000);
  assert.equal(state.actors.has(1), false);
});
test('V11 quiet/eco motion is static and decorative bow/prostrate groups remain small', () => {
  const ids = seats().map((s) => s.id);
  assert.equal(npcPoses(ids, 7000, 'light').size, 2);
  assert.equal(npcPoses(ids, 21000, 'light').size, 1);
  assert.equal(npcPoses(ids, 7000, 'medium').size, 4);
  assert.equal(npcPoses(ids, 21000, 'medium').size, 2);
  assert.equal(npcPoses(ids, 7000, 'static').size, 0);
  assert.equal(npcPoses(ids, 21000, 'medium', true).size, 0);
  assert.equal(npcPoses([], 7000, 'medium').size, 0);
  for (const pose of npcPoses(ids, 7000, 'medium').values())
    assert.ok(['bow', 'prostrate'].includes(pose.action));
  const state = new VirtualNpcState(),
    rows = seats(1),
    config = npcSchema.parse({});
  state.step(rows, config, 0, true);
  assert.equal(state.visibleCount, 1);
  rows[0].player = {};
  state.step(rows, config, 100, true);
  assert.equal(state.actors.size, 0);
  assert.equal(state.humanAlpha(1, 100), 1);
});
test('V11 legacy layouts keep the first 36 seats and add inactive capacity until an explicit layout switch', () => {
  const old = standardSeatLayout(36),
    expanded = expandLegacySeats(old);
  assert.equal(expanded.length, 72);
  assert.deepEqual(expanded.slice(0, 36), old);
  assert.equal(expanded.filter((s) => s.enabled).length, 36);
  const full = standardSeatLayout(72);
  assert.equal(new Set(full.map((s) => s.id)).size, 72);
  assert.equal(full.filter((s) => s.enabled).length, 72);
  assert.ok(full.every((s) => s.scale >= 2 && s.y <= 94));
});
