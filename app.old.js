const demoPgn = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2024.06.15"]
[White "TrainingWhite"]
[Black "TrainingBlack"]
[Result "1-0"]
[WhiteElo "1432"]
[BlackElo "1461"]
[TimeControl "600"]
[Termination "TrainingWhite won by resignation"]
[Opening "Queen's Gambit Declined"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 8. cxd5
Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6
15. dxc5 bxc5 16. O-O Ra7 17. Be2 Nd7 18. Nd4 Qf8 19. Nxe6 fxe6 20. e4 d4
21. f4 Qe7 22. e5 Kh8 23. Bc4 Rb8 24. b3 a5 25. Rf3 a4 26. Rcf1 Nb6 27. Bd3 axb3
28. Qxb3 Rab7 29. Bb1 Nd5 30. Qd3 g5 31. fxg5 Qxg5 32. Rf8+ Kg7 33. Qh7# 1-0`;

const engineCdn = "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.js";
const inputDraftStorageKey = "chessAnalyzer.inputDraft";

const elements = {
  gameUrl: document.getElementById("gameUrl"),
  playerName: document.getElementById("playerName"),
  playerColor: document.getElementById("playerColor"),
  engineDepth: document.getElementById("engineDepth"),
  pgnInput: document.getElementById("pgnInput"),
  analyzeButton: document.getElementById("analyzeButton"),
  demoButton: document.getElementById("demoButton"),
  clearDraftButton: document.getElementById("clearDraftButton"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  performanceScore: document.getElementById("performanceScore"),
  performanceTag: document.getElementById("performanceTag"),
  avgCpl: document.getElementById("avgCpl"),
  consistencyTag: document.getElementById("consistencyTag"),
  bestPhase: document.getElementById("bestPhase"),
  bestPhaseNote: document.getElementById("bestPhaseNote"),
  mainLeak: document.getElementById("mainLeak"),
  mainLeakNote: document.getElementById("mainLeakNote"),
  gameMeta: document.getElementById("gameMeta"),
  summaryText: document.getElementById("summaryText"),
  strengthsList: document.getElementById("strengthsList"),
  issuesList: document.getElementById("issuesList"),
  phaseBreakdown: document.getElementById("phaseBreakdown"),
  recommendations: document.getElementById("recommendations"),
  criticalMoves: document.getElementById("criticalMoves"),
};

const state = {
  engine: null,
  ready: false,
  analysisMode: "engine",
};

initializeInputDraft();

elements.demoButton.addEventListener("click", () => {
  elements.pgnInput.value = demoPgn;
  elements.gameUrl.value = "";
  elements.playerName.value = "TrainingWhite";
  saveInputDraft();
  setStatus("Demo game loaded. Press Analyze Game when you're ready.");
});

elements.clearDraftButton.addEventListener("click", clearInputDraft);

elements.analyzeButton.addEventListener("click", async () => {
  setBusy(true);
  elements.results.classList.add("hidden");

  try {
    setStatus("Preparing your game...");

    const pgn = await resolvePgnInput();
    const chess = new Chess();

    if (!chess.load_pgn(pgn, { sloppy: true })) {
      throw new Error("I couldn't parse that game. Export the PGN from Chess.com and paste it directly.");
    }

    const headers = chess.header();
    const moves = chess.history({ verbose: true });

    if (!moves.length) {
      throw new Error("This PGN has no moves to analyze.");
    }

    const playerColor = detectPlayerColor(headers);
    const engineReady = await ensureEngine();
    setStatus(
      engineReady
        ? "Analyzing move quality with Stockfish. This can take a little while for longer games..."
        : "Stockfish could not start, so the app switched to heuristic analysis mode."
    );
    const analysis = await analyzeGame(moves, headers, playerColor);

    renderReport({ headers, moves, playerColor, analysis });
    elements.results.classList.remove("hidden");
    setStatus("Analysis complete.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong while analyzing the game.");
  } finally {
    setBusy(false);
  }
});

async function resolvePgnInput() {
  const pasted = elements.pgnInput.value.trim();
  if (pasted) {
    return normalizePgn(pasted);
  }

  const rawUrl = elements.gameUrl.value.trim();
  if (!rawUrl) {
    throw new Error("Paste a Chess.com game URL or PGN first.");
  }

  const parsedUrl = parseGameUrl(rawUrl);
  const url = parsedUrl.toString();

  setStatus("Trying to load PGN from the Chess.com page...");
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    if (isLikelyCorsError(error)) {
      throw new Error("The browser could not read that Chess.com page directly. Paste the PGN export instead.");
    }

    throw new Error("The game URL could not be loaded. Check the link and your connection, or paste the PGN export instead.");
  }

  if (!response.ok) {
    throw new Error("The game URL could not be loaded in the browser. Paste the PGN export instead.");
  }

  const html = await response.text();
  const extracted = extractPgnFromHtml(html);
  if (!extracted) {
    throw new Error("The page loaded, but the PGN could not be extracted. Paste the PGN export instead.");
  }

  elements.pgnInput.value = extracted;
  saveInputDraft();
  return extracted;
}

function initializeInputDraft() {
  restoreInputDraft();

  ["gameUrl", "playerName", "pgnInput"].forEach((key) => {
    elements[key].addEventListener("input", saveInputDraft);
  });

  ["playerColor", "engineDepth"].forEach((key) => {
    elements[key].addEventListener("change", saveInputDraft);
  });
}

function restoreInputDraft() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const savedDraft = storage.getItem(inputDraftStorageKey);
    if (!savedDraft) {
      return;
    }

    const draft = JSON.parse(savedDraft);
    if (!draft || typeof draft !== "object") {
      return;
    }

    elements.gameUrl.value = typeof draft.gameUrl === "string" ? draft.gameUrl : "";
    elements.playerName.value = typeof draft.playerName === "string" ? draft.playerName : "";
    elements.playerColor.value = draft.playerColor === "w" || draft.playerColor === "b" ? draft.playerColor : "auto";
    elements.engineDepth.value = ["10", "12", "14"].includes(draft.engineDepth) ? draft.engineDepth : "12";
    elements.pgnInput.value = typeof draft.pgnInput === "string" ? draft.pgnInput : "";
  } catch (error) {
    console.warn("Could not restore saved input draft.", error);
  }
}

