import * as THREE from 'three';
import { RENDER_CONFIG } from '../config/constants';
import { computeFogRange } from './backend';

export interface SceneWithLights {
  scene: THREE.Scene;
  /** The distance fog instance (also `scene.fog` while fog is enabled). */
  fog: THREE.Fog;
  hemisphereLight: THREE.HemisphereLight;
  directionalLight: THREE.DirectionalLight;
}

/**
 * Creates the base scene: sky-colored background, distance fog matching the
 * render distance, and simple hemisphere + directional lighting. Returns the
 * lights (and scene) so callers (e.g. day/night lighting) can drive their
 * colors/intensities/direction over time without re-querying the scene graph.
 */
export function createScene(): SceneWithLights {
  const scene = new THREE.Scene();

  scene.background = new THREE.Color(RENDER_CONFIG.skyColor);

  const { near, far } = computeFogRange();
  const fog = new THREE.Fog(RENDER_CONFIG.skyColor, near, far);
  scene.fog = fog;

  const hemisphereLight = new THREE.HemisphereLight(
    RENDER_CONFIG.hemisphereSkyColor,
    RENDER_CONFIG.hemisphereGroundColor,
    RENDER_CONFIG.hemisphereIntensity
  );
  scene.add(hemisphereLight);

  const directionalLight = new THREE.DirectionalLight(
    RENDER_CONFIG.directionalLightColor,
    RENDER_CONFIG.directionalLightIntensity
  );
  directionalLight.position.set(...RENDER_CONFIG.directionalLightPosition);
  scene.add(directionalLight);
  // The light's target must be in the scene graph for its world matrix
  // (and therefore the light's direction) to update; day/night lighting
  // repositions this target to follow the player each frame.
  scene.add(directionalLight.target);

  return { scene, fog, hemisphereLight, directionalLight };
}
