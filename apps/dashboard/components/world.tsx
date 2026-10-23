"use client";
// The World layer. One fixed film that every page sits on, and the soundtrack
// under it. The film is the interface: it is not a panel, it is not a widget,
// it is the page. It loops forever and the music loops with it.
//
// There is deliberately no play/pause control in the interface. The one thing
// a visitor can do is nothing, and the film keeps running.
//
//   - the film is muted so browsers allow it to autoplay
//   - the soundtrack starts as soon as the browser allows audible playback
//     (in practice the first interaction) at 20% volume, locked to the
//     film's clock, crossfading to silence at every loop point
//   - logged-in sub-pages open on their own character scene of the same film
//   - prefers-reduced-motion never plays the film: the scene still stands in
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
const SOUNDTRACK_SRC = "/media/loop.mp3";

/** The soundtrack sits at 20%: present, never in front of the reading. */
const BASE_VOLUME = 0.2;
/** Seconds over which the music crossfades to silence at the loop point. */
const FADE_OUT = 2.5;
/** Seconds over which the music fades back in after the loop point. */
const FADE_IN = 1.5;
/** Drift beyond this (seconds) is corrected, so lip and beat never wander. */
const SYNC_TOLERANCE = 0.3;

type Scene = {
  poster: string;
  /** Seconds into the 149.3s film where this scene lives. */
  time: number;
  label: string;
};

const DEFAULT_SCENE: Scene = {
  poster: "/media/posters/ambient.jpg",
  time: 0,
  label: "Ei point",
};

// One character scene per logged-in surface, all cut from the same film.
function sceneForPath(pathname: string): Scene {
  if (pathname.startsWith("/account/services"))
    return {
      poster: "/media/posters/ch4-stage.jpg",
      time: 60,
      label: "Services",
    };
  if (pathname.startsWith("/account/orders/"))
    return {
      poster: "/media/posters/ch8-orb.jpg",
      time: 140,
      label: "Order detail",
    };
  if (pathname.startsWith("/account/orders"))
    return {
      poster: "/media/posters/ch7-throne.jpg",
      time: 124,
      label: "Purchase logs",
    };
  if (pathname.startsWith("/account"))
    return {
      poster: "/media/posters/ch3-starfield.jpg",
      time: 42,
      label: "Servers",
    };
  if (pathname === "/login")
    return {
      poster: "/media/posters/ch2-street.jpg",
      time: 22,
      label: "Sign in",
    };
  return DEFAULT_SCENE;
}

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
  const prefersReduced = useReducedMotion();
  // Data-saver / 2G visitors get the still frame, never the 90 MB film or
  // the soundtrack: same art direction, zero heavy bytes. Quality is
  // untouched for everyone else — this only reroutes the constrained.
  const [liteMotion, setLiteMotion] = useState(false);
  useEffect(() => {
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      connection &&
      (connection.saveData || /^(slow-2g|2g)$/.test(connection.effectiveType ?? ""))
    ) {
      setLiteMotion(true);
    }
  }, []);
  const reduce = prefersReduced || liteMotion;
  const pathname = usePathname();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const scene = useMemo(() => sceneForPath(pathname ?? "/"), [pathname]);

  // The soundtrack. Browsers only allow audible autoplay once the visitor has
  // interacted with the site, so the attempt happens on load and is retried
  // on the first interaction of any kind. There is no button for it: the
  // music is part of the film, not a feature.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || reduce) return;
    audio.volume = BASE_VOLUME;

    const start = () => {
      if (audio.paused) void audio.play().catch(() => {});
    };
    start();

    const unlock = () => {
      // Start the music on the film's clock, not from zero, so the two match
      // from the first audible bar.
      const video = videoRef.current;
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        try {
          audio.currentTime = Math.min(video.currentTime, audio.duration || 0);
        } catch {
          /* metadata not ready — the sync loop settles it */
        }
      }
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

  // Lock the music to the film's clock and crossfade it to silence at the
  // loop point, so the restart never clicks. The film is the master: the
  // audio follows it, never the other way round.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || reduce) return;

    const sync = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const vt = video.currentTime;
      // The loop restart: the film jumps home, so the music jumps with it.
      if (vt < 0.6) {
        const at = audio.currentTime;
        const ad = audio.duration;
        if (
          Number.isFinite(ad) &&
          ad > 0 &&
          (at > ad - 1.2 || Math.abs(at - vt) > 1)
        ) {
          try {
            audio.currentTime = Math.min(vt, ad - 0.05);
          } catch {
            /* seeking before metadata — the next tick settles it */
          }
        }
      } else if (
        Number.isFinite(audio.duration) &&
        Math.abs(audio.currentTime - vt) > SYNC_TOLERANCE
      ) {
        try {
          audio.currentTime = Math.min(vt, audio.duration - 0.05);
        } catch {
          /* seeking before metadata — the next tick settles it */
        }
      }
      // Crossfade to 0 across the last FADE_OUT seconds, back up over the
      // first FADE_IN seconds. Silence, not a cut.
      const fadeOut = Math.min(Math.max((duration - vt) / FADE_OUT, 0), 1);
      const fadeIn = Math.min(Math.max(vt / FADE_IN, 0), 1);
      audio.volume = BASE_VOLUME * Math.min(fadeOut, fadeIn);
    };

    video.addEventListener("timeupdate", sync);
    video.addEventListener("seeked", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("seeked", sync);
    };
  }, [reduce]);

  // Each logged-in sub-page opens on its own character scene of the same
  // film, then keeps playing from there. Same footage, different moment.
  useEffect(() => {
    if (reduce) return;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = Math.min(Math.max(scene.time, 0), video.duration - 0.1);
    if (Math.abs(video.currentTime - target) > 0.5) {
      try {
        video.currentTime = target;
      } catch {
        /* metadata not ready — the default start is fine */
      }
      if (audio && !audio.paused && Number.isFinite(audio.duration)) {
        try {
          audio.currentTime = Math.min(target, audio.duration - 0.05);
        } catch {
          /* the sync loop settles it */
        }
      }
    }
  }, [reduce, scene.time, pathname]);

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
          const video = videoRef.current;
          if (video && Number.isFinite(video.duration)) {
            try {
              audio.currentTime = Math.min(
                video.currentTime,
                audio.duration || 0,
              );
            } catch {
              /* the sync loop settles it */
            }
          }
          void audio.play().then(() => setSoundOn(true)).catch(() => {});
        }
      },
    }),
    [soundOn],
  );

  return (
    <WorldContext.Provider value={value}>
      <div className={`world world--${tone}`} aria-hidden="true">
        <div
          className="world__poster"
          style={{ backgroundImage: `url("${scene.poster}")` }}
        />
        <motion.video
          ref={videoRef}
          className="world__video"
          poster={scene.poster}
          aria-label={scene.label}
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
        {tone === "calm" ? (
          <div
            className="world__scene"
            style={{ backgroundImage: `url("${scene.poster}")` }}
          />
        ) : null}
        <div className="world__grain" />
        <div className="world__vignette" />
      </div>
      <audio ref={audioRef} src={SOUNDTRACK_SRC} loop preload="auto" />
      {children}
    </WorldContext.Provider>
  );
}