function saveInputDraft() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  const draft = {
    gameUrl: elements.gameUrl.value,
    playerName: elements.playerName.value,
    playerColor: elements.playerColor.value,
    engineDepth: elements.engineDepth.value,
    pgnInput: elements.pgnInput.value,
  };

  try {
    storage.setItem(inputDraftStorageKey, JSON.stringify(draft));
  } catch (error) {
    console.warn("Could not save input draft.", error);
  }
}

function clearInputDraft() {
  elements.gameUrl.value = "";
  elements.playerName.value = "";
  elements.playerColor.value = "auto";
  elements.engineDepth.value = "12";
  elements.pgnInput.value = "";

  const storage = getLocalStorage();
  if (storage) {
    try {
      storage.removeItem(inputDraftStorageKey);
    } catch (error) {
      console.warn("Could not clear saved input draft.", error);
    }
  }

  setStatus("Saved game input cleared.");
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function normalizePgn(raw) {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  const tagStart = trimmed.search(/\[\w+\s+"(?:[^"\\]|\\.)*"\]/);
  const movetextStart = trimmed.search(/(?:^|\n)\s*\d+\.(?:\.\.)?/);

  if (tagStart === 0) {
    return trimmed;
  }

  if (tagStart > 0 && (movetextStart === -1 || tagStart < movetextStart)) {
    return trimmed.slice(tagStart).trim();
  }

  if (movetextStart >= 0) {
    return trimmed.slice(movetextStart).trim();
  }

  return trimmed;
}

function parseGameUrl(rawUrl) {
  let parsedUrl;
  const normalizedUrl = normalizeGameUrl(rawUrl);

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch (error) {
    throw new Error("Enter a valid Chess.com game URL, or paste the PGN export instead.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isChessCom = hostname === "chess.com" || hostname.endsWith(".chess.com");
  if (!isChessCom) {
    throw new Error("URL import currently supports Chess.com game links only. Paste PGN for other sites.");
  }

  return parsedUrl;
}

function normalizeGameUrl(rawUrl) {
  const trimmedUrl = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  if (/^(www\.)?chess\.com\//i.test(trimmedUrl)) {
    return `https://${trimmedUrl}`;
  }

  return trimmedUrl;
}

function isLikelyCorsError(error) {
  return error instanceof TypeError;
}

function extractPgnFromHtml(html) {
  const match = html.match(/"pgn":"(.*?)"/);
  if (!match) {
    return null;
  }

  const escaped = match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");

  return normalizePgn(escaped);
}

function detectPlayerColor(headers) {
  const selected = elements.playerColor.value;
  if (selected === "w" || selected === "b") {
    return selected;
  }

  const username = elements.playerName.value.trim().toLowerCase();
  const white = (headers.White || "").trim();
  const black = (headers.Black || "").trim();
  const whiteNormalized = white.toLowerCase();
  const blackNormalized = black.toLowerCase();

  if (username) {
    if (whiteNormalized === username) {
      return "w";
    }
    if (blackNormalized === username) {
      return "b";
    }

    throw new Error(
      'The username "' + elements.playerName.value.trim() + '" does not match the PGN players (' + (white || 'White') + ' vs ' + (black || 'Black') + '). Enter the exact Chess.com username or choose White/Black manually.'
    );
  }

  throw new Error(
    'Auto-detect needs your Chess.com username to match the PGN players (' + (white || 'White') + ' vs ' + (black || 'Black') + '). Enter your username or choose White/Black manually.'
  );
}

async function ensureEngine() {
  if (state.ready && state.engine) {
    state.analysisMode = "engine";
    return true;
  }

  try {
    setStatus("Loading engine...");
    const bootCode = `
      self.Module = {};
      importScripts("${engineCdn}");
    `;

    const workerUrl = URL.createObjectURL(new Blob([bootCode], { type: "application/javascript" }));
    const engine = new Worker(workerUrl);

    state.engine = engine;
    state.ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Engine setup took too long.")), 15000);

      engine.onmessage = (event) => {
        const line = typeof event.data === "string" ? event.data : "";
        if (line.includes("uciok")) {
          engine.postMessage("isready");
        } else if (line.includes("readyok")) {
          clearTimeout(timer);
          resolve(true);
        }
      };

      engine.onerror = () => reject(new Error("The analysis engine failed to start."));
      engine.postMessage("uci");
    });

    URL.revokeObjectURL(workerUrl);
    state.analysisMode = "engine";
    return true;
  } catch (error) {
    console.warn("Engine boot failed, switching to heuristic mode.", error);
    if (state.engine) {
      state.engine.terminate();
    }
    state.engine = null;
    state.ready = false;
    state.analysisMode = "heuristic";
    return false;
  }
}

async function analyzeGame(moves, headers, playerColor) {
  const game = new Chess();
  const records = [];
  const playerMoves = [];
  const phaseBuckets = {
    opening: [],
    middlegame: [],
    endgame: [],
  };

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    const turnColor = game.turn();
    const isPlayerMove = turnColor === playerColor;
    const fenBefore = game.fen();
    const phase = classifyPhase(game, index);

    let evaluationBefore = null;
    let bestMove = null;
    let evaluationAfter = null;
    let centipawnLoss = null;
    let moveLabel = "Opponent";

    if (isPlayerMove) {
      if (state.analysisMode === "engine") {
        const engineBefore = await evaluatePosition(fenBefore, Number(elements.engineDepth.value));
        evaluationBefore = normalizeEngineScore(engineBefore.score, playerColor);
        bestMove = engineBefore.bestMove;
      } else {
        evaluationBefore = evaluateHeuristic(game, playerColor);
        bestMove = pickHeuristicBestMove(game, playerColor);
      }
    }

    game.move(move);

    if (isPlayerMove) {
      if (state.analysisMode === "engine") {
        const engineAfter = await evaluatePosition(game.fen(), Number(elements.engineDepth.value));
        evaluationAfter = normalizeEngineScore(engineAfter.score, playerColor);
      } else {
        evaluationAfter = evaluateHeuristic(game, playerColor);
      }
      centipawnLoss = calculateCentipawnLoss(evaluationBefore, evaluationAfter);
      moveLabel = classifyMove(centipawnLoss, evaluationAfter);

      const record = {
        index,
        moveNumber: Math.ceil((index + 1) / 2),
        color: turnColor,
        san: move.san,
        fenBefore,
        phase,
        evaluationBefore,
        evaluationAfter,
        centipawnLoss,
        bestMove,
        label: moveLabel,
        themes: detectThemes(move, game, phase),
      };

      playerMoves.push(record);
      phaseBuckets[phase].push(record);
      records.push(record);
    }
  }

  return summarizeAnalysis({ headers, playerColor, playerMoves, phaseBuckets, records });
}

