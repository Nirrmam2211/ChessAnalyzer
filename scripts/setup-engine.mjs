// The Stockfish 19 engine is not committed to git: its NNUE network is 94.5 MB,
// which would sit in the repository history forever. It ships inside the
// "stockfish" npm package instead, and this script copies the two files the
// browser needs into public/ under the fixed names the app loads.
//
//   npm run setup:engine          strongest build  (94.5 MB, full NNUE network)
//   npm run setup:engine -- lite  small build      (1.7 MB, slightly weaker)
//
// Both modes also install the lite pair as stockfish-lite.js/.wasm, the fallback the
// app boots when the full network cannot be fetched in time.
//
// Keep the destination names exactly as they are: the engine's Emscripten glue
// derives its wasm URL from the loading script's own filename (.js -> .wasm), so
// renaming them makes the engine boot and then never answer the UCI handshake.
//
// Runs are idempotent: an already-copied file of the right size is left alone, so
// the predev/prebuild hooks and the Vite plugin cost nothing after the first run.
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Resolved from this file rather than the current working directory, so the copy
// lands in the project correctly whether npm, Vite or a bare node run started us.
const projectRoot = path.join(import.meta.dirname, "..");
const binDir = path.join(projectRoot, "node_modules", "stockfish", "bin");
const publicDir = path.join(projectRoot, "public");

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

/**
 * Copies the engines into public/ and returns a line per file describing what happened.
 * Pass { lite: true } to make the small build the primary engine. Rejects if the
 * stockfish package is absent.
 *
 * The lite pair is always copied, whatever the primary: the app falls back to
 * /stockfish-lite.js when the 94.5 MB network cannot download on a slow connection,
 * which is better than dropping the report to heuristics.
 */
export async function setupEngine({ lite = false } = {}) {
  await mkdir(publicDir, { recursive: true });
  const primaryBase = `stockfish-19-${lite ? "lite-" : ""}single`;
  const fallbackBase = "stockfish-19-lite-single";

  return [
    await copyIfStale(`${primaryBase}.js`, "stockfish.js"),
    await copyIfStale(`${primaryBase}.wasm`, "stockfish.wasm"),
    await copyIfStale(`${fallbackBase}.js`, "stockfish-lite.js"),
    await copyIfStale(`${fallbackBase}.wasm`, "stockfish-lite.wasm"),
  ];
}

// Only behave like a command line tool when this file is executed directly, so that
// importing it (vite.config.js) gets the function and nothing else.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const results = await setupEngine({ lite: process.argv.includes("lite") });
    console.log(`Stockfish ready in public/:\n  ${results.join("\n  ")}`);
  } catch (err) {
    console.error(
      `Could not set up the Stockfish engine: ${err.message}\n` +
        "  Run \"npm install\" first - the engine binaries come from the stockfish package."
    );
    process.exitCode = 1;
  }
}
