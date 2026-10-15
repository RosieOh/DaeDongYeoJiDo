import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as LibreMap } from "maplibre-gl";
import type { Place } from "../data";
import { bake, disposeObject, landmark } from "./landmarks";

export function createLandmarkLayer(
  getPlaces: () => Place[],
  getSelected: () => string | undefined,
): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer, map: LibreMap;
  const camera = new THREE.Camera(),
    scene = new THREE.Scene();
  const objects = new Map<string, THREE.Group>();
  const hemisphere = new THREE.HemisphereLight("#fff5dc", "#6a8971", 2.5);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#fff0cb", 3);
  sun.position.set(-1, 3, 2);
  scene.add(sun);
  const origin = MercatorCoordinate.fromLngLat([127.7, 36]);
  const unit = origin.meterInMercatorCoordinateUnits();
  // Keep the Mercator reflection in the camera transform, so Three's normal
  // and front-face calculations remain in a conventional Y-up local world.
  const localToMercator = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, 0)
    .multiply(new THREE.Matrix4().makeScale(unit, -unit, unit))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  let signature = "";
  return {
    id: "landmark-models",
    type: "custom",
    renderingMode: "3d",
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGL2RenderingContext,
        antialias: true,
      });
      renderer.autoClear = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    },
    render(_gl, args) {
      const places = getPlaces(),
        next = places.map((p) => p.id).join(",");
      if (next !== signature) {
        objects.forEach((g) => {
          scene.remove(g);
          disposeObject(g);
        });
        objects.clear();
        places.forEach((p) => {
          const model = bake(landmark(p));
          model.matrixAutoUpdate = false;
          objects.set(p.id, model);
          scene.add(model);
        });
        signature = next;
      }
      for (const p of places) {
        const model = objects.get(p.id)!;
        const elevation = map.queryTerrainElevation(p.coordinates) || 0;
        const point = MercatorCoordinate.fromLngLat(
          p.coordinates,
          elevation + 2,
        );
        const metersPerPixel =
          (40075016.686 * Math.cos((p.coordinates[1] * Math.PI) / 180)) /
          (512 * 2 ** map.getZoom());
        const scale = metersPerPixel * (getSelected() === p.id ? 10 : 8);
        model.matrix
          .makeTranslation(
            (point.x - origin.x) / unit,
            point.z / unit,
            (point.y - origin.y) / unit,
          )
          .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
          .multiply(new THREE.Matrix4().makeRotationY(0.25));
      }
      camera.projectionMatrix
        .fromArray(args.defaultProjectionData.mainMatrix)
        .multiply(localToMercator);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      disposeObject(scene);
      renderer?.dispose();
      objects.clear();
    },
  };
}
