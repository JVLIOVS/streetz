/**
 * Tiny synthesized sound kit (WebAudio, no files): gunshots, punches, explosions,
 * horn, cash, and a continuous engine hum. Started on the first user gesture.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  enabled = true;
  private siren: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain, filter };
  }

  suspend() {
    void this.ctx?.suspend();
  }

  private burst(duration: number, freq: number, volume: number, q = 0.7) {
    const c = this.ctx;
    if (!c || !this.noise || !this.enabled) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration);
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const o = c.createOscillator();
    o.type = type;
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + duration);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + duration);
  }

  /** Volume falloff with distance to the listener. */
  private att(d: number) {
    return Math.max(0, 1 - d / 120);
  }

  gunshot(d = 0) {
    const a = this.att(d);
    if (a <= 0) return;
    this.burst(0.18, 3500, 0.9 * a, 0.5);
    this.tone('sine', 160, 50, 0.15, 0.7 * a);
  }

  punch() {
    this.burst(0.08, 900, 0.8);
    this.tone('sine', 120, 60, 0.1, 0.6);
  }

  explosion(d = 0) {
    const a = this.att(d);
    if (a <= 0) return;
    this.burst(1.4, 500, 1.2 * a, 0.3);
    this.tone('sine', 80, 25, 1.0, 0.9 * a);
  }

  impact(strength: number) {
    this.burst(0.25, 700, Math.min(1, strength / 15));
  }

  horn() {
    this.tone('square', 420, 410, 0.45, 0.18);
    this.tone('square', 525, 515, 0.45, 0.14);
  }

  cash() {
    this.tone('sine', 1320, 1320, 0.08, 0.25);
    this.tone('sine', 1760, 1760, 0.15, 0.25, 0.07);
  }

  /** Rising arpeggio (level up, all contracts done). */
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.22, i * 0.09));
  }

  /** Short blip whose pitch climbs with the combo multiplier. */
  combo(mult: number) {
    const f = 500 + mult * 120;
    this.tone('square', f, f * 1.5, 0.07, 0.07);
  }

  /** KO crunch: punch + low thump. */
  knockout() {
    this.burst(0.15, 600, 1);
    this.tone('sine', 90, 35, 0.25, 0.9);
  }

  alert() {
    this.tone('square', 660, 880, 0.25, 0.12);
  }

  /** Police siren (French two-tone), volume 0..1. */
  setSiren(volume: number) {
    const c = this.ctx;
    if (!c || !this.master) return;
    if (!this.siren) {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 520;
      // square LFO jumps between the two tones (pin-pon)
      const lfo = c.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.3;
      const depth = c.createGain();
      depth.gain.value = 70;
      lfo.connect(depth).connect(osc.frequency);
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.siren = { osc, lfo, gain };
    }
    this.siren.gain.gain.setTargetAtTime(this.enabled ? volume * 0.09 : 0, c.currentTime, 0.2);
  }

  /** Continuous engine sound; speed in m/s, 0 = off. */
  setEngine(on: boolean, speed: number, throttle: number) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 45 + Math.abs(speed) * 3.2 + throttle * 15;
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(300 + Math.abs(speed) * 25, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(on && this.enabled ? 0.12 + throttle * 0.05 : 0, t, 0.15);
  }
}
