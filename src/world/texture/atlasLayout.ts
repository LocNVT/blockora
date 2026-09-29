import { ATLAS_CONFIG } from '../../config/constants';

/**
 * Geometry of the texture atlas image: a grid of equally sized square tiles.
 * Row 0 is the TOP of the atlas image; `tileUvRect` accounts for this so
 * texture-space v=0 is the image's bottom (see its doc comment).
 */
export interface AtlasLayout {
  readonly tileSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
}

/** Builds an AtlasLayout that fits `tileCount` tiles using ATLAS_CONFIG's tile size/columns. */
export function createAtlasLayout(tileCount: number, config = ATLAS_CONFIG): AtlasLayout {
  if (tileCount <= 0) {
    throw new Error('createAtlasLayout: tileCount must be positive.');
  }
  const { tileSize, columns } = config;
  const rows = Math.ceil(tileCount / columns);
  return {
    tileSize,
    columns,
    rows,
    width: columns * tileSize,
    height: rows * tileSize,
  };
}

export interface UvRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/**
 * Texture-space UV rect for `tileIndex`, in the [0,1]^2 convention where v=0
 * is the BOTTOM of the atlas image and v=1 is the top (standard OpenGL/Three
 * texture-space). Tile index 0 is the top-left tile of the source image
 * (row 0, column 0), so it maps to the highest v range. A half-texel-relative
 * inset (`ATLAS_CONFIG.uvInset`, as a fraction of one tile) is applied on all
 * four edges to avoid neighbouring-tile bleeding under bilinear sampling.
 */
export function tileUvRect(layout: AtlasLayout, tileIndex: number, config = ATLAS_CONFIG): UvRect {
  const { columns, rows } = layout;
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= columns * rows) {
    throw new Error(`tileUvRect: tile index ${tileIndex} out of range for a ${columns}x${rows} atlas.`);
  }

  const col = tileIndex % columns;
  const row = Math.floor(tileIndex / columns);

  const tileWidthU = 1 / columns;
  const tileHeightV = 1 / rows;
  const inset = config.uvInset;

  const u0 = col * tileWidthU;
  const u1 = u0 + tileWidthU;

  // Row 0 is the top of the image; image top = v=1 in texture space.
  const vTop = 1 - row * tileHeightV;
  const vBottom = vTop - tileHeightV;

  return {
    u0: u0 + inset * tileWidthU,
    v0: vBottom + inset * tileHeightV,
    u1: u1 - inset * tileWidthU,
    v1: vTop - inset * tileHeightV,
  };
}

/**
 * Maps a unit quad's local UV (localU, localV in [0,1], v increasing upward)
 * into `tileIndex`'s inset rect within the atlas. For a future greedy-meshed
 * quad, localU/localV may exceed [0,1]; callers wanting tiling would need to
 * `fract()` them first (not implemented here — see applyAtlasUvs doc).
 */
export function mapToAtlasUv(
  localU: number,
  localV: number,
  tileIndex: number,
  layout: AtlasLayout,
  config = ATLAS_CONFIG,
): readonly [number, number] {
  const rect = tileUvRect(layout, tileIndex, config);
  const u = rect.u0 + localU * (rect.u1 - rect.u0);
  const v = rect.v0 + localV * (rect.v1 - rect.v0);
  return [u, v];
}
