// Procedural skeletal animation for the Kafka rig — no clips exist in the GLB,
// so every layer is generated here. Rules that keep it safe:
//  - all rotations are applied as rest * delta (no accumulation, no drift);
//  - every driven angle is clamped;
//  - delta-time based (frame-rate independent) with dt clamped by the engine;
//  - a bounded, explicit bone list — never "animate every bone".
// Which layers exist, and why: docs/kafka-3d-character.md.
import { Euler, Object3D, Quaternion } from "three";

export interface AnimatorConfig {
  breathing: { period: number; chest: number; spine: number; hips: number; shoulder: number };
  headIdle: { yaw: number; pitch: number; roll: number };
  tracking: { yaw: number; pitch: number; omega: number; headShare: number };
  secondary: { omega: number; impulse: number; coatScale: number; sleeveScale: number; clamp: number };
  eyes: { yaw: number; pitch: number; omega: number };
}

export const DEFAULT_ANIMATOR_CONFIG: AnimatorConfig = {
  breathing: { period: 4.6, chest: 0.011, spine: 0.006, hips: 0.0035, shoulder: 0.004 },
  headIdle: { yaw: 0.024, pitch: 0.012, roll: 0.009 },
  tracking: { yaw: 0.125, pitch: 0.07, omega: 8.5, headShare: 0.72 },
  secondary: { omega: 5.4, impulse: 0.9, coatScale: 0.5, sleeveScale: 0.4, clamp: 0.08 },
  // Verified by probe (docs/kafka-3d-character.md): the eye joints do not
  // deform the eyeballs, so the eye layer stays off until the asset is fixed.
  eyes: { yaw: 0, pitch: 0, omega: 10 },
};

interface Spring {
  value: [number, number, number];
  velocity: [number, number, number];
}

interface Chain {
  bones: Object3D[];
  rest: Quaternion[];
  spring: Spring;
  scale: number;
}

const ZERO = (): Spring => ({ value: [0, 0, 0], velocity: [0, 0, 0] });

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

// Neutral idle stance applied once at load, before animation layers. The T-pose
// bind needs arms lowered; local axes differ per bone, so each entry is defined
// as a world-space rotation axis and converted through the bone's live world
// basis at application time (deterministic, robust to re-exports).
const IDLE_BASE_POSE: { joint: string; worldAxis: [number, number, number]; degrees: number }[] = [
  { joint: "Left_arm_0114", worldAxis: [0, 0, -1], degrees: 68 },
  { joint: "Right_arm_061", worldAxis: [0, 0, 1], degrees: 68 },
  { joint: "Left_arm_0114", worldAxis: [-1, 0, 0], degrees: 7 },
  { joint: "Right_arm_061", worldAxis: [-1, 0, 0], degrees: 7 },
  { joint: "Left_elbow_0116", worldAxis: [-1, 0, 0], degrees: 13 },
  { joint: "Right_elbow_063", worldAxis: [-1, 0, 0], degrees: 13 },
];

/**
 * Compose the idle stance over the bind pose. `userData.k3dRest` keeps the
 * original bind rotation so resetPose() returns to the idle stance, not T-pose.
 * Names here use the GLTFLoader-sanitized spelling (whitespace → underscore).
 */
export function applyIdleBasePose(map: { all: Map<string, Object3D> }) {
  for (const entry of IDLE_BASE_POSE) {
    const bone = map.all.get(entry.joint) ?? map.all.get(entry.joint.replace(/_/g, " "));
    if (!bone) continue;
    if (!(bone.userData.k3dRest instanceof Quaternion)) {
      bone.userData.k3dRest = bone.quaternion.clone();
    }
    bone.updateWorldMatrix(true, false);
    const elements = bone.matrixWorld.elements;
    // World axis in the bone's local frame: components are dot products with
    // the rotation columns of the world matrix (orthonormal basis).
    const [ax, ay, az] = entry.worldAxis;
    const local = [
      elements[0] * ax + elements[1] * ay + elements[2] * az,
      elements[4] * ax + elements[5] * ay + elements[6] * az,
      elements[8] * ax + elements[9] * ay + elements[10] * az,
    ];
    const delta = new Quaternion().setFromEuler(
      new Euler(...local.map((component) => (component * entry.degrees * Math.PI) / 180) as [number, number, number], "XYZ"),
    );
    bone.quaternion.multiply(delta);
  }
}

