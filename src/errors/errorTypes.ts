/** Where in the app lifecycle an error happened. */
export type ErrorPhase = 'renderer-init' | 'bootstrap' | 'frame' | 'runtime';

/** Thrown by createRenderer when neither WebGPU nor WebGL2 can be used. */
export class RendererUnavailableError extends Error {
  constructor(
    message = 'No supported graphics backend available: no WebGPU adapter and WebGL2 context creation failed.',
  ) {
    super(message);
    this.name = 'RendererUnavailableError';
  }
}

/** Thrown by createRenderer when a backend was available but renderer.init() failed. */
export class RendererInitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RendererInitError';
  }
}
