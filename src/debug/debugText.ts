import type { PerfSnapshot } from './PerfStats';

/** Draw / memory counters read from three's `renderer.info`. */
export interface RendererStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
}

/**
 * Structural subset of `renderer.info`. three r186's `WebGPURenderer` exposes
 * the same `Info` object for the WebGPU and the WebGL2 (`forceWebGL`)
 * backends: per-frame `render.drawCalls` / `render.triangles` (reset by the
 * animation loop *before* the frame callback, so read them after
 * `renderer.render()`), and live `memory.geometries` / `memory.textures`.
 * The classic `WebGLRenderer` shape (`render.calls` = draw calls) is accepted
 * as a fallback.
 */
export interface RendererInfoLike {
  readonly render: { readonly drawCalls?: number; readonly calls?: number; readonly triangles?: number };
  readonly memory: { readonly geometries?: number; readonly textures?: number };
}

export function readRendererStats(info: RendererInfoLike): RendererStats {
  return {
    drawCalls: info.render.drawCalls ?? info.render.calls ?? 0,
    triangles: info.render.triangles ?? 0,
    geometries: info.memory.geometries ?? 0,
    textures: info.memory.textures ?? 0,
  };
}

const BYTES_PER_MB = 1024 * 1024;

/** Chrome-only `performance.memory`; null where unavailable. */
export function readJsHeapMb(
  perf: unknown = typeof performance === 'undefined' ? undefined : performance,
): number | null {
  const memory = (perf as { memory?: { usedJSHeapSize?: unknown } } | undefined)?.memory;
  const used = memory?.usedJSHeapSize;
  return typeof used === 'number' && Number.isFinite(used) ? used / BYTES_PER_MB : null;
}

/** Everything the overlay shows. */
export interface DebugSnapshot {
  readonly backend: string;
  readonly perf: PerfSnapshot;
  readonly renderer: RendererStats;
  readonly jsHeapMb: number | null;
  readonly chunksLoaded: number;
  readonly mobCount: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly chunk: { readonly cx: number; readonly cz: number };
  readonly renderDistance: number;
}

const NA = 'n/a';

function fixed(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? NA : value.toFixed(digits);
}

/** Integer with thousands separators (locale-independent so output is deterministic). */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) {
    return NA;
  }
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function backendLabel(backend: string): string {
  if (backend === 'webgpu') return 'WebGPU';
  if (backend === 'webgl2') return 'WebGL2';
  return backend;
}

/** Pure formatter: the overlay's lines, top to bottom. */
export function formatDebugLines(s: DebugSnapshot): string[] {
  const p = s.perf;
  const heap = s.jsHeapMb === null ? NA : `${fixed(s.jsHeapMb, 1)} MB`;
  return [
    `Blockora  [${backendLabel(s.backend)}]`,
    `FPS ${fixed(p.fps, 1)}`,
    `Frame ms  avg ${fixed(p.frameAvgMs, 1)}  p95 ${fixed(p.frameP95Ms, 1)}  max ${fixed(p.frameMaxMs, 1)}`,
    `Draw calls ${formatInt(s.renderer.drawCalls)}`,
    `Triangles ${formatInt(s.renderer.triangles)}`,
    `Geometries ${formatInt(s.renderer.geometries)}  Textures ${formatInt(s.renderer.textures)}`,
    `JS heap ${heap}`,
    `Chunks loaded ${formatInt(s.chunksLoaded)}  gen ${formatInt(p.chunksGeneratedPerSec)}/s  mesh ${formatInt(p.meshesRebuiltPerSec)}/s`,
    `Chunk ms  gen ${fixed(p.chunkGenAvgMs, 2)}  light ${fixed(p.lightAvgMs, 2)}  mesh ${fixed(p.meshAvgMs, 2)}`,
    `Mobs ${formatInt(s.mobCount)}`,
    `Pos ${fixed(s.position.x, 1)} ${fixed(s.position.y, 1)} ${fixed(s.position.z, 1)}  chunk (${s.chunk.cx}, ${s.chunk.cz})`,
    `Render distance ${s.renderDistance} chunks`,
  ];
}
