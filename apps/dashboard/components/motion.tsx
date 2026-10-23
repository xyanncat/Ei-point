"use client";
// Motion primitives. Every entrance on the site comes from here so the whole
// surface moves with one grammar: rise + de-blur, expo-out, staggered.
//
// Reduced motion is honoured at the primitive level — when the visitor asks
// for less movement the content is simply present, never animated into place.
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

function useOnce(amount = 0.25) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, amount });
  return { ref, inView };
}

export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
  amount = 0.25,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  amount?: number;
}) {
  const reduce = useReducedMotion();
  const { ref, inView } = useOnce(amount);
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduce ? false : { opacity: 0, y, filter: "blur(10px)" }}
      animate={inView || reduce ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.75, delay, ease: EASE }
      }
    >
      {children}
    </motion.div>
  );
}

const groupVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.075, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(8px)" },
  shown: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE },
  },
};

export function Stagger({
  children,
  className,
  amount = 0.15,
}: {
  children: ReactNode;
  className?: string;
  amount?: number;
}) {
  const reduce = useReducedMotion();
  const { ref, inView } = useOnce(amount);
  return (
    <motion.div
      ref={ref}
      className={className}
      variants={reduce ? undefined : groupVariants}
      initial={reduce ? false : "hidden"}
      animate={inView || reduce ? "shown" : undefined}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduce ? undefined : itemVariants}
    >
      {children}
    </motion.div>
  );
}

/** Word-by-word reveal: each word rises out of its own mask. */
export function KineticTitle({
  text,
  className,
  as: Tag = "h1",
  delay = 0,
}: {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "h3" | "p";
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const { ref, inView } = useOnce(0.3);
  const words = text.split(" ");
  const MotionTag = motion[Tag] as typeof motion.h1;
  if (reduce) {
    return (
      <Tag className={className} ref={ref as never}>
        {text}
      </Tag>
    );
  }
  return (
    <MotionTag
      ref={ref as never}
      className={`kinetic ${className ?? ""}`}
      initial="hidden"
      animate={inView ? "shown" : "hidden"}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: 0.055, delayChildren: delay } },
      }}
    >
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="kinetic__word">
            <motion.span
              className="kinetic__inner"
              variants={{
                hidden: { y: "110%" },
                shown: {
                  y: "0%",
                  transition: { duration: 0.85, ease: EASE },
                },
              }}
            >
              {word}
            </motion.span>
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </MotionTag>
  );
}

/** Page transition: the whole route enters with the site grammar — rise +
    de-blur, expo-out — every time the pathname changes. Keyed by route so a
    fresh mount replays the entrance; reduced motion renders plain content. */
export function PageTransition({
  routeKey,
  children,
  className,
}: {
  routeKey: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      key={routeKey}
      className={className}
      initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Hairline progress rail pinned to the top of the viewport. */
export function ScrollProgress() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 220,
    damping: 40,
    restDelta: 0.001,
  });
  if (reduce) return null;
  return (
    <motion.div
      className="scroll-progress"
      style={{ scaleX }}
      aria-hidden="true"
    />
  );
}

/** Slow vertical drift for layered background copy. */
export function Parallax({
  children,
  distance = 60,
  className,
}: {
  children: ReactNode;
  distance?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useSpring(
    useTransform(scrollYProgress, [0, 1], [distance, -distance]),
    { stiffness: 120, damping: 30, restDelta: 0.01 },
  );
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} style={{ y }}>
      {children}
    </motion.div>
  );
}

/** Count-up number that settles when it scrolls into view. */
export function CountUp({
  to,
  suffix = "",
  className,
}: {
  to: number;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const { ref, inView } = useOnce(0.6);
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / 1100, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(to * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduce, to]);

  return (
    <span ref={ref} className={className}>
      {value}
      {suffix}
    </span>
  );
}