// Critically damped spring toward a target (stable at any dt below clamp).
function springTo(spring: Spring, target: [number, number, number], omega: number, dt: number) {
  for (let axis = 0; axis < 3; axis++) {
    const x = spring.value[axis];
    const v = spring.velocity[axis];
    const t = target[axis];
    spring.velocity[axis] = v + (-(omega * omega) * (x - t) - 2 * omega * v) * dt;
    spring.value[axis] = x + spring.velocity[axis] * dt;
  }
}

export class KafkaAnimator {
  private config: AnimatorConfig;
  private bones: {
    hips: Object3D; spine: Object3D; chest: Object3D; neck: Object3D; head: Object3D;
    shoulders: Object3D[]; eyes: Object3D[];
  };
  private rest: Map<Object3D, Quaternion> = new Map();
  private hair: Chain[];
  private coat: Chain[];
  private sleeves: Chain[];
  private tracked: Spring = ZERO();
  private eyeSpring: Spring = ZERO();
  private pointer: [number, number] | null = null;
  private trackingEnabled = true;
  private previousHead = new Quaternion();
  private euler = new Euler();

  constructor(
    bones: {
      hips: Object3D; spine: Object3D; chest: Object3D; neck: Object3D; head: Object3D;
      shoulderL: Object3D; shoulderR: Object3D;
      eyeL: Object3D | null; eyeR: Object3D | null;
      hairChains: Object3D[][];
      coatChains: Object3D[][];
      sleeveChains: Object3D[][];
    },
    config: AnimatorConfig = DEFAULT_ANIMATOR_CONFIG,
  ) {
    this.config = config;
    this.bones = {
      hips: bones.hips,
      spine: bones.spine,
      chest: bones.chest,
      neck: bones.neck,
      head: bones.head,
      shoulders: [bones.shoulderL, bones.shoulderR],
      eyes: [bones.eyeL, bones.eyeR].filter((bone): bone is Object3D => bone !== null),
    };
    const makeChains = (lists: Object3D[][], scale: number): Chain[] =>
      lists.map((list) => ({ bones: list, rest: list.map((b) => b.quaternion.clone()), spring: ZERO(), scale }));
    this.hair = makeChains(bones.hairChains, 1);
    this.coat = makeChains(bones.coatChains, this.config.secondary.coatScale);
    this.sleeves = makeChains(bones.sleeveChains, this.config.secondary.sleeveScale);
    for (const [bone] of this.boneEntries()) this.rest.set(bone, bone.quaternion.clone());
    this.previousHead.copy(bones.head.quaternion);
  }

  private *boneEntries() {
    yield [this.bones.hips] as const;
    yield [this.bones.spine] as const;
    yield [this.bones.chest] as const;
    yield [this.bones.neck] as const;
    yield [this.bones.head] as const;
    for (const shoulder of this.bones.shoulders) yield [shoulder] as const;
    for (const eye of this.bones.eyes) yield [eye] as const;
    for (const chain of [...this.hair, ...this.coat, ...this.sleeves]) for (const bone of chain.bones) yield [bone] as const;
  }

  /** Restore the neutral idle stance (base pose included) and clear springs. */
  resetToRest() {
    for (const [bone] of this.boneEntries()) {
      const rest = this.rest.get(bone);
      if (rest) bone.quaternion.copy(rest);
    }
    for (const spring of [this.tracked, this.eyeSpring]) {
      spring.value = [0, 0, 0];
      spring.velocity = [0, 0, 0];
    }
    for (const chain of [...this.hair, ...this.coat, ...this.sleeves]) {
      chain.spring.value = [0, 0, 0];
      chain.spring.velocity = [0, 0, 0];
    }
    this.pointer = null;
  }

  /** Normalized pointer position (−1..1) or null when the pointer left. */
  setPointer(pointer: [number, number] | null) {
    this.pointer = pointer;
  }

  setTracking(enabled: boolean) {
    this.trackingEnabled = enabled;
  }

  private setDelta(bone: Object3D, x: number, y: number, z: number) {
    const rest = this.rest.get(bone);
    if (!rest) return;
    this.euler.set(x, y, z, "XYZ");
    bone.quaternion.setFromEuler(this.euler).multiply(rest);
  }

  private applyChain(chain: Chain, clampAngle: number) {
    const count = chain.bones.length;
    for (let i = 0; i < count; i++) {
      const weight = count === 1 ? 1 : 0.45 + 0.55 * (i / (count - 1));
      this.setDelta(
        chain.bones[i],
        clamp(chain.spring.value[0], clampAngle) * weight,
        clamp(chain.spring.value[1], clampAngle) * weight,
        clamp(chain.spring.value[2], clampAngle) * weight,
      );
    }
  }

