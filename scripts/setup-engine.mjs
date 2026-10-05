// The Stockfish 19 engine is not committed to git: its NNUE network is 94.5 MB,
// which would sit in the repository history forever. It ships inside the
// "stockfish" npm package instead, and this script copies the two files the
// browser needs into public/ under the fixed names the app loads.
//
//   npm run setup:engine          strongest build  (94.5 MB, full NNUE network)
//   npm run setup:engine -- lite  small build      (1.7 MB, slightly weaker)
//
// Keep the destination names exactly as they are: the engine's Emscripten glue
// derives its wasm URL from the loading script's own filename (.js -> .wasm), so
// renaming them makes the engine boot and then never answer the UCI handshake.
//
// Runs are idempotent: an already-copied file of the right size is left alone, so
// the predev/prebuild hooks cost nothing after the first run.
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const useLite = process.argv.includes("lite");
const sourceBase = `stockfish-19-${useLite ? "lite-" : ""}single`;
const binDir = path.join("node_modules", "stockfish", "bin");
const publicDir = "public";

async function sizeOf(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

async function copyIfStale(sourceName, targetName) {
  const from = path.join(binDir, sourceName);
  const to = path.join(publicDir, targetName);
  const sourceSize = await sizeOf(from);

  if (sourceSize === null) {
    throw new Error(`missing ${path.join("node_modules", "stockfish", "bin", sourceName)}`);
  }
  if ((await sizeOf(to)) === sourceSize) {
    return `${targetName} already in place`;
  }

  await copyFile(from, to);
  return `${targetName} copied (${(sourceSize / 1048576).toFixed(2)} MB)`;
}

async function main() {
  await mkdir(publicDir, { recursive: true });

  try {
    const results = [
      await copyIfStale(`${sourceBase}.js`, "stockfish.js"),
      await copyIfStale(`${sourceBase}.wasm`, "stockfish.wasm"),
    ];
    console.log(`Stockfish ready in public/ (${sourceBase}):\n  ${results.join("\n  ")}`);
  } catch (err) {
    console.error(
      `Could not set up the Stockfish engine: ${err.message}\n` +
        "  Run \"npm install\" first - the engine binaries come from the stockfish package."
    );
    process.exitCode = 1;
  }
}

main();
