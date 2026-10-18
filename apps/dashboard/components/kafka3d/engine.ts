// Kafka character render engine — framework-agnostic three.js lifecycle.
// Responsibilities: renderer/camera/scene setup, GLB loading (unlit painted
// materials kept as authored), the single animation loop, quality/DPR limits,
// pause/active gating, and full teardown on dispose. React never touches this
// per frame — see kafka-character.tsx.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resolveBoneMap, type BoneMap } from "./bone-map";
import { KafkaAnimator, DEFAULT_ANIMATOR_CONFIG, applyIdleBasePose } from "./animation";

export type KafkaQuality = "high" | "medium" | "low";
export type KafkaFraming = "full" | "portrait";

/** Message contract for the recoverable context-loss path (see the component). */
export const CONTEXT_LOST_MESSAGE = "The graphics context was lost.";

export interface EngineHooks {
  onReady?: () => void;
  onError?: (message: string) => void;
}

export interface EngineStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  dpr: number;
  width: number;
  height: number;
  quality: KafkaQuality;
}

const FRAMINGS: Record<KafkaFraming, { camera: [number, number, number]; look: [number, number, number] }> = {
  // The model stands at the origin, 20.45 units tall, facing +Z.
  full: { camera: [2.2, 11.4, 46], look: [0, 10.3, 0] },
  portrait: { camera: [0.8, 19.0, 12.4], look: [0, 18.72, 0.15] },
};

export class KafkaEngine {
  static isSupported(): boolean {
    try {
      const probe = document.createElement("canvas");
      return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    } catch {
      return false;
    }
  }

