# Chess Analyzer — Chess.com Review Studio

A client-side chess review studio: import a Chess.com game, get a Stockfish-graded
report (centipawn loss per move, move classifications, phase breakdown, training
advice), review it move by move on a live board, and play games against the engine.

Everything runs in the browser. There is no backend beyond a static file server, so
no accounts, no database, and no games leave your machine.

## Quick start

```bash
npm install
npm run setup:engine   # copies Stockfish 19 into public/ (also runs automatically before dev/build)
npm run dev            # http://localhost:5173
```

The engine binary is **not** committed to this repository: `stockfish.wasm` is 94.5 MB
and would live in the git history forever. It ships inside the [`stockfish`][stockfish]
npm package, and [`scripts/setup-engine.mjs`](scripts/setup-engine.mjs) copies the two
files the app loads into `public/`:

```bash
npm run setup:engine          # strongest build, 94.5 MB NNUE network
npm run setup:engine -- lite  # 1.7 MB build, slightly weaker but instant to download
```

The destination names must stay `public/stockfish.js` and `public/stockfish.wasm`: the
engine derives its wasm URL from the loading script's own filename, so renaming or
wrapping the script makes the engine boot and then never answer the UCI handshake.

`vite.config.js` runs the same copy as a plugin at build start, so a build that bypasses
the npm scripts (`vite build`, or a hosting build command typed by hand) still ships a
working engine instead of a site whose worker 404s.

## Using the app

1. **Load a game.** Paste a Chess.com game URL *plus* one player's username, or paste a
   PGN export. The URL path uses Chess.com's public archives API
   (`/pub/player/{username}/games/archives`) because the game page itself cannot be
   fetched from a browser (CORS). The username is required: the public API only groups
   games by player.
2. **Pick a side and a depth.** "Analyze as" chooses which player is graded (`auto`
   matches your username against the PGN headers). Two separate depth controls exist
   because they have very different costs:
   - **Live eval speed** — the always-on evaluation bar and principal line.
   - **Report depth** — the per-move search used for the full-game report. Higher is
     closer to Chess.com's verdicts but takes noticeably longer.
3. **Review.** The report grades every move of the selected side, and the board steps
   through the game. Keyboard: `←` / `→` step moves, `Home` / `End` jump, `F` flips the
   board. Arrows are ignored while you are typing in a text field.
4. **Play vs Engine** to play a game against it, or **Free Analysis** to load any FEN or
   position and evaluate it live.

## What the grading means

Each of your moves is searched before and after it is played. The engine reports scores
from the point of view of the side to move, so the score is normalised to the mover, then
to you, and the difference is the centipawn loss for that move:

| Label | Centipawn loss |
| --- | --- |
| Best | also assigned when the move matches the engine's top choice |
| Excellent | ≤ 35 |
| Good | ≤ 70 |
| Inaccuracy | ≤ 140 |
| Mistake | ≤ 260 |
| Blunder | above that |

Mate scores are kept as a separate flag rather than a giant number, so a forced mate
prints as `M3` (or `M0` for a position that is already mate/stalemate) and one missed mate
cannot wreck the average centipawn loss for the whole game.

At the lowest depths a single-threaded WASM engine genuinely disagrees with Chess.com on
quiet positional moves; raise **Report depth** if you want closer agreement.

## Project layout

```
src/App.jsx                    orchestration: engine worker, UCI plumbing, analysis runs, keyboard nav
src/utils/chessAnalyzer.js     phases, themes, centipawn loss, classifications, report copy
src/components/                board + eval bar + HUD, input form, move list, report dashboard
scripts/setup-engine.mjs       copies the Stockfish binaries from node_modules into public/
server.js                      static server for dist/ (correct application/wasm + cache headers)
vercel.json                    same cache headers for a Vercel deployment
```

## Production build

```bash
npm run build   # outputs to dist/
npm run serve   # node server.js, serves dist/
```

`server.js` streams files with `fs.stat` + `createReadStream`, sends
`Content-Type: application/wasm` (required for `WebAssembly.instantiateStreaming`,
without which the engine falls back to a slow ArrayBuffer path) and caches engine
assets for a day so repeat visits do not re-download 94.5 MB.

## Stack

React 19, Vite 8, [chess.js][chessjs] for rules, [react-chessboard][rcb] for the board,
[lucide-react][lucide] for icons, [Stockfish 19][stockfish] (NNUE, single-thread WASM) over
a Web Worker speaking UCI, and [oxlint][oxlint] for linting.

[stockfish]: https://www.npmjs.com/package/stockfish
[chessjs]: https://github.com/jhlywa/chess.js
[rcb]: https://github.com/Clariity/react-chessboard
[lucide]: https://lucide.dev
[oxlint]: https://oxc.rs/docs/guide/usage/linter
