import * as THREE from "three";
import type { Place } from "../data";
import { nearestStop } from "./world";
import { createTraveler } from "./character";
import type { SurfaceLibrary } from "./textures";
import { buildGeoWorld } from "./GeoWorld";
import { pointInPolygon } from "./geo";
import { MAX_QI, Motion, SKILLS } from "./motion";
import type { MoveMode, SkillId } from "./motion";
import { Effects } from "./fx";
import type { GeoSceneData } from "./geo";
import type { Stop } from "./world";
import { disposeObject } from "./landmarks";
import { detectQuality, shared } from "./quality";
import type { QualitySettings } from "./quality";
import { PostPipeline } from "./post";
import type { AtmosphereState } from "./post";
import {
  applySkyPreset,
  bakeEnvironment,
  createSkyDome,
  createSkyMaterial,
  presets,
} from "./sky";
import type { TimeOfDay } from "./sky";
export type JourneyState = {
  x: number;
  z: number;
  y: number;
  airborne: boolean;
  mode: MoveMode;
  /** 기력, 0–1. */
  qi: number;
  /** Remaining cooldown of each technique, 0–1. */
  cooldowns: Record<SkillId, number>;
  /** Seconds spent in the air (경공 수련). */
  airTime: number;
  heading: number;
  distance: number;
  nearby: Stop | null;
};
/** Moments the HUD reacts to: technique names, log lines, failures. */
export type JourneyCue =
  { kind: "skill"; name: string } | { kind: "fail"; reason: "qi" | "cooldown" };
