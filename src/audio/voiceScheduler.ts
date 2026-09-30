/** A sound currently playing. */
export interface VoiceInfo {
  readonly id: number;
  readonly startTime: number;
  readonly endTime: number;
}

export interface VoiceAdmission {
  readonly id: number;
  /** Id of the voice that had to be stopped to make room, or null. */
  readonly stolen: number | null;
}

/**
 * Bookkeeping for a fixed number of simultaneous voices. Pure: it only tracks
 * ids and times (the caller owns the audio nodes). When full, the oldest voice
 * (earliest start, then lowest id) is stolen.
 */
export class VoiceScheduler {
  private readonly voices: VoiceInfo[] = [];
  private nextId = 1;

  constructor(private readonly maxVoices: number) {}

  get count(): number {
    return this.voices.length;
  }

  /** Drops voices whose end time has passed (a safety net next to `release`). Returns the removed ids. */
  prune(now: number): number[] {
    const removed: number[] = [];
    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      const voice = this.voices[i];
      if (voice !== undefined && voice.endTime <= now) {
        removed.push(voice.id);
        this.voices.splice(i, 1);
      }
    }
    return removed;
  }

  /** Registers a new voice, stealing the oldest one when the cap is reached. */
  admit(now: number, duration: number): VoiceAdmission {
    let stolen: number | null = null;
    if (this.voices.length >= this.maxVoices) {
      stolen = this.stealOldest();
    }
    const id = this.nextId;
    this.nextId += 1;
    this.voices.push({ id, startTime: now, endTime: now + duration });
    return { id, stolen };
  }

  /** Removes a voice that ended (or was stopped). Returns whether it was still registered. */
  release(id: number): boolean {
    const index = this.voices.findIndex((voice) => voice.id === id);
    if (index < 0) {
      return false;
    }
    this.voices.splice(index, 1);
    return true;
  }

  /** Ids of every registered voice, oldest first. */
  ids(): number[] {
    return this.voices.map((voice) => voice.id);
  }

  private stealOldest(): number | null {
    let oldestIndex = -1;
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i];
      const oldest = this.voices[oldestIndex];
      if (voice !== undefined && (oldest === undefined || voice.startTime < oldest.startTime)) {
        oldestIndex = i;
      }
    }
    const [removed] = this.voices.splice(oldestIndex, 1);
    return removed === undefined ? null : removed.id;
  }
}