function evaluateHeuristic(game, playerColor) {
  const board = game.board();
  const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const centralSquares = new Set(["d4", "e4", "d5", "e5"]);
  let score = 0;

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file];
      if (!piece) {
        continue;
      }

      const square = String.fromCharCode(97 + file) + (8 - rank);
      const sign = piece.color === playerColor ? 1 : -1;
      score += sign * pieceValues[piece.type];

      if (centralSquares.has(square)) {
        score += sign * 14;
      }

      if ((piece.type === "n" || piece.type === "b") && !isBackRankStartSquare(piece, square)) {
        score += sign * 10;
      }
    }
  }

  score += mobilityScore(game, playerColor);
  score += kingSafetyScore(game, playerColor);
  return score;
}

function pickHeuristicBestMove(game, playerColor) {
  const legalMoves = game.moves({ verbose: true });
  if (!legalMoves.length) {
    return null;
  }

  let bestMove = legalMoves[0].san;
  let bestScore = -Infinity;

  legalMoves.forEach((candidate) => {
    const sandbox = new Chess(game.fen());
    sandbox.move(candidate);
    const score = evaluateHeuristic(sandbox, playerColor);
    if (score > bestScore) {
      bestScore = score;
      bestMove = candidate.san;
    }
  });

  return bestMove;
}