const SKILL_NAMES = {
  jump2: "이단도약",
  jump3: "삼단도약",
  dash: "비연",
  soar: "제운종",
  plunge: "천근추",
  wall: "벽호공",
  kick: "연환퇴",
};
export class JourneyEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 20000);
  readonly quality: QualitySettings = detectQuality();
  private post: PostPipeline;
  private skyMaterial = createSkyMaterial();
  private sky = createSkyDome(this.skyMaterial);
  private environment: THREE.WebGLRenderTarget | null = null;
  private timeOfDay: TimeOfDay = "day";
  private atmosphere: AtmosphereState = {
    ...presets.day,
    hazeBase: 0,
    mistBase: 0,
    shafts: 0,
  };
  private bufferSize = new THREE.Vector2();
  readonly world: ReturnType<typeof buildGeoWorld>;
  readonly traveler = createTraveler(this.quality.level === "high" ? 6 : 2);
  readonly motion: Motion;
  private fx = new Effects(this.quality.level === "high");
  private eyeY = 0;
  private shake = 0;
  private roll = 0;
  private extraDistance = 0;
  private lastHeading = 0;
  private bank = 0;
  private speedFx = 0;
  private overlay: HTMLElement | null = null;
  /** Dev tooling only: skip camera collision for wide establishing shots. */
  private freeCamera = false;
  private onCue: (cue: JourneyCue) => void = () => {};
  private fov = 50;
  private frameCount = 0;
  private slowTime = 0;
  private pixelRatio = 1;
  private resize: () => void = () => {};
  private keys = new Set<string>();
  private joystick = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = 0.32;
  private cameraDistance = 10;
  private position = { x: 0, z: 0 };
  private distance = 0;
  private elapsed = 0;
  private last = 0;
  private snapshotAt = 0;
  private running = false;
  private paused = false;
  private dragging = false;
  private previous = { x: 0, y: 0 };
  private resizeObserver: ResizeObserver;
  private onState: (state: JourneyState) => void;
  private onInteract: (stop: Stop) => void;
  private sun = new THREE.DirectionalLight("#fff5e5", 2.4);
  private targetCamera = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private cleanup: Array<() => void> = [];
  private reducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  constructor(
    private canvas: HTMLCanvasElement,
    place: Place,
    data: GeoSceneData,
    surfaces: SurfaceLibrary,
    onState: (state: JourneyState) => void,
    onInteract: (stop: Stop) => void,
  ) {
    this.onState = onState;
    this.onInteract = onInteract;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.pixelRatio = Math.min(
      window.devicePixelRatio,
      this.quality.pixelRatio,
    );
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    // Shadows update once per frame even though water renders a mirror pass.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.post = new PostPipeline(this.renderer, this.quality);
    this.world = buildGeoWorld(place, data, surfaces, this.quality);
    this.motion = new Motion(
      {
        data,
        heightAt: this.world.heightAt,
        surfaceAt: this.world.surfaceAt,
        waterAt: this.world.waterAt,
      },
      this.world.spawn.x,
      this.world.spawn.z,
    );
    this.eyeY = this.motion.y;
    this.position = { x: this.world.spawn.x, z: this.world.spawn.z };
    this.yaw = this.world.spawn.heading;
    this.scene.add(this.sky);
    const range = this.quality.shadowRange;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      this.quality.shadowMapSize,
      this.quality.shadowMapSize,
    );
    Object.assign(this.sun.shadow.camera, {
      left: -range,
      right: range,
      top: range,
      bottom: -range,
      near: 1,
      far: range * 4,
    });
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
    this.setTimeOfDay("day");
    this.scene.add(
      this.world.group,
      this.world.rings,
      this.traveler.group,
      this.fx.group,
    );
    this.traveler.group.position.set(
      this.position.x,
      this.world.heightAt(this.position.x, this.position.z),
      this.position.z,
    );
    this.traveler.group.rotation.y = this.yaw;
    this.traveler.attach(this.scene);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      this.renderer.setSize(width, height, false);
      this.renderer.getDrawingBufferSize(this.bufferSize);
      this.post.setSize(this.bufferSize.x, this.bufferSize.y);
      this.world.reflection?.setSize(this.bufferSize.x, this.bufferSize.y);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    };
    this.resize = resize;
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(canvas);
    resize();
    const listen = <K extends keyof WindowEventMap>(
      name: K,
      fn: (e: WindowEventMap[K]) => void,
    ) => {
      window.addEventListener(name, fn);
      this.cleanup.push(() => window.removeEventListener(name, fn));
    };
    listen("keydown", (e) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches("input,select,textarea") ||
          e.target.isContentEditable)
      )
        return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "ShiftLeft",
          "ShiftRight",
        ].includes(e.code)
      ) {
        e.preventDefault();
        this.keys.add(e.code);
      }
      if (e.code === "KeyE" && !e.repeat && !this.paused) this.interact();
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat && !this.paused) this.motion.jump();
      }
      if (e.repeat || this.paused) return;
      // A fresh Shift press in mid-air becomes a 비연 dash.
      if (
        (e.code === "ShiftLeft" || e.code === "ShiftRight") &&
        this.motion.airborne
      )
        this.dash();
      if (e.code === "KeyF" || e.code === "Digit1") this.dash();
      if (e.code === "KeyQ" || e.code === "Digit2") this.soar();
      if (e.code === "KeyC" || e.code === "Digit3") this.plunge();
    });
    listen("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Space") this.motion.release();
    });
    listen("blur", () => this.clearInput());
    const visibility = () => {
      if (document.hidden) {
        this.clearInput();
        this.renderer.setAnimationLoop(null);
      } else {
        this.last = performance.now();
        this.renderer.setAnimationLoop(this.frame);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    this.cleanup.push(() =>
      document.removeEventListener("visibilitychange", visibility),
    );
    const down = (e: PointerEvent) => {
      this.dragging = true;
      this.previous = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.focus({ preventScroll: true });
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.previous.x) * 0.005;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + (e.clientY - this.previous.y) * 0.003,
        0.13,
        1.1,
      );
      this.previous = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      this.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.cameraDistance = THREE.MathUtils.clamp(
        this.cameraDistance + e.deltaY * 0.008,
        3.5,
        22,
      );
    };
    const context = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("lostpointercapture", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", context);
    this.cleanup.push(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", context);
    });
    this.updateCamera(1);
    this.renderer.setAnimationLoop(this.frame);
    // Dev-only hook for automated visual checks (camera pose and teleport).
    if (import.meta.env.DEV)
      (window as unknown as { __journey?: unknown }).__journey = {
        pose: (yaw: number, pitch: number, distance: number) => {
          this.yaw = yaw;
          this.pitch = pitch;
          this.cameraDistance = distance;
          this.freeCamera = distance > 22;
        },
        teleport: (x: number, z: number) => {
          this.position = { x, z };
          this.motion.reset(x, z);
          this.eyeY = this.motion.y;
          this.traveler.reset();
        },
        stops: () => this.world.stops,
        setPieces: () => this.world.setPieces,
        scene: this.scene,
        renderer: this.renderer,
      };
  }
  private clearInput() {
    this.keys.clear();
    this.motion?.release();
    this.joystick = { x: 0, y: 0 };
    this.running = false;
    this.dragging = false;
  }
  setJoystick(x: number, y: number) {
    this.joystick = { x, y };
  }
  setCueListener(fn: (cue: JourneyCue) => void) {
    this.onCue = fn;
  }
  /** A DOM element (name plate) kept above the traveller's head. */
  setOverlay(el: HTMLElement | null) {
    this.overlay = el;
  }
  private facing() {
    const r = this.traveler.group.rotation.y;
    return { x: -Math.sin(r), z: -Math.cos(r) };
  }
  dash() {
    if (this.paused) return;
    const f = this.facing();
    this.motion.dash(f.x, f.z);
  }
  soar() {
    if (this.paused) return;
    const f = this.facing();
    this.motion.soar(f.x, f.z);
  }
  plunge() {
    if (!this.paused) this.motion.plunge();
  }
  /** 경공: press to jump (up to three times), hold to glide. */
  setJump(pressed: boolean) {
    if (pressed && !this.paused) this.motion.jump();
    else this.motion.release();
  }
  setRunning(value: boolean) {
    this.running = value;
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.clearInput();
  }
  setSunset(value: boolean) {
    this.setTimeOfDay(value ? "sunset" : "day");
  }
  setTimeOfDay(mode: TimeOfDay) {
    this.timeOfDay = mode;
    const p = presets[mode];
    Object.assign(this.atmosphere, p, {
      hazeBase: this.world.hazeBase,
      mistBase: this.world.mistBase,
      shafts: mode === "night" ? 0 : mode === "sunset" ? 0.55 : 0.32,
    });
    shared.sunDir.value.copy(p.sunDir);
    shared.sunColor.value.copy(p.sunColor);
    shared.night.value = p.night;
    this.sun.color.copy(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.traveler.setLantern(mode === "night");
    applySkyPreset(this.skyMaterial, p);
    this.environment = bakeEnvironment(
      this.renderer,
      this.skyMaterial,
      this.environment ?? undefined,
    );
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = p.envIntensity;
  }
  reset() {
    this.position = { x: this.world.spawn.x, z: this.world.spawn.z };
    this.yaw = this.world.spawn.heading;
    this.pitch = 0.3;
    this.clearInput();
    this.motion.reset(this.position.x, this.position.z);
    this.eyeY = this.motion.y;
    this.traveler.group.position.set(
      this.position.x,
      this.motion.y,
      this.position.z,
    );
    this.traveler.reset();
    this.updateCamera(1);
  }
  interact() {
    const stop = nearestStop(
      this.position.x,
      this.position.z,
      this.world.stops,
    );
    if (stop && !this.paused) this.onInteract(stop);
  }
  private updateCamera(alpha: number, dt = 0) {
    const ground = this.eyeY;
    const eye = ground + 1.4;
    const mode = this.motion.mode;
    // Pull back for big techniques so the whole flight stays in frame.
    const extra =
      mode === "soar" ? 7 : mode === "glide" ? 3 : mode === "dash" ? 2.5 : 0;
    this.extraDistance += (extra - this.extraDistance) * Math.min(1, dt * 2.5);
    let distance = this.cameraDistance + this.extraDistance;
    const full = distance;
    // Keep the follow camera in front of nearby building walls in narrow lanes.
    // Fine steps so thin village walls (0.5 m) are never skipped.
    for (let d = 1.2; d <= full; d += 0.3) {
      const x = this.position.x + Math.sin(this.yaw) * d * Math.cos(this.pitch);
      const z = this.position.z + Math.cos(this.yaw) * d * Math.cos(this.pitch);
      const y = eye + d * Math.sin(this.pitch);
      // Stop in front of walls, roofs and rising ground (river banks, ridges).
      if (this.freeCamera) break;
      if (
        y < this.world.heightAt(x, z) + 0.6 ||
        this.motion
          .buildingsAt(x, z)
          .some(
            (b) =>
              pointInPolygon(x, z, b) && y < this.world.surfaceAt(b, x, z) + 1,
          )
      ) {
        distance = Math.max(1.2, d - 0.45);
        break;
      }
    }
    const r = distance * Math.cos(this.pitch);
    this.targetCamera.set(
      this.position.x + Math.sin(this.yaw) * r,
      eye + distance * Math.sin(this.pitch),
      this.position.z + Math.cos(this.yaw) * r,
    );
    this.targetCamera.y = Math.max(
      this.targetCamera.y,
      this.world.heightAt(this.targetCamera.x, this.targetCamera.z) + 1,
    );
    this.camera.position.lerp(this.targetCamera, distance < full ? 1 : alpha);
    this.camera.position.y = Math.max(
      this.camera.position.y,
      this.world.heightAt(this.camera.position.x, this.camera.position.z) + 0.5,
    );
    this.lookAt.set(this.position.x, ground + 1.35, this.position.z);
    this.camera.lookAt(this.lookAt);
    // Bank into gliding turns and shake on heavy landings.
    this.roll += (this.bank * 0.35 - this.roll) * Math.min(1, dt * 4);
    this.camera.rotateZ(this.roll);
    if (this.shake > 0.001) {
      const t = this.elapsed * 60;
      this.camera.position.x += Math.sin(t * 1.3) * this.shake * 0.25;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * this.shake * 0.25;
      this.camera.rotateZ(Math.sin(t * 2.1) * this.shake * 0.02);
      this.shake *= Math.exp(-dt * 6);
    }
  }
  private frame = (now: number) => {
    const raw = (now - (this.last || now)) / 1000;
    const dt = Math.min(raw, 0.05);
    this.last = now;
    // Dynamic resolution: step the pixel ratio down while frames run long.
    if (raw > 0 && raw < 0.5) {
      this.slowTime =
        raw > 1 / 42
          ? this.slowTime + raw
          : Math.max(0, this.slowTime - raw * 0.5);
      if (this.slowTime > 2 && this.pixelRatio > 0.75) {
        this.slowTime = 0;
        this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.resize();
      }
    }
    if (!this.paused) {
      this.elapsed += dt;
      let forward =
        (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
        (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) +
        this.joystick.y;
      let right =
        (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
        (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0) +
        this.joystick.x;
      const norm = Math.hypot(forward, right);
      if (norm > 1) {
        forward /= norm;
        right /= norm;
      }
      const m = this.motion;
      const sprint =
        this.running ||
        this.keys.has("ShiftLeft") ||
        this.keys.has("ShiftRight");
      // Gliding carries the traveller forward even without input.
      const speed = m.gliding ? (sprint ? 12 : 9.5) : sprint ? 7.4 : 3.8;
      let dx =
        (Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) *
        speed *
        dt;
      let dz =
        (Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right) *
        speed *
        dt;
      if (m.gliding && norm < 0.1) {
        const r = this.traveler.group.rotation.y;
        dx = -Math.sin(r) * speed * dt;
        dz = -Math.cos(r) * speed * dt;
      }
      const before = { x: m.x, z: m.z };
      const face =
        norm > 0.1
          ? { x: dx / Math.hypot(dx, dz), z: dz / Math.hypot(dx, dz) }
          : this.facing();
      m.update(dt, { dx, dz, fx: face.x, fz: face.z, sprint });
      const next = { x: m.x, z: m.z };
      const traveled = Math.hypot(next.x - before.x, next.z - before.z);
      this.distance += traveled;
      this.position = next;
      this.traveler.group.position.set(next.x, m.y, next.z);
      // The camera eases vertically so jumps feel airy rather than jerky.
      this.eyeY +=
        (m.y - this.eyeY) *
        (1 - Math.exp(-dt * (m.grounded ? 10 : m.mode === "soar" ? 6 : 4)));
      const events = m.consume();
      const feet = new THREE.Vector3(next.x, m.y, next.z);
      const facing = this.facing();
      const dir = new THREE.Vector3(facing.x, 0, facing.z);
      const cue = (name: string) => this.onCue({ kind: "skill", name });
      if (events.jumped) {
        this.fx.jump(feet, events.jumped);
        if (events.jumped > 1)
          cue(events.jumped === 3 ? SKILL_NAMES.jump3 : SKILL_NAMES.jump2);
      }
      if (events.dashed) {
        this.fx.dash(feet, dir);
        this.fov += 9;
        cue(SKILL_NAMES.dash);
      }
      if (events.soared) {
        this.fx.soar(feet);
        this.shake = Math.max(this.shake, 0.5);
        cue(SKILL_NAMES.soar);
      }
      if (events.wall) {
        this.fx.wall(feet);
        cue(SKILL_NAMES.wall);
      }
      if (events.kicked) {
        this.fx.wall(feet);
        cue(SKILL_NAMES.kick);
      }
      if (events.plunged) {
        this.fx.shockwave(feet, events.plunged, m.onWater);
        this.shake = Math.max(
          this.shake,
          0.6 + Math.min(1, events.plunged / 20),
        );
        cue(SKILL_NAMES.plunge);
      } else if (events.landed) {
        this.fx.land(feet, events.landed, m.onWater);
        if (events.landed > 16) this.shake = Math.max(this.shake, 0.25);
      }
      if (events.failed) this.onCue({ kind: "fail", reason: events.failed });
      // Bank from the rate of turn while flying.
      const heading = this.traveler.group.rotation.y;
      const turn = Math.atan2(
        Math.sin(heading - this.lastHeading),
        Math.cos(heading - this.lastHeading),
      );
      this.lastHeading = heading;
      this.bank +=
        (THREE.MathUtils.clamp((turn / Math.max(dt, 1e-3)) * 0.22, -0.7, 0.7) -
          this.bank) *
        Math.min(1, dt * 4);
      const horizontal = traveled / Math.max(dt, 1e-3);
      this.speedFx +=
        (THREE.MathUtils.clamp(
          (horizontal - 8) / 14 + (m.mode === "soar" ? 0.6 : 0),
          0,
          1,
        ) -
          this.speedFx) *
        Math.min(1, dt * 6);
      const anchors = this.traveler.anchors();
      this.fx.update(dt, {
        player: feet,
        anchors,
        mode: m.mode,
        airborne: !m.grounded,
        onWater: m.onWater,
        moving: traveled > 0.01 || m.mode === "wall",
        speed: horizontal,
        camera: this.camera.position,
      });
      const targetFov =
        50 +
        (sprint && traveled > 0.01 ? 5 : 0) +
        (m.gliding ? 8 : 0) +
        (m.mode === "dash" ? 10 : 0) +
        (m.mode === "soar" ? 12 : 0);
      this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3));
      if (Math.abs(this.camera.fov - this.fov) > 0.01) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
      if (traveled > 0.001) {
        const target = Math.atan2(-dx, -dz);
        this.traveler.group.rotation.y +=
          Math.atan2(
            Math.sin(target - this.traveler.group.rotation.y),
            Math.cos(target - this.traveler.group.rotation.y),
          ) * Math.min(dt * 12, 1);
      }
      this.traveler.update(
        dt,
        traveled > 0.001 && m.grounded ? Math.min(norm, 1) * (speed / 3.8) : 0,
        {
          grounded: m.grounded,
          vy: m.vy,
          gliding: m.gliding,
          flips: m.flips,
          landed: events.landed,
          mode: m.mode,
          modeTime: m.modeTime,
          jumps: m.jumps,
          bank: this.bank,
          speed: horizontal,
          plunged: events.plunged,
        },
      );
      this.world.rings.children.forEach((o, i) => {
        if (o.name === "pillar")
          // Light pillars step aside when the traveller or camera is close.
          o.visible =
            Math.hypot(
              o.position.x - this.position.x,
              o.position.z - this.position.z,
            ) > 6 &&
            Math.hypot(
              o.position.x - this.camera.position.x,
              o.position.z - this.camera.position.z,
            ) > 14;
        if (o.name.startsWith("beacon")) {
          o.position.y =
            Number(o.userData.baseY) + Math.sin(this.elapsed * 1.5 + i) * 0.16;
          o.rotation.y = this.elapsed * 0.5;
        }
      });
      this.world.update(
        this.position.x,
        this.position.z,
        dt,
        this.elapsed,
        shared.player.value,
        this.reducedMotion,
      );
    }
    this.updateCamera(1 - Math.exp(-dt * 9), dt);
    this.atmosphere.speed = this.speedFx;
    this.placeOverlay();
    if (now - this.snapshotAt > 80) {
      this.snapshotAt = now;
      this.onState({
        ...this.position,
        y: this.motion.y,
        airborne: !this.motion.grounded,
        mode: this.motion.mode,
        qi: this.motion.qi / MAX_QI,
        cooldowns: {
          dash: this.motion.cooldowns.dash / SKILLS.dash.cooldown,
          soar: this.motion.cooldowns.soar / SKILLS.soar.cooldown,
          plunge: this.motion.cooldowns.plunge / SKILLS.plunge.cooldown,
        },
        airTime: this.motion.airTime,
        heading: this.yaw,
        distance: this.distance,
        nearby: nearestStop(this.position.x, this.position.z, this.world.stops),
      });
    }
    shared.time.value = this.elapsed;
    this.renderFrame();
  };
  private overlayPoint = new THREE.Vector3();
  /** Keeps the name plate floating above the traveller's head. */
  private placeOverlay() {
    const el = this.overlay;
    if (!el) return;
    const p = this.traveler.anchors().head.add(new THREE.Vector3(0, 0.5, 0));
    this.overlayPoint.copy(p).project(this.camera);
    const visible = this.overlayPoint.z < 1;
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    el.style.opacity = visible ? "1" : "0";
    el.style.transform = `translate(${((this.overlayPoint.x + 1) / 2) * w}px, ${((1 - this.overlayPoint.y) / 2) * h}px) translate(-50%, -100%)`;
  }
  private renderFrame() {
    const ground = this.motion.y;
    // Snap the shadow frustum to texels so shadows do not shimmer while walking.
    const range = this.quality.shadowRange,
      texel = (range * 2) / this.quality.shadowMapSize;
    const cx = Math.round(this.position.x / texel) * texel,
      cz = Math.round(this.position.z / texel) * texel;
    const d = presets[this.timeOfDay].sunDir;
    this.sun.position.set(
      cx + d.x * range * 2,
      ground + d.y * range * 2,
      cz + d.z * range * 2,
    );
    this.sun.target.position.set(cx, ground, cz);
    this.sky.position.copy(this.camera.position);
    shared.player.value.set(this.position.x, ground, this.position.z);
    this.camera.updateMatrixWorld();
    this.world.reflection?.render(
      this.renderer,
      this.scene,
      this.camera,
      [...this.world.reflectionHidden, this.world.rings, this.fx.group],
      this.atmosphere.haze,
    );
    // Static scenery dominates the shadow map; refresh it every other frame.
    if (this.frameCount++ % 2 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.post.render(this.scene, this.camera, this.atmosphere, this.elapsed);
  }
  capture() {
    this.renderFrame();
    return this.canvas.toDataURL("image/png");
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.cleanup.forEach((fn) => fn());
    this.world.dispose();
    disposeObject(this.scene);
    this.environment?.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
