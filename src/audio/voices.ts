/**
 * Voices: short cries ("Ah !", "Oh !", screams) made with a tiny formant synthesizer,
 * and whole sentences ("Au secours !", "Police, pas un geste !") through the device's
 * speech synthesis when it exists. Each pedestrian keeps the same voice (seeded).
 */

export type CryKind = 'hurt' | 'ko' | 'scream' | 'effort';
export type LineKind = 'hurt' | 'flee' | 'fight' | 'cop' | 'carjack' | 'ko' | 'talk';

/** Vowel formants (Hz): F1, F2, F3. */
const VOWELS: Record<string, [number, number, number]> = {
  a: [800, 1200, 2500],
  o: [500, 900, 2400],
  ou: [320, 800, 2300],
  e: [480, 1700, 2500],
  i: [300, 2200, 2900],
};

const LINES: Record<LineKind, string[]> = {
  hurt: ['Aïe !', 'Oh non !', 'Arrête !', 'Oh shit !', "Non, s'il vous plaît !", 'Pitié !', 'Mais ça va pas ?', 'Oh no, no, no !', 'Ouch !'],
  flee: ['Au secours !', 'À l’aide !', 'Il est fou !', 'Appelez la police !', 'Cours !', 'Help !', 'Oh mon dieu !'],
  fight: ['Viens là !', 'Tu vas voir !', 'Tu cherches quoi ?', 'Tu vas le regretter !', 'Come on !', 'Approche !'],
  cop: ['Police ! Pas un geste !', 'Arrêtez-vous !', 'Les mains en l’air !', 'Halte ! Police !', 'Suspect en fuite !', 'On le tient !'],
  carjack: ['Ma voiture !', 'Hé ! Reviens !', 'Au voleur !'],
  ko: ['Ahhh…', 'Ma tête…'],
  talk: ['Salut !', 'Ça va ?', 'Bien ou bien ?', 'Hé !', 'Wesh !'],
};

/** Per-voice character from a seed: pitch (low male … high female), speed, timbre. */
export function voiceOf(seed: number) {
  const h = (Math.imul(seed | 0, 2654435761) >>> 0) / 4294967296;
  const high = h > 0.5;
  return { f0: high ? 190 + h * 80 : 95 + h * 70, rate: 0.95 + ((h * 7) % 1) * 0.35, pitch: high ? 1.2 + h * 0.4 : 0.7 + h * 0.4, high };
}

export class Voices {
  private speaking = 0;
  private lastLine = 0;
  private fr: SpeechSynthesisVoice | null = null;
  private en: SpeechSynthesisVoice | null = null;
  enabled = true;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private noise: AudioBuffer,
  ) {
    const pick = () => {
      const vs = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
      this.fr = vs.find((v) => v.lang.startsWith('fr')) ?? null;
      this.en = vs.find((v) => v.lang.startsWith('en')) ?? null;
    };
    pick();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = pick;
  }

  /** A short synthesized cry at volume `vol` (0..1) and stereo `pan`. */
  cry(kind: CryKind, seed: number, vol: number, pan: number) {
    if (!this.enabled || vol <= 0.02) return;
    const c = this.ctx;
    const v = voiceOf(seed);
    const t = c.currentTime + 0.01;
    const vowel = kind === 'scream' ? 'a' : kind === 'ko' ? 'o' : (['a', 'o', 'ou', 'e'] as const)[seed % 4];
    const dur = kind === 'scream' ? 0.9 : kind === 'ko' ? 0.7 : kind === 'effort' ? 0.15 : 0.28;
    const f0 = v.f0 * (kind === 'scream' ? 1.9 : kind === 'effort' ? 0.9 : 1.2);
    // glottal source: sawtooth with a pitch contour
    const src = c.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * (kind === 'hurt' ? 1.25 : 1), t);
    if (kind === 'ko') src.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
    else if (kind === 'scream') {
      src.frequency.linearRampToValueAtTime(f0 * 1.15, t + dur * 0.3);
      src.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
    } else src.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + dur);
    // vibrato on screams
    if (kind === 'scream') {
      const lfo = c.createOscillator();
      lfo.frequency.value = 7;
      const d = c.createGain();
      d.gain.value = f0 * 0.04;
      lfo.connect(d).connect(src.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.03);
    env.gain.setValueAtTime(vol * 0.5, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const panner = c.createStereoPanner();
    panner.pan.value = pan;
    env.connect(panner).connect(this.dest);
    const F = VOWELS[vowel];
    F.forEach((f, k) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (v.high ? 1.15 : 1);
      bp.Q.value = 6 + k * 2;
      const g = c.createGain();
      g.gain.value = [1, 0.6, 0.25][k];
      src.connect(bp).connect(g).connect(env);
    });
    // breath
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const ng = c.createGain();
    ng.gain.value = 0.08;
    n.connect(hp).connect(ng).connect(env);
    src.start(t);
    src.stop(t + dur + 0.02);
    n.start(t, Math.random() * 0.5, dur);
  }

  /** Says an exact sentence (mission partner). Interrupts other voices. */
  say(text: string, seed: number, vol = 1) {
    if (!this.enabled || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text.replace(/[«»📋€🔧]/g, ''));
    const voice = this.fr ?? this.en;
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else u.lang = 'fr-FR';
    const v = voiceOf(seed);
    u.pitch = v.pitch;
    u.rate = 1.08;
    u.volume = vol;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    const now = performance.now();
    this.lastLine = now;
    this.speaking = now + 400 + text.length * 65;
  }

  /**
   * Says a sentence of the given kind with the speaker's voice. Rate-limited (one at a
   * time, and not too often) so the city doesn't turn into a choir.
   */
  line(kind: LineKind, seed: number, vol: number, force = false): boolean {
    if (!this.enabled || typeof speechSynthesis === 'undefined' || vol <= 0.05) return false;
    const now = performance.now();
    if (!force && (now < this.speaking || now - this.lastLine < 1800)) return false;
    const list = LINES[kind];
    const text = list[Math.abs(seed + Math.floor(now / 997)) % list.length];
    const u = new SpeechSynthesisUtterance(text);
    const english = /^(Oh shit|Oh no|Help|Come on|Ouch)/.test(text);
    const voice = english ? (this.en ?? this.fr) : (this.fr ?? this.en);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else u.lang = english ? 'en-US' : 'fr-FR';
    const v = voiceOf(seed);
    u.pitch = Math.min(2, v.pitch * (kind === 'flee' || kind === 'hurt' ? 1.15 : 1));
    u.rate = v.rate * (kind === 'flee' ? 1.25 : kind === 'cop' ? 1.1 : 1);
    u.volume = Math.min(1, vol);
    if (force) speechSynthesis.cancel();
    speechSynthesis.speak(u);
    this.lastLine = now;
    this.speaking = now + 400 + text.length * 70;
    return true;
  }
}