function mobilityScore(game, playerColor) {
  const currentTurn = game.turn();
  const availableMoves = game.moves().length;
  const signedMoves = currentTurn === playerColor ? availableMoves : -availableMoves;
  return signedMoves * 2;
}

function kingSafetyScore(game, playerColor) {
  const playerKing = findKingSquare(game, playerColor);
  const opponentKing = findKingSquare(game, playerColor === "w" ? "b" : "w");
  let score = 0;

  if (playerKing === "g1" || playerKing === "c1" || playerKing === "g8" || playerKing === "c8") {
    score += 35;
  }
  if (playerKing === "e1" || playerKing === "e8") {
    score -= 20;
  }

  if (opponentKing && countNearbyPieces(game, opponentKing, playerColor) >= 2) {
    score += 18;
  }

  return score;
}

function countNearbyPieces(game, square, color) {
  const board = game.board();
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - Number(square[1]);
  let total = 0;

  for (let rankOffset = -1; rankOffset <= 1; rankOffset += 1) {
    for (let fileOffset = -1; fileOffset <= 1; fileOffset += 1) {
      if (rankOffset === 0 && fileOffset === 0) {
        continue;
      }

      const nextRank = rank + rankOffset;
      const nextFile = file + fileOffset;
      if (nextRank < 0 || nextRank > 7 || nextFile < 0 || nextFile > 7) {
        continue;
      }

      const piece = board[nextRank][nextFile];
      if (piece && piece.color === color) {
        total += 1;
      }
    }
  }

  return total;
}

function isBackRankStartSquare(piece, square) {
  const homeSquares = {
    w: new Set(["b1", "g1", "c1", "f1"]),
    b: new Set(["b8", "g8", "c8", "f8"]),
  };
  return homeSquares[piece.color].has(square);
}

function classifyPhase(game, index) {
  const board = game.board().flat().filter(Boolean);
  const nonPawnMaterial = board.reduce((total, piece) => {
    const values = { n: 3, b: 3, r: 5, q: 9 };
    return total + (values[piece.type] || 0);
  }, 0);

  if (index < 16) {
    return "opening";
  }

  if (nonPawnMaterial <= 18) {
    return "endgame";
  }

  return "middlegame";
}

