import { WebGPURenderer } from 'three/webgpu';
import { chooseBackend, type RendererBackend } from './backend';

/** Narrow local view of the WebGPU navigator API (no @webgpu/types dependency). */
interface GPUNavigator {
  gpu: {
    requestAdapter: () => Promise<unknown | null>;
  };
}

function hasGpuNavigator(nav: Navigator): nav is Navigator & GPUNavigator {
  return 'gpu' in nav;
}

async function detectWebGPUAdapter(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !hasGpuNavigator(navigator)) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export interface CreatedRenderer {
  renderer: WebGPURenderer;
  backend: RendererBackend;
}

/**
 * Creates a renderer, preferring WebGPU and falling back to WebGL2.
 * Both paths return a WebGPURenderer instance (WebGL2 fallback uses
 * `forceWebGL: true`), so callers get one consistent renderer API and
 * node-compatible materials regardless of backend.
 */
export async function createRenderer(): Promise<CreatedRenderer> {
  const hasAdapter = await detectWebGPUAdapter();
  const backend = chooseBackend(hasAdapter);

  if (backend === 'webgl2' && !hasWebGL2()) {
    throw new Error(
      'No supported graphics backend available: WebGPU adapter not found and WebGL2 is unsupported.'
    );
  }

  const renderer = new WebGPURenderer({
    antialias: true,
    forceWebGL: backend === 'webgl2',
  });

  await renderer.init();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  return { renderer, backend };
}
