export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
const MAX_STEPS_PER_FRAME = 5;

/**
 * Fixed-timestep loop: the simulation always advances by DT, rendering
 * interpolates between the last two ticks with `alpha`.
 */
export class FixedLoop {
  tick = 0;
  private acc = 0;
  private last = -1;

  constructor(
    private step: (tick: number) => void,
    private render: (alpha: number, frameDt: number) => void,
  ) {}

  /** Advance with a timestamp in ms (rAF time). Returns the number of sim steps taken. */
  frame(nowMs: number): number {
    if (this.last < 0) this.last = nowMs;
    let frameDt = (nowMs - this.last) / 1000;
    this.last = nowMs;
    // Tab switch / long hitch: don't try to catch up forever.
    if (frameDt > 0.25) frameDt = 0.25;
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      this.step(this.tick);
      this.tick++;
      this.acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    this.render(this.acc / DT, frameDt);
    return steps;
  }

  resetClock(): void {
    this.last = -1;
    this.acc = 0;
  }
}
