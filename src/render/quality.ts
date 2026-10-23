export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Device pixel ratio cap and floor for the adaptive resolution. */
  maxPixelRatio: number;
  minPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Chunks beyond this distance (m) are hidden; fog ends there. */
  viewDistance: number;
  /** Roofs / trees beyond this distance are hidden. */
  lodDistance: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { maxPixelRatio: 1, minPixelRatio: 0.5, antialias: false, shadows: false, shadowMapSize: 0, viewDistance: 200, lodDistance: 110 },
  medium: { maxPixelRatio: 1.5, minPixelRatio: 0.7, antialias: true, shadows: true, shadowMapSize: 1024, viewDistance: 300, lodDistance: 180 },
  high: { maxPixelRatio: 2, minPixelRatio: 0.9, antialias: true, shadows: true, shadowMapSize: 2048, viewDistance: 450, lodDistance: 300 },
};

/**
 * Lowers the render resolution when the frame rate drops, raises it back when there is headroom.
 * Pure logic (testable): feed it frame durations, read `scale`.
 */
export class AdaptiveResolution {
  scale: number;
  private acc = 0;
  private frames = 0;
  private goodStreak = 0;

  constructor(
    private min: number,
    private max: number,
    private targetFps = 55,
  ) {
    this.scale = max;
  }

  setRange(min: number, max: number) {
    this.min = min;
    this.max = max;
    this.scale = Math.min(max, Math.max(min, this.scale));
  }

  /** Returns true when the scale changed. */
  push(dt: number): boolean {
    this.acc += dt;
    this.frames++;
    if (this.acc < 1) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    const before = this.scale;
    if (fps < this.targetFps - 8) {
      this.scale = Math.max(this.min, this.scale * (fps < 30 ? 0.8 : 0.9));
      this.goodStreak = 0;
    } else if (fps > this.targetFps + 2) {
      if (++this.goodStreak >= 3) {
        this.scale = Math.min(this.max, this.scale * 1.08);
        this.goodStreak = 0;
      }
    } else {
      this.goodStreak = 0;
    }
    return Math.abs(before - this.scale) > 1e-3;
  }
}
