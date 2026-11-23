"use client";

// Click-to-load game frame: a poster first, so the game only downloads when asked for.

import { useRef, useState } from "react";
import { Gamepad2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GameEmbed() {
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const focusGame = () => {
    frame.current?.focus();
    frame.current?.contentWindow?.focus();
  };

  return (
    <div className="game-wrap">
      <div className="game-frame" data-game-frame>
        {loaded ? (
          <iframe ref={frame} src="/game/world.html" title="Space Cadet game" allow="fullscreen" onLoad={focusGame} />
        ) : (
          <button type="button" className="game-poster" onClick={() => setLoaded(true)}>
            <span className="game-poster-title">Space Cadet</span>
            <span className="game-poster-button">
              <Gamepad2 aria-hidden="true" /> Launch the game
            </span>
          </button>
        )}
      </div>
      <Button asChild variant="outline">
        <a href="/game/world.html" target="_blank" rel="noopener noreferrer">
          <Maximize2 aria-hidden="true" /> Play fullscreen
        </a>
      </Button>
    </div>
  );
}
