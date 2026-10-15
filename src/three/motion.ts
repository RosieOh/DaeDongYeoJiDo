import { pointInPolygon, segmentDistance } from "./geo";
import type { GeoBuilding, GeoSceneData } from "./geo";

export type MotionWorld = {
  data: GeoSceneData;
  /** Terrain or bridge deck. */
  heightAt: (x: number, z: number) => number;
  /** Walkable top of a building (roof surface, flat roof or wall coping). */
  surfaceAt: (b: GeoBuilding, x: number, z: number) => number;
  /** Water surface level at a point, or null on land and bridges. */
  waterAt: (x: number, z: number) => number | null;
};

export type MoveMode =
  "ground" | "air" | "glide" | "wall" | "dash" | "soar" | "plunge";
export type SkillId = "dash" | "soar" | "plunge";
/** 기력 cost and cooldown of each 경공 technique. */
export const SKILLS: Record<SkillId, { cost: number; cooldown: number }> = {
  dash: { cost: 18, cooldown: 0.7 },
  soar: { cost: 38, cooldown: 4.5 },
  plunge: { cost: 8, cooldown: 0.8 },
};
export const MAX_QI = 100;

const STEP = 0.5,
  GRAVITY = 20,
  RADIUS = 0.35,
  CELL = 24;
/** Take-off speeds of the three chained jumps and the 기력 they cost. */
const JUMPS = [8, 9.5, 11];
const JUMP_COST = [0, 9, 12];
const WALL_REACH = 16,
  WALL_TIME = 1.6,
  DASH_TIME = 0.32,
  SOAR_TIME = 0.9;

type Block =
  | null
  | { kind: "edge" | "water" | "terrain" }
  | { kind: "building"; top: number };

export type MotionInput = {
  /** Requested horizontal displacement for this frame (metres). */
  dx: number;
  dz: number;
  /** Unit vector the traveller faces; dashes and soars follow it. */
  fx: number;
  fz: number;
  sprint: boolean;
};

/**
 * Third-person 경공 movement modelled on wuxia MMO light-foot skills:
 * chained triple jumps, gliding, 비연 dashes, the soaring 제운종, the
 * crashing 천근추, running up walls (벽호공) and over water (능파보). Every
 * technique spends 기력, which recovers on the ground.
 */
