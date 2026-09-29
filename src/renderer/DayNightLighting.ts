import * as THREE from 'three';
import { DAY_NIGHT_CONFIG } from '../config/constants';
import { daylightFactor, skyColor, sunAngle, type DayNightConfig } from '../world/GameTime';
import type { SceneWithLights } from './scene';

/**
 * Drives the scene's sky/fog color, hemisphere/directional light intensities,
 * and sun direction from `timeOfDay`, reusing `THREE.Color`/`Vector3`
 * instances so `apply()` allocates nothing per frame.
 */
export class DayNightLighting {
  private readonly scene: THREE.Scene;
  private readonly hemisphereLight: THREE.HemisphereLight;
  private readonly directionalLight: THREE.DirectionalLight;
  private readonly config: DayNightConfig;

  private readonly skyColorScratch = new THREE.Color();
  private readonly sunPositionScratch = new THREE.Vector3();

  constructor(sceneWithLights: SceneWithLights, config: DayNightConfig = DAY_NIGHT_CONFIG) {
    this.scene = sceneWithLights.scene;
    this.hemisphereLight = sceneWithLights.hemisphereLight;
    this.directionalLight = sceneWithLights.directionalLight;
    this.config = config;
  }

  /**
   * Applies lighting for `timeOfDay` (fraction of the day/night cycle, see
   * `GameTime.timeOfDay`). `followPosition` (defaults to the origin) is the
   * point the sun's orbit is centered on, so shadow-free directional lighting
   * stays visually stable near the player without needing a shadow camera to
   * track them.
   */
  apply(timeOfDay: number, followPosition?: { x: number; y: number; z: number }): void {
    const { config } = this;

    const rgb = skyColor(timeOfDay, config);
    this.skyColorScratch.setRGB(rgb.r, rgb.g, rgb.b);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.skyColorScratch);
    } else {
      this.scene.background = this.skyColorScratch.clone();
    }
    if (this.scene.fog !== null) {
      this.scene.fog.color.copy(this.skyColorScratch);
    }

    const daylight = daylightFactor(timeOfDay, config);
    this.directionalLight.intensity = lerp(config.sunIntensityNight, config.sunIntensityDay, daylight);
    this.hemisphereLight.intensity = lerp(
      config.ambientIntensityNight,
      config.ambientIntensityDay,
      daylight,
    );

    const angle = sunAngle(timeOfDay, config);
    const originX = followPosition?.x ?? 0;
    const originY = followPosition?.y ?? 0;
    const originZ = followPosition?.z ?? 0;
    // Arc the sun overhead on the X/Y plane (rises +X, peaks +Y, sets -X),
    // matching sunAngle's 0=rise/PI=set/2*PI=wrap convention.
    this.sunPositionScratch.set(
      originX + Math.cos(angle) * config.sunOrbitRadius,
      originY + Math.sin(angle) * config.sunOrbitRadius,
      originZ,
    );
    this.directionalLight.position.copy(this.sunPositionScratch);
    this.directionalLight.target.position.set(originX, originY, originZ);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
