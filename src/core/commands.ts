/**
 * Every player action is a serializable Command. In solo they go through a local
 * CommandQueue; in multiplayer the same objects will be sent to the authoritative server.
 */

export interface MoveCommand {
  type: 'move';
  playerId: string;
  tick: number;
  /** Stick axes in [-1, 1], screen space: x = right, y = forward. */
  x: number;
  y: number;
  /** Camera yaw (radians) so movement is camera-relative without the sim knowing the camera. */
  yaw: number;
  sprint: boolean;
  jump: boolean;
}

export type Command = MoveCommand;

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