export class Motion {
  x: number;
  z: number;
  y: number;
  vy = 0;
  /** Horizontal momentum carried through the air (m/s). */
  px = 0;
  pz = 0;
  grounded = true;
  onWater = false;
  jumps = 0;
  gliding = false;
  mode: MoveMode = "ground";
  modeTime = 0;
  qi = MAX_QI;
  cooldowns: Record<SkillId, number> = { dash: 0, soar: 0, plunge: 0 };
  /** Increments on every mid-air jump so the body can somersault. */
  flips = 0;
  /** Seconds since 기력 was last spent; recovery waits a moment. */
  private rest = 1;
  private autoGlide = 0;
  private wallDir = { x: 0, z: 0 };
  private plungeFrom = 0;
  /** Seconds spent airborne this session (경공 수련). */
  airTime = 0;
  events = {
    jumped: 0,
    landed: 0,
    dashed: false,
    soared: false,
    plunged: 0,
    wall: false,
    kicked: false,
    failed: "" as "" | "qi" | "cooldown",
  };
  private holding = false;
  private coyote = 0;
  private grid = new Map<string, GeoBuilding[]>();
  constructor(
    private world: MotionWorld,
    x: number,
    z: number,
  ) {
    this.x = x;
    this.z = z;
    this.y = world.heightAt(x, z);
    this.index();
  }
  /** Spatial hash of building footprints (walls are appended after load). */
  index() {
    this.grid.clear();
    for (const b of this.world.data.buildings) {
      const ring = b.rings[0];
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const [x, z] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      for (
        let i = Math.floor((minX - RADIUS) / CELL);
        i <= Math.floor((maxX + RADIUS) / CELL);
        i++
      )
        for (
          let j = Math.floor((minZ - RADIUS) / CELL);
          j <= Math.floor((maxZ + RADIUS) / CELL);
          j++
        ) {
          const key = `${i},${j}`;
          const list = this.grid.get(key);
          if (list) list.push(b);
          else this.grid.set(key, [b]);
        }
    }
  }
  /** Footprints in the spatial-hash cell containing (x, z). */
  buildingsAt(x: number, z: number) {
    return this.near(x, z);
  }
  private near(x: number, z: number) {
    return (
      this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []
    );
  }
  get airborne() {
    return !this.grounded;
  }
  /** Highest surface the feet can rest on at (x, z) without climbing past `top`. */
  floor(x: number, z: number, top: number) {
    let best = this.world.heightAt(x, z);
    const water = this.world.waterAt(x, z);
    if (water !== null && water > best && (this.onWater || !this.grounded))
      best = water;
    for (const b of this.near(x, z)) {
      if (!pointInPolygon(x, z, b)) continue;
      const s = this.world.surfaceAt(b, x, z);
      if (s <= top + STEP && s > best) best = s;
    }
    return best;
  }
  private blocker(x: number, z: number, y: number, sprint: boolean): Block {
    const e = this.world.data.extent;
    if (Math.abs(x) > e - 5 || Math.abs(z) > e - 5) return { kind: "edge" };
    for (const b of this.near(x, z)) {
      const inside = pointInPolygon(x, z, b);
      if (
        !inside &&
        !b.rings.some((r) =>
          r.some(
            (a, i) =>
              i > 0 && segmentDistance(x, z, r[i - 1], a).distance < RADIUS,
          ),
        )
      )
        continue;
      const top = this.world.surfaceAt(b, x, z);
      if (top > y + STEP) return { kind: "building", top };
    }
    if (this.grounded) {
      // 능파보: sprinting carries the traveller straight onto the water.
      if (!this.onWater && !sprint && this.world.waterAt(x, z) !== null)
        return { kind: "water" };
      if (this.world.heightAt(x, z) > y + STEP) return { kind: "terrain" };
    }
    return null;
  }
  blocked(x: number, z: number, y: number) {
    return this.blocker(x, z, y, false) !== null;
  }
  private spend(cost: number) {
    if (this.qi < cost) {
      this.events.failed = "qi";
      return false;
    }
    this.qi -= cost;
    this.rest = 0;
    return true;
  }
  private setMode(mode: MoveMode) {
    this.mode = mode;
    this.modeTime = 0;
  }
  private takeOff() {
    this.grounded = false;
    this.onWater = false;
    this.coyote = 0;
  }
  jump() {
    this.holding = true;
    if (this.mode === "wall") {
      // Kick off the wall, flipping away from it.
      this.vy = 10;
      this.px = -this.wallDir.x * 9;
      this.pz = -this.wallDir.z * 9;
      this.jumps = 2;
      this.flips++;
      this.setMode("air");
      this.events.kicked = true;
      return;
    }
    if (this.mode === "dash" || this.mode === "plunge") return;
    if (this.grounded || this.coyote > 0) {
      this.vy = JUMPS[0];
      this.jumps = 1;
      this.takeOff();
      this.setMode("air");
      this.events.jumped = 1;
    } else if (this.jumps < JUMPS.length && this.spend(JUMP_COST[this.jumps])) {
      this.vy = JUMPS[this.jumps];
      this.jumps++;
      this.flips++;
      this.autoGlide = 0;
      this.setMode("air");
      this.events.jumped = this.jumps;
    }
  }
  release() {
    this.holding = false;
  }
  private ready(skill: SkillId) {
    if (this.cooldowns[skill] > 0) {
      this.events.failed = "cooldown";
      return false;
    }
    return true;
  }
  /** 비연: a burst along the facing direction, on the ground or in the air. */
  dash(fx: number, fz: number) {
    if (this.mode === "wall" || this.mode === "plunge") return false;
    if (!this.ready("dash") || !this.spend(SKILLS.dash.cost)) return false;
    this.cooldowns.dash = SKILLS.dash.cooldown;
    const l = Math.hypot(fx, fz) || 1;
    this.px = (fx / l) * 24;
    this.pz = (fz / l) * 24;
    this.vy = this.grounded ? 3 : Math.max(this.vy, 1.5);
    this.takeOff();
    if (this.jumps === 0) this.jumps = 1;
    this.setMode("dash");
    this.events.dashed = true;
    return true;
  }
  /** 제운종: spiral high into the sky, then glide on the wind. */
  soar(fx: number, fz: number) {
    if (this.mode === "wall" || this.mode === "plunge") return false;
    if (!this.ready("soar") || !this.spend(SKILLS.soar.cost)) return false;
    this.cooldowns.soar = SKILLS.soar.cooldown;
    const l = Math.hypot(fx, fz) || 1;
    this.px = (fx / l) * 5;
    this.pz = (fz / l) * 5;
    this.takeOff();
    this.jumps = JUMPS.length;
    this.setMode("soar");
    this.events.soared = true;
    return true;
  }
  /** 천근추: drop like a thousand-weight stone and shake the ground. */
  plunge() {
    if (this.grounded || this.mode === "plunge") return false;
    if (!this.ready("plunge") || !this.spend(SKILLS.plunge.cost)) return false;
    this.cooldowns.plunge = SKILLS.plunge.cooldown;
    this.px = this.pz = 0;
    this.vy = -12;
    this.autoGlide = 0;
    this.plungeFrom = this.y;
    this.setMode("plunge");
    return true;
  }
  reset(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.y = this.world.heightAt(x, z);
    this.vy = this.px = this.pz = 0;
    this.grounded = true;
    this.onWater = false;
    this.jumps = 0;
    this.gliding = false;
    this.holding = false;
    this.autoGlide = 0;
    this.qi = MAX_QI;
    this.setMode("ground");
  }
  /** Moves by the requested horizontal displacement and integrates gravity. */
  update(dt: number, input: MotionInput) {
    const { sprint } = input;
    let { dx, dz } = input;
    this.modeTime += dt;
    this.rest += dt;
    for (const k of Object.keys(this.cooldowns) as SkillId[])
      this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.grounded && this.rest > 0.5)
      this.qi = Math.min(MAX_QI, this.qi + dt * (this.onWater ? 14 : 32));
    if (!this.grounded) this.airTime += dt;

