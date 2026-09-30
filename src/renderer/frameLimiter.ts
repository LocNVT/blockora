import { GRAPHICS_CONFIG } from '../config/constants';

/** Result of one animation callback: whether to render this frame and the simulation time it covers. */
export interface FrameStep {
  readonly render: boolean;
  /** Seconds since the previous *rendered* frame (sum of skipped frames' deltas); 0 when not rendering. */
  readonly dt: number;
}

/**
 * Frame-rate cap gate, fed the real elapsed seconds of every animation
 * callback. It keeps a time credit that grows by each delta and is charged one
 * cap interval per rendered frame, so the long-run rate equals the cap without
 * drift even when the display refresh does not divide it (e.g. 144 Hz / 60
 * fps). A credit of two or more intervals (tab in background, long stall)
 * is dropped instead of paid back, so there is no burst of catch-up frames.
 * cap 0 (unlimited) renders every callback.
 */
export class FrameLimiter {
  private credit = 0;
  private sinceRender = 0;

  constructor(private readonly toleranceSeconds: number = GRAPHICS_CONFIG.frameCapToleranceSeconds) {}

  step(deltaSeconds: number, capFps: number): FrameStep {
    const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    this.sinceRender += delta;
    if (!(capFps > 0)) {
      return this.emit(0);
    }
    const interval = 1 / capFps;
    this.credit += delta;
    if (this.credit + this.toleranceSeconds < interval) {
      return { render: false, dt: 0 };
    }
    const remaining = this.credit - interval;
    return this.emit(remaining >= interval ? 0 : remaining);
  }

  private emit(nextCredit: number): FrameStep {
    const dt = this.sinceRender;
    this.sinceRender = 0;
    this.credit = nextCredit;
    return { render: true, dt };
  }
}
