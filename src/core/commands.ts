/**
 * Every player action is a serializable Command. In solo they go through a local
 * CommandQueue; in multiplayer the same objects will be sent to the authoritative server.
 */

/** Continuous input, sent every tick. */
export interface MoveCommand {
  type: 'move';
  playerId: string;
  tick: number;
  /** Stick axes in [-1, 1], screen space: x = right, y = forward. In a vehicle x steers. */
  x: number;
  y: number;
  /** Camera yaw (radians) so movement is camera-relative without the sim knowing the camera. */
  yaw: number;
  sprint: boolean;
  /** Jump pressed this tick (on foot). */
  jump: boolean;
  /** Charge of the jump (0 = tap, 1 = fully charged super jump). */
  jumpPower?: number;
  /** Vehicle pedals: 1 accelerate, -1 brake/reverse, 0 none. */
  throttle: number;
  handbrake: boolean;
}

export type ActionKind =
  /** Punch / shoot with the current weapon. */
  | 'attack'
  /** Contextual action: enter/exit vehicle, open door, rob, talk... */
  | 'use'
  /** Cycle weapons. */
  | 'weapon'
  | 'horn'
  /** Shop purchase, arg = 'weapon:pistol' | 'ammo:pistol' | 'armor' | 'cloth:<id>' | 'car:<type>' | 'home:<id>'. */
  | 'buy'
  /** Wardrobe: put on an owned piece of clothing (arg = clothing id). */
  | 'wear'
  /** Garage: take out stored vehicle number arg. */
  | 'garage_out'
  /** Missions: start (arg = mission id) or give up (arg = ''). */
  | 'mission' | 'collect' | 'crew' | 'heist' | 'fine' | 'bank' | 'skill';

/** One-shot action (button tap). */
export interface ActionCommand {
  type: 'action';
  playerId: string;
  tick: number;
  action: ActionKind;
  arg?: string;
}

export type Command = MoveCommand | ActionCommand;

export class CommandQueue {
  private items: Command[] = [];

  push(cmd: Command): void {
    this.items.push(cmd);
  }

  /** Returns and removes every command for ticks <= `tick`. */
  drain(tick: number): Command[] {
    if (this.items.length === 0) return [];
    const out: Command[] = [];
    const keep: Command[] = [];
    for (const c of this.items) (c.tick <= tick ? out : keep).push(c);
    this.items = keep;
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}