    // --- vertical motion per technique ---
    if (this.mode === "dash") {
      this.vy = Math.max(this.vy - GRAVITY * dt * 0.15, -1);
      dx *= 0.25;
      dz *= 0.25;
      if (this.modeTime > DASH_TIME) {
        this.px *= 0.45;
        this.pz *= 0.45;
        this.setMode("air");
      }
    } else if (this.mode === "soar") {
      const t = this.modeTime / SOAR_TIME;
      this.vy = 26 * (1 - t) + 3;
      dx *= 0.3;
      dz *= 0.3;
      if (t >= 1) {
        this.autoGlide = 3;
        this.setMode("air");
      }
    } else if (this.mode === "plunge") {
      this.vy = Math.max(this.vy - 70 * dt, -42);
      dx = dz = 0;
    } else if (this.mode === "wall") {
      this.vy = 8;
      this.qi = Math.max(0, this.qi - dt * 20);
      this.rest = 0;
      if (this.modeTime > WALL_TIME || this.qi <= 0) {
        // Out of breath: slip off the wall.
        this.px = -this.wallDir.x * 3;
        this.pz = -this.wallDir.z * 3;
        this.vy = 2;
        this.setMode("air");
      }
    } else if (!this.grounded) {
      this.autoGlide = Math.max(0, this.autoGlide - dt);
      const wantGlide =
        this.autoGlide > 0 ||
        (this.holding && this.vy < 0 && this.jumps > 0 && this.qi > 0);
      this.gliding = wantGlide && this.vy < 0.5;
      this.vy -= GRAVITY * dt;
      if (this.gliding) {
        this.vy = Math.max(this.vy, -1.6);
        if (this.autoGlide <= 0) {
          this.qi = Math.max(0, this.qi - dt * 5);
          this.rest = 0;
        }
      }
      this.setModeKeep(this.gliding ? "glide" : "air");
    }
    if (this.mode !== "glide" && this.mode !== "air") this.gliding = false;

