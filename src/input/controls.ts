/**
 * Turns touches / keys into a plain input state. The game turns that state into
 * serializable Commands once per sim tick; this module never touches the sim.
 *
 * Touch layout (landscape):
 *  - left 45 % of the screen: floating joystick, appears under the thumb
 *  - rest of the screen: drag to orbit the camera
 *  - buttons (DOM) on the right call press()/toggle() directly
 */
import type { ActionKind } from '../core/commands';

export interface InputState {
  moveX: number;
  moveY: number;
  sprint: boolean;
  jumpPressed: boolean;
}

const JOY_RADIUS = 56;
const DEADZONE = 0.12;
const CAM_SENS_X = 0.0062;
const CAM_SENS_Y = 0.0045;

export class Controls {
  readonly state: InputState = { moveX: 0, moveY: 0, sprint: false, jumpPressed: false };
  /** Camera deltas accumulated since the last read. */
  private camDX = 0;
  private camDY = 0;
  private sprintToggle = false;
  private keys = new Set<string>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private camId: number | null = null;
  private camLast = { x: 0, y: 0 };
  private releasedFor = 0;
  onSprintChange?: (on: boolean) => void;
  /** Buttons held down (pedals, handbrake, trigger). */
  readonly held = { gas: false, brake: false, handbrake: false, attack: false };
  private actions: ActionKind[] = [];

  constructor(
    surface: HTMLElement,
    private joyBase: HTMLElement,
    private joyKnob: HTMLElement,
  ) {
    surface.addEventListener('pointerdown', this.down, { passive: false });
    addEventListener('pointermove', this.move, { passive: false });
    addEventListener('pointerup', this.up);
    addEventListener('pointercancel', this.up);
    addEventListener('keydown', (e) => {
      // typing in a text field (crew name, nickname) is not playing
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.startJump();
      if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') this.pushAction('use');
      if (e.code === 'KeyR' || e.code === 'Tab') this.pushAction('weapon');
      if (e.code === 'KeyH') this.pushAction('horn');
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.releaseJump();
    });
    addEventListener('blur', () => this.keys.clear());
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    const leftZone = e.clientX < innerWidth * 0.45;
    if (e.pointerType !== 'mouse' && leftZone && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyVec = { x: 0, y: 0 };
      this.joyBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.joyKnob.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.joyBase.classList.add('on');
      this.joyKnob.classList.add('on');
    } else if (this.camId === null) {
      this.camId = e.pointerId;
      this.camLast = { x: e.clientX, y: e.clientY };
    }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) {
      e.preventDefault();
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > JOY_RADIUS) {
        // The base follows the thumb when it goes past the edge
        const k = (d - JOY_RADIUS) / d;
        this.joyOrigin.x += dx * k;
        this.joyOrigin.y += dy * k;
        dx = e.clientX - this.joyOrigin.x;
        dy = e.clientY - this.joyOrigin.y;
        this.joyBase.style.transform = `translate(${this.joyOrigin.x}px, ${this.joyOrigin.y}px)`;
      }
      this.joyVec = { x: dx / JOY_RADIUS, y: -dy / JOY_RADIUS };
      this.joyKnob.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    } else if (e.pointerId === this.camId) {
      e.preventDefault();
      this.camDX += e.clientX - this.camLast.x;
      this.camDY += e.clientY - this.camLast.y;
      this.camLast = { x: e.clientX, y: e.clientY };
    }
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      this.joyBase.classList.remove('on');
      this.joyKnob.classList.remove('on');
    } else if (e.pointerId === this.camId) {
      this.camId = null;
    }
  };

  pushAction(a: ActionKind) {
    this.actions.push(a);
  }

  takeActions(): ActionKind[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  /** Makes a DOM button set `held[key]` while a finger is on it (multi-touch safe). */
  bindHold(el: HTMLElement, key: keyof Controls['held'], onDown?: () => void) {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      this.held[key] = true;
      el.classList.add('pressed');
      onDown?.();
    };
    const up = (e: PointerEvent) => {
      e.stopPropagation();
      this.held[key] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  /** Keyboard extras for desktop testing. */
  keyHeld() {
    const k = this.keys;
    return {
      gas: k.has('KeyW') || k.has('ArrowUp') || k.has('KeyZ'),
      brake: k.has('KeyS') || k.has('ArrowDown'),
      handbrake: k.has('Space'),
      attack: k.has('KeyK') || k.has('ControlLeft'),
    };
  }

  /** A quick tap jumps; holding charges a super jump (released = jump). */
  pressJump(power = 0) {
    this.state.jumpPressed = true;
    this.jumpPower = power;
  }

  private jumpStart = -1;
  private jumpPower = 0;

  startJump() {
    this.jumpStart = performance.now();
  }

  releaseJump() {
    if (this.jumpStart < 0) return;
    const power = this.jumpCharge();
    this.jumpStart = -1;
    this.pressJump(power);
  }

  /** Jump button (or Space) currently held. */
  jumpHeld() {
    return this.jumpStart >= 0;
  }

  /** Current charge of a held jump, 0..1 (taps under 0.18 s stay normal jumps). */
  jumpCharge() {
    if (this.jumpStart < 0) return 0;
    return Math.max(0, Math.min(1, ((performance.now() - this.jumpStart) / 1000 - 0.18) / 0.7));
  }

  toggleSprint() {
    this.sprintToggle = !this.sprintToggle;
    this.onSprintChange?.(this.sprintToggle);
  }

  /** Reads and resets the camera drag since last call, in radians. */
  takeCameraDelta(): { yaw: number; pitch: number } {
    const r = { yaw: -this.camDX * CAM_SENS_X, pitch: this.camDY * CAM_SENS_Y };
    this.camDX = 0;
    this.camDY = 0;
    return r;
  }

  /** Refresh the analog state; call once per frame. */
  update(dt: number) {
    let x = this.joyVec.x;
    let y = this.joyVec.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp') || k.has('KeyZ')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft') || k.has('KeyQ')) x -= 1;
    if (k.has('KeyJ')) this.camDX -= 400 * dt;
    if (k.has('KeyL')) this.camDX += 400 * dt;
    const m = Math.hypot(x, y);
    if (m < DEADZONE) {
      x = 0;
      y = 0;
    } else if (m > 1) {
      x /= m;
      y /= m;
    }
    this.state.moveX = x;
    this.state.moveY = y;
    // Sprint toggle switches itself off after the stick has been released for a moment
    if (m < DEADZONE) {
      this.releasedFor += dt;
      if (this.sprintToggle && this.releasedFor > 0.6) this.toggleSprint();
    } else {
      this.releasedFor = 0;
    }
    this.state.sprint = this.sprintToggle || k.has('ShiftLeft') || k.has('ShiftRight');
  }

  /** Returns the jump once per press, with its charge. */
  consumeJump(): { jump: boolean; power: number } {
    const j = this.state.jumpPressed;
    this.state.jumpPressed = false;
    return { jump: j, power: j ? this.jumpPower : 0 };
  }
}
