// Copies the game (../game/world.html) into public/game/ so Next.js serves it
// at /game/world.html. Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(webDir, "..", "game", "world.html");
const dest = join(webDir, "public", "game", "world.html");

if (!existsSync(src)) {
  console.error(`copy-game: game file not found at ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copy-game: copied ${src} -> ${dest}`);