    // Momentum: decays fast on the ground, slowly in the air.
    const carry = Math.exp(-dt * (this.grounded ? 9 : 1.1));
    this.px *= carry;
    this.pz *= carry;
    dx += this.px * dt;
    dz += this.pz * dt;

    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
    let hitWall: { top: number; dx: number; dz: number } | null = null;
    for (let i = 0; i < steps; i++) {
      const sx = dx / steps,
        sz = dz / steps;
      const bx = this.blocker(this.x + sx, this.z, this.y, sprint);
      if (!bx) this.x += sx;
      const bz = this.blocker(this.x, this.z + sz, this.y, sprint);
      if (!bz) this.z += sz;
      for (const b of [bx, bz])
        if (b?.kind === "building" && !hitWall)
          hitWall = { top: b.top, dx: sx, dz: sz };
      if (this.grounded) {
        const water = this.world.waterAt(this.x, this.z);
        if (water !== null && sprint && !this.onWater) {
          this.onWater = true;
          this.y = water;
        }
        const f = this.floor(this.x, this.z, this.y);
        if (f < this.y - 0.7) {
          // Walked off an edge: start falling, with a short grace to jump.
          this.grounded = false;
          this.coyote = 0.14;
          this.vy = 0;
          this.onWater = false;
          this.setMode("air");
        } else this.y = f;
      }
    }
    // 벽호공: running into a wall in the air (or at a sprint) runs up it.
    const intoWall = Math.hypot(input.dx, input.dz) > 0.01;
    if (this.mode === "wall") {
      if (!hitWall) {
        // Cleared the top: vault over the edge onto the roof.
        this.vy = 3.5;
        this.px = this.wallDir.x * 4;
        this.pz = this.wallDir.z * 4;
        this.setMode("air");
      } else if (!intoWall) {
        this.vy = 0;
        this.setMode("air");
      }
    } else if (
      hitWall &&
      intoWall &&
      (this.mode === "air" ||
        this.mode === "glide" ||
        this.mode === "dash" ||
        (this.grounded && sprint)) &&
      hitWall.top - this.y < WALL_REACH &&
      this.qi > 8
    ) {
      const l = Math.hypot(hitWall.dx, hitWall.dz) || 1;
      this.wallDir = { x: hitWall.dx / l, z: hitWall.dz / l };
      this.px = this.pz = 0;
      this.takeOff();
      this.setMode("wall");
      this.events.wall = true;
    }

    if (!this.grounded) {
      this.coyote = Math.max(0, this.coyote - dt);
      const before = this.y;
      this.y += this.vy * dt;
      const f = this.floor(this.x, this.z, Math.max(before, this.y));
      if (this.y <= f && this.vy <= 0) {
        this.events.landed = -this.vy;
        if (this.mode === "plunge")
          this.events.plunged = Math.max(1, this.plungeFrom - f);
        this.y = f;
        this.vy = 0;
        this.grounded = true;
        this.jumps = 0;
        this.gliding = false;
        this.autoGlide = 0;
        this.setMode("ground");
        const water = this.world.waterAt(this.x, this.z);
        this.onWater = water !== null && Math.abs(water - f) < 0.05;
      } else if (this.y < f) this.y = f;
    } else {
      const water = this.world.waterAt(this.x, this.z);
      this.onWater = water !== null && Math.abs(water - this.y) < 0.05;
    }
  }
  private setModeKeep(mode: MoveMode) {
    if (this.mode !== mode) this.setMode(mode);
  }
  /** Reads and clears one-shot events for effects. */
  consume() {
    const e = { ...this.events };
    this.events.jumped = 0;
    this.events.landed = 0;
    this.events.dashed = false;
    this.events.soared = false;
    this.events.plunged = 0;
    this.events.wall = false;
    this.events.kicked = false;
    this.events.failed = "";
    return e;
  }
}