function detectThemes(move, game, phase) {
  const themes = [];

  if (move.flags.includes("k") || move.flags.includes("q")) {
    themes.push("castling");
  }
  if (move.san.includes("x")) {
    themes.push("capture");
  }
  if (move.san.includes("+")) {
    themes.push("check");
  }
  if (move.san.includes("#")) {
    themes.push("mate");
  }
  if (move.flags.includes("p")) {
    themes.push("promotion");
  }
  if (phase === "opening" && /^[a-h]/.test(move.san)) {
    themes.push("pawn-structure");
  }
  if (phase === "middlegame" && /[QRBN]/.test(move.san)) {
    themes.push("piece-activity");
  }

  const enemyKing = findKingSquare(game, game.turn());
  if (enemyKing && move.to && distanceBetweenSquares(move.to, enemyKing) <= 2) {
    themes.push("king-pressure");
  }

  return [...new Set(themes)];
}

function findKingSquare(game, color) {
  const board = game.board();
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file];
      if (piece && piece.type === "k" && piece.color === color) {
        return String.fromCharCode(97 + file) + (8 - rank);
      }
    }
  }
  return null;
}

function distanceBetweenSquares(from, to) {
  const files = "abcdefgh";
  const fromFile = files.indexOf(from[0]);
  const toFile = files.indexOf(to[0]);
  const fromRank = Number(from[1]);
  const toRank = Number(to[1]);
  return Math.max(Math.abs(fromFile - toFile), Math.abs(fromRank - toRank));
}

function summarizeAnalysis({ headers, playerColor, playerMoves, phaseBuckets, records }) {
  if (!playerMoves.length) {
    throw new Error("No moves were found for the selected side.");
  }

  const analysisMode = state.analysisMode;
  const avgCpl = average(playerMoves.map((move) => move.centipawnLoss));
  const performanceScore = Math.max(1, Math.round(100 - avgCpl / 3));
  const moveCounts = countBy(playerMoves, (move) => move.label);
  const themeCounts = countThemes(playerMoves);
  const phaseScores = Object.fromEntries(
    Object.entries(phaseBuckets).map(([phase, entries]) => {
      if (!entries.length) {
        return [phase, null];
      }

      const phaseAvg = average(entries.map((move) => move.centipawnLoss));
      return [phase, Math.max(1, Math.round(100 - phaseAvg / 3))];
    })
  );
  const playedPhases = Object.entries(phaseScores).filter(([, score]) => score !== null);

  const bestPhase = playedPhases.sort((a, b) => b[1] - a[1])[0][0];
  const worstPhase = playedPhases.sort((a, b) => a[1] - b[1])[0][0];
  const biggestSwing = [...records].sort((a, b) => b.centipawnLoss - a.centipawnLoss).slice(0, 8);
  const primaryLeak = inferPrimaryLeak(moveCounts, themeCounts, worstPhase);
  const recommendations = buildRecommendations(moveCounts, themeCounts, phaseScores, headers);
  const strengths = buildStrengths(moveCounts, themeCounts, phaseScores);
  const issues = buildIssues(moveCounts, themeCounts, phaseScores, biggestSwing);

  return {
    analysisMode,
    avgCpl,
    performanceScore,
    moveCounts,
    themeCounts,
    phaseScores,
    bestPhase,
    worstPhase,
    criticalMoves: biggestSwing,
    primaryLeak,
    recommendations,
    strengths,
    issues,
    summary: buildSummary(headers, playerColor, performanceScore, avgCpl, bestPhase, primaryLeak, moveCounts),
  };
}

function buildSummary(headers, playerColor, performanceScore, avgCpl, bestPhase, primaryLeak, moveCounts) {
  const colorName = playerColor === "w" ? "White" : "Black";
  const opening = headers.Opening || "Unknown opening";
  const cleanMoves = (moveCounts.Best || 0) + (moveCounts.Excellent || 0) + (moveCounts.Good || 0);
  const errors = (moveCounts.Mistake || 0) + (moveCounts.Blunder || 0);

  return `${colorName} was analyzed in a ${opening} game. Your overall performance score came out to ${performanceScore}/100 with an average centipawn loss of ${avgCpl.toFixed(1)}. Your cleanest phase was the ${bestPhase}, where your decisions stayed comparatively stable. The biggest training theme was ${primaryLeak.toLowerCase()}, and the game contained ${cleanMoves} solid moves against ${errors} major errors from your side.`;
}

