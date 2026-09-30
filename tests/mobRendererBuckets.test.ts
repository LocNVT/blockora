import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MobRenderer, createPartMesh, createShadedBoxGeometry } from '../src/renderer/MobRenderer';
import { LIGHT_RENDER_CONFIG } from '../src/config/constants';
import { ChunkStore } from '../src/world/ChunkStore';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType } from '../src/entities/mobDefinitions';

function instancedMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
}

describe('mob part buckets keep an instance-colour attribute from creation', () => {
  it('createPartMesh allocates a white instanceColor sized to the capacity', () => {
    const mesh = createPartMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 8);
    expect(mesh.instanceColor).not.toBeNull();
    expect(mesh.instanceColor?.count).toBe(8);
    expect(Array.from(mesh.instanceColor?.array ?? [])).toEqual(new Array(24).fill(1));
    expect(mesh.count).toBe(0);
  });

  it('every bucket has instanceColor after the first update with zero mobs (before any setColorAt)', () => {
    const scene = new THREE.Scene();
    const renderer = new MobRenderer(scene, new ChunkStore());
    renderer.update([], 0.016);
    const meshes = instancedMeshes(scene);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.instanceColor).not.toBeNull();
    }
    renderer.dispose();
  });

  it('grown buckets also have instanceColor at the new capacity', () => {
    const scene = new THREE.Scene();
    const renderer = new MobRenderer(scene, new ChunkStore());
    renderer.update([], 0.016);
    const entities = new EntityStore();
    for (let i = 0; i < 20; i += 1) {
      entities.spawn(MobType.Cow, { x: i, y: 10, z: 0 });
      entities.spawn(MobType.Chicken, { x: i, y: 10, z: 3 });
      entities.spawn(MobType.Pig, { x: i, y: 10, z: 6 });
    }
    renderer.update(entities.all(), 0.016);
    let grown = 0;
    for (const mesh of instancedMeshes(scene)) {
      expect(mesh.instanceColor).not.toBeNull();
      expect(mesh.instanceColor?.count).toBe(mesh.instanceMatrix.count);
      if (mesh.instanceMatrix.count > 8) grown += 1;
    }
    expect(grown).toBeGreaterThan(0);
    renderer.dispose();
  });
});

// Mobs are lit like chunks (unlit material + baked face shade), so they don't
// pick up the blue hemisphere sky light on top of the voxel-light brightness.
describe('mob part shading', () => {
  it('bakes the chunk face shade into vertex colours by face direction', () => {
    const geometry = createShadedBoxGeometry({ x: 1, y: 1, z: 1 });
    const normals = geometry.getAttribute('normal');
    const colors = geometry.getAttribute('color');
    const seen = new Set<number>();
    for (let i = 0; i < normals.count; i += 1) {
      const ny = normals.getY(i);
      const nx = normals.getX(i);
      const expected =
        ny > 0.5
          ? LIGHT_RENDER_CONFIG.faceShadeTop
          : ny < -0.5
            ? LIGHT_RENDER_CONFIG.faceShadeBottom
            : Math.abs(nx) > 0.5
              ? LIGHT_RENDER_CONFIG.faceShadeSideX
              : LIGHT_RENDER_CONFIG.faceShadeSideZ;
      expect(colors.getX(i)).toBeCloseTo(expected);
      expect(colors.getY(i)).toBeCloseTo(expected);
      expect(colors.getZ(i)).toBeCloseTo(expected);
      seen.add(expected);
    }
    expect(seen.size).toBe(4);
  });

  it('uses one shared unlit material with vertex colours', () => {
    const scene = new THREE.Scene();
    const renderer = new MobRenderer(scene, new ChunkStore());
    const store = new EntityStore();
    store.spawn(MobType.Cow, { x: 0, y: 10, z: 0 });
    renderer.update(store.all(), 1 / 60);
    const materials = new Set(
      scene.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh).map((m) => m.material),
    );
    expect(materials.size).toBe(1);
    const [material] = [...materials];
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
  });
});
