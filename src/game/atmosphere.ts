import * as THREE from 'three/webgpu';
import type { Atmosphere, PointLightDef } from '../levels';
import { clampPointLights, hexToInt } from '../levels';

export interface SceneLights {
  fill: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  overheadGroup: THREE.Group;
}

export function createLights(atmo: Atmosphere, placed: PointLightDef[] = []): SceneLights {
  const fill = new THREE.AmbientLight(hexToInt(atmo.ambient.color), atmo.ambient.intensity);
  const hemi = new THREE.HemisphereLight(
    hexToInt(atmo.hemisphere.sky),
    hexToInt(atmo.hemisphere.ground),
    atmo.hemisphere.intensity
  );
  const overheadGroup = new THREE.Group();
  overheadGroup.name = 'overhead-lights';
  const lights: SceneLights = { fill, hemi, overheadGroup };
  syncPlacedLights(lights, placed);
  return lights;
}

export function addLightsToScene(scene: THREE.Scene, lights: SceneLights) {
  scene.add(lights.fill, lights.hemi, lights.overheadGroup);
}

/** 近、亮、衰减快：地面上是一汪一汪的斑。数量按手机预算裁过。 */
export function syncPlacedLights(lights: SceneLights, placed: PointLightDef[]) {
  lights.overheadGroup.clear();
  for (const def of clampPointLights(placed)) {
    const p = new THREE.PointLight(hexToInt(def.color), Math.max(0, def.intensity), Math.max(1.2, def.distance), 2);
    p.castShadow = false;
    p.position.set(def.x, def.y, def.z);
    lights.overheadGroup.add(p);
  }
}

export function applyAtmosphere(
  scene: THREE.Scene,
  renderer: { toneMappingExposure: number },
  lights: SceneLights,
  atmo: Atmosphere,
  placed: PointLightDef[] = []
) {
  scene.background = new THREE.Color(hexToInt(atmo.background));
  scene.fog = new THREE.Fog(hexToInt(atmo.fogColor), atmo.fogNear, atmo.fogFar);
  renderer.toneMappingExposure = atmo.exposure;

  lights.fill.color.setHex(hexToInt(atmo.ambient.color));
  lights.fill.intensity = atmo.ambient.intensity;

  lights.hemi.color.setHex(hexToInt(atmo.hemisphere.sky));
  lights.hemi.groundColor.setHex(hexToInt(atmo.hemisphere.ground));
  lights.hemi.intensity = atmo.hemisphere.intensity;

  syncPlacedLights(lights, placed);
}
