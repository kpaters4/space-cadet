"use client";

// Click-to-load game frame: a poster first, so the game only downloads when asked for.

import { useRef, useState } from "react";

export default function GameEmbed() {
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // Give the game keyboard focus as soon as it has loaded.
  const focusGame = () => {
    frame.current?.focus();
    frame.current?.contentWindow?.focus();
  };

  return (
    <div className="game-wrap">
      <div className="game-frame" data-game-frame>
        {loaded ? (
          <iframe
            ref={frame}
            src="/game/world.html"
            title="Space Cadet game"
            allow="fullscreen"
            onLoad={focusGame}
          />
        ) : (
          <button type="button" className="game-poster" onClick={() => setLoaded(true)}>
            <span className="game-poster-title">Space Cadet</span>
            <span className="game-poster-button">Launch the game</span>
          </button>
        )}
      </div>
      <a
        href="/game/world.html"
        target="_blank"
        rel="noopener noreferrer"
        className="button-outline"
      >
        Play fullscreen
      </a>
    </div>
  );
}
