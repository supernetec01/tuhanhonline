import {
  audioMixSchema,
  type AudioMix,
  type AudioCue,
  type AudioGroup,
} from '../server/audio-config';
export type AudioState = {
  unlocked: boolean;
  needsGesture: boolean;
  playing: boolean;
  muted: boolean;
  volumes: Record<AudioGroup, number>;
  error: string;
  customTrack: string;
  ambient: string;
  effects: number;
};
type Voice = { source: AudioBufferSourceNode; gain: GainNode };
const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
// Overlap-add once, then native Web Audio looping keeps boundaries smooth even when JS timers are throttled.
export function crossfadeLoopChannels(
  channels: Float32Array[],
  sampleRate: number,
  seconds: number,
) {
  const length = channels[0]?.length ?? 0,
    overlap = Math.min(Math.floor(sampleRate * seconds), Math.floor(length / 4));
  if (overlap < 2) return channels.map((c) => c.slice());
  return channels.map((c) => {
    const result = c.slice(0, length - overlap);
    for (let i = 0; i < overlap; i++) {
      const t = i / (overlap - 1);
      result[i] = c[length - overlap + i] * (1 - t) + c[i] * t;
    }
    return result;
  });
}
export class TempleAudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<AudioGroup, GainNode>();
  private mix: AudioMix = audioMixSchema.parse({});
  private mapping: Partial<Record<AudioCue, string>> = {};
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private ambientSources = new Set<Voice>();
  private ambientVoice: Voice | null = null;
  private ambientUrl = '';
  private desired: 'temple' | 'waiting' = 'temple';
  private requestedAmbient = '';
  private generation = 0;
  private paused = false;
  private unlocked = false;
  private muted = false;
  private overrides: Partial<Record<AudioGroup, number>> = {};
  private effects = new Set<Voice>();
  private pendingEffects = 0;
  private seen = new Set<string>();
  private recent = new Map<AudioCue, number>();
  private speaking = false;
  private error = '';
  private disposed = false;
  private custom: { url: string; name: string } | null = null;
  private listeners = new Set<() => void>();
  private stops = new Set<ReturnType<typeof setTimeout>>();
  private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  constructor(
    private options: {
      context?: () => AudioContext;
      fetch?: typeof fetch;
      storage?: Pick<Storage, 'getItem' | 'setItem'>;
    } = {},
  ) {
    try {
      this.storage =
        options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
      const p = JSON.parse(this.storage?.getItem('temple-audio-v2') ?? '{}');
      this.muted = p.muted === true;
      for (const group of Object.keys(this.mix.volumes) as AudioGroup[])
        if (typeof p.volumes?.[group] === 'number') this.overrides[group] = clamp(p.volumes[group]);
    } catch {
      /* Preferences are optional, not a playback prerequisite. */
    }
  }
  activate() {
    this.disposed = false;
  }
  get state(): AudioState {
    return {
      unlocked: this.unlocked,
      needsGesture: this.unlocked && this.ctx?.state !== 'running',
      playing: !!this.ambientVoice && !this.paused && this.ctx?.state === 'running',
      muted: this.muted,
      volumes: { ...this.mix.volumes, ...this.overrides },
      error: this.error,
      customTrack: this.custom?.name ?? '',
      ambient: this.ambientUrl,
      effects: this.effects.size,
    };
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }
  private persist() {
    try {
      this.storage?.setItem(
        'temple-audio-v2',
        JSON.stringify({ muted: this.muted, volumes: this.overrides }),
      );
    } catch {
      /* Storage may be blocked. */
    }
  }
  configure(mapping: Partial<Record<AudioCue, string>>, mix: AudioMix = audioMixSchema.parse({})) {
    const fadeChanged = this.mix.crossfadeSeconds !== mix.crossfadeSeconds;
    this.mapping = { ...mapping };
    this.mix = audioMixSchema.parse(mix);
    this.applyVolumes();
    if (fadeChanged) this.requestedAmbient = '';
    if (this.unlocked && !this.paused) void this.syncAmbient();
    this.emit();
  }
  async unlock() {
    if (this.disposed) return false;
    try {
      if (!this.ctx) {
        this.ctx = this.options.context?.() ?? new AudioContext();
        this.ctx.onstatechange = () => this.emit();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const group of Object.keys(this.mix.volumes) as AudioGroup[]) {
          const bus = this.ctx.createGain();
          bus.connect(this.master);
          this.buses.set(group, bus);
        }
        this.applyVolumes();
      }
      await this.ctx.resume();
      if (this.ctx.state !== 'running')
        throw new Error('Trình duyệt chưa cho phép phát âm thanh. Hãy chạm nút bật âm thanh.');
      this.unlocked = true;
      this.paused = false;
      this.error = '';
      await this.syncAmbient();
      this.emit();
      return true;
    } catch (e) {
      this.unlocked = false;
      this.error = (e as Error).message;
      this.emit();
      return false;
    }
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.applyVolumes();
    this.persist();
    this.emit();
  }
  setVolume(group: AudioGroup, value: number) {
    this.overrides[group] = clamp(value);
    this.applyVolumes();
    this.persist();
    this.emit();
  }
  resetVolumes() {
    this.overrides = {};
    this.applyVolumes();
    this.persist();
    this.emit();
  }
  setSpeaking(value: boolean) {
    this.speaking = value;
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.03);
    const volumes = this.state.volumes;
    for (const [group, bus] of this.buses)
      bus.gain.setTargetAtTime(
        volumes[group] *
          ((group === 'templeAmbient' || group === 'waitingAmbient') && this.speaking
            ? this.mix.duckFactor
            : 1),
        this.ctx.currentTime,
        0.08,
      );
  }
  setPresence(value: 'temple' | 'waiting') {
    this.desired = value;
    if (this.unlocked && !this.paused) void this.syncAmbient();
  }
  private url(cue: AudioCue) {
    const id = this.mapping[cue];
    return id ? `/api/media/${id}` : '';
  }
  private async buffer(url: string) {
    if (this.buffers.has(url)) return this.buffers.get(url)!;
    if (this.loading.has(url)) return this.loading.get(url)!;
    const promise = (async () => {
      if (!this.ctx) throw new Error('Âm thanh chưa bật.');
      const response = await (this.options.fetch ?? fetch)(url);
      if (!response.ok) throw new Error('Không tải được bản âm thanh.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 26000000) throw new Error('Tệp âm thanh quá lớn.');
      const buffer = await this.ctx.decodeAudioData(bytes);
      if (this.disposed) throw new Error('Audio manager đã đóng.');
      this.buffers.set(url, buffer);
      while (
        this.buffers.size > 8 ||
        [...this.buffers.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0) >
          48000000
      )
        this.buffers.delete(this.buffers.keys().next().value!);
      return buffer;
    })();
    this.loading.set(url, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(url);
    }
  }
  private stopVoice(voice: Voice) {
    try {
      voice.source.stop();
    } catch {
      /* Source may have ended. */
    }
    voice.source.disconnect();
    voice.gain.disconnect();
    this.ambientSources.delete(voice);
  }
  private async syncAmbient() {
    const url =
      this.custom?.url ??
      (this.url(this.desired === 'waiting' ? 'waitingBackground' : 'background') ||
        this.url('chant'));
    const group: AudioGroup = this.desired === 'waiting' ? 'waitingAmbient' : 'templeAmbient';
    const request = url + ':' + group;
    if (this.requestedAmbient === request) return;
    this.requestedAmbient = request;
    const generation = ++this.generation;
    if (!url) {
      for (const voice of this.ambientSources) this.stopVoice(voice);
      this.ambientVoice = null;
      this.ambientUrl = '';
      this.emit();
      return;
    }
    try {
      const original = await this.buffer(url);
      if (generation !== this.generation || this.disposed || this.paused) return;
      const channels = crossfadeLoopChannels(
        Array.from({ length: original.numberOfChannels }, (_, i) => original.getChannelData(i)),
        original.sampleRate,
        this.mix.crossfadeSeconds,
      );
      const loop = this.ctx!.createBuffer(channels.length, channels[0].length, original.sampleRate);
      channels.forEach((samples, i) => loop.copyToChannel(samples, i));
      const source = this.ctx!.createBufferSource(),
        gain = this.ctx!.createGain();
      source.buffer = loop;
      source.loop = true;
      source.connect(gain);
      gain.connect(this.buses.get(group)!);
      const now = this.ctx!.currentTime,
        fade = this.mix.crossfadeSeconds;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);
      const old = this.ambientVoice,
        voice = { source, gain };
      this.ambientSources.add(voice);
      source.start();
      this.ambientVoice = voice;
      this.ambientUrl = url;
      this.error = '';
      if (old) {
        old.gain.gain.cancelScheduledValues(now);
        old.gain.gain.setValueAtTime(old.gain.gain.value, now);
        old.gain.gain.linearRampToValueAtTime(0, now + fade);
        const timer = setTimeout(
          () => {
            this.stops.delete(timer);
            this.stopVoice(old);
          },
          fade * 1000 + 50,
        );
        this.stops.add(timer);
      }
      // A rapid room transition never accumulates an unbounded chain of fading tracks.
      for (const stale of [...this.ambientSources])
        if (stale !== old && stale !== voice) this.stopVoice(stale);
      this.emit();
    } catch (e) {
      if (generation !== this.generation || this.disposed) return;
      this.requestedAmbient = '';
      this.error = (e as Error).message;
      this.emit();
    }
  }
  async effect(cue: AudioCue, eventId: string, waitForEnd = false) {
    const key = cue + ':' + eventId;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    if (!this.unlocked || this.muted || this.disposed || !this.ctx) return;
    if (
      (cue === 'coin' && !this.mix.coinEnabled) ||
      (cue === 'woodblock' && !this.mix.woodblockEnabled)
    )
      return;
    const url = this.url(cue);
    if (!url) return;
    const now = Date.now();
    if (now - (this.recent.get(cue) ?? 0) < (cue === 'coin' || cue === 'woodblock' ? 5000 : 200))
      return;
    if (this.effects.size + this.pendingEffects >= this.mix.maxEffects) return;
    this.recent.set(cue, now);
    this.pendingEffects++;
    try {
      const buffer = await this.buffer(url);
      if (this.disposed || this.muted) return;
      const source = this.ctx.createBufferSource(),
        gain = this.ctx.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(
        this.buses.get(
          ['bow', 'prostrate', 'incense', 'meditation', 'woodblock'].includes(cue)
            ? 'ritualEffects'
            : 'uiEffects',
        )!,
      );
      const voice = { source, gain };
      this.effects.add(voice);
      let resolveEnd = () => {};
      const ended = new Promise<void>((r) => {
        resolveEnd = r;
      });
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      source.onended = () => {
        if (stopTimer) clearTimeout(stopTimer);
        resolveEnd();
        this.effects.delete(voice);
        source.disconnect();
        gain.disconnect();
        this.emit();
      };
      source.start();
      this.emit();
      if (waitForEnd) {
        stopTimer = setTimeout(() => {
          try {
            source.stop();
          } catch {
            resolveEnd();
          }
        }, 2000);
        await ended;
      }
    } catch (e) {
      if (!this.disposed) {
        this.error = (e as Error).message;
        this.emit();
      }
    } finally {
      this.pendingEffects--;
    }
  }
  async voice(bytes: ArrayBuffer, signal?: AbortSignal) {
    if (!this.unlocked || !this.ctx || this.disposed)
      throw new Error('Hãy bật âm thanh trước khi nhận lời chúc.');
    const buffer = await this.ctx.decodeAudioData(bytes);
    if (signal?.aborted || this.disposed) return;
    if (buffer.duration > 10.001) throw new Error('Voice vượt 10 giây.');
    this.setSpeaking(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const source = this.ctx!.createBufferSource();
        source.buffer = buffer;
        source.connect(this.buses.get('voice')!);
        let ended = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          source.disconnect();
          resolve();
        };
        const cancel = () => {
          try {
            source.stop();
          } catch {
            /* Ended. */
          }
          finish();
        };
        const timer = setTimeout(cancel, 10000);
        source.onended = finish;
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          source.start();
        } catch (e) {
          finish();
          reject(e);
        }
      });
    } finally {
      this.setSpeaking(false);
    }
  }
  pause() {
    this.paused = true;
    ++this.generation;
    for (const voice of this.ambientSources) this.stopVoice(voice);
    this.ambientVoice = null;
    this.ambientUrl = '';
    this.requestedAmbient = '';
    this.emit();
  }
  async resume() {
    return this.unlock();
  }
  async customTrack(file: File) {
    if (file.size > 25000000) throw new Error('Tệp tối đa 25 MB.');
    if (this.custom) URL.revokeObjectURL(this.custom.url);
    this.custom = { url: URL.createObjectURL(file), name: file.name };
    this.requestedAmbient = '';
    if (this.unlocked && !this.paused) await this.syncAmbient();
    this.emit();
  }
  clearCustomTrack() {
    if (this.custom) URL.revokeObjectURL(this.custom.url);
    this.custom = null;
    this.requestedAmbient = '';
    if (this.unlocked && !this.paused) void this.syncAmbient();
    this.emit();
  }
  async dispose() {
    this.disposed = true;
    this.unlocked = false;
    this.pause();
    for (const effect of this.effects)
      try {
        effect.source.stop();
      } catch {
        /* Ended. */
      }
    for (const timer of this.stops) clearTimeout(timer);
    this.stops.clear();
    if (this.custom) URL.revokeObjectURL(this.custom.url);
    this.buffers.clear();
    this.listeners.clear();
    const context = this.ctx;
    this.ctx = null;
    this.master = null;
    this.buses.clear();
    if (context) context.onstatechange = null;
    await context?.close();
  }
}
// Retained for integrations using the old lightweight mixer, now with relative V2 ducking.
export class BroadcastAudioManager {
  private speaking = false;
  private base = 0.5;
  constructor(
    private background: { volume: number },
    private duck = 0.25,
  ) {}
  setVolume(value: number) {
    this.base = clamp(value);
    this.apply();
  }
  setSpeaking(value: boolean) {
    this.speaking = value;
    this.apply();
  }
  setDuck(value: number) {
    this.duck = clamp(value);
    this.apply();
  }
  private apply() {
    this.background.volume = this.speaking ? this.base * this.duck : this.base;
  }
}