function buildStrengths(moveCounts, themeCounts, phaseScores) {
  const items = [];
  const playedPhases = Object.entries(phaseScores).filter(([, score]) => score !== null);

  if ((moveCounts.Best || 0) >= 2) {
    items.push({
      title: "You found several engine-approved moves",
      body: `${moveCounts.Best} moves landed in the best-move zone, which usually means your calculation is seeing the core idea of the position.`,
    });
  }

  const bestPhase = playedPhases.sort((a, b) => b[1] - a[1])[0];
  if (bestPhase) {
    items.push({
      title: `${capitalize(bestPhase[0])} was your steadiest phase`,
      body: `That phase scored ${bestPhase[1]}/100, so your decisions there were more consistent than in the rest of the game.`,
    });
  }

  if ((themeCounts["king-pressure"] || 0) >= 2) {
    items.push({
      title: "You created pressure against the king",
      body: "Your moves repeatedly pointed toward king pressure, which is a strong sign that you were playing with purpose rather than just making safe moves.",
    });
  }

  if (!items.length) {
    items.push({
      title: "There were still recoverable positions",
      body: "Even in tougher games, you reached playable moments. That means the main opportunity is improving decision quality at the key swings rather than rebuilding your whole game.",
    });
  }

  return items.slice(0, 3);
}

function buildIssues(moveCounts, themeCounts, phaseScores, biggestSwing) {
  const items = [];
  const playedPhases = Object.entries(phaseScores).filter(([, score]) => score !== null);
  const worstPhase = playedPhases.sort((a, b) => a[1] - b[1])[0];

  if ((moveCounts.Blunder || 0) > 0) {
    items.push({
      title: "Large tactical losses decided the game",
      body: `${moveCounts.Blunder} move${moveCounts.Blunder === 1 ? "" : "s"} qualified as a blunder. These are the moments where a short blunder-check would have saved the most rating points.`,
    });
  }

  if (worstPhase) {
    items.push({
      title: `${capitalize(worstPhase[0])} needs more structure`,
      body: `Your weakest phase scored ${worstPhase[1]}/100. A simpler plan in that stage would likely improve your whole result.`,
    });
  }

  if ((themeCounts.capture || 0) >= 4) {
    items.push({
      title: "Captures likely needed deeper verification",
      body: "This game contained many forcing exchanges. In tactical positions, captures are often where hidden replies and recaptures punish fast decisions.",
    });
  }

  if (biggestSwing[0]) {
    items.push({
      title: `The biggest swing came on move ${biggestSwing[0].moveNumber}`,
      body: `${biggestSwing[0].san} cost roughly ${Math.round(biggestSwing[0].centipawnLoss)} centipawns compared with the engine's preferred plan.`,
    });
  }

  return items.slice(0, 4);
}

function buildRecommendations(moveCounts, themeCounts, phaseScores, headers) {
  const recommendations = [];
  const playedPhases = Object.entries(phaseScores).filter(([, score]) => score !== null);
  const worstPhase = playedPhases.sort((a, b) => a[1] - b[1])[0]?.[0];

  if ((moveCounts.Blunder || 0) > 0 || (moveCounts.Mistake || 0) >= 2) {
    recommendations.push({
      title: "Add a 15-second blunder check before every forcing move",
      body: "Before you play a capture, check, or major pawn break, pause and ask: what changed, what is hanging, and what is my opponent's strongest reply?",
    });
  }

  if (worstPhase === "opening") {
    recommendations.push({
      title: "Tighten your first 8-10 moves",
      body: `Review the main ideas of ${headers.Opening || "this opening"} and focus on plans, not memorizing long lines. Your goal is to reach a comfortable middlegame without early concessions.`,
    });
  }

  if (worstPhase === "middlegame") {
    recommendations.push({
      title: "Train middlegame planning from static features",
      body: "After the opening, spend a few seconds naming the weakest square, worst-placed piece, and safest file for activity. That will stop you from drifting between unrelated ideas.",
    });
  }

  if (worstPhase === "endgame") {
    recommendations.push({
      title: "Work on conversion and king activity in endgames",
      body: "Use simple rook and pawn endgames to build technique. Many endgame losses come from passive king placement and missing the most active move.",
    });
  }

  if ((themeCounts["king-pressure"] || 0) === 0) {
    recommendations.push({
      title: "Create clearer attacking targets",
      body: "When you cannot see a direct tactic, build pressure first by improving one piece at a time toward the enemy king or a weak pawn.",
    });
  }

  recommendations.push({
    title: "Replay the three worst moments without engine help",
    body: "Try to explain what you were calculating and what you missed. That reflection loop is where fast improvement usually happens.",
  });

  return recommendations.slice(0, 4);
}

