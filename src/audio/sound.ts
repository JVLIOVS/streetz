import { TrapRadio } from './music';
import { Voices } from './voices';

/**
 * Synthesized sound (WebAudio, no files): weapons, hits, explosions, cars, city
 * ambience, police, voices and a procedural trap radio.
 *
 * Mobile browsers only allow audio after a tap: `unlock()` must be called from a touch
 * handler (the lobby buttons, and any tap until it worked). On iPhone, WebAudio is also
 * muted by the silent switch unless the page plays "media": a silent <audio> loop and
 * `navigator.audioSession` take care of that.
 *
 * Positional sounds take world (x, z): volume falls off with distance to the listener
 * (the local player) and is panned left/right from the camera's point of view.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private amb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private siren: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private loops: { screech: GainNode; heli: GainNode; heliLfo: GainNode; traffic: GainNode; city: GainNode } | null = null;
  private radio: TrapRadio | null = null;
  voices: Voices | null = null;
  private listener = { x: 0, z: 0, yaw: 0 };
  private nextAmbient = 0;
  private silentEl: HTMLAudioElement | null = null;
  /** User settings. */
  sfxOn = true;
  musicOn = true;
  onStation?: (name: string) => void;

  get enabled() {
    return this.sfxOn;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  /** Call from a user gesture. Safe to call many times. */
  unlock() {
    if (!this.ctx) this.create();
    const c = this.ctx;
    if (!c) return;
    if (c.state !== 'running') void c.resume().catch(() => {});
    // iOS: play through the silent switch
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    if (!this.silentEl) {
      const a = new Audio(SILENT_WAV);
      a.loop = true;
      a.setAttribute('playsinline', '');
      a.volume = 0.01;
      this.silentEl = a;
    }
    void this.silentEl.play().catch(() => {});
    // speech synthesis also needs a first utterance during a gesture on iOS
    if (typeof speechSynthesis !== 'undefined' && !this.spoke) {
      this.spoke = true;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }
  private spoke = false;

  /** Legacy name used by the game: same as unlock. */
  start() {
    this.unlock();
    if (this.musicOn) this.radio?.start();
  }

  suspend() {
    void this.ctx?.suspend();
    this.silentEl?.pause();
  }

  private create() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    this.ctx = c;
    this.master = c.createGain();
    this.master.gain.value = 1;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    this.master.connect(limiter).connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.8 : 0;
    this.sfx.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.amb = c.createGain();
    this.amb.gain.value = this.sfxOn ? 1 : 0;
    this.amb.connect(this.master);
    // 2 s of white noise, shared by every noisy sound
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.buildEngine();
    this.buildLoops();
    this.radio = new TrapRadio(c, this.musicBus, this.noise);
    this.radio.onTrack = (n) => this.onStation?.(n);
    this.voices = new Voices(c, this.sfx, this.noise);
  }

  private buildEngine() {
    const c = this.ctx!;
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.sfx!);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain, filter };
  }

  /** Continuous layers: tyre screech, helicopter rotor, traffic hum, city bed. */
  private buildLoops() {
    const c = this.ctx!;
    const loopNoise = (type: BiquadFilterType, freq: number, q: number, dest: AudioNode) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(dest);
      s.start();
      return g;
    };
    const screech = loopNoise('bandpass', 2600, 6, this.sfx!);
    // rotor: low noise chopped by a ~12 Hz LFO
    const heli = loopNoise('lowpass', 260, 1, this.sfx!);
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 12;
    const heliLfo = c.createGain();
    heliLfo.gain.value = 0;
    lfo.connect(heliLfo).connect(heli.gain);
    lfo.start();
    const traffic = loopNoise('lowpass', 180, 0.7, this.amb!);
    const city = loopNoise('bandpass', 700, 0.4, this.amb!);
    this.loops = { screech, heli, heliLfo, traffic, city };
  }

  /** Where the ears are (local player) and where the camera looks (stereo). */
  setListener(x: number, z: number, yaw: number) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  /** Volume (0..1) and pan (-1..1) of a sound at (x, z). */
  private spatial(x: number, z: number, range = 120): { vol: number; pan: number } {
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const vol = Math.max(0, 1 - d / range) ** 1.6;
    if (d < 0.5) return { vol, pan: 0 };
    // camera right vector = (cos yaw, -sin yaw)
    const right = (dx * Math.cos(this.listener.yaw) - dz * Math.sin(this.listener.yaw)) / d;
    return { vol, pan: Math.max(-0.85, Math.min(0.85, right)) };
  }

  private out(pan: number): AudioNode {
    if (!pan) return this.sfx!;
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx!);
    return p;
  }

  private burst(duration: number, freq: number, volume: number, q = 0.7, pan = 0, type: BiquadFilterType = 'lowpass', delay = 0) {
    const c = this.ctx;
    if (!c || !this.noise || !this.sfxOn || volume <= 0.005) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration);
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0, pan = 0) {
    const c = this.ctx;
    if (!c || !this.sfxOn || volume <= 0.005) return;
    const o = c.createOscillator();
    o.type = type;
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + duration);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + duration);
  }

  // ------------------------------------------------------------------ weapons & hits

  /** A gunshot at (x, z), by weapon. */
  shot(x: number, z: number, weapon = 'pistol') {
    const { vol, pan } = this.spatial(x, z, 160);
    if (vol <= 0) return;
    switch (weapon) {
      case 'smg':
        this.burst(0.08, 4200, 0.6 * vol, 0.5, pan);
        this.tone('square', 220, 90, 0.06, 0.25 * vol, 0, pan);
        break;
      case 'shotgun':
        this.burst(0.45, 1800, 1.1 * vol, 0.4, pan);
        this.tone('sine', 120, 35, 0.3, 0.9 * vol, 0, pan);
        // pump
        this.burst(0.05, 2500, 0.3 * vol, 3, pan, 'bandpass', 0.35);
        this.burst(0.05, 2000, 0.3 * vol, 3, pan, 'bandpass', 0.45);
        break;
      case 'sniper':
        this.burst(0.5, 2600, 1.2 * vol, 0.4, pan);
        this.tone('sine', 140, 30, 0.45, 0.9 * vol, 0, pan);
        break;
      case 'rifle':
        this.burst(0.14, 3200, 0.85 * vol, 0.5, pan);
        this.tone('sawtooth', 180, 60, 0.1, 0.35 * vol, 0, pan);
        break;
      default:
        this.burst(0.18, 3500, 0.9 * vol, 0.5, pan);
        this.tone('sine', 160, 50, 0.15, 0.7 * vol, 0, pan);
    }
    // echo off the buildings
    if (vol < 0.9) this.burst(0.35, 900, 0.25 * vol, 0.4, -pan, 'lowpass', 0.12);
  }

  /** Flamethrower roar (called for each puff). */
  flame(x: number, z: number) {
    const { vol, pan } = this.spatial(x, z, 60);
    this.burst(0.12, 900, 0.35 * vol, 0.5, pan);
  }

  /** Awakening: a rising roar while the aura builds up (2.4 s), crackles of lightning. */
  awakenCharge(x: number, z: number) {
    const { vol, pan } = this.spatial(x, z, 70);
    this.tone('sawtooth', 70, 420, 2.4, 0.22 * vol, 0, pan);
    this.tone('sine', 140, 840, 2.4, 0.18 * vol, 0, pan);
    for (let k = 0; k < 7; k++) this.burst(0.06, 3200, 0.25 * vol, 3, pan, 'bandpass', 0.2 + k * 0.3);
  }

  /** Awakening: the boom of the transformation. */
  awakenBoom(x: number, z: number) {
    const { vol, pan } = this.spatial(x, z, 90);
    this.burst(0.9, 300, 1.2 * vol, 0.7, pan);
    this.tone('sine', 90, 30, 0.8, 1.0 * vol, 0, pan);
    this.tone('triangle', 660, 1320, 0.5, 0.25 * vol, 0.05, pan);
  }

  /** Energy ball (whoosh + zap) or beam (long charged blast). */
  energy(x: number, z: number, beam: boolean) {
    const { vol, pan } = this.spatial(x, z, 70);
    if (beam) {
      this.tone('sawtooth', 220, 880, 0.35, 0.3 * vol, 0, pan);
      this.burst(1.0, 1800, 0.6 * vol, 1.2, pan, 'bandpass', 0.3);
      this.tone('sine', 110, 60, 1.1, 0.5 * vol, 0.3, pan);
    } else {
      this.tone('sine', 900, 300, 0.25, 0.35 * vol, 0, pan);
      this.burst(0.18, 2600, 0.3 * vol, 2, pan, 'bandpass');
    }
  }

  /** Chainsaw buzz while cutting. */
  chainsaw() {
    this.tone('sawtooth', 115, 140, 0.13, 0.12);
    this.burst(0.1, 2500, 0.1, 2, 0, 'bandpass');
  }

  /** Kept for old call sites: a gunshot at distance d, centered. */
  gunshot(d = 0) {
    this.shot(this.listener.x + d, this.listener.z);
  }

  /** Melee hit at (x, z). */
  hit(x: number, z: number, heavy = false) {
    const { vol, pan } = this.spatial(x, z, 45);
    this.burst(heavy ? 0.14 : 0.08, heavy ? 600 : 900, 0.9 * vol, 0.7, pan);
    this.tone('sine', heavy ? 100 : 130, 55, heavy ? 0.16 : 0.1, 0.7 * vol, 0, pan);
  }

  punch() {
    this.hit(this.listener.x, this.listener.z);
  }

  /** Swinging a fist / bat through the air. */
  whoosh() {
    this.burst(0.18, 1200, 0.25, 1.5, 0, 'bandpass');
  }

  explosion(x: number, z: number) {
    const { vol, pan } = this.spatial(x, z, 220);
    if (vol <= 0) return;
    this.burst(1.6, 500, 1.3 * vol, 0.3, pan);
    this.tone('sine', 80, 25, 1.1, 1.0 * vol, 0, pan);
    this.burst(0.6, 3000, 0.3 * vol, 0.5, pan, 'highpass', 0.05);
    // debris raining down
    for (let i = 0; i < 5; i++) this.burst(0.06, 2500 + Math.random() * 2000, 0.15 * vol, 4, pan, 'bandpass', 0.4 + Math.random() * 0.9);
  }

  impact(strength: number, x = this.listener.x, z = this.listener.z) {
    const { vol, pan } = this.spatial(x, z, 60);
    const v = Math.min(1, strength / 15) * vol;
    this.burst(0.3, 700, v, 0.7, pan);
    // crumpled metal and broken glass on big crashes
    if (strength > 8) {
      this.burst(0.25, 1800, v * 0.5, 2, pan, 'bandpass', 0.02);
      this.burst(0.4, 6000, v * 0.35, 1, pan, 'highpass', 0.05);
    }
  }

  /** Street furniture breaking, by kind. */
  breakProp(kind: string, x: number, z: number) {
    const { vol, pan } = this.spatial(x, z, 50);
    if (vol <= 0) return;
    switch (kind) {
      case 'streetlight':
      case 'trafficlight':
        this.burst(0.25, 900, 0.7 * vol, 0.6, pan); // pole
        this.burst(0.6, 7000, 0.45 * vol, 0.8, pan, 'highpass', 0.05); // glass
        for (let i = 0; i < 4; i++) this.tone('sine', 3000 + Math.random() * 3000, 2500, 0.08, 0.06 * vol, 0.08 + i * 0.07, pan);
        break;
      case 'hydrant':
        this.tone('triangle', 700, 650, 0.4, 0.35 * vol, 0, pan); // metal clang
        this.burst(2.5, 3000, 0.25 * vol, 0.5, pan, 'highpass', 0.1); // water burst
        break;
      case 'trash':
      case 'dumpster':
        this.burst(0.3, 500, 0.6 * vol, 1.2, pan, 'bandpass');
        this.tone('square', 180, 120, 0.15, 0.12 * vol, 0, pan);
        break;
      case 'bollard':
        this.tone('triangle', 520, 480, 0.35, 0.3 * vol, 0, pan);
        break;
      default:
        this.burst(0.25, 800, 0.6 * vol, 0.7, pan);
    }
  }

  horn() {
    this.tone('square', 420, 410, 0.45, 0.18);
    this.tone('square', 525, 515, 0.45, 0.14);
  }

  /** Someone else's horn, in the street. */
  hornAt(x: number, z: number) {
    const { vol, pan } = this.spatial(x, z, 90);
    this.tone('square', 400, 395, 0.35, 0.12 * vol, 0, pan);
    this.tone('square', 500, 495, 0.35, 0.09 * vol, 0, pan);
  }

  door() {
    this.burst(0.12, 400, 0.6, 1);
    this.tone('sine', 90, 60, 0.1, 0.4);
  }

  footstep(run: boolean) {
    this.burst(0.05, run ? 900 : 700, run ? 0.12 : 0.07, 1.2, 0, 'bandpass');
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

  /** Police radio chirp (new star). */
  radioChirp() {
    this.burst(0.08, 2500, 0.2, 2, 0, 'bandpass');
    this.tone('square', 1200, 1200, 0.05, 0.06, 0.08);
    this.burst(0.25, 2000, 0.12, 3, 0, 'bandpass', 0.14);
  }

  // ------------------------------------------------------------------ continuous layers

  /** Police siren (French two-tone), volume 0..1. */
  setSiren(volume: number) {
    const c = this.ctx;
    if (!c || !this.sfx) return;
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
      osc.connect(gain).connect(this.sfx);
      osc.start();
      lfo.start();
      this.siren = { osc, lfo, gain };
    }
    this.siren.gain.gain.setTargetAtTime(volume * 0.09, c.currentTime, 0.2);
  }

  /** Continuous engine sound; speed in m/s, 0 = off. */
  setEngine(on: boolean, speed: number, throttle: number, moto = false) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    // fake gearbox: the pitch climbs then drops at each "gear"
    const s = Math.abs(speed);
    const gear = Math.min(4, Math.floor(s / 9));
    const inGear = s - gear * 9;
    const base = (moto ? 70 : 45) + inGear * 6 + gear * 8 + throttle * 15;
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(300 + s * 25 + throttle * 300, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(on ? 0.12 + throttle * 0.06 : 0, t, 0.15);
  }

  /** Tyres: drift / hard braking (0..1). */
  setScreech(level: number) {
    if (!this.loops || !this.ctx) return;
    this.loops.screech.gain.setTargetAtTime(Math.min(1, level) * 0.22, this.ctx.currentTime, 0.05);
  }

  /** Closest helicopter: volume 0..1. */
  setHeli(level: number) {
    if (!this.loops || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.loops.heliLfo.gain.setTargetAtTime(level * 0.35, t, 0.3);
  }

  /**
   * City ambience: low traffic rumble (how many cars are around), a distant city murmur,
   * and random far-away events (horns, sirens, dogs). Indoors: almost silent.
   */
  setAmbience(traffic: number, indoors: boolean, park: boolean) {
    const c = this.ctx;
    if (!c || !this.loops) return;
    const t = c.currentTime;
    this.loops.traffic.gain.setTargetAtTime(indoors ? 0.01 : 0.05 + Math.min(1, traffic / 10) * 0.12, t, 0.5);
    this.loops.city.gain.setTargetAtTime(indoors ? 0.004 : park ? 0.01 : 0.025, t, 0.5);
    if (indoors || !this.sfxOn || t < this.nextAmbient) return;
    this.nextAmbient = t + 3 + Math.random() * 6;
    const pan = Math.random() * 1.6 - 0.8;
    const r = Math.random();
    if (park && r < 0.6) {
      // birds
      for (let i = 0; i < 3; i++) this.tone('sine', 2600 + Math.random() * 1500, 3200 + Math.random() * 1500, 0.07, 0.03, i * 0.11, pan);
    } else if (r < 0.45) {
      this.tone('square', 380 + Math.random() * 120, 375, 0.3, 0.025, 0, pan); // distant horn
    } else if (r < 0.6) {
      // distant siren
      for (let i = 0; i < 4; i++) this.tone('triangle', i % 2 ? 450 : 520, i % 2 ? 450 : 520, 0.38, 0.012, i * 0.38, pan);
    } else if (r < 0.75) {
      this.burst(0.25, 500, 0.04, 2, pan, 'bandpass'); // dog / thud
      this.burst(0.2, 500, 0.03, 2, pan, 'bandpass', 0.3);
    } else {
      this.burst(1.2, 1200, 0.03, 0.5, pan, 'bandpass'); // scooter passing far away
      this.tone('sawtooth', 140, 110, 1.2, 0.012, 0, pan);
    }
  }

  // ------------------------------------------------------------------ music & settings

  /** Music level: background on foot, louder radio in a car, nothing indoors-quiet. */
  setMusicMode(inCar: boolean, chase: boolean, indoors: boolean) {
    const c = this.ctx;
    if (!c || !this.musicBus || !this.radio) return;
    const level = !this.musicOn ? 0 : inCar ? 0.55 : indoors ? 0.18 : 0.28;
    this.musicBus.gain.setTargetAtTime(level, c.currentTime, 0.6);
    this.radio.intensity = chase ? 1 : 0;
  }

  get station() {
    return this.radio?.name ?? '';
  }

  nextStation() {
    this.radio?.skip();
  }

  setSettings(sfx: boolean, music: boolean) {
    this.sfxOn = sfx;
    this.musicOn = music;
    if (this.voices) this.voices.enabled = sfx;
    const c = this.ctx;
    if (!c) return;
    this.sfx?.gain.setTargetAtTime(sfx ? 0.8 : 0, c.currentTime, 0.05);
    this.amb?.gain.setTargetAtTime(sfx ? 1 : 0, c.currentTime, 0.05);
    if (music) this.radio?.start();
    else {
      this.radio?.stop();
      this.musicBus?.gain.setTargetAtTime(0, c.currentTime, 0.05);
    }
  }

  /** Volume and pan for a voice at (x, z). */
  voiceAt(x: number, z: number, range = 30) {
    return this.spatial(x, z, range);
  }
}

/** A tiny silent WAV (keeps iOS in "media playback" mode so WebAudio ignores the mute switch). */
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
