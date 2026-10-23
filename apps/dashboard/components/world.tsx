"use client";
// The World layer. One fixed film that every page sits on, and the soundtrack
// under it. The film is the interface: it is not a panel, it is not a widget,
// it is the page. It loops forever and the music loops with it.
//
// There is deliberately no play/pause control in the interface. The one thing
// a visitor can do is nothing, and the film keeps running.
//
//   - the film is muted so browsers allow it to autoplay
//   - the soundtrack is a separate element that starts as soon as the browser
//     allows it, and on the first interaction if it does not
//   - prefers-reduced-motion never plays the film: the poster frame stands in
//   - a hidden tab stops decoding; returning resumes
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

const FILM_MP4 = "/media/film-1080.mp4";
const FILM_MOBILE = "/media/film-540.mp4";
const AMBIENT_POSTER = "/media/posters/ambient.jpg";
const SOUNDTRACK_SRC = "/media/loop.mp3";

type WorldState = {
  /** True once the soundtrack is actually running. */
  soundOn: boolean;
  /** Mute or unmute without leaving the page. */
  setMuted: (muted: boolean) => void;
};

const WorldContext = createContext<WorldState>({
  soundOn: false,
  setMuted: () => {},
});

export function useWorld() {
  return useContext(WorldContext);
}

export function WorldProvider({
  children,
  tone = "cinema",
}: {
  children: ReactNode;
  tone?: "cinema" | "calm";
}) {
  const reduce = useReducedMotion();
  const pathname = usePathname();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundOn, setSoundOn] = useState(false);

  // The soundtrack. Browsers only allow audible autoplay once the visitor has
  // interacted with the site, so the attempt happens on load and is retried
  // on the first interaction of any kind. There is no button for it: the
  // music is part of the film, not a feature.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || reduce) return;
    audio.volume = 0.55;

    const start = () => {
      if (audio.paused) void audio.play().catch(() => {});
    };
    start();

    const unlock = () => {
      start();
      if (!audio.paused) {
        setSoundOn(true);
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
        window.removeEventListener("scroll", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("scroll", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("scroll", unlock);
    };
  }, [reduce]);

  // A hidden tab stops decoding and stops the music with it.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      const audio = audioRef.current;
      if (document.hidden) {
        video?.pause();
        audio?.pause();
      } else {
        if (video && !reduce) void video.play().catch(() => {});
        if (audio && !reduce && soundOn) void audio.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reduce, soundOn]);

  // The film never leaves the frame. As the reader moves down the page the
  // crop walks down the source and the picture grows very slightly, so the
  // site reads as one continuous shot rather than a looping background.
  const { scrollYProgress } = useScroll();
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.16]);
  const drift = useTransform(scrollYProgress, [0, 1], ["0%", "-7%"]);
  const crop = useTransform(scrollYProgress, [0, 1], ["50% 32%", "50% 64%"]);

  const value = useMemo(
    () => ({
      soundOn,
      setMuted: (muted: boolean) => {
        const audio = audioRef.current;
        if (!audio) return;
        if (muted) {
          audio.pause();
          setSoundOn(false);
        } else {
          void audio.play().then(() => setSoundOn(true)).catch(() => {});
        }
      },
    }),
    [soundOn],
  );

  return (
    <WorldContext.Provider value={value}>
      <div className={`world world--${tone}`} aria-hidden="true">
        <div className="world__poster" />
        <motion.video
          ref={videoRef}
          className="world__video"
          poster={AMBIENT_POSTER}
          muted
          loop
          playsInline
          autoPlay={!reduce}
          preload="auto"
          style={
            reduce
              ? undefined
              : ({
                  scale,
                  y: drift,
                  "--world-crop": crop,
                } as never)
          }
        >
          <source src={FILM_MOBILE} type="video/mp4" media="(max-width: 820px)" />
          <source src={FILM_MP4} type="video/mp4" />
        </motion.video>
        <div className="world__scrim" />
        <div className="world__grain" />
        <div className="world__vignette" />
      </div>
      <audio ref={audioRef} src={SOUNDTRACK_SRC} loop preload="auto" />
      {children}
    </WorldContext.Provider>
  );
}
