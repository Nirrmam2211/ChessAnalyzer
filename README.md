# Chess Analyzer

Turn one Chess.com game into a practical training plan. Paste a game link or PGN and get:

- a performance score
- average centipawn loss
- opening, middlegame, and endgame phase ratings
- recurring mistake patterns
- critical move review
- concrete improvement recommendations

## Input options

- Paste a Chess.com game URL
- Paste PGN directly from Chess.com export

PGN is the most reliable option because some Chess.com pages block direct browser extraction.

## Run locally

1. Open a terminal in the project folder
2. Run `node server.js`
3. Open `http://127.0.0.1:3000`

## Deploy on Vercel

This is a fully static, client-side app — no build step or server code is required. All analysis (Stockfish via Web Worker, `chess.js`) runs in the browser.

### Option A — Vercel CLI

1. Install the CLI: `npm i -g vercel`
2. From the project root, run: `vercel` and follow the prompts.
3. To promote a preview to production: `vercel --prod`

### Option B — Git + Vercel dashboard

1. Push this project to a GitHub repo.
2. In the Vercel dashboard choose **New Project** and import the repo.
3. Vercel auto-detects the framework as **Other** (static files). No build command is needed:
   - Build command: *(leave empty)*
   - Output directory: *(leave empty, root)*
4. Click **Deploy**.

The included `vercel.json` configures clean URLs and sensible security/caching headers.

## Notes

- The app uses CDN-hosted `chess.js` and Stockfish, so the browser needs internet access.
- If URL import fails, paste the PGN into the textarea and analyze from there.
- Use the `Load Demo Game` button to test the interface quickly.
