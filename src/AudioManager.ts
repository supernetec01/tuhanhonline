export class BroadcastAudioManager {
  private speaking = false;
  private base = 0.5;
  constructor(
    private background: { volume: number },
    private duck = 0.2,
  ) {}
  setVolume(value: number) {
    this.base = Math.max(0, Math.min(1, value));
    this.apply();
  }
  setSpeaking(value: boolean) {
    this.speaking = value;
    this.apply();
  }
  setDuck(value: number) {
    this.duck = Math.max(0, Math.min(1, value));
    this.apply();
  }
  private apply() {
    this.background.volume = this.speaking ? Math.min(this.base, this.duck) : this.base;
  }
}