  /**
   * Advance the pose. `elapsed` drives the periodic layers, `dt` the springs.
   * Call only while the scene is active; while paused the last pose persists.
   */
  update(dt: number, elapsed: number) {
    const { breathing, headIdle, tracking, secondary, eyes } = this.config;
    const rest = this.rest;
    const kinetic = this.euler;
    const q = new Quaternion();

    const set = (bone: Object3D, x: number, y: number, z: number) => {
      const base = rest.get(bone);
      if (!base) return;
      kinetic.set(x, y, z, "XYZ");
      bone.quaternion.copy(base).multiply(q.setFromEuler(kinetic));
    };

    // --- layer 1: breathing -------------------------------------------------
    const breath = (1 - Math.cos((Math.PI * 2 * elapsed) / breathing.period)) / 2;
    set(this.bones.chest, -breathing.chest * (0.35 - breath * 0.85), 0, 0);
    set(this.bones.spine, breathing.spine * (0.3 - breath * 0.8), 0, 0);
    set(this.bones.hips, breathing.hips * (0.4 - breath), 0, 0);
    set(this.bones.shoulders[0], 0, 0, breathing.shoulder * (0.4 + breath * 0.6));
    set(this.bones.shoulders[1], 0, 0, -breathing.shoulder * (0.4 + breath * 0.6));

    // --- layer 2: idle head/neck drift -------------------------------------
    const t = elapsed;
    const idleYaw = headIdle.yaw * (0.6 * Math.sin(t * 0.31) + 0.4 * Math.sin(t * 0.47 + 2.1));
    const idlePitch = headIdle.pitch * (0.6 * Math.sin(t * 0.23 + 0.7) + 0.4 * Math.sin(t * 0.41 + 4.2));
    const idleRoll = headIdle.roll * Math.sin(t * 0.19 + 1.4);

    // --- layer 3: pointer tracking (springs smoothly back to zero) ---------
    const hasPointer = this.pointer !== null && this.trackingEnabled;
    const target: [number, number, number] = hasPointer
      ? [clamp(-this.pointer![1] * tracking.pitch, tracking.pitch), clamp(this.pointer![0] * tracking.yaw, tracking.yaw), 0]
      : [0, 0, 0];
    springTo(this.tracked, target, tracking.omega, dt);
    const trackYaw = this.tracked.value[1];
    const trackPitch = this.tracked.value[0];
    set(
      this.bones.head,
      idlePitch + trackPitch * tracking.headShare,
      idleYaw + trackYaw * tracking.headShare,
      idleRoll,
    );
    set(this.bones.neck, (idlePitch + trackPitch * (1 - tracking.headShare)) * 0.7, (idleYaw + trackYaw * (1 - tracking.headShare)) * 0.7, idleRoll * 0.4);

    // --- layer 4: eyes (subtle, only if the eyeballs actually move) ---------
    if (this.bones.eyes.length && eyes.yaw > 0) {
      springTo(this.eyeSpring, hasPointer ? [clamp(-this.pointer![1] * eyes.pitch, eyes.pitch), clamp(this.pointer![0] * eyes.yaw, eyes.yaw), 0] : [0, 0, 0], eyes.omega, dt);
      for (const eye of this.bones.eyes) {
        set(eye, this.eyeSpring.value[0], this.eyeSpring.value[1], this.eyeSpring.value[2]);
      }
    }

    // --- layer 5: secondary motion (hair, coat, sleeves) --------------------
    // Driven by the head's per-frame angular change — classical follow-through.
    const headDelta = this.bones.head.quaternion.clone().multiply(this.previousHead.clone().invert());
    this.previousHead.copy(this.bones.head.quaternion);
    kinetic.setFromQuaternion(headDelta, "XYZ");
    const impulseX = clamp(kinetic.x, 0.05) * -secondary.impulse;
    const impulseY = clamp(kinetic.y, 0.05) * -secondary.impulse;
    const impulseZ = clamp(kinetic.z, 0.05) * -secondary.impulse * 0.7;
    const drive = (chains: Chain[]) => {
      for (const chain of chains) {
        chain.spring.velocity[0] += impulseX;
        chain.spring.velocity[1] += impulseY;
        chain.spring.velocity[2] += impulseZ;
        springTo(chain.spring, [0, 0, 0], secondary.omega, dt);
        this.applyChain(chain, secondary.clamp);
      }
    };
    drive(this.hair);
    drive(this.coat);
    drive(this.sleeves);
  }
}
