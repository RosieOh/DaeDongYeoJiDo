import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { asset } from "../asset";
import { Cloth, Strand, rim, silkTexture, std } from "./character";
import type { AirState, Capsule, Traveler } from "./character";

/**
 * The hero is the CC0 VRoid "Base Male" sample dressed as a wandering
 * swordsman, animated with the CC0 Quaternius Universal Animation Library.
 * The library's clips are retargeted onto the VRM skeleton once at load;
 * 경공 techniques blend procedural poses over them, and cloth, hair and
 * afterimages are simulated as before.
 *
 * Space conventions: poses are written for a figure facing +z with its left
 * hand at +x ("canonical"). The VRM model faces -z, so canonical vectors map
 * to the model by (x, y, z) → (-x, y, -z).
 */

/** VRM humanoid bone → the matching rigify bone in the animation library. */
const SOURCE: Record<string, string> = {
  hips: "DEF-hips",
  spine: "DEF-spine.001",
  chest: "DEF-spine.002",
  upperChest: "DEF-spine.003",
  neck: "DEF-neck",
  head: "DEF-head",
};
for (const [side, s] of [
  ["left", "L"],
  ["right", "R"],
]) {
  Object.assign(SOURCE, {
    [`${side}Shoulder`]: `DEF-shoulder.${s}`,
    [`${side}UpperArm`]: `DEF-upper_arm.${s}`,
    [`${side}LowerArm`]: `DEF-forearm.${s}`,
    [`${side}Hand`]: `DEF-hand.${s}`,
    [`${side}UpperLeg`]: `DEF-thigh.${s}`,
    [`${side}LowerLeg`]: `DEF-shin.${s}`,
    [`${side}Foot`]: `DEF-foot.${s}`,
    [`${side}Toes`]: `DEF-toe.${s}`,
  });
  for (const [finger, rig] of [
    ["Thumb", "thumb"],
    ["Index", "f_index"],
    ["Middle", "f_middle"],
    ["Ring", "f_ring"],
    ["Little", "f_pinky"],
  ])
    ["Proximal", "Intermediate", "Distal"].forEach(
      (joint, i) =>
        (SOURCE[`${side}${finger}${joint}`] = `DEF-${rig}.0${i + 1}.${s}`),
    );
}

const CLIPS = {
  idle: "Idle_Loop",
  walk: "Walk_Loop",
  jog: "Jog_Fwd_Loop",
  sprint: "Sprint_Loop",
  fall: "Jump_Loop",
  jumpStart: "Jump_Start",
  land: "Jump_Land",
  roll: "Roll",
} as const;
type ClipName = keyof typeof CLIPS;
const GAITS = ["walk", "jog", "sprint"] as const;
type Gait = (typeof GAITS)[number];

export type HeroAssets = {
  template: THREE.Object3D;
  /** VRM humanoid bone → node name in the template. */
  bones: Record<string, string>;
  clips: Record<ClipName, THREE.AnimationClip>;
  /** Ground speed each gait clip covers (m/s) and its left-foot-forward phase. */
  gaits: Record<Gait, { speed: number; offset: number }>;
  /** Morph target index of the blink expression on the face meshes. */
  blink: number;
};

const model = (x: number, y: number, z: number) => new THREE.Vector3(-x, y, -z);
const _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(),
  _v = new THREE.Vector3();

/**
 * Samples every library clip on its own skeleton and rewrites it for the VRM
 * skeleton: each bone's world rotation relative to the library's T-pose is
 * applied to the VRM's T-pose (both rigs share that rest pose), facing is
 * flipped, and the hips' travel is scaled by leg length with drift removed.
 */
