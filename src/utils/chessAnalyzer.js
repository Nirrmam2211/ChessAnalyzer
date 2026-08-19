import { Chess } from "chess.js";

export function classifyPhase(game, index) {
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

export function detectThemes(move, game, phase) {
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

export function findKingSquare(game, color) {
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

export function distanceBetweenSquares(from, to) {
  const files = "abcdefgh";
  const fromFile = files.indexOf(from[0]);
  const toFile = files.indexOf(to[0]);
  const fromRank = Number(from[1]);
  const toRank = Number(to[1]);
  return Math.max(Math.abs(fromFile - toFile), Math.abs(fromRank - toRank));
}

export function evaluateHeuristic(game, playerColor) {
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

export function pickHeuristicBestMove(game, playerColor) {
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

export function calculateCentipawnLoss(before, after) {
  return Math.max(0, before - after);
}

export function classifyMove(cpl, evaluationAfter) {
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
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatEval(value) {
  const pawns = value / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

export function performanceLabel(score) {
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

export function consistencyLabel(avgCpl) {
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

export function phaseDetail(phase, score) {
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

export function describeMove(move, analysisMode) {
  const before = formatEval(move.evaluationBefore);
  const after = formatEval(move.evaluationAfter);
  const themes = move.themes.length ? ` Themes: ${move.themes.join(", ")}.` : "";
  const referenceLabel = analysisMode === "engine" ? "engine's preferred line" : "the heuristic baseline";

  return `The position shifted from ${before} to ${after}, costing about ${Math.round(move.centipawnLoss)} centipawns relative to ${referenceLabel}.${themes}`;
}

export function summarizeAnalysis({ headers, playerColor, playerMoves, phaseBuckets, records, analysisMode }) {
  if (!playerMoves.length) {
    throw new Error("No moves were found for the selected side.");
  }

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

  const bestPhase = playedPhases.length ? playedPhases.sort((a, b) => b[1] - a[1])[0][0] : "opening";
  const worstPhase = playedPhases.length ? playedPhases.sort((a, b) => a[1] - b[1])[0][0] : "opening";
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

  const bestPhase = playedPhases.length ? playedPhases.sort((a, b) => b[1] - a[1])[0] : null;
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
  const worstPhase = playedPhases.length ? playedPhases.sort((a, b) => a[1] - b[1])[0] : null;

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
  const worstPhase = playedPhases.length ? playedPhases.sort((a, b) => a[1] - b[1])[0]?.[0] : null;

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
