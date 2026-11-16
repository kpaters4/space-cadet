"use client";

// The scrolling atmosphere behind the page: sky layers, stars, passing objects
// on three parallax tracks, chapter reveals and the fixed altitude readout.
// Every per-frame write is a transform or an opacity.

import { useEffect, useRef } from "react";
import { LAYERS } from "@/components/layers";

const SMOOTHING = 0.14; // share of the remaining distance covered each frame
const SPEEDS = { far: 0.15, mid: 0.4, near: 0.8 } as const;
type Track = keyof typeof SPEEDS;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function AscentScene() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;

    const skies = [...el.querySelectorAll<HTMLElement>("[data-sky]")];
    const stars = el.querySelector<HTMLElement>("[data-stars]")!;
    const tracks = [...el.querySelectorAll<HTMLElement>("[data-track]")];
    const objects = [...el.querySelectorAll<HTMLElement>("[data-obj]")];
    const kmText = el.querySelector<HTMLElement>("[data-km]")!;
    const layerText = el.querySelector<HTMLElement>("[data-layer-name]")!;
    const fill = el.querySelector<HTMLElement>("[data-fill]")!;
    const ticks = [...el.querySelectorAll<HTMLElement>("[data-tick]")];

    let chapters: { top: number; height: number }[] = [];
    let vh = window.innerHeight;
    let maxScroll = 1;
    let cur = window.scrollY;
    let raf = 0;
    let paused = false;
    let lastKm = -1;
    let lastLayer = -1;
    const lastOpacity = new Map<HTMLElement, number>();

    const setOpacity = (node: HTMLElement, value: number) => {
      const v = Math.round(value * 1000) / 1000;
      if (lastOpacity.get(node) !== v) {
        lastOpacity.set(node, v);
        node.style.opacity = String(v);
      }
    };

    // Layout reads happen here only (on load, resize and content changes), never per frame.
    const measure = () => {
      vh = window.innerHeight;
      maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
      chapters = LAYERS.map((l) => {
        const s = document.getElementById(l.id);
        if (!s) return { top: 0, height: 1 };
        const r = s.getBoundingClientRect();
        return { top: r.top + window.scrollY, height: Math.max(1, r.height) };
      });
      // Place each object so it passes mid-screen while its chapter is centred.
      for (const o of objects) {
        const c = chapters[Number(o.dataset.chapter)];
        const speed = reduced ? 1 : SPEEDS[o.closest<HTMLElement>("[data-track]")!.dataset.track as Track];
        const centredScroll = c.top + c.height / 2 - vh / 2;
        o.style.top = `${Number(o.dataset.y) * vh + speed * centredScroll}px`;
      }
    };

    const render = (y: number) => {
      // Which chapter is under the middle of the screen, and how far through it.
      const mid = y + vh / 2;
      let i = 0;
      while (i < chapters.length - 1 && mid >= chapters[i + 1].top) i++;
      const t = clamp((mid - chapters[i].top) / chapters[i].height, 0, 1);
      const [k0, k1] = LAYERS[i].km;
      const km = Math.round(k0 + (k1 - k0) * t);
      // Continuous layer position: each chapter's own colours sit at its centre.
      const f = clamp(i + t - 0.5, 0, LAYERS.length - 1);

      // Each sky fades in over the fully opaque one beneath it: an exact linear blend.
      skies.forEach((s, k) => k > 0 && setOpacity(s, clamp(f - (k - 1), 0, 1)));
      setOpacity(stars, clamp((f - 1.4) / 1.6, 0, 1));
      for (const o of objects) {
        const d = Math.abs(f - Number(o.dataset.chapter));
        setOpacity(o, clamp(1 - (d - 0.35) / 0.55, 0, 1));
      }
      for (const tr of tracks) {
        const speed = reduced ? 1 : SPEEDS[tr.dataset.track as Track];
        tr.style.transform = `translate3d(0, ${(-y * speed).toFixed(1)}px, 0)`;
      }

      fill.style.transform = `scaleY(${clamp(y / maxScroll, 0, 1).toFixed(4)})`;
      if (km !== lastKm) {
        lastKm = km;
        kmText.textContent = String(km);
      }
      if (i !== lastLayer) {
        lastLayer = i;
        layerText.textContent = LAYERS[i].name;
        for (const tk of ticks) {
          if (Number(tk.dataset.tick) === i) tk.setAttribute("aria-current", "step");
          else tk.removeAttribute("aria-current");
        }
      }
    };

    // rAF loop that eases toward the real scroll position and stops when settled.
    const tick = () => {
      raf = 0;
      if (paused) return;
      const target = window.scrollY;
      cur = reduced ? target : cur + (target - cur) * SMOOTHING;
      if (Math.abs(target - cur) < 0.25) cur = target;
      render(cur);
      if (cur !== target) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf && !paused) raf = requestAnimationFrame(tick);
    };

    const onResize = () => {
      measure();
      cur = window.scrollY;
      render(cur);
    };
    const onMotionChange = () => {
      reduced = motionQuery.matches;
      onResize();
    };

    // Chapter fade-ins: once each, as it enters the screen.
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            reveal.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".reveal").forEach((n) => reveal.observe(n));

    // Pause the background while the game frame is on screen; resume when it leaves.
    const game = document.querySelector("[data-game-frame]");
    const gameWatch = new IntersectionObserver(
      ([e]) => {
        const onScreen = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (onScreen === paused) return;
        if (onScreen) {
          cur = window.scrollY;
          render(cur); // settle on the final values before stopping
          paused = true;
          el.classList.add("scene-paused");
          cancelAnimationFrame(raf);
          raf = 0;
        } else {
          paused = false;
          el.classList.remove("scene-paused");
          kick();
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    if (game) gameWatch.observe(game);

    const resizeWatch = new ResizeObserver(onResize);
    resizeWatch.observe(document.body);

    measure();
    render(cur);
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", onResize);
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(raf);
      reveal.disconnect();
      gameWatch.disconnect();
      resizeWatch.disconnect();
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", onResize);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <div ref={root} className="scene">
      <div className="scene-back" aria-hidden="true">
        {LAYERS.map((l, k) => (
          <div
            key={l.id}
            data-sky
            className={`sky sky-${l.id}`}
            style={{
              background: `linear-gradient(to bottom, ${l.sky[0]}, ${l.sky[1]})`,
              opacity: k === 0 ? 1 : 0,
            }}
          />
        ))}
        <div data-stars className="stars" style={{ opacity: 0 }} />

        {/* Far track (slowest) */}
        <div className="track-viewport">
          <div data-track="far" className="track">
            <Cloud chapter={0} x={58} y={0.18} w={260} />
            <div data-obj data-chapter={3} data-y={0.08} className="obj" style={{ left: "-10%", opacity: 0 }}>
              <div className="aurora" />
            </div>
          </div>
        </div>

        {/* Mid track */}
        <div className="track-viewport">
          <div data-track="mid" className="track">
            <Obj chapter={0} x={0} y={0.32} full>
              <div className="anim-fly">
                <Plane />
              </div>
            </Obj>
            <Obj chapter={1} x={70} y={0.2}>
              <div className="anim-bob">
                <Balloon />
              </div>
            </Obj>
            <Obj chapter={2} x={45} y={0.12}>
              <div className="meteor-group">
                <span className="meteor" style={{ animationDelay: "0s" }} />
                <span className="meteor" style={{ animationDelay: "1.3s", top: 70, left: 120 }} />
                <span className="meteor" style={{ animationDelay: "2.6s", top: 150, left: -40 }} />
              </div>
            </Obj>
            <Obj chapter={3} x={0} y={0.62} full>
              <div className="anim-orbit">
                <Station />
              </div>
            </Obj>
          </div>
        </div>

        {/* Near track (fastest) */}
        <div className="track-viewport">
          <div data-track="near" className="track">
            <Cloud chapter={0} x={8} y={0.72} w={340} />
            <Cloud chapter={1} x={62} y={0.78} w={220} />
            <Obj chapter={4} x={66} y={0.25}>
              <Specks />
            </Obj>
            <Obj chapter={5} x={4} y={0.12}>
              <Specks />
            </Obj>
          </div>
        </div>
      </div>

      <aside className="readout" aria-label="Altitude">
        <div className="readout-panel">
          <p className="readout-km">
            <span data-km>0</span> <span className="readout-unit">km</span>
          </p>
          <p data-layer-name className="readout-layer">
            {LAYERS[0].name}
          </p>
          <nav className="readout-track" aria-label="Chapters">
            <span className="readout-rail" aria-hidden="true">
              <span data-fill className="readout-fill" />
            </span>
            <ol>
              {/* Listed top-down (highest first); data-tick is the layer's index from the ground. */}
              {LAYERS.map((l, k) => ({ l, k }))
                .reverse()
                .map(({ l, k }) => (
                  <li key={l.id}>
                    <a data-tick={k} href={`#${l.id}`} className="readout-tick">
                      <span className="readout-dot" aria-hidden="true" />
                      <span className="readout-tick-label">{l.name}</span>
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

/* ---- Passing objects (original inline SVG and CSS shapes) ---- */

function Obj({
  chapter,
  x,
  y,
  full,
  children,
}: {
  chapter: number;
  x: number;
  y: number;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-obj
      data-chapter={chapter}
      data-y={y}
      className={`obj${full ? " obj-full" : ""}`}
      style={{ left: `${x}%`, opacity: 0 }}
    >
      {children}
    </div>
  );
}

function Cloud({ chapter, x, y, w }: { chapter: number; x: number; y: number; w: number }) {
  return (
    <Obj chapter={chapter} x={x} y={y}>
      <div className="anim-drift">
        <svg width={w} height={w * 0.38} viewBox="0 0 200 76" className="cloud">
          <ellipse cx="60" cy="50" rx="52" ry="24" />
          <ellipse cx="105" cy="36" rx="46" ry="32" />
          <ellipse cx="150" cy="50" rx="44" ry="22" />
        </svg>
      </div>
    </Obj>
  );
}

function Plane() {
  return (
    <svg width="74" height="26" viewBox="0 0 74 26" className="plane">
      <path d="M2 13 L62 11 Q72 12 72 13 Q72 14 62 15 L2 13Z" />
      <path d="M30 12 L44 1 L49 1 L40 12Z M30 14 L44 25 L49 25 L40 14Z" />
      <path d="M4 13 L2 5 L7 5 L12 12Z" />
    </svg>
  );
}

function Balloon() {
  return (
    <svg width="64" height="130" viewBox="0 0 64 130" className="balloon">
      <ellipse cx="32" cy="34" rx="28" ry="32" className="balloon-envelope" />
      <path d="M32 66 L32 112" className="balloon-line" />
      <rect x="25" y="112" width="14" height="12" rx="2" className="balloon-box" />
    </svg>
  );
}

function Station() {
  return (
    <svg width="96" height="40" viewBox="0 0 96 40" className="station">
      <rect x="4" y="2" width="22" height="36" className="station-panel" />
      <rect x="70" y="2" width="22" height="36" className="station-panel" />
      <rect x="26" y="18" width="44" height="4" className="station-truss" />
      <rect x="40" y="12" width="16" height="16" rx="3" className="station-core" />
    </svg>
  );
}

function Specks() {
  const specks = [
    [0, 0, 10, 4],
    [60, 40, 6, 6],
    [130, 10, 12, 3],
    [30, 110, 5, 5],
    [170, 90, 8, 4],
    [100, 150, 4, 4],
  ];
  return (
    <div className="specks">
      {specks.map(([x, y, w, h], k) => (
        <span
          key={k}
          className="speck"
          style={{ left: x, top: y, width: w, height: h, animationDelay: `${-k * 2.1}s` }}
        />
      ))}
    </div>
  );
}
