"use client";
// The hero. The film is already running behind this; the hero is simply the
// first frame of the site's copy laid over it. There is nothing to click and
// nothing to start: the trailer is the site.
import Link from "next/link";
import { Fragment } from "react";
import { motion, useReducedMotion } from "motion/react";

const TITLE = "Play here. Belong here.";

export function Hero() {
  const reduce = useReducedMotion();
  const words = TITLE.split(" ");

  return (
    <section className="hero" aria-label="Ei point">
      <div className="world-shell hero__inner">
        <div className="hero__copy">
          <motion.p
            className="world-eyebrow"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            30-day account management · five games
          </motion.p>

          <h1 className="hero__title">
            {words.map((word, index) => (
              <Fragment key={`${word}-${index}`}>
                <span className="kinetic__word">
                  <motion.span
                    className="kinetic__inner"
                    initial={reduce ? false : { y: "110%" }}
                    animate={{ y: "0%" }}
                    transition={{
                      duration: 1,
                      delay: 0.2 + index * 0.08,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    {word}
                  </motion.span>
                </span>
                {index < words.length - 1 ? " " : null}
              </Fragment>
            ))}
          </h1>

          <motion.p
            className="hero__lede"
            initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            Ei point provides 30-day account management across Genshin Impact,
            Honkai: Star Rail, Wuthering Waves, Neverness to Everness and
            Arknights: Endfield. Paid over UPI or USDT, verified on this site,
            settled by staff. No app to install, no noise.
          </motion.p>

          <motion.div
            className="hero__actions"
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.75, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link className="ei-action" href="/services">
              See the game services
            </Link>
            <Link className="world-button world-button--ghost" href="/membership">
              Become a member
            </Link>
          </motion.div>
        </div>
      </div>

      <div className="hero__hint" aria-hidden="true">
        scroll
        <i />
      </div>
    </section>
  );
}
