"use client";

// Drives the page's scroll experience:
//   - a fixed WebGL canvas (three.js, loaded lazily) with the ship rising as you scroll
//   - the altitude readout on the side
//   - chapter fade-ins (IntersectionObserver)
// Scroll values are eased in one requestAnimationFrame loop. The loop stops while the
// game is on screen or the tab is hidden; with reduced motion it renders only on scroll.

import { useEffect, useRef } from "react";
import type { LaunchScene as Scene } from "@/three/scene";
import { CHAPTERS } from "@/content/chapters";

const SMOOTHING = 0.12;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export default function LaunchScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const root = rootRef.current!;
    const kmText = root.querySelector<HTMLElement>("[data-km]")!;
    const nameText = root.querySelector<HTMLElement>("[data-chapter-name]")!;
    const fill = root.querySelector<HTMLElement>("[data-fill]")!;
    const ticks = [...root.querySelectorAll<HTMLElement>("[data-tick]")];

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let scene: Scene | null = null;
    let disposed = false;
    let raf = 0;
    let gameOnScreen = false;
    let cur = window.scrollY;
    let last = cur;
    let speed = 0;
    let lastKm = -1;
    let lastChapter = -1;
    const t0 = performance.now();

    // Layout reads only here (load, resize, content changes), never per frame.
    let tops: number[] = [];
    let vh = window.innerHeight;
    let climbEnd = 1, spaceEnd = 2, maxScroll = 1;
    const measure = () => {
      vh = window.innerHeight;
      maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
      tops = CHAPTERS.map((c) => {
        const el = document.getElementById(c.id);
        return el ? el.getBoundingClientRect().top + window.scrollY : 0;
      });
      const predict = document.getElementById("predict");
      const play = document.getElementById("play");
      climbEnd = Math.max(1, (predict ? predict.getBoundingClientRect().top + window.scrollY : vh) - vh * 0.35);
      const playEl = play ? play.getBoundingClientRect() : null;
      spaceEnd = Math.max(climbEnd + 1, playEl ? playEl.top + window.scrollY + playEl.height / 2 - vh / 2 : maxScroll);
      scene?.resize(window.innerWidth, vh);
    };

    const draw = (y: number, now: number) => {
      const climb = clamp(y / climbEnd);
      const space = clamp((y - climbEnd) / (spaceEnd - climbEnd));

      // readout: 0-100 km during the climb, 100-780 km through space (compressed scale)
      const km = Math.round(climb < 1 ? climb * 100 : 100 + space * 680);
      if (km !== lastKm) {
        lastKm = km;
        kmText.textContent = km.toLocaleString("en-US");
      }
      const mid = y + vh * 0.45;
      let ch = 0;
      while (ch < tops.length - 1 && mid >= tops[ch + 1]) ch++;
      if (ch !== lastChapter) {
        lastChapter = ch;
        nameText.textContent = CHAPTERS[ch].readout;
        ticks.forEach((t) => (Number(t.dataset.tick) === ch ? t.setAttribute("aria-current", "step") : t.removeAttribute("aria-current")));
      }
      fill.style.transform = `scaleY(${clamp(y / maxScroll).toFixed(4)})`;

      if (scene) {
        scene.update({ climb, space, speed, time: (now - t0) / 1000, animate: !reduced });
        scene.render();
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (disposed || gameOnScreen || document.hidden) return;
      const target = window.scrollY;
      cur = reduced ? target : cur + (target - cur) * SMOOTHING;
      if (Math.abs(target - cur) < 0.2) cur = target;
      speed = speed * 0.85 + (cur - last) * 0.15;
      last = cur;
      draw(cur, now);
      // keep running for the idle motion (engine flicker, drifting debris) unless reduced
      if (!reduced || cur !== target) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && !disposed && !gameOnScreen && !document.hidden) raf = requestAnimationFrame(frame);
    };

    // Chapter fade-ins.
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          reveal.unobserve(e.target);
        }
      }),
      { threshold: 0.12 },
    );
    document.querySelectorAll(".reveal").forEach((n) => reveal.observe(n));

    // Pause rendering while the game frame is mostly on screen.
    const gameWatch = new IntersectionObserver(
      ([e]) => {
        const on = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (on === gameOnScreen) return;
        gameOnScreen = on;
        root.classList.toggle("scene-paused", on);
        if (on) {
          cancelAnimationFrame(raf);
          raf = 0;
          // settle on the final values before stopping, so the readout shows the debris field
          cur = last = window.scrollY;
          speed = 0;
          measure();
          draw(cur, performance.now());
        } else kick();
      },
      { threshold: [0, 0.5, 1] },
    );
    const game = document.querySelector("[data-game-frame]");
    if (game) gameWatch.observe(game);

    const onResize = () => {
      measure();
      kick();
    };
    const onMotion = () => {
      reduced = motion.matches;
      kick();
    };
    const onVisibility = () => kick();
    const resizeWatch = new ResizeObserver(onResize);
    resizeWatch.observe(document.body);

    measure();
    draw(cur, performance.now());
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", onResize);
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);

    // Load three.js and the models after first paint; fall back to a CSS sky without WebGL.
    import("@/three/scene")
      .then(({ createLaunchScene }) => {
        if (disposed) return;
        try {
          scene = createLaunchScene(canvas);
          scene.resize(window.innerWidth, window.innerHeight);
          root.classList.add("scene-ready");
          draw(cur, performance.now());
          kick();
        } catch (err) {
          console.warn("WebGL unavailable, showing the plain background instead.", err);
          root.classList.add("scene-fallback");
        }
      })
      .catch(() => root.classList.add("scene-fallback"));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      reveal.disconnect();
      gameWatch.disconnect();
      resizeWatch.disconnect();
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", onResize);
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      scene?.dispose();
    };
  }, []);

  return (
    <div ref={rootRef} className="scene-root">
      <div className="scene-fallback-sky" aria-hidden="true" />
      <canvas ref={canvasRef} className="scene-canvas" aria-hidden="true" />

      <aside className="readout" aria-label="Altitude">
        <div className="panel readout-panel">
          <p className="readout-km">
            <span data-km>0</span> <span className="readout-unit">km</span>
          </p>
          <p data-chapter-name className="readout-name">
            {CHAPTERS[0].readout}
          </p>
          <nav className="readout-track" aria-label="Sections">
            <span className="readout-rail" aria-hidden="true">
              <span data-fill className="readout-fill" />
            </span>
            <ol>
              {CHAPTERS.map((c, k) => ({ c, k }))
                .reverse()
                .map(({ c, k }) => (
                  <li key={c.id}>
                    <a data-tick={k} href={`#${c.id}`} className="readout-tick">
                      <span className="readout-dot" aria-hidden="true" />
                      {c.label}
                    </a>
                  </li>
                ))}
            </ol>
          </nav>
          <p className="readout-note">Altitude not to scale</p>
        </div>
      </aside>
    </div>
  );
}
