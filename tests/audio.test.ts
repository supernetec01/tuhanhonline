import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TempleAudioManager,
  crossfadeLoopChannels,
  BroadcastAudioManager,
} from '../src/AudioManager.js';
import { audioMixSchema } from '../server/audio-config.js';
class Parameter {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class Gain {
  gain = new Parameter();
  to: any;
  connect(to: any) {
    this.to = to;
  }
  disconnect() {}
}
class BufferData {
  numberOfChannels = 1;
  get length() {
    return this.data[0].length;
  }
  sampleRate = 100;
  duration: number;
  data: Float32Array[];
  constructor(channels = 1, length = 200, rate = 100) {
    this.numberOfChannels = channels;
    this.sampleRate = rate;
    this.duration = length / rate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(i: number) {
    return this.data[i];
  }
  copyToChannel(c: Float32Array, i: number) {
    this.data[i].set(c);
  }
}
class Source {
  buffer: BufferData | null = null;
  loop = false;
  started = false;
  stopped = false;
  to: any;
  onended: (() => void) | null = null;
  connect(to: any) {
    this.to = to;
  }
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}
class Context {
  state = 'suspended';
  currentTime = 1;
  destination = {};
  sources: Source[] = [];
  gains: Gain[] = [];
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new BufferData(channels, length, rate);
  }
  decodeAudioData() {
    return Promise.resolve(new BufferData());
  }
}
const turn = () => new Promise<void>((r) => setTimeout(r, 0));
function fixture() {
  const context = new Context(),
    calls: string[] = [],
    data = new Map<string, string>();
  const manager = new TempleAudioManager({
    context: () => context as unknown as AudioContext,
    fetch: (async (url: any) => {
      calls.push(String(url));
      return new Response(new ArrayBuffer(10));
    }) as typeof fetch,
    storage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    },
  });
  return { manager, context, calls, data };
}
test('audio unlock is lazy, popup reconfiguration does not restart native loops, ambient switches and ducking is relative', async () => {
  const { manager, context, calls } = fixture(),
    mix = audioMixSchema.parse({});
  manager.configure({ background: 'temple', waitingBackground: 'waiting' }, mix);
  await turn();
  assert.equal(calls.length, 0);
  assert.equal(context.sources.length, 0);
  assert.equal(await manager.unlock(), true);
  assert.equal(context.sources.filter((s) => s.loop).length, 1);
  const original = context.sources[0];
  manager.configure({ background: 'temple', waitingBackground: 'waiting' }, structuredClone(mix));
  manager.setPresence('temple');
  await turn();
  assert.equal(context.sources.length, 1);
  assert.equal(original.stopped, false);
  manager.setVolume('templeAmbient', 0.4);
  manager.setSpeaking(true);
  const temple = context.gains[1];
  assert.equal(temple.gain.value, 0.1);
  manager.setVolume('templeAmbient', 0.6);
  assert.equal(temple.gain.value, 0.15);
  manager.setSpeaking(false);
  assert.equal(temple.gain.value, 0.6);
  manager.setPresence('waiting');
  await turn();
  assert.deepEqual(calls, ['/api/media/temple', '/api/media/waiting']);
  assert.equal(context.sources.filter((s) => s.loop).length, 2);
  await manager.dispose();
  assert.equal(original.stopped, true);
  assert.equal(context.state, 'closed');
});
test('effects dedupe confirmed events and limit pending/playing effects to two, coin events are throttled', async () => {
  const { manager, context } = fixture();
  manager.configure(
    { bow: 'bow', prostrate: 'lay', incense: 'incense', coin: 'coin' },
    audioMixSchema.parse({ coinEnabled: true }),
  );
  await manager.unlock();
  await Promise.all([
    manager.effect('bow', '1'),
    manager.effect('prostrate', '2'),
    manager.effect('incense', '3'),
  ]);
  assert.equal(context.sources.length, 2);
  await manager.effect('bow', '1');
  assert.equal(context.sources.length, 2);
  context.sources.forEach((s) => s.stop());
  await manager.effect('coin', 'grant-a');
  assert.equal(context.sources.length, 3);
  context.sources.at(-1)!.stop();
  await manager.effect('coin', 'grant-b');
  assert.equal(context.sources.length, 3);
  manager.setMuted(true);
  await manager.effect('incense', '4');
  assert.equal(context.sources.length, 3);
  await manager.dispose();
});
test('audio preferences persist and survive fresh managers; reviving after StrictMode cleanup allows unlock', async () => {
  const { manager, data } = fixture();
  manager.setMuted(true);
  manager.setVolume('voice', 0.63);
  const context = new Context(),
    restored = new TempleAudioManager({
      context: () => context as unknown as AudioContext,
      storage: {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
    });
  assert.equal(restored.state.muted, true);
  assert.equal(restored.state.volumes.voice, 0.63);
  await restored.dispose();
  restored.activate();
  assert.equal(await restored.unlock(), true);
  await restored.dispose();
  await manager.dispose();
});
test('overlap-add reduces loop-edge discontinuity without altering or interleaving source channels', () => {
  const left = Float32Array.from({ length: 200 }, (_, i) => i / 200),
    right = Float32Array.from(left, (v) => -v),
    copy = left.slice();
  const out = crossfadeLoopChannels([left, right], 100, 0.5);
  assert.equal(out[0].length, 150);
  assert.deepEqual(left, copy);
  const originalJump = Math.abs(left.at(-1)! - left[0]),
    newJump = Math.abs(out[0].at(-1)! - out[0][0]);
  assert.ok(newJump < originalJump * 0.05);
  for (let i = 0; i < out[0].length; i++) assert.ok(Math.abs(out[0][i] + out[1][i]) < 1e-6);
  const channel = { volume: 1 },
    relative = new BroadcastAudioManager(channel, 0.25);
  relative.setVolume(0.16);
  relative.setSpeaking(true);
  assert.equal(channel.volume, 0.04);
  relative.setVolume(0.4);
  relative.setSpeaking(false);
  assert.equal(channel.volume, 0.4);
});
