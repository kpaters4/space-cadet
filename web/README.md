# Space Cadet website (D5)

One scrolling page built with Next.js, Tailwind and shadcn/ui. The team's ship (the
game's Astra-9 Mk2, ported to three.js) lifts off from a launch pad and climbs into
space while you scroll. On the way up are the live prediction tool, the D3 results,
the method and limits, and finally the game.

The prediction tool calls the live FastAPI service on Modal (see `../api/README.md`).

## Run locally

```bash
# 1. the API, from the repo root (needs api/pipeline.joblib; see ../api/README.md)
uv run --group api uvicorn api.serve:app --port 8077

# 2. the site, from web/
cp .env.example .env.local     # then set NEXT_PUBLIC_API_URL=http://127.0.0.1:8077
npm install
npm run dev                    # http://localhost:3000
```

`npm run dev` and `npm run build` first copy `../game/world.html` into
`public/game/` (see `scripts/copy-game.mjs`), so the game is never duplicated in git.

## Deploy on Vercel

1. Import the GitHub repo in Vercel and set **Root Directory** to `web`.
2. Add the environment variable `NEXT_PUBLIC_API_URL` = the Modal API URL (no trailing slash).
3. Deploy. The API already allows requests from any `*.vercel.app` address.

## Where things are

| Path | What it does |
|---|---|
| `src/app/page.tsx` | The page: launch pad, predict, results, method, game |
| `src/components/LaunchScene.tsx` | Scroll loop: drives the 3D scene, altitude readout, fade-ins; pauses while the game is on screen |
| `src/three/scene.ts` | The three.js scene: pad, sky, clouds, Earth, stars, satellites, debris, ship and engine flames |
| `src/three/models.ts` | Ship, ISS, Hubble, Iridium, rocket body and debris models, ported from `../game/world_src/js` |
| `src/components/PredictPanel.tsx` | Form calling `/predict`, with loading, result and error states and an API health badge |
| `src/lib/api.ts` | API client: 60 s timeout, typed errors for 422 / 503 / network / timeout |
| `src/content/results.ts` | D3 numbers, copied from the notebooks in `../src/Models/` |
| `src/components/ui/` | shadcn/ui components |

Note: the repo root `.gitignore` ignores every `lib/` folder (Python template), so
`web/.gitignore` re-includes `src/lib/`.
