import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockOutline } from '../src/renderer/BlockOutline';

function outlineLines(scene: THREE.Scene): THREE.Object3D {
  const lines = scene.children.find((child) => child instanceof THREE.LineSegments);
  if (lines === undefined) {
    throw new Error('outline not in scene');
  }
  return lines;
}

describe('BlockOutline.precompile', () => {
  it('shows the outline while compiling, then restores it hidden', async () => {
    const scene = new THREE.Scene();
    const outline = new BlockOutline(scene);
    const lines = outlineLines(scene);
    let visibleDuringCompile = false;

    await outline.precompile(async () => {
      visibleDuringCompile = lines.visible;
    });

    expect(visibleDuringCompile).toBe(true);
    expect(lines.visible).toBe(false);
  });

  it('keeps a visible outline visible and restores visibility when compile rejects', async () => {
    const scene = new THREE.Scene();
    const outline = new BlockOutline(scene);
    const lines = outlineLines(scene);
    outline.update({ x: 1, y: 2, z: 3 });

    await expect(outline.precompile(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(lines.visible).toBe(true);

    outline.update(null);
    await expect(outline.precompile(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(lines.visible).toBe(false);
  });
});