function inferPrimaryLeak(moveCounts, themeCounts, worstPhase) {
  if ((moveCounts.Blunder || 0) > 0) {
    return "Tactical oversight";
  }
  if (worstPhase === "opening") {
    return "Opening structure";
  }
  if (worstPhase === "endgame") {
    return "Endgame technique";
  }
  if ((themeCounts.capture || 0) > 3) {
    return "Forcing-move calculation";
  }
  return "Middlegame planning";
}

function renderReport({ headers, moves, playerColor, analysis }) {
  elements.performanceScore.textContent = analysis.performanceScore;
  elements.performanceTag.textContent = performanceLabel(analysis.performanceScore);
  elements.avgCpl.textContent = analysis.avgCpl.toFixed(1);
  elements.consistencyTag.textContent = consistencyLabel(analysis.avgCpl);
  elements.bestPhase.textContent = capitalize(analysis.bestPhase);
  elements.bestPhaseNote.textContent = `${analysis.phaseScores[analysis.bestPhase]}/100 phase score`;
  elements.mainLeak.textContent = analysis.primaryLeak;
  elements.mainLeakNote.textContent = `${capitalize(analysis.worstPhase)} was the weakest phase`;

  elements.gameMeta.innerHTML = "";
  const metaItems = [
    ["Players", `${headers.White || "White"} vs ${headers.Black || "Black"}`],
    ["You were analyzed as", playerColor === "w" ? "White" : "Black"],
    ["Analysis mode", analysis.analysisMode === "engine" ? "Stockfish engine" : "Heuristic fallback"],
    ["Result", headers.Result || "Unknown"],
    ["Opening", headers.Opening || "Not provided"],
    ["Moves", String(Math.ceil(moves.length / 2))],
    ["Time control", headers.TimeControl || "Not provided"],
  ];

  metaItems.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "meta-item";
    const strong = document.createElement("strong");
    strong.textContent = label;
    item.append(strong, document.createTextNode(value));
    elements.gameMeta.appendChild(item);
  });

  elements.summaryText.textContent = analysis.summary;
  renderCardList(elements.strengthsList, analysis.strengths);
  renderCardList(elements.issuesList, analysis.issues);

  elements.phaseBreakdown.innerHTML = "";
  ["opening", "middlegame", "endgame"].forEach((phase) => {
    const card = document.createElement("div");
    const phaseScore = analysis.phaseScores[phase];
    card.className = "phase-card";
    const title = document.createElement("strong");
    title.textContent = capitalize(phase);
    const score = document.createElement("div");
    score.className = "phase-score";
    score.textContent = phaseScore === null ? "Not reached" : `${phaseScore}/100`;
    const detail = document.createElement("p");
    detail.textContent = phaseDetail(phase, phaseScore);
    card.append(title, score, detail);
    elements.phaseBreakdown.appendChild(card);
  });

  renderCardList(elements.recommendations, analysis.recommendations, "recommendation-card");

  elements.criticalMoves.innerHTML = "";
  analysis.criticalMoves.forEach((move) => {
    const card = document.createElement("article");
    card.className = "move-card";
    const header = document.createElement("div");
    header.className = "move-header";
    const title = document.createElement("strong");
    title.textContent = `Move ${move.moveNumber}: ${move.san}`;
    const badge = document.createElement("span");
    badge.className = "move-badge";
    badge.textContent = move.label;
    header.append(title, badge);

    const description = document.createElement("p");
    description.textContent = describeMove(move, analysis.analysisMode);

    const note = document.createElement("p");
    note.className = "muted";
    const bestMoveLabel = analysis.analysisMode === "engine" ? "Best engine move" : "Best heuristic move";
    note.textContent = `${bestMoveLabel}: ${move.bestMove || "Unavailable"} | Phase: ${capitalize(move.phase)}`;

    card.append(header, description, note);
    elements.criticalMoves.appendChild(card);
  });
}

function renderCardList(container, items, className = "tag-card") {
  container.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = className;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const body = document.createElement("p");
    body.textContent = item.body;
    card.append(title, body);
    container.appendChild(card);
  });
}

