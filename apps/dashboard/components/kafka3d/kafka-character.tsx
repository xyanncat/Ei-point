"use client";
// Reusable Kafka character component. Documented interface (see
// docs/kafka-3d-character.md):
//   src      – model URL (default: bundled GLB copy)
//   posterSrc– static fallback image shown while loading and on failure
//   quality  – "high" | "medium" | "low"  (DPR + antialias budget)
//   framing  – "full" | "portrait"        (composed cameras)
//   active   – render only while true (viewport gating)
//   tracking – pointer tracking toward the cursor (default true)
//   controls – visible pause control (default true)
//   debug    – expose window.__kafka3d and enable debug probes (preview only)
//   onLoaded / onError – lifecycle callbacks
// Rendering state lives inside the engine; React state changes only on
// lifecycle events (loading → ready → error) and the user pause intent.
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTEXT_LOST_MESSAGE, KafkaEngine, type KafkaFraming, type KafkaQuality } from "./engine";
import "./kafka-character.css";

export interface KafkaCharacterProps {
  src?: string;
  posterSrc?: string;
  quality?: KafkaQuality;
  framing?: KafkaFraming;
  active?: boolean;
  tracking?: boolean;
  controls?: boolean;
  debug?: boolean;
  className?: string;
  onLoaded?: () => void;
  onError?: (message: string) => void;
  /** Debug/preview hook: receives the live engine (preview tools only). */
  onEngine?: (engine: KafkaEngine | null) => void;
}

const DEFAULT_SRC = "/art/kafka3d/star_rail_-_kafka.glb";

type Status = "loading" | "ready" | "error";

export function KafkaCharacter({
  src = DEFAULT_SRC,
  posterSrc,
  quality = "high",
  framing = "full",
  active = true,
  tracking = true,
  controls = true,
  debug = false,
  className,
  onLoaded,
  onError,
  onEngine,
}: KafkaCharacterProps) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const engine = useRef<KafkaEngine | null>(null);
  const started = useRef(false);
  const pausedRef = useRef(false);
  // debug may arrive one tick after mount (query-param discovery); the engine
  // start path must read it live, not from the first render's closure.
  const debugRef = useRef(debug);
  debugRef.current = debug;
  const [status, setStatus] = useState<Status>("loading");
  const [paused, setPaused] = useState(false);
  const [errorNote, setErrorNote] = useState("");
  // A lost WebGL context is often transient (driver reset, tab reaping):
  // rebuild the engine once before giving up and showing the fallback.
  const [attempt, setAttempt] = useState(0);
  const recovered = useRef(false);

  const applyPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    engine.current?.setPaused(next);
    setPaused(next);
  }, []);

  // Mount: lazy-start on approach, wire pointer/visibility, expose debug.
  useEffect(() => {
    const host = wrapper.current;
    if (!host) return;
    let cancelled = false;

    const fail = (message: string) => {
      if (cancelled) return;
      if (!recovered.current && message === CONTEXT_LOST_MESSAGE) {
        recovered.current = true;
        engine.current?.dispose();
        engine.current = null;
        setAttempt((value) => value + 1);
        return;
      }
      setErrorNote(message);
      setStatus("error");
      onError?.(message);
      engine.current?.dispose();
      engine.current = null;
      onEngine?.(null);
    };

    const start = () => {
      if (started.current || cancelled) return;
      started.current = true;
      if (!KafkaEngine.isSupported()) {
        fail("WebGL is not available in this browser.");
        return;
      }
      const instance = new KafkaEngine(host, src, quality, {
        onReady: () => {
          if (cancelled) return;
          // Debug probes should not fight the animation: freeze the pose so
          // bone tests show exactly what the slider does.
          if (debugRef.current) instance.setPaused(true);
          else instance.setPaused(pausedRef.current);
          setStatus("ready");
          onLoaded?.();
        },
        onError: fail,
      });
      engine.current = instance;
      onEngine?.(instance);
      if (debugRef.current) {
        (window as unknown as Record<string, unknown>).__kafka3d = {
          get engine() {
            return engine.current;
          },
        };
      }
      instance.setFraming(framing);
      instance.setTracking(tracking);
      instance.setActive(active);
      instance.setPaused(debugRef.current ? true : pausedRef.current);
      void instance.load().catch((cause: unknown) => {
        fail(cause instanceof Error ? cause.message : "The character model could not be loaded.");
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            start();
            observer.disconnect();
          }
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(host);

    const onMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = ((event.clientX - box.left) / box.width) * 2 - 1;
      const y = ((event.clientY - box.top) / box.height) * 2 - 1;
      engine.current?.setPointer([Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))]);
    };
    const onLeave = () => engine.current?.setPointer(null);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave, { passive: true });

    // Reduced motion: start paused; the visible control allows opting in.
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) applyPaused(true);
    const onMedia = (event: MediaQueryListEvent) => {
      if (event.matches) applyPaused(true);
    };
    media.addEventListener("change", onMedia);

    return () => {
      cancelled = true;
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      media.removeEventListener("change", onMedia);
      if (debugRef.current) delete (window as unknown as Record<string, unknown>).__kafka3d;
      engine.current?.dispose();
      engine.current = null;
      started.current = false;
      onEngine?.(null);
    };
    // Engine lifecycle mounts once per host (and once more on a context-loss
    // recovery); prop changes below are applied through dedicated effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    engine.current?.setFraming(framing);
  }, [framing]);

  useEffect(() => {
    engine.current?.setTracking(tracking && !paused);
  }, [tracking, paused]);

  useEffect(() => {
    engine.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    engine.current?.setActive(active);
  }, [active]);

  const toggle = () => {
    applyPaused(!pausedRef.current);
  };

  return (
    <div ref={wrapper} className={`k3d${className ? ` ${className}` : ""}`} data-status={status}>
      {posterSrc ? <img className="k3d-poster" src={posterSrc} alt="" aria-hidden="true" /> : null}
      {status === "loading" && (
        <p className="k3d-status" role="status">
          Loading character…
        </p>
      )}
      {status === "error" && (
        <p className="k3d-status" data-kind="error" role="status">
          <strong>3D character unavailable</strong>
          {errorNote || "The model could not be loaded on this device."}
        </p>
      )}
      {controls && status === "ready" && (
        <button className="k3d-pause" type="button" aria-pressed={paused} onClick={toggle}>
          {paused ? "Resume character animation" : "Pause character animation"}
        </button>
      )}
    </div>
  );
}