  private renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private animator: KafkaAnimator | null = null;
  private map: BoneMap | null = null;
  private model: THREE.Group | null = null;
  private skeleton: THREE.SkeletonHelper | null = null;
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private disposed = false;
  private loading = false;
  private quality: KafkaQuality;
  private framing: KafkaFraming = "full";
  private paused = false;
  private active = true;
  private dirty = true;
  private elapsed = 0;
  private last = 0;
  private frameSamples: number[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly src: string,
    quality: KafkaQuality,
    private readonly hooks: EngineHooks = {},
  ) {
    this.quality = quality;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.container.appendChild(this.canvas);
    this.renderer = this.createRenderer();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 220);
    this.applyFraming(this.framing);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    this.resize();
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality !== "low",
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Unlit painted textures: no tone mapping, no lights — faithful to source.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  }

  private onContextLost = () => {
    if (!this.disposed) this.hooks.onError?.(CONTEXT_LOST_MESSAGE);
  };

  private dprLimit() {
    const device = window.devicePixelRatio || 1;
    return this.quality === "high" ? Math.min(device, 2) : this.quality === "medium" ? Math.min(device, 1.5) : 1;
  }

  private applyFraming(framing: KafkaFraming) {
    const config = FRAMINGS[framing];
    this.camera.position.set(...config.camera);
    this.camera.lookAt(...config.look);
  }

  setFraming(framing: KafkaFraming) {
    if (framing === this.framing) return;
    this.framing = framing;
    this.applyFraming(framing);
    this.requestRender();
  }

  setQuality(quality: KafkaQuality) {
    if (quality === this.quality) return;
    const antialiasChanged = (quality === "low") !== (this.quality === "low");
    this.quality = quality;
    if (antialiasChanged) {
      // Antialiasing is fixed at context creation; rebuild the renderer only
      // when that flag changes (rare, explicit user action).
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.canvas.remove();
      this.canvas = document.createElement("canvas");
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.addEventListener("webglcontextlost", this.onContextLost, false);
      this.container.insertBefore(this.canvas, this.container.firstChild);
      this.renderer = this.createRenderer();
    }
    this.resize();
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused) this.last = performance.now();
    else this.requestRender();
  }

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    if (active) this.last = performance.now();
  }

  setTracking(enabled: boolean) {
    this.animator?.setTracking(enabled);
  }

  /** Normalized (−1..1) pointer within the character area, or null on leave. */
  setPointer(pointer: [number, number] | null) {
    this.animator?.setPointer(pointer);
  }

  private requestRender() {
    this.dirty = true;
  }

  async load(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true;
    let response: Response;
    try {
      response = await fetch(this.src);
    } catch {
      throw new Error("The character model could not be downloaded.");
    }
    if (!response.ok) throw new Error(`Model request failed (${response.status})`);
    const buffer = await response.arrayBuffer();
    if (this.disposed) return;
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    if (this.disposed) return;
    this.model = gltf.scene;
    this.model.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
        // Skinned bounds follow the bind pose; keep the character visible
        // while the head and secondary chains move.
        object.frustumCulled = false;
      }
    });
    this.scene.add(this.model);
    this.map = resolveBoneMap(this.model);
    applyIdleBasePose(this.map);
    this.animator = new KafkaAnimator(this.map, DEFAULT_ANIMATOR_CONFIG);
    this.loading = false;
    this.hooks.onReady?.();
    this.last = performance.now();
    this.start();
  }

  private resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setPixelRatio(this.dprLimit());
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private start() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (document.hidden || !this.active) return;
    const animating = !this.paused && this.animator !== null;
    if (animating) {
      this.elapsed += dt;
      this.animator!.update(dt, this.elapsed);
    }
    if (!animating && !this.dirty) return;
    this.dirty = false;
    const started = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.frameSamples.push(performance.now() - started);
    if (this.frameSamples.length > 240) this.frameSamples.shift();
  };

  stats(): EngineStats {
    const samples = [...this.frameSamples].sort((a, b) => a - b);
    const avg = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
    const p95 = samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] : 0;
    return {
      frames: samples.length,
      avgMs: Math.round(avg * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      dpr: this.renderer.getPixelRatio(),
      width: this.container.clientWidth,
      height: this.container.clientHeight,
      quality: this.quality,
    };
  }

  // ---- debug-only helpers (used by the preview; not part of the site API) --
  /** Debug-only: world rotation basis of a bone (rotation columns). */
  worldBasis(name: string): number[] | null {
    const bone = this.map?.all.get(name);
    if (!bone) return null;
    bone.updateWorldMatrix(true, false);
    const e = bone.matrixWorld.elements;
    return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
  }

  setJoint(name: string, xDeg: number, yDeg: number, zDeg: number): boolean {
    const bone = this.map?.all.get(name);
    if (!bone) return false;
    // Probe rest is captured on first use from the CURRENT pose (idle stance
    // included) so debug rotations are relative to what the visitor sees.
    if (!(bone.userData.k3dProbeRest instanceof THREE.Quaternion)) {
      bone.userData.k3dProbeRest = bone.quaternion.clone();
    }
    const rest = bone.userData.k3dProbeRest as THREE.Quaternion;
    const delta = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(xDeg), THREE.MathUtils.degToRad(yDeg), THREE.MathUtils.degToRad(zDeg), "XYZ"),
    );
    bone.quaternion.copy(rest).multiply(delta);
    this.requestRender();
    return true;
  }

  resetPose() {
    if (this.map) {
      for (const bone of this.map.all.values()) {
        const rest = bone.userData.k3dRest;
        if (rest instanceof THREE.Quaternion) bone.quaternion.copy(rest);
        delete bone.userData.k3dProbeRest;
      }
      // Static base-pose bones (arms, elbows) are not part of the animator's
      // driven set; re-apply the idle stance after resetting the bind pose.
      applyIdleBasePose(this.map);
    }
    this.animator?.resetToRest();
    this.requestRender();
  }

  listJoints(): string[] {
    return this.map ? [...this.map.all.keys()] : [];
  }

  /** Debug-only: meshes in traversal order with vertex counts + visibility. */
  listMeshes(): { index: number; name: string; vertices: number; visible: boolean }[] {
    const out: { index: number; name: string; vertices: number; visible: boolean }[] = [];
    let index = 0;
    this.model?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      mesh.userData.k3dMeshIndex = index;
      out.push({
        index,
        name: mesh.name || `mesh-${index}`,
        vertices: geometry?.attributes?.position?.count ?? 0,
        visible: mesh.visible,
      });
      index += 1;
    });
    return out;
  }

  setMeshVisible(index: number, visible: boolean) {
    this.model?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.k3dMeshIndex === index) mesh.visible = visible;
    });
    this.requestRender();
  }

  setSkeletonVisible(visible: boolean) {
    if (!this.model) return;
    if (visible && !this.skeleton) {
      this.skeleton = new THREE.SkeletonHelper(this.model);
      this.scene.add(this.skeleton);
    } else if (!visible && this.skeleton) {
      this.scene.remove(this.skeleton);
      this.skeleton.geometry.dispose();
      (this.skeleton.material as THREE.Material).dispose();
      this.skeleton = null;
    }
    this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    if (this.skeleton) {
      this.skeleton.geometry.dispose();
      (this.skeleton.material as THREE.Material).dispose();
      this.skeleton = null;
    }
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      }
    });
    this.scene.clear();
    this.model = null;
    this.map = null;
    this.animator = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
