import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { asset } from "../asset";
import type { TimeOfDay } from "./sky";

/**
 * CC0 Poly Haven panoramas used as ambient light probes, one per time of day
 * (see scripts/pack-hdri.py). Their sun discs are clamped because the scene's
 * directional light already carries the sun; the probes add real sky and
 * ground bounce. `azimuth` is where each panorama's sun sits, so the probe can
 * be turned to agree with the procedural sky.
 */
const PROBES: Record<
  TimeOfDay,
  { file: string; azimuth: number; intensity: number }
> = {
  day: { file: "env/day.hdr", azimuth: 0.629, intensity: 1 },
  sunset: { file: "env/sunset.hdr", azimuth: 0.629, intensity: 1 },
  night: { file: "env/night.hdr", azimuth: 0.623, intensity: 1 },
};

const cache = new Map<TimeOfDay, Promise<THREE.DataTexture>>();
/** Loads once per page; renderers convert it to a PMREM on their own. */
export function loadProbe(mode: TimeOfDay) {
  let probe = cache.get(mode);
  if (!probe) {
    probe = new HDRLoader().loadAsync(asset(PROBES[mode].file)).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    probe.catch(() => cache.delete(mode));
    cache.set(mode, probe);
  }
  return probe;
}

/** Turns the probe so its sun lines up with the sky's sun direction. */
export function probeRotation(mode: TimeOfDay, sunDir: THREE.Vector3) {
  return PROBES[mode].azimuth - Math.atan2(sunDir.z, sunDir.x);
}

export const probeIntensity = (mode: TimeOfDay) => PROBES[mode].intensity;
