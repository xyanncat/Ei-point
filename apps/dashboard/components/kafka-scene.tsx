"use client";
import { useState } from "react";

export function KafkaScene() {
  const [paused, setPaused] = useState(false);
  return (
    <div
      className={`kafka-scene${paused ? " is-paused" : ""}`}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          "--kafka-x",
          `${((event.clientX - box.left) / box.width - 0.5) * 12}px`,
        );
        event.currentTarget.style.setProperty(
          "--kafka-y",
          `${((event.clientY - box.top) / box.height - 0.5) * 8}px`,
        );
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--kafka-x", "0px");
        event.currentTarget.style.setProperty("--kafka-y", "0px");
      }}
    >
      <div className="kafka-stage" aria-hidden="true">
        <span className="kafka-name">KAFKA</span>
        <div className="kafka-orbit" />
        <svg className="kafka-threads" viewBox="0 0 600 500" fill="none">
          <path d="M-80 420C130 30 400 560 680 80M-80 450C180 110 380 530 680 130M-80 380C190 0 390 450 680 40" />
        </svg>
        <img
          className="kafka-character"
          src="/art/kafka-hero.png"
          alt=""
          fetchPriority="high"
        />
        {[0, 1, 2, 3].map((n) => (
          <span key={n} className={`kafka-butterfly butterfly-${n}`}>
            <i />
            <i />
          </span>
        ))}
        <span className="kafka-signature">Stellaron Hunter · 01</span>
      </div>
      <button
        className="kafka-motion"
        onClick={() => setPaused(!paused)}
        aria-pressed={paused}
        aria-label={
          paused ? "Resume character animation" : "Pause character animation"
        }
      >
        {paused ? "▶ Motion paused" : "Ⅱ Pause motion"}
      </button>
    </div>
  );
}
