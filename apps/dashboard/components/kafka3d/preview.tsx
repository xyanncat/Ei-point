"use client";
// Isolated development preview for the Kafka 3D character. Framing, quality,
// tracking, pause and (with ?debug=1) skeleton + bone probes. The public hero
// is untouched; this page is not linked from anywhere.
import { useEffect, useState } from "react";
import { KafkaCharacter } from "./kafka-character";
import type { EngineStats, KafkaEngine, KafkaFraming, KafkaQuality } from "./engine";
import "./preview.css";

const PROBE_JOINTS = [
  "Head_08",
  "Neck_07",
  "Chest_06",
  "Spine_05",
  "Hips_04",
  "Eye_L_010",
  "Eye_R_09",
  "Left shoulder_0113",
  "Right shoulder_060",
  "HairA1_JNT_012",
  "HairB1_JNT_014",
  "HairB2_JNT_015",
  "HairRB_1_JNT_021",
  "HairLB_1_JNT_018",
  "HairJ1_JNT_038",
  "Yb_1_048",
  "Zb_0_1_054",
  "Wt_0_6_0228",
  "Wt_0_7_0240",
  "Wt_0_8_0252",
  "Zxz_0_1_0105",
  "Yxz_1_0156",
  "Xj_0_1_0353",
];

export function KafkaPreview() {
  const [engine, setEngine] = useState<KafkaEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState(false);
  const [framing, setFraming] = useState<KafkaFraming>("full");
  const [quality, setQuality] = useState<KafkaQuality>("high");
  const [tracking, setTracking] = useState(true);
  const [skeleton, setSkeleton] = useState(false);
  const [joint, setJoint] = useState("Head_08");
  const [angles, setAngles] = useState({ x: 0, y: 0, z: 0 });
  const [stats, setStats] = useState<EngineStats | null>(null);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).has("debug"));
  }, []);

  useEffect(() => {
    if (!engine || !ready) return;
    const timer = setInterval(() => setStats(engine.stats()), 1000);
    return () => clearInterval(timer);
  }, [engine, ready]);

  const probe = (next: { x: number; y: number; z: number }) => {
    setAngles(next);
    engine?.setJoint(joint, next.x, next.y, next.z);
  };

  const selectJoint = (name: string) => {
    setJoint(name);
    setAngles({ x: 0, y: 0, z: 0 });
    engine?.setJoint(name, 0, 0, 0);
  };

  return (
    <main className="k3dpreview">
      <header className="k3dpreview-head">
        <p className="kp-eyebrow">Development preview · not linked from the site</p>
        <h1>Kafka — 3D character</h1>
        <p>
          Isolated from the approved hero. Model: <code>star_rail_-_kafka.glb</code> (Sketchfab export,
          376 joints, unlit textures). Debug probes (skeleton, bone rotation) appear with{" "}
          <code>?debug=1</code>.
        </p>
      </header>

      <section className="k3dpreview-stage" aria-label="Kafka character scene">
        <KafkaCharacter
          posterSrc="/art/kafka-hero.png"
          quality={quality}
          framing={framing}
          tracking={tracking}
          debug={debug}
          onEngine={setEngine}
          onLoaded={() => setReady(true)}
          onError={(message) => setError(message)}
        />
      </section>

      <section className="k3dpreview-bar" aria-label="Preview controls">
        <fieldset>
          <legend>Framing</legend>
          <button type="button" aria-pressed={framing === "full"} onClick={() => setFraming("full")}>
            Full body
          </button>
          <button type="button" aria-pressed={framing === "portrait"} onClick={() => setFraming("portrait")}>
            Portrait
          </button>
        </fieldset>
        <fieldset>
          <legend>Quality</legend>
          <button type="button" aria-pressed={quality === "high"} onClick={() => setQuality("high")}>
            High
          </button>
          <button type="button" aria-pressed={quality === "medium"} onClick={() => setQuality("medium")}>
            Medium
          </button>
          <button type="button" aria-pressed={quality === "low"} onClick={() => setQuality("low")}>
            Low
          </button>
        </fieldset>
        <fieldset>
          <legend>Behaviour</legend>
          <button type="button" aria-pressed={tracking} onClick={() => setTracking(!tracking)}>
            Pointer tracking
          </button>
          <button
            type="button"
            onClick={() => {
              engine?.resetPose();
              setAngles({ x: 0, y: 0, z: 0 });
            }}
          >
            Reset pose
          </button>
        </fieldset>
        <p className="kp-dim">
          {error
            ? `Error: ${error}`
            : stats
              ? `frame ${stats.avgMs} ms avg · p95 ${stats.p95Ms} ms · dpr ${stats.dpr} · ${stats.width}×${stats.height}`
              : ready
                ? "measuring…"
                : "loading…"}
        </p>
      </section>

      {debug && (
        <section className="k3dpreview-debug" aria-label="Bone probes">
          <h2>Bone probes (development)</h2>
          <div style={{ display: "grid", gap: "0.6rem", alignContent: "start" }}>
            <label style={{ display: "grid", gap: "0.3rem", color: "var(--kp-dim)", fontSize: "0.8rem" }}>
              Joint
              <select value={joint} onChange={(event) => selectJoint(event.target.value)}>
                {PROBE_JOINTS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={skeleton}
                onChange={(event) => {
                  setSkeleton(event.target.checked);
                  engine?.setSkeletonVisible(event.target.checked);
                }}
              />
              Show skeleton
            </label>
          </div>
          <div className="kp-sliders">
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis}>
                {axis.toUpperCase()}
                <input
                  type="range"
                  min={-30}
                  max={30}
                  step={0.5}
                  value={angles[axis]}
                  onChange={(event) => probe({ ...angles, [axis]: Number(event.target.value) })}
                />
                <output>{angles[axis].toFixed(1)}°</output>
              </label>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
