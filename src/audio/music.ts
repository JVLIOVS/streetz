/**
 * Procedural hip-hop / trap radio (WebAudio only, no files, so no licence issue).
 * Each "track" is generated from a seed: key, tempo, chords, 808 line, hi-hat rolls and
 * a bell melody. A step sequencer schedules notes slightly ahead of time.
 * `intensity` (0..1) adds layers: busier hats and a double-time feel during police chases.
 */

const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Minor-key chord progressions (degrees of the natural minor scale). */
const PROGRESSIONS = [
  [0, 5, 2, 6],
  [0, 3, 5, 4],
  [0, 5, 3, 4],
  [0, 6, 5, 6],
];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export const STATIONS = ['Radio Bitume', 'Trap FM', 'Hood 808', 'Béton Radio'];

class Rand {
  constructor(private s: number) {}
  next() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(a: readonly T[]) {
    return a[Math.floor(this.next() * a.length)];
  }
}

interface Track {
  name: string;
  bpm: number;
  root: number; // midi
  prog: number[];
  kick: boolean[];
  snare: boolean[];
  /** 808 notes per 16th step (scale degree offsets, -1 = rest). */
  bass: number[];
  melody: number[];
  melodyOct: number;
}

function makeTrack(seed: number): Track {
  const r = new Rand(seed);
  const kick = Array.from({ length: 32 }, (_, i) => i === 0 || i === 16 || (i % 4 === 2 && r.next() < 0.22) || (i % 8 === 7 && r.next() < 0.3));
  // half-time snare/clap on beat 3 of each bar
  const snare = Array.from({ length: 32 }, (_, i) => i === 8 || i === 24 || (i === 30 && r.next() < 0.3));
  const bass = Array.from({ length: 32 }, (_, i) => (kick[i] ? 0 : i % 4 === 3 && r.next() < 0.25 ? r.pick([0, 7, 12, -2]) : -1));
  const melody = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 && r.next() < 0.55 ? r.pick([0, 2, 4, 7, 9, 11, 14]) : -1));
  return {
    name: STATIONS[seed % STATIONS.length],
    bpm: r.int(132, 150),
    root: 33 + r.int(0, 7), // A1..E2
    prog: r.pick(PROGRESSIONS),
    kick,
    snare,
    bass,
    melody,
    melodyOct: r.pick([36, 48]),
  };
}

const degree = (root: number, d: number) => root + MINOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

export class TrapRadio {
  private out: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private track: Track;
  private seed: number;
  intensity = 0;
  onTrack?: (name: string) => void;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private noise: AudioBuffer,
    seed = Math.floor(Math.random() * 1000),
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    // soft glue compression for the whole beat
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(dest);
    this.seed = seed;
    this.track = makeTrack(seed);
  }

  get name() {
    return this.track.name;
  }

  start() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
    this.onTrack?.(this.track.name);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Next station (new generated track). */
  skip() {
    this.seed++;
    this.track = makeTrack(this.seed);
    this.step = 0;
    this.bar = 0;
    this.onTrack?.(this.track.name);
  }

  private schedule() {
    const t16 = 60 / this.track.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.play(this.step, this.nextTime, t16);
      this.nextTime += t16;
      this.step = (this.step + 1) % 32;
      if (this.step === 0) {
        this.bar = (this.bar + 1) % 32;
        // a new track every 32 bars or so, like a playlist
        if (this.bar === 0) this.skip();
      }
    }
  }

  private play(i: number, t: number, t16: number) {
    const tr = this.track;
    const chordDeg = tr.prog[Math.floor(this.bar / 2) % tr.prog.length];
    const chase = this.intensity > 0.5;
    const intro = this.bar < 2;
    // drums
    if (tr.kick[i] && !intro) this.kick(t);
    if (tr.snare[i] && !intro) this.clap(t);
    if (chase && (i === 4 || i === 12 || i === 20 || i === 28)) this.clap(t, 0.35);
    // hats: 8ths, with 16th/32nd rolls; busier during chases
    const roll = (i % 8 === 6 && (this.bar + i) % 3 === 0) || (chase && i % 4 === 3);
    if (i % 2 === 0 || roll || chase) this.hat(t, i % 4 === 0 ? 0.5 : 0.32);
    if (roll) {
      this.hat(t + t16 / 2, 0.25);
      if (chase) {
        this.hat(t + t16 / 4, 0.18);
        this.hat(t + (3 * t16) / 4, 0.18);
      }
    }
    // 808
    const b = tr.bass[i];
    if (b >= 0 && !intro) this.bass808(t, NOTE(degree(tr.root, chordDeg) + b), t16 * (b === 0 ? 6 : 3));
    // pad on each chord change
    if (i === 0 && this.bar % 2 === 0) for (const d of [0, 2, 4]) this.pad(NOTE(degree(tr.root + 24, chordDeg + d)), t, t16 * 32);
    // bell melody (pentatonic-ish over the chord)
    const m = tr.melody[i];
    if (m >= 0 && this.bar % 8 < 6) this.bell(t, NOTE(degree(tr.root + tr.melodyOct, chordDeg + m)));
  }

  private env(t: number, peak: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.out);
    return g;
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(this.env(t, 0.9, 0.35));
    o.start(t);
    o.stop(t + 0.4);
  }

  private clap(t: number, vol = 0.5) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 0.8;
    s.connect(f).connect(this.env(t, vol, 0.22));
    s.start(t, Math.random() * 0.5, 0.25);
  }

  private hat(t: number, vol: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    s.connect(f).connect(this.env(t, vol * 0.5, 0.05));
    s.start(t, Math.random() * 0.5, 0.06);
  }

  private bass808(t: number, freq: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    // the signature 808 slide into the note
    o.frequency.setValueAtTime(freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = SATURATE;
    o.connect(shaper).connect(this.env(t, 0.55, Math.min(1.6, len)));
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private bell(t: number, freq: number) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g = this.env(t, 0.13, 0.5);
    o.connect(g);
    o2.connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.55);
    o2.stop(t + 0.55);
  }

  private pad(freq: number, t: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 14;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.025, t + len * 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + len);
  }
}

const SATURATE = (() => {
  const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    c[i] = Math.tanh(x * 2.2);
  }
  return c;
})();
