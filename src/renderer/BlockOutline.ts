import * as THREE from 'three';
import { RENDER_CONFIG } from '../config/constants';

const UNIT_SIZE = 1;

/**
 * Wireframe box highlighting the currently targeted block. Built once
 * (geometry + material) and reused every frame via `update`, so there is no
 * per-frame allocation — only a position write and a visibility toggle.
 * Kept separate from chunk meshes (own THREE.LineSegments object).
 */
export class BlockOutline {
  private readonly scene: THREE.Scene;
  private readonly lines: THREE.LineSegments;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const size = UNIT_SIZE + 2 * RENDER_CONFIG.blockOutlinePadding;
    const box = new THREE.BoxGeometry(size, size, size);
    this.geometry = new THREE.EdgesGeometry(box);
    box.dispose();

    this.material = new THREE.LineBasicMaterial({ color: RENDER_CONFIG.blockOutlineColor });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.visible = false;

    this.scene.add(this.lines);
  }

  /** Moves the outline onto block (x,y,z) and shows it, or hides it when `hit` is null. */
  update(hit: { readonly x: number; readonly y: number; readonly z: number } | null): void {
    if (hit === null) {
      this.lines.visible = false;
      return;
    }
    this.lines.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.lines.visible = true;
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
  }
}