function performanceLabel(score) {
  if (score >= 88) {
    return "Very sharp and controlled";
  }
  if (score >= 75) {
    return "Solid game with a few leaks";
  }
  if (score >= 60) {
    return "Playable, but too swingy";
  }
  return "High volatility, big upside from review";
}

function consistencyLabel(avgCpl) {
  if (avgCpl <= 25) {
    return "Strong consistency";
  }
  if (avgCpl <= 45) {
    return "Reasonably stable";
  }
  if (avgCpl <= 70) {
    return "Several costly slips";
  }
  return "Large evaluation swings";
}

function phaseDetail(phase, score) {
  if (score === null) {
    return `This game never reached a true ${phase}, so it was left out of the scoring summary.`;
  }
  if (score >= 85) {
    return `You handled the ${phase} with clear decisions and limited damage.`;
  }
  if (score >= 70) {
    return `The ${phase} was mostly fine, but there were still moments to tighten.`;
  }
  return `This was the most fragile part of the game and deserves focused work.`;
}

function describeMove(move, analysisMode) {
  const before = formatEval(move.evaluationBefore);
  const after = formatEval(move.evaluationAfter);
  const themes = move.themes.length ? ` Themes: ${move.themes.join(", ")}.` : "";
  const referenceLabel = analysisMode === "engine" ? "engine's preferred line" : "the heuristic baseline";

  return `The position shifted from ${before} to ${after}, costing about ${Math.round(move.centipawnLoss)} centipawns relative to ${referenceLabel}.${themes}`;
}

async function evaluatePosition(fen, depth) {
  const engine = state.engine;
  return new Promise((resolve, reject) => {
    let bestMove = null;
    let latestScore = { type: "cp", value: 0 };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Engine evaluation timed out."));
    }, 20000);

    const handler = (event) => {
      const line = typeof event.data === "string" ? event.data : "";

      if (line.startsWith("info depth") && line.includes(" score ")) {
        latestScore = parseScore(line) || latestScore;
      }

      if (line.startsWith("bestmove")) {
        bestMove = line.split(" ")[1];
        cleanup();
        resolve({ score: latestScore, bestMove });
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      engine.removeEventListener("message", handler);
    };

    engine.addEventListener("message", handler);
    engine.postMessage("ucinewgame");
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth}`);
  });
}

function parseScore(line) {
  const mateMatch = line.match(/score mate (-?\d+)/);
  if (mateMatch) {
    return { type: "mate", value: Number(mateMatch[1]) };
  }

  const cpMatch = line.match(/score cp (-?\d+)/);
  if (cpMatch) {
    return { type: "cp", value: Number(cpMatch[1]) };
  }

  return null;
}

function normalizeEngineScore(score, playerColor) {
  if (!score) {
    return 0;
  }

  if (score.type === "mate") {
    const mateBase = score.value > 0 ? 10000 : -10000;
    return playerColor === "w" ? mateBase : -mateBase;
  }

  return playerColor === "w" ? score.value : -score.value;
}

function calculateCentipawnLoss(before, after) {
  return Math.max(0, before - after);
}

function classifyMove(cpl, evaluationAfter) {
  if (evaluationAfter >= 9500) {
    return "Winning";
  }
  if (cpl <= 15) {
    return "Best";
  }
  if (cpl <= 35) {
    return "Excellent";
  }
  if (cpl <= 70) {
    return "Good";
  }
  if (cpl <= 140) {
    return "Inaccuracy";
  }
  if (cpl <= 260) {
    return "Mistake";
  }
  return "Blunder";
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countThemes(items) {
  return items.reduce((counts, item) => {
    item.themes.forEach((theme) => {
      counts[theme] = (counts[theme] || 0) + 1;
    });
    return counts;
  }, {});
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatEval(value) {
  const pawns = value / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

function setBusy(isBusy) {
  elements.analyzeButton.disabled = isBusy;
  elements.demoButton.disabled = isBusy;
  elements.clearDraftButton.disabled = isBusy;
  elements.gameUrl.disabled = isBusy;
  elements.playerName.disabled = isBusy;
  elements.playerColor.disabled = isBusy;
  elements.engineDepth.disabled = isBusy;
  elements.pgnInput.disabled = isBusy;
}

function setStatus(message) {
  elements.status.textContent = message;
}
