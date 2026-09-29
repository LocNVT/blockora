import * as THREE from 'three';
import type { AtlasLayout } from '../world/texture/atlasLayout';

/**
 * Builds the shared voxel texture atlas as a single THREE.DataTexture from
 * raw RGBA pixels (see generateAtlasPixels). Nearest filtering + no mipmaps
 * keeps the pixel-art tiles crisp; SRGBColorSpace matches how the painters'
 * colors are authored (perceptual/sRGB, not linear).
 *
 * Row-order note: `generateAtlasPixels`/`tileUvRect` treat pixel row 0 (and
 * v=1 in texture space) as the TOP of the atlas image, matching how a 2D
 * canvas or image file is normally read top-to-bottom. THREE.DataTexture's
 * default (flipY = false) uploads row 0 of the source array as the texture's
 * v=0 (bottom) instead, so it must be flipped here to keep pixels and UVs in
 * agreement.
 */
export function createVoxelAtlasTexture(layout: AtlasLayout, pixels: Uint8ClampedArray): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    pixels,
    layout.width,
    layout.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}
