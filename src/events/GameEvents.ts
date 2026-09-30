/** World position of an event (blocks). */
export interface EventPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Plain gameplay events. Simulation code emits these into a `GameEventSink`;
 * whatever listens (audio today) lives elsewhere, so gameplay never imports it.
 */
export type GameEvent =
  | { readonly type: 'blockBreak'; readonly blockId: number; readonly position: EventPosition }
  | { readonly type: 'blockPlace'; readonly blockId: number; readonly position: EventPosition }
  /** `blockId` is the block under the player's feet. */
  | { readonly type: 'footstep'; readonly blockId: number; readonly sprinting: boolean; readonly crouching: boolean }
  | { readonly type: 'jump'; readonly blockId: number }
  /** `fallSpeed` is the downward speed (blocks/s, positive) at touchdown. */
  | { readonly type: 'land'; readonly blockId: number; readonly fallSpeed: number }
  | { readonly type: 'playerHurt' }
  | { readonly type: 'playerDeath' }
  | { readonly type: 'eatBite' }
  | { readonly type: 'eatDone' }
  | { readonly type: 'pickup' }
  | { readonly type: 'chestOpen' }
  | { readonly type: 'mobIdle'; readonly mobType: number; readonly position: EventPosition }
  | { readonly type: 'mobHurt'; readonly mobType: number; readonly position: EventPosition }
  | { readonly type: 'mobDeath'; readonly mobType: number; readonly position: EventPosition };

export type GameEventType = GameEvent['type'];

/** Where gameplay code reports events. */
export interface GameEventSink {
  emit(event: GameEvent): void;
}

/**
 * Ordered buffer of events. Gameplay emits during a frame; the frame loop
 * drains it once to the listener, preserving emission order. Bounded so a
 * stalled consumer can never grow it without limit (oldest events drop).
 */
export class GameEventQueue implements GameEventSink {
  private events: GameEvent[] = [];

  constructor(private readonly capacity: number = 256) {}

  emit(event: GameEvent): void {
    if (this.events.length >= this.capacity) {
      this.events.shift();
    }
    this.events.push(event);
  }

  get length(): number {
    return this.events.length;
  }

  /** Delivers every queued event in order to `consumer` and empties the queue. */
  drain(consumer: (event: GameEvent) => void): void {
    const batch = this.events;
    this.events = [];
    for (const event of batch) {
      consumer(event);
    }
  }
}
