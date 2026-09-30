import { AUDIO_CONFIG } from '../config/constants';
import type { GameEventSink } from './GameEvents';

/** Emits a bite every `eatBiteInterval` seconds while eating (first one on the first frame) and a gulp when done. */
export class EatEventTracker {
  private sinceBite = 0;
  private active = false;

  constructor(private readonly sink: GameEventSink) {}

  update(state: 'idle' | 'eating' | 'eaten', dt: number): void {
    if (state === 'eating') {
      this.sinceBite += Math.max(0, dt);
      if (!this.active || this.sinceBite >= AUDIO_CONFIG.eatBiteInterval) {
        this.sinceBite = 0;
        this.sink.emit({ type: 'eatBite' });
      }
      this.active = true;
      return;
    }
    if (state === 'eaten') {
      this.sink.emit({ type: 'eatDone' });
    }
    this.active = false;
    this.sinceBite = 0;
  }
}