function retarget(
  source: THREE.Object3D,
  sourceClips: THREE.AnimationClip[],
  target: THREE.Object3D,
  bones: Record<string, string>,
) {
  const find = (root: THREE.Object3D, name: string) =>
    root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  const pairs = Object.keys(SOURCE)
    .map((human) => ({
      human,
      from: find(source, SOURCE[human]),
      to: bones[human] ? target.getObjectByName(bones[human]) : undefined,
    }))
    .filter(
      (p): p is { human: string; from: THREE.Object3D; to: THREE.Object3D } =>
        !!p.from && !!p.to,
    );
  const depth = (o: THREE.Object3D) => {
    let d = 0;
    for (let p = o.parent; p; p = p.parent) d++;
    return d;
  };
  pairs.sort((a, b) => depth(a.to) - depth(b.to));
  const clip = (name: string) => {
    const c = sourceClips.find((c) => c.name === name);
    if (!c) throw new Error(`Missing animation ${name}`);
    return c;
  };
  const mixer = new THREE.AnimationMixer(source);
  const pose = (c: THREE.AnimationClip, t: number) => {
    mixer.stopAllAction();
    mixer.clipAction(c).play();
    mixer.setTime(t);
    source.updateMatrixWorld(true);
  };
  const hips = pairs.find((p) => p.human === "hips")!;
  const leftFoot = find(source, SOURCE.leftFoot)!;
  const leftArm = pairs.find((p) => p.human === "leftUpperArm")!;

  target.updateMatrixWorld(true);
  const restLocal = new Map(
    pairs.map((p) => [
      p.to,
      { q: p.to.quaternion.clone(), p: p.to.position.clone() },
    ]),
  );
  const restTarget = new Map(
    pairs.map((p) => [
      p.human,
      p.to.getWorldQuaternion(new THREE.Quaternion()),
    ]),
  );
  const targetHips = hips.to.getWorldPosition(new THREE.Vector3());
  const targetLeft = leftArm.to.getWorldPosition(new THREE.Vector3()).x;

  pose(clip("A_TPose"), 0);
  const restSource = new Map(
    pairs.map((p) => [
      p.human,
      p.from.getWorldQuaternion(new THREE.Quaternion()).invert(),
    ]),
  );
  const sourceHips = hips.from.getWorldPosition(new THREE.Vector3());
  const sourceLeft = leftArm.from.getWorldPosition(new THREE.Vector3()).x;
  // Turn the library's motion around when the two rigs face opposite ways.
  const facing =
    Math.sign(sourceLeft) === Math.sign(targetLeft)
      ? new THREE.Quaternion()
      : new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.PI,
        );
  const facingInverse = facing.clone().invert();
  const scale = targetHips.y / sourceHips.y;

  const clips = {} as Record<ClipName, THREE.AnimationClip>;
  const gaits = {} as HeroAssets["gaits"];
  for (const [key, name] of Object.entries(CLIPS) as [ClipName, string][]) {
    const c = clip(name);
    const frames = Math.max(2, Math.round(c.duration * 30) + 1);
    const times = new Float32Array(frames);
    const rotations = pairs.map(() => new Float32Array(frames * 4));
    const offsets = new Float32Array(frames * 3);
    const foot: { y: number; z: number }[] = [];
    for (let f = 0; f < frames; f++) {
      const t = (c.duration * f) / (frames - 1);
      times[f] = t;
      pose(c, t);
      pairs.forEach((p, i) => {
        // Δ = W_source(t) · W_source(rest)⁻¹, carried into the VRM's frame.
        p.from.getWorldQuaternion(_q).multiply(restSource.get(p.human)!);
        _q.premultiply(facing).multiply(facingInverse);
        _q.multiply(restTarget.get(p.human)!);
        p.to.parent!.getWorldQuaternion(_q2).invert();
        p.to.quaternion.copy(_q2.multiply(_q));
        p.to.quaternion.toArray(rotations[i], f * 4);
      });
      hips.from
        .getWorldPosition(_v)
        .sub(sourceHips)
        .applyQuaternion(facing)
        .multiplyScalar(scale);
      _v.toArray(offsets, f * 3);
      const { y, z } = leftFoot.getWorldPosition(new THREE.Vector3());
      foot.push({ y, z });
    }
    // Clips that wander (rolls, jumps) are pinned in place: the engine moves the hero.
    const last = (frames - 1) * 3;
    const driftX = offsets[last] - offsets[0],
      driftZ = offsets[last + 2] - offsets[2];
    const positions = new Float32Array(frames * 3);
    const rest = restLocal.get(hips.to)!.p;
    for (let f = 0; f < frames; f++) {
      const k = f / (frames - 1);
      positions[f * 3] = rest.x + offsets[f * 3] - driftX * k;
      positions[f * 3 + 1] = rest.y + offsets[f * 3 + 1];
      positions[f * 3 + 2] = rest.z + offsets[f * 3 + 2] - driftZ * k;
    }
    const tracks: THREE.KeyframeTrack[] = pairs.map(
      (p, i) =>
        new THREE.QuaternionKeyframeTrack(
          `${p.to.name}.quaternion`,
          times,
          rotations[i],
        ),
    );
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${hips.to.name}.position`,
        times,
        positions,
      ),
    );
    clips[key] = new THREE.AnimationClip(key, c.duration, tracks);
    if ((GAITS as readonly string[]).includes(key)) {
      // A planted foot slides back at the speed the clip would travel.
      const low = Math.min(...foot.map((f) => f.y));
      const slides: number[] = [];
      let forward = 0;
      for (let f = 1; f < frames; f++) {
        if (foot[f].z > foot[forward].z) forward = f;
        if (foot[f].y < low + 0.08 && foot[f - 1].y < low + 0.08)
          slides.push(
            ((foot[f - 1].z - foot[f].z) * scale) / (times[f] - times[f - 1]),
          );
      }
      slides.sort((a, b) => a - b);
      gaits[key as Gait] = {
        speed: Math.max(0.5, slides[Math.floor(slides.length * 0.75)] ?? 1),
        offset: forward / (frames - 1),
      };
    }
  }
  mixer.stopAllAction();
  for (const [bone, rest] of restLocal) {
    bone.quaternion.copy(rest.q);
    bone.position.copy(rest.p);
  }
  return { clips, gaits };
}

/** Swaps the VRM's unlit toon materials for lit silk, skin and lacquered hair. */
async function dress(scene: THREE.Object3D, parser: GLTFParser) {
  const json = parser.json;
  const normals = new Map<string, THREE.Texture>();
  for (const def of json.materials ?? []) {
    const index = def.normalTexture?.index;
    if (index == null) continue;
    const image = json.images?.[json.textures[index].source];
    if (!image || /None/.test(image.name ?? "")) continue;
    normals.set(def.name, await parser.getDependency("texture", index));
  }
  const restyle = (m: THREE.MeshBasicMaterial): THREE.Material | null => {
    const n = m.name,
      normalMap = normals.get(n) ?? null;
    const base = {
      map: m.map,
      alphaTest: m.alphaTest,
      transparent: m.transparent,
      depthWrite: m.depthWrite,
      side: m.side,
    };
    if (n.includes("Tie")) return null;
    if (n.includes("Shoes"))
      return matte("#ffffff", { ...base, roughness: 0.48 });
    if (n.endsWith("_CLOTH"))
      return fabric("#e4e2dc", {
        ...base,
        normalMap,
        transparent: false,
        depthWrite: true,
      });
    if (n.endsWith("_HAIR"))
      return std("#ffffff", {
        map: m.map,
        normalMap,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.34,
      });
    if (n.endsWith("_SKIN"))
      return matte("#eadfd8", { ...base, normalMap, roughness: 0.62 });
    if (n.includes("EyeHighlight"))
      return new THREE.MeshBasicMaterial({ ...base, color: "#ffffff" });
    if (/Brow|Eyelash|Eyeline/.test(n))
      return new THREE.MeshStandardMaterial({
        ...base,
        color: "#140f0d",
        roughness: 0.7,
      });
    return new THREE.MeshStandardMaterial({
      ...base,
      color: m.color,
      roughness: 0.35,
    });
  };
  const made = new Map<THREE.Material, THREE.Material | null>();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshBasicMaterial;
    if (!made.has(m)) made.set(m, restyle(m));
    const next = made.get(m);
    // Skinned bounds follow the rest pose, so never cull the hero.
    o.frustumCulled = false;
    if (!next) {
      o.visible = false;
      return;
    }
    o.material = next;
    const overlay = /_(FACE|EYE)$/.test(m.name);
    o.castShadow = !overlay;
    o.receiveShadow = !overlay && !m.name.includes("Face_00");
  });
}

/**
 * Matte silk for the hero: a soft sheen and only a faint rim, so a white robe
 * in full sun stays below the bloom threshold instead of glowing.
 */
const fabric = (color: string, o: THREE.MeshPhysicalMaterialParameters = {}) =>
  rim(
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.66,
      sheen: 0.7,
      sheenColor: new THREE.Color("#dfe7ef"),
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
      ...o,
    }),
    0.12,
  );
const matte = (color: string, o: THREE.MeshStandardMaterialParameters = {}) =>
  rim(new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o }), 0.1);

let library: Promise<HeroAssets> | null = null;
/** Loads and retargets once per page; every journey clones the result. */
export function loadHero() {
  library ??= (async () => {
    const loader = new GLTFLoader();
    const [hero, moves] = await Promise.all([
      loader.loadAsync(asset("models/hero.glb")),
      loader.loadAsync(asset("models/moves.glb")),
    ]);
    const vrm = hero.parser.json.extensions?.VRM;
    if (!vrm) throw new Error("hero.glb has no VRM humanoid");
    const bones: Record<string, string> = {};
    for (const { bone, node } of vrm.humanoid.humanBones as {
      bone: string;
      node: number;
    }[])
      bones[bone] = THREE.PropertyBinding.sanitizeNodeName(
        hero.parser.json.nodes[node].name,
      );
    await dress(hero.scene, hero.parser);
    const { clips, gaits } = retarget(
      moves.scene,
      moves.animations,
      hero.scene,
      bones,
    );
    const blink =
      (
        vrm.blendShapeMaster?.blendShapeGroups as
          { presetName: string; binds: { index: number }[] }[] | undefined
      )?.find((g) => g.presetName === "blink")?.binds[0]?.index ?? -1;
    return { template: hero.scene, bones, clips, gaits, blink };
  })();
  library.catch(() => (library = null));
  return library;
}

/* --------------------------------- poses --------------------------------- */

type Dir = [number, number, number];
type PoseSpec = {
  /** Canonical Euler angles (x pitches forward). */
  hips?: Dir;
  spine?: Dir;
  chest?: Dir;
  upperChest?: Dir;
  neck?: Dir;
  head?: Dir;
  /** Canonical directions for [upper, lower] limb segments. */
  leftArm?: [Dir, Dir];
  rightArm?: [Dir, Dir];
  leftLeg?: [Dir, Dir];
  rightLeg?: [Dir, Dir];
};
type Pose = Map<string, THREE.Quaternion>;
const mirror = ([x, y, z]: Dir): Dir => [-x, y, z];
const arms = (upper: Dir, lower: Dir) => ({
  leftArm: [upper, lower] as [Dir, Dir],
  rightArm: [mirror(upper), mirror(lower)] as [Dir, Dir],
});

/** Technique poses own the whole torso; partial ones (the lantern) only their limbs. */
function pose(spec: PoseSpec, partial = false): Pose {
  const out: Pose = new Map();
  for (const key of [
    "hips",
    "spine",
    "chest",
    "upperChest",
    "neck",
    "head",
  ] as const) {
    const e =
      spec[key] ?? (partial || key === "hips" ? undefined : ([0, 0, 0] as Dir));
    if (e)
      out.set(
        key,
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-e[0], e[1], -e[2]),
        ),
      );
  }
  const limb = (a: string, b: string, rest: Dir, dirs?: [Dir, Dir]) => {
    if (!dirs) return;
    const r = model(...rest),
      upper = new THREE.Quaternion().setFromUnitVectors(
        r,
        model(...dirs[0]).normalize(),
      ),
      lower = new THREE.Quaternion().setFromUnitVectors(
        r,
        model(...dirs[1]).normalize(),
      );
    out.set(a, upper);
    out.set(b, upper.clone().invert().multiply(lower));
  };
  // Arms are aimed from a level shoulder, whatever shrug the clip carries.
  if (spec.leftArm) out.set("leftShoulder", new THREE.Quaternion());
  if (spec.rightArm) out.set("rightShoulder", new THREE.Quaternion());
  limb("leftUpperArm", "leftLowerArm", [1, 0, 0], spec.leftArm);
  limb("rightUpperArm", "rightLowerArm", [-1, 0, 0], spec.rightArm);
  limb("leftUpperLeg", "leftLowerLeg", [0, -1, 0], spec.leftLeg);
  limb("rightUpperLeg", "rightLowerLeg", [0, -1, 0], spec.rightLeg);
  return out;
}

const POSES = {
  /** 활공: leaning into the wind, sleeves spread back like wings. */
  glide: pose({
    hips: [0.95, 0, 0],
    spine: [-0.12, 0, 0],
    chest: [-0.12, 0, 0],
    neck: [-0.35, 0, 0],
    head: [-0.25, 0, 0],
    ...arms([1, -0.35, -0.3], [1, -0.2, -0.45]),
    leftLeg: [
      [0.05, -1, -0.1],
      [0.03, -1, -0.6],
    ],
    rightLeg: [
      [-0.05, -1, 0.15],
      [-0.03, -1, -0.12],
    ],
  }),
  /** 비연: a flat swallow-dive with the arms swept behind. */
  dash: pose({
    hips: [1.2, 0, 0],
    spine: [0.05, 0, 0],
    neck: [-0.65, 0, 0],
    head: [-0.2, 0, 0],
    // Swept back along the body, which lies almost flat.
    ...arms([0.32, -0.95, -0.12], [0.2, -0.95, -0.2]),
    leftLeg: [
      [0.05, -1, 0.2],
      [0.05, -1, -0.4],
    ],
    rightLeg: [
      [-0.05, -1, -0.25],
      [-0.05, -1, -0.2],
    ],
  }),
  /** 제운종: spiralling up, one arm thrust skyward, one knee drawn high. */
  soar: pose({
    hips: [-0.05, 0, 0],
    spine: [0.12, 0, 0],
    chest: [0.1, 0, 0],
    neck: [-0.1, 0, 0],
    leftArm: [
      [1, -0.25, -0.2],
      [0.75, -0.6, 0.3],
    ],
    rightArm: [
      [-0.12, 1, 0.15],
      [-0.05, 1, 0.2],
    ],
    leftLeg: [
      [0.08, -0.2, 1],
      [0.05, -1, 0.15],
    ],
    rightLeg: [
      [-0.05, -0.85, 0.45],
      [-0.05, -0.5, -0.85],
    ],
  }),
  /** 천근추: dropping like a stone, legs locked, arms flung up. */
  plunge: pose({
    spine: [-0.08, 0, 0],
    neck: [0.35, 0, 0],
    ...arms([0.8, 0.6, 0], [0.55, 0.83, 0]),
    leftLeg: [
      [0.03, -1, 0.04],
      [0, -1, 0],
    ],
    rightLeg: [
      [-0.03, -1, 0.04],
      [0, -1, 0],
    ],
  }),
  /** Somersault tuck: knees to the chest, arms wrapped round the shins. */
  tuck: pose({
    spine: [0.3, 0, 0],
    chest: [0.2, 0, 0],
    neck: [0.3, 0, 0],
    ...arms([0.3, -0.45, 0.85], [-0.35, -0.55, 0.75]),
    leftLeg: [
      [0.1, -0.05, 1],
      [0.05, -1, -0.5],
    ],
    rightLeg: [
      [-0.1, -0.05, 1],
      [-0.05, -1, -0.5],
    ],
  }),
  /** Holding a lantern out in front at night. */
  lantern: pose(
    {
      rightArm: [
        [-0.2, -0.9, 0.4],
        [-0.1, -0.15, 1],
      ],
    },
    true,
  ),
};

/* ------------------------------- the hero -------------------------------- */

type Ghost = {
  root: THREE.Group;
  bones: THREE.Object3D[];
  material: THREE.MeshBasicMaterial;
  life: number;
};

export function createHero(assets: HeroAssets, ghostCount = 6): Traveler {
  const group = new THREE.Group();
  // Spins and corkscrews turn this pivot; flips turn the hips bone.
  const body = new THREE.Group();
  group.add(body);
  const figure = cloneRig(assets.template);
  body.add(figure);
  const bone = (human: string) => {
    const b = figure.getObjectByName(assets.bones[human]);
    if (!b) throw new Error(`Hero is missing ${human}`);
    return b;
  };
  const B = Object.fromEntries(
    [
      "hips",
      "spine",
      "chest",
      "upperChest",
      "neck",
      "head",
      "leftUpperArm",
      "rightUpperArm",
      "leftLowerArm",
      "rightLowerArm",
      "leftHand",
      "rightHand",
      "leftUpperLeg",
      "rightUpperLeg",
      "leftLowerLeg",
      "rightLowerLeg",
      "leftFoot",
      "rightFoot",
    ].map((h) => [h, bone(h)]),
  ) as Record<string, THREE.Object3D>;
  const poseBones = new Map<string, THREE.Object3D>();
  for (const p of Object.values(POSES))
    for (const human of p.keys()) poseBones.set(human, bone(human));

  /** An empty attached to a bone at a canonical offset from its joint. */
  const at = (b: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.copy(model(x, y, z));
    b.add(o);
    return o;
  };
  const mesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.copy(model(x, y, z));
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const robeCloth = fabric("#e4e2dc", { map: silkTexture(true) }),
    robe = fabric("#e4e2dc", { map: silkTexture(false) }),
    gauze = fabric("#cfe0ee", {
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      roughness: 0.4,
      sheenColor: new THREE.Color("#ffffff"),
    }),
    trim = std("#2a3a58", { roughness: 0.6, side: THREE.DoubleSide }),
    hairMat = std("#0e0f13", { roughness: 0.38, side: THREE.DoubleSide }),
    dark = std("#16171c", { roughness: 0.45 }),
    silver = std("#d2d5db", { metalness: 0.85, roughness: 0.28 }),
    gold = std("#c9a45c", { metalness: 0.7, roughness: 0.35 }),
    jade = std("#5fa38a", { roughness: 0.2 }),
    ribbon = std("#9fc1dc", { side: THREE.DoubleSide, roughness: 0.6 }),
    tassel = std("#b8392d", { side: THREE.DoubleSide, roughness: 0.6 }),
    grip = std("#3a2a22");

  // Sash belt with a jade plaque, worn at the natural waist.
  const belt = mesh(
    new THREE.CylinderGeometry(0.138, 0.146, 0.075, 28, 1, true),
    trim,
    B.spine,
    0,
    -0.05,
    0.02,
  );
  belt.scale.z = 0.78;
  mesh(
    new THREE.BoxGeometry(0.07, 0.055, 0.02),
    silver,
    B.spine,
    0,
    -0.05,
    0.135,
  );
  mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.012, 12),
    jade,
    B.spine,
    0,
    -0.05,
    0.146,
  ).rotation.x = Math.PI / 2;
  const sashAnchor = at(B.spine, 0.08, -0.08, 0.14);
  const pendantAnchor = at(B.spine, -0.1, -0.08, 0.13);

  // Wide silk sleeves over the short-sleeved shirt, flaring at the cuff.
  const sleeve = (side: 1 | -1) => {
    const upper = B[side > 0 ? "leftUpperArm" : "rightUpperArm"],
      lower = B[side > 0 ? "leftLowerArm" : "rightLowerArm"];
    const tube = (r0: number, r1: number, from: number, to: number) => {
      const g = new THREE.CylinderGeometry(r1, r0, to - from, 18, 1, true);
      // Lay the tube along the canonical arm axis (+x left, -x right).
      g.rotateZ((-side * Math.PI) / 2);
      g.translate((side * (from + to)) / 2, 0, 0);
      g.scale(-1, 1, -1); // canonical → model
      return g;
    };
    const top = new THREE.Mesh(tube(0.066, 0.074, 0.02, 0.235), robe);
    const cuff = new THREE.Mesh(tube(0.074, 0.125, -0.01, 0.215), robe);
    for (const m of [top, cuff]) m.castShadow = m.receiveShadow = true;
    upper.add(top);
    lower.add(cuff);
    const band = new THREE.Mesh(tube(0.123, 0.127, 0.185, 0.215), trim);
    band.castShadow = true;
    lower.add(band);
    // The long hanging back of the sleeve, pinned round the cuff's rear half.
    const flap = new Cloth(
      [125, 155, 180, 205, 235].map((deg) => {
        const t = (deg * Math.PI) / 180;
        return {
          obj: lower,
          offset: model(side * 0.2, Math.sin(t) * 0.12, Math.cos(t) * 0.12),
        };
      }),
      7,
      0.44,
      1.3,
      model(side * 0.5, -0.6, -0.6).normalize(),
      robeCloth,
      "#2a3a58",
    );
    return flap;
  };
  const flaps = [sleeve(1), sleeve(-1)];

  // Topknot under a silver crown, held by a gold pin.
  const crown = mesh(
    new THREE.CylinderGeometry(0.034, 0.044, 0.05, 14),
    silver,
    B.head,
    0,
    0.2,
    -0.04,
  );
  crown.rotation.x = 0.35;
  mesh(
    new THREE.SphereGeometry(0.036, 12, 10),
    hairMat,
    B.head,
    0,
    0.225,
    -0.05,
  );
  mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.17, 6),
    gold,
    B.head,
    0,
    0.21,
    -0.04,
  ).rotation.z = Math.PI / 2;
  const tail = at(B.head, 0, 0.2, -0.08);
  const nape = [-0.05, 0, 0.05].map((x) => at(B.head, x, 0.06, -0.1));

  // Sword slung across the back with a red tassel.
  const sword = new THREE.Group();
  sword.position.copy(model(0, 0.06, -0.15));
  sword.rotation.set(-0.12, 0, -0.62);
  B.upperChest.add(sword);
  const swordPart = (g: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const p = new THREE.Mesh(g, m);
    p.position.y = y;
    p.castShadow = true;
    sword.add(p);
  };
  swordPart(new THREE.CylinderGeometry(0.024, 0.02, 0.86, 8), dark, -0.1);
  swordPart(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), grip, 0.44);
  swordPart(new THREE.BoxGeometry(0.11, 0.022, 0.04), gold, 0.32);
  for (const y of [-0.5, 0.1])
    swordPart(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 8), silver, y);
  const pommel = new THREE.Object3D();
  pommel.position.y = 0.56;
  sword.add(pommel);

  // Night lantern carried in the right hand; kept upright every frame.
  const lantern = new THREE.Group();
  const shadeMat = new THREE.MeshStandardMaterial({
    color: "#f3c47a",
    emissive: "#ffb054",
    emissiveIntensity: 1.4,
  });
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4),
    dark,
  );
  rod.position.y = -0.1;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 0.15, 10),
    shadeMat,
  );
  shade.position.y = -0.27;
  shade.castShadow = true;
  const light = new THREE.PointLight("#ffb766", 2.6, 13, 1.7);
  light.position.y = -0.27;
  lantern.add(rod, shade, light);
  lantern.position.copy(model(-0.08, 0, 0.02));
  B.rightHand.add(lantern);
  lantern.visible = false;

  // Robe tails split at the sides, front and back, like a long 도포.
  const deg = Math.PI / 180;
  const panel = (from: number, to: number) => {
    const pins = [];
    for (let c = 0; c < 4; c++) {
      const a = from + ((to - from) * c) / 3;
      pins.push({
        obj: B.hips,
        offset: model(Math.sin(a) * 0.168, 0.055, 0.015 + Math.cos(a) * 0.13),
      });
    }
    const mid = (from + to) / 2;
    return new Cloth(
      pins,
      9,
      0.92,
      1.55,
      model(Math.sin(mid) * 0.18, -1, Math.cos(mid) * 0.18).normalize(),
      robeCloth,
      "#2a3a58",
    );
  };
  const tails = [
    panel(-82 * deg, -6 * deg),
    panel(6 * deg, 82 * deg),
    panel(98 * deg, 174 * deg),
    panel(-174 * deg, -98 * deg),
  ];
  // Sheer outer robe (披紗) falling from the shoulders behind the back.
  const veil = (from: number, to: number) => {
    const pins = [];
    for (let c = 0; c < 5; c++) {
      const a = from + ((to - from) * c) / 4;
      pins.push({
        obj: B.upperChest,
        offset: model(Math.sin(a) * 0.205, 0.13, 0.008 + Math.cos(a) * 0.1),
      });
    }
    return new Cloth(
      pins,
      11,
      1.3,
      1.5,
      model(0, -1, -0.3).normalize(),
      gauze,
      "#ffffff",
    );
  };
  const veils = [veil(125 * deg, 180 * deg), veil(180 * deg, 235 * deg)];

  const down = (x: number, z: number) => model(x, -1, z).normalize();
  const strands = [
    new Strand(tail, 12, 1.0, 0.085, 0.016, hairMat, 0.05, down(0, -0.35)),
    new Strand(tail, 10, 0.82, 0.06, 0.012, hairMat, 0.07, down(0.1, -0.25)),
    new Strand(tail, 9, 0.74, 0.05, 0.01, hairMat, 0.07, down(-0.1, -0.25)),
    ...nape.map(
      (n, i) =>
        new Strand(
          n,
          8,
          0.52 + i * 0.04,
          0.04,
          0.012,
          hairMat,
          0.1,
          down((i - 1) * 0.1, -0.3),
        ),
    ),
    new Strand(tail, 8, 0.72, 0.016, 0.012, ribbon),
    new Strand(sashAnchor, 9, 0.8, 0.03, 0.026, ribbon),
    new Strand(sashAnchor, 8, 0.62, 0.024, 0.02, ribbon),
    new Strand(pommel, 6, 0.3, 0.016, 0.034, tassel),
    new Strand(pendantAnchor, 5, 0.22, 0.008, 0.026, tassel),
  ];
  const HEAD_STRANDS = 6;
  const cloths = [...tails, ...flaps, ...veils];
  const capsule = (r: number): Capsule => ({
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    r,
  });
  const colliders = [
    capsule(0.15),
    capsule(0.095),
    capsule(0.075),
    capsule(0.095),
    capsule(0.075),
  ];
  const headColliders = [capsule(0.13), colliders[0]];
  const headCenter = at(B.head, 0, 0.08, 0.01);
  const updateColliders = () => {
    B.hips.getWorldPosition(colliders[0].a);
    B.neck.getWorldPosition(colliders[0].b);
    B.leftUpperLeg.getWorldPosition(colliders[1].a);
    B.leftLowerLeg.getWorldPosition(colliders[1].b);
    colliders[2].a.copy(colliders[1].b);
    B.leftFoot.getWorldPosition(colliders[2].b);
    B.rightUpperLeg.getWorldPosition(colliders[3].a);
    B.rightLowerLeg.getWorldPosition(colliders[3].b);
    colliders[4].a.copy(colliders[3].b);
    B.rightFoot.getWorldPosition(colliders[4].b);
    headCenter.getWorldPosition(headColliders[0].a);
    headColliders[0].b.copy(headColliders[0].a);
  };

  // 잔상: translucent copies of the figure that hold a pose and fade away.
  const bonesOf = (root: THREE.Object3D) => {
    const list: THREE.Object3D[] = [];
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) list.push(o);
    });
    return list;
  };
  const figureBones = bonesOf(figure);
  const ghosts: Ghost[] = Array.from({ length: ghostCount }, () => {
    const copy = cloneRig(figure);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#9fe3d8").multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    copy.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = material;
        o.castShadow = o.receiveShadow = false;
      }
      if (o instanceof THREE.Light) o.visible = false;
    });
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.add(copy);
    root.visible = false;
    return { root, bones: bonesOf(copy), material, life: 0 };
  });
  let ghostClock = 0,
    ghostNext = 0;
  const spawnGhost = () => {
    if (!ghosts.length) return;
    const g = ghosts[ghostNext++ % ghosts.length];
    g.root.matrix.copy(body.matrixWorld);
    figureBones.forEach((o, i) => {
      const n = g.bones[i];
      if (!n) return;
      n.position.copy(o.position);
      n.quaternion.copy(o.quaternion);
    });
    g.life = 1;
    g.root.visible = true;
    g.root.updateMatrixWorld(true);
  };

  // Animation: the gait clips share one phase so blends never scissor the legs.
  const mixer = new THREE.AnimationMixer(figure);
  const actions = Object.fromEntries(
    (Object.keys(CLIPS) as ClipName[]).map((k) => {
      const a = mixer.clipAction(assets.clips[k]);
      a.setEffectiveWeight(0);
      a.play();
      return [k, a];
    }),
  ) as Record<ClipName, THREE.AnimationAction>;
  for (const k of GAITS) actions[k].timeScale = 0;
  for (const k of ["jumpStart", "land", "roll"] as const) {
    actions[k].setLoop(THREE.LoopOnce, 1);
    actions[k].clampWhenFinished = true;
  }
  const faces: number[][] = [];
  figure.traverse((o) => {
    const m = o as THREE.Mesh;
    if (
      assets.blink >= 0 &&
      m.morphTargetInfluences &&
      m.morphTargetInfluences.length > assets.blink
    )
      faces.push(m.morphTargetInfluences);
  });

  let added = false,
    time = 0,
    air = 0,
    glide = 0,
    flip = 0,
    flipKind = 0,
    lastFlips = 0,
    spin = 0,
    bank = 0,
    phase = 0,
    velocity = 0,
    wasGrounded = true,
    blinkIn = 2,
    blinkT = 0;
  let shot: { action: THREE.AnimationAction; from: number } | null = null;
  // Dev tooling: hold the figure in a technique's pose for inspection.
  let forced: Partial<AirState> | null = null;
  if (import.meta.env.DEV)
    (window as unknown as { __hero?: unknown }).__hero = {
      force: (s: Partial<AirState> | null) => (forced = s),
      probe: () =>
        Object.fromEntries(
          Object.entries(B).map(([k, b]) => [
            k,
            b
              .getWorldPosition(new THREE.Vector3())
              .sub(group.position)
              .toArray()
              .map((v) => +v.toFixed(2)),
          ]),
        ),
    };
  const w = { dash: 0, soar: 0, wall: 0, plunge: 0 };
  const right = new THREE.Vector3(),
    back = new THREE.Vector3();
  const tilt = new THREE.Quaternion(),
    euler = new THREE.Euler(),
    upright = new THREE.Quaternion();
  const sim = () => {
    group.updateMatrixWorld(true);
    updateColliders();
  };
  const play = (name: "jumpStart" | "land" | "roll", from = 0) => {
    const a = actions[name];
    a.reset();
    a.time = from * a.getClip().duration;
    shot = { action: a, from: a.time };
  };
  const apply = (p: Pose, weight: number) => {
    if (weight < 0.002) return;
    for (const [human, q] of p)
      poseBones.get(human)!.quaternion.slerp(q, Math.min(1, weight));
  };
  // Gaits blend at the engine's walk, run and sprint speeds; each clip then
  // plays near its natural cadence (a little foot slide beats moon-walking).
  const marks = [0, 1.2, 3.8, 7.4];
  const rate = (g: Gait, v: number) =>
    THREE.MathUtils.clamp(v / assets.gaits[g].speed, 0.75, 1.4) /
    assets.clips[g].duration;
  const gaitWeights = (v: number) => {
    const out = [0, 0, 0, 0];
    if (v >= marks[3]) out[3] = 1;
    else
      for (let i = 0; i < 3; i++)
        if (v <= marks[i + 1]) {
          const t = (v - marks[i]) / Math.max(1e-3, marks[i + 1] - marks[i]);
          out[i] = 1 - t;
          out[i + 1] = t;
          break;
        }
    return out;
  };

  return {
    group,
    attach(scene: THREE.Object3D) {
      if (added) return;
      added = true;
      for (const s of strands) scene.add(s.mesh);
      for (const c of cloths) scene.add(c.mesh);
      for (const g of ghosts) scene.add(g.root);
      this.reset();
    },
    reset() {
      mixer.update(0);
      sim();
      strands.forEach((s) => s.reset());
      cloths.forEach((c) => c.reset());
    },
    setLantern(on: boolean) {
      lantern.visible = on;
    },
    /** World positions for trails: hands, feet and the head. */
    anchors() {
      return {
        left: B.leftHand.getWorldPosition(new THREE.Vector3()),
        right: B.rightHand.getWorldPosition(new THREE.Vector3()),
        leftFoot: B.leftFoot.getWorldPosition(new THREE.Vector3()),
        rightFoot: B.rightFoot.getWorldPosition(new THREE.Vector3()),
        head: headCenter.getWorldPosition(new THREE.Vector3()),
      };
    },
    /** speed: 0 idle, 1 at 3.8 m/s; state comes from the 경공 motion. */
    update(dt: number, speed: number, state?: AirState) {
      if (forced)
        state = {
          ...(state ?? {
            grounded: true,
            vy: 0,
            gliding: false,
            flips: 0,
            landed: 0,
          }),
          ...forced,
        };
      time += dt;
      const ease = (rate: number) => 1 - Math.exp(-dt * rate);
      const mode = state?.mode ?? "ground";
      const grounded = state?.grounded ?? true;
      const wall = mode === "wall";
      air += ((grounded || wall ? 0 : 1) - air) * ease(10);
      glide += ((state?.gliding ? 1 : 0) - glide) * ease(6);
      for (const key of Object.keys(w) as (keyof typeof w)[])
        w[key] += ((mode === key ? 1 : 0) - w[key]) * ease(12);
      bank += ((state?.bank ?? 0) * (glide + w.dash * 0.5) - bank) * ease(5);

      // One-shot clips: take-off, landing and the shoulder roll.
      if (state) {
        if (state.flips !== lastFlips) {
          lastFlips = state.flips;
          flip = 1;
          // The second jump is a forward somersault; the third a corkscrew.
          flipKind = (state.jumps ?? 0) >= 3 ? 1 : 0;
        }
        if (!grounded && wasGrounded && !wall && state.vy > 2)
          play("jumpStart", 0.3);
        const impact = Math.max(state.landed ?? 0, state.plunged ?? 0);
        if (impact > 7)
          play(
            impact > 13 &&
              (state.speed ?? 0) > 4 &&
              mode !== "plunge" &&
              !state.plunged
              ? "roll"
              : "land",
            0.08,
          );
      }
      wasGrounded = grounded;
      let shotWeight = 0;
      if (shot) {
        const a = shot.action;
        // Landings are cut short once the hero is on the move again.
        const duration =
          a.getClip().duration *
          (a === actions.land
            ? velocity > 1
              ? 0.5
              : 0.8
            : a === actions.roll
              ? 0.85
              : 1);
        const cancel =
          (a === actions.jumpStart && (grounded || mode !== "air")) ||
          (a !== actions.jumpStart && !grounded && !wall);
        shotWeight = Math.min(
          1,
          (a.time - shot.from) / 0.06 + 0.05,
          (duration - a.time) / 0.18,
        );
        if (cancel || a.time >= duration - 1e-3) {
          a.setEffectiveWeight(0);
          shot = null;
          shotWeight = 0;
        }
      }
      flip = Math.max(0, flip - dt / (flipKind ? 0.6 : 0.5));
      if (mode === "soar")
        spin += dt * 16 * (1 - Math.min(1, (state?.modeTime ?? 0) / 0.9) * 0.6);
      else
        spin +=
          (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * ease(6);

      // Ground gait: idle → walk → jog → sprint by speed, wall runs at a sprint.
      const target = wall ? marks[3] : grounded ? speed * 3.8 : velocity;
      velocity += (target - velocity) * ease(8);
      const gw = gaitWeights(velocity);
      let cycles = 0,
        total = 0;
      GAITS.forEach((g, i) => {
        cycles += gw[i + 1] * rate(g, velocity);
        total += gw[i + 1];
      });
      phase =
        (phase + (total > 0 ? (cycles / total) * dt * (wall ? 1.4 : 1) : 0)) %
        1;
      const rest = 1 - shotWeight,
        ground = rest * (1 - air);
      actions.idle.setEffectiveWeight(gw[0] * ground);
      GAITS.forEach((g, i) => {
        const a = actions[g],
          duration = assets.clips[g].duration;
        a.setEffectiveWeight(gw[i + 1] * ground);
        a.time = ((phase + assets.gaits[g].offset) % 1) * duration;
      });
      actions.fall.setEffectiveWeight(rest * air);
      if (shot) shot.action.setEffectiveWeight(shotWeight);
      mixer.update(dt);

      // 경공 techniques pose the body over the clips.
      const free = 1 - Math.min(1, w.dash + w.soar + w.plunge);
      apply(POSES.glide, glide * free);
      apply(POSES.dash, w.dash);
      apply(POSES.soar, w.soar);
      apply(POSES.plunge, w.plunge);
      const flipAngle = flip > 0 ? (1 - Math.pow(flip, 1.4)) * Math.PI * 2 : 0;
      apply(POSES.tuck, flip > 0 ? Math.sin(Math.PI * (1 - flip)) * 1.2 : 0);
      if (lantern.visible) apply(POSES.lantern, (1 - air) * 0.9 * free);
      // Flips turn about the hips; banks roll into turns; wall runs lean out.
      euler.set(
        -(
          (flipKind ? 0.5 * Math.sin(flipAngle / 2) : flipAngle) -
          w.wall * 0.3
        ),
        0,
        bank,
      );
      B.hips.quaternion.premultiply(tilt.setFromEuler(euler));
      body.rotation.y = spin + (flipKind ? flipAngle : 0);

      // Blink every few seconds.
      blinkIn -= dt;
      if (blinkIn <= 0) {
        blinkIn = 2.5 + Math.random() * 3;
        blinkT = 0.16;
      }
      blinkT = Math.max(0, blinkT - dt);
      const lid = blinkT > 0 ? Math.sin(Math.PI * (1 - blinkT / 0.16)) : 0;
      for (const f of faces) f[assets.blink] = lid;

      sim();
      if (lantern.visible) {
        // Hang the lantern plumb whatever the hand is doing.
        B.rightHand.getWorldQuaternion(upright).invert();
        lantern.quaternion.copy(upright.multiply(group.getWorldQuaternion(_q)));
        lantern.rotation.x +=
          Math.sin(time * 5) * 0.08 * Math.min(1, velocity / 3);
        lantern.updateMatrixWorld(true);
      }
      // Afterimages trail the fast techniques.
      ghostClock -= dt;
      const fast =
        mode === "dash" ||
        mode === "soar" ||
        mode === "plunge" ||
        (mode === "glide" && (state?.speed ?? 0) > 9);
      if (fast && ghostClock <= 0 && !forced) {
        ghostClock = mode === "glide" ? 0.12 : 0.045;
        spawnGhost();
      }
      for (const g of ghosts) {
        if (!g.root.visible) continue;
        g.life -= dt / 0.4;
        g.material.opacity = Math.max(0, g.life) * 0.32;
        if (g.life <= 0) g.root.visible = false;
      }
      right.set(1, 0, 0).applyQuaternion(group.quaternion);
      back.set(0, 0, 1).applyQuaternion(group.quaternion);
      const step = Math.min(dt, 1 / 30);
      for (const cloth of cloths) cloth.update(step, colliders, time);
      strands.forEach((strand, i) =>
        strand.update(
          step,
          right,
          back,
          time,
          i < HEAD_STRANDS ? headColliders : colliders,
        ),
      );
    },
  };
}
