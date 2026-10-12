"use client";
import { useState } from "react";
export function PageArt({ src, caption }: { src: string; caption: string }) {
  const [paused, setPaused] = useState(false);
  return (
    <figure
      className={`ei-page-art${paused ? " is-paused" : ""}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty(
          "--art-x",
          `${((e.clientX - r.left) / r.width - 0.5) * 10}px`,
        );
      }}
      onPointerLeave={(e) =>
        e.currentTarget.style.setProperty("--art-x", "0px")
      }
    >
      <img
        src={src}
        alt="Kafka from Honkai: Star Rail"
        width="736"
        height="1075"
      />
      <svg className="ei-art-silk" viewBox="0 0 400 600" aria-hidden="true">
        <path d="M-60 500Q300 0 470 250M-50 420Q300 30 470 180" />
      </svg>
      <figcaption>{caption}</figcaption>
      <button
        className="ei-art-pause"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? "Resume artwork motion" : "Pause artwork motion"}
        aria-pressed={paused}
      >
        {paused ? "▶" : "Ⅱ"}
      </button>
    </figure>
  );
}
