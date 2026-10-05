import React, { useState, useEffect, useRef } from "react";
import { Chess } from "chess.js";
import GameInputSection from "./components/GameInputSection";
import ChessboardSection from "./components/ChessboardSection";
import MovesListSection from "./components/MovesListSection";
import AnalysisReport from "./components/AnalysisReport";
import { 
  classifyPhase, 
  detectThemes, 
  evaluateHeuristic, 
  pickHeuristicBestMove, 
  summarizeAnalysis, 
  calculateCentipawnLoss, 
  classifyMove 
} from "./utils/chessAnalyzer";

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

const inputDraftStorageKey = "chessAnalyzer.inputDraft";
const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Live evaluation is throttled: the engine can emit hundreds of "info" lines per
// second, and each React state update re-renders the whole board. We buffer the
// newest line in a ref and only commit it to state a few times per second.
const LIVE_UI_FLUSH_MS = 160;
// Hard wall-clock cap for the live eval so deep settings still feel instant.
const LIVE_MOVE_MS = 1400;
// Cap for the engine's own reply when playing against it.
const PLAY_MOVE_MS = 1500;

// Wall-clock budget per position for the full-game report, keyed by depth.
// Without a time cap a depth-20 single-threaded search can take 20s+ per move,
// which is what makes a 40-move review feel frozen. Depth still wins if reached
// sooner; this only prevents pathological positions from stalling the run.
const REPORT_TIME_BUDGET = { 10: 1200, 12: 2000, 14: 3500, 16: 6000, 18: 10000, 20: 16000 };

function thinkingMsForDepth(depth) {
  return REPORT_TIME_BUDGET[depth] || Math.min(2000 + (depth - 10) * 1500, 30000);
}

const defaultInputs = {
  gameUrl: "",
  playerName: "",
  playerColor: "auto",
  engineDepth: "12",
  liveDepth: "12",
  pgnInput: "",
};

function parseInfoLine(line) {
  // A score tagged lowerbound/upperbound is only an approximation (cutoff search
  // or tablebase probe). Painting those as exact made the live bar jump to absurd
  // values mid-search, most often straight to 0.00 in winning positions.
  if (/lowerbound|upperbound/.test(line)) return null;

  const depthMatch = line.match(/depth (\d+)/);
  if (!depthMatch) return null;

  const result = { depth: Number(depthMatch[1]), nps: null, cp: null, mate: null, pv: null };

  const npsMatch = line.match(/nps (\d+)/);
  if (npsMatch) result.nps = Number(npsMatch[1]);

  const mateMatch = line.match(/score mate (-?\d+)/);
  if (mateMatch) {
    result.mate = Number(mateMatch[1]);
  } else {
    const cpMatch = line.match(/score cp (-?\d+)/);
    if (cpMatch) result.cp = Number(cpMatch[1]);
  }

  const pvIdx = line.indexOf(" pv ");
  if (pvIdx !== -1) result.pv = line.substring(pvIdx + 4).trim().split(" ").slice(0, 6);

  return result;
}

function isStalematePosition(fenStr) {
  try {
    return new Chess(fenStr).isStalemate();
  } catch {
    return false;
  }
}

// When both positions are a forced mate for the same side, the centipawn maths
// collapses them onto the same ±10000 sentinel and sees zero damage - a move that
// lets the win slip from "mate in 2" to "mate in 8" (or speeds up your own loss)
// was graded Best. The mate distance is the only signal that distinguishes them.
function mateDistancePenalty(beforeEval, afterEval, beforeDist, afterDist) {
  if (beforeDist === null || afterDist === null) return 0;
  if (beforeEval !== afterEval || Math.abs(beforeEval) < 9500) return 0;
  const delta = beforeEval > 0 ? afterDist - beforeDist : beforeDist - afterDist;
  return delta > 0 ? Math.min(delta * 200, 1000) : 0;
}

// SAN comparison of the played move against the engine's top choice. Check and
// mate markers are dropped because the two conversion paths do not always agree
// on them, and promotion suffixes must survive.
const sanKey = (san) => (san || "").replace(/[+#]/g, "");

export default function App() {
  // Input fields
  const [inputs, setInputs] = useState({ ...defaultInputs });

  // App states
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [analysis, setAnalysis] = useState(null);
  
  // Game state
  const [game, setGame] = useState(() => new Chess());
  const [fen, setFen] = useState(startingFen);
  const [orientation, setOrientation] = useState("white");
  const [moves, setMoves] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [gameMode, setGameMode] = useState("analyze"); // analyze | play | free
  
  // Tabs for right side panel
  const [rightPanelTab, setRightPanelTab] = useState("input"); // input | moves

  // Play vs Engine Config
  const [playerColorPref, setPlayerColorPref] = useState("w"); // 'w' or 'b' for vs engine

  // Live Stockfish states
  const [engineOn, setEngineOn] = useState(false);
  const [engineEval, setEngineEval] = useState(null);
  const [enginePv, setEnginePv] = useState("");
  const [engineDepthReached, setEngineDepthReached] = useState(0);
  const [engineNps, setEngineNps] = useState(0);
  const [engineIsAnalyzing, setEngineIsAnalyzing] = useState(false);

  // References
  const engineWorkerRef = useRef(null);
  const activeAnalysisModeRef = useRef("engine"); // engine | heuristic
  const liveFlushTimerRef = useRef(null);
  const liveSnapshotRef = useRef(null);
  const liveDirtyRef = useRef(false);
  const engineInitRef = useRef(null);
  const engineReadyRef = useRef(false);
  const busyRef = useRef(false);
  // True while the engine is thinking its reply in Play mode: the live-eval search
  // must stay off the worker for that window, but it should run again the moment
  // it is the human's turn (otherwise the eval bar dies exactly when it is read).
  const engineThinkingRef = useRef(false);
  // Incremented on every stop: an async engine boot that finishes after a stop
  // must not start a search, or it will fight the report for the single worker.
  const liveStartTokenRef = useRef(0);

  // Load inputs from local storage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(inputDraftStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setInputs((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch (e) {
      console.warn("Could not restore saved input draft.", e);
    }
  }, []);

  // Save inputs to local storage on change
  const handleInputChange = (key, value) => {
    setInputs((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem(inputDraftStorageKey, JSON.stringify(updated));
      } catch (e) {
        console.warn("Could not save input draft.", e);
      }
      return updated;
    });
  };

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      if (liveFlushTimerRef.current) clearInterval(liveFlushTimerRef.current);
      if (engineWorkerRef.current) {
        engineWorkerRef.current.terminate();
      }
    };
  }, []);
  
  // Live engine worker manager
  useEffect(() => {
    // While a report run owns the worker, touching it would abort its searches.
    if (busyRef.current) return;

    if (!engineOn) {
      stopLiveAnalysis();
      setEngineEval(null);
      setEnginePv("");
      setEngineDepthReached(0);
      setEngineNps(0);
      setEngineIsAnalyzing(false);
      return;
    }
  
    // In Play mode the engine's own reply search owns the worker while it thinks.
    // Two overlapping "go" commands would abort each other, so only the reply
    // feeds the HUD during that window - the live eval resumes on our turn.
    if (gameMode === "play" && engineThinkingRef.current) {
      stopLiveAnalysis();
      return;
    }

    startLiveAnalysisOfCurrentFen();
  }, [fen, engineOn, inputs.liveDepth, gameMode]);
  
  function stopLiveAnalysis() {
    liveStartTokenRef.current += 1;

    if (liveFlushTimerRef.current) {
      clearInterval(liveFlushTimerRef.current);
      liveFlushTimerRef.current = null;
    }
    liveDirtyRef.current = false;
    liveSnapshotRef.current = null;
  
    const worker = engineWorkerRef.current;
    if (worker) {
      // Only detach once the engine is ready: during startup this listener *is*
      // the UCI handshake, and nulling it would hang every waiting caller.
      if (engineReadyRef.current) {
        worker.onmessage = null;
      }
      worker.postMessage("stop");
    }
    setEngineIsAnalyzing(false);
  }

  // Throttled HUD consumer, shared by live evaluation and by the engine's reply
  // search in Play mode. Info lines are buffered in a ref and only repainted to
  // React state a few times per second.
  function installLiveInfoConsumer(worker, currentFen) {
    const sideToMove = currentFen.split(" ")[1] || "w";

    const flush = () => {
      if (!liveDirtyRef.current) return;
      liveDirtyRef.current = false;

      const snap = liveSnapshotRef.current;
      if (!snap) return;

      setEngineDepthReached(snap.depth);
      if (snap.nps) setEngineNps(snap.nps);
      if (snap.mate !== null) {
        // UCI reports mate scores for the side to move. "mate 0" means it is
        // already mated, so the winning side is the opponent - a plain sign flip
        // would turn that into +0 and paint the eval bar on the wrong end.
        if (snap.mate === 0) {
          setEngineEval({ type: "mate", value: sideToMove === "w" ? -1 : 1, now: true });
        } else {
          setEngineEval({ type: "mate", value: sideToMove === "b" ? -snap.mate : snap.mate });
        }
      } else if (snap.cp !== null) {
        setEngineEval({ type: "cp", value: sideToMove === "b" ? -snap.cp : snap.cp });
      }
      if (snap.pv) {
        setEnginePv(convertLanToSan(currentFen, snap.pv.slice(0, 5)));
      }
    };

    worker.onmessage = (event) => {
      const line = typeof event.data === "string" ? event.data : "";
      if (line.startsWith("info depth")) {
        const parsed = parseInfoLine(line);
        if (parsed) {
          liveSnapshotRef.current = parsed;
          liveDirtyRef.current = true;
        }
      } else if (line.startsWith("bestmove")) {
        // "bestmove (none)" means the position is terminal (mate/stalemate), so no
        // info line was ever produced: mark the eval bar decisively instead of
        // leaving the previous position's number on screen.
        if (line.includes("(none)") && !liveDirtyRef.current) {
          if (isStalematePosition(currentFen)) {
            // Stalemate is a draw, not a mate: the bar must not slam to one end.
            setEngineEval({ type: "cp", value: 0 });
          } else {
            setEngineEval({ type: "mate", value: sideToMove === "w" ? -1 : 1, now: true });
          }
        }
        flush();
        if (liveFlushTimerRef.current) {
          clearInterval(liveFlushTimerRef.current);
          liveFlushTimerRef.current = null;
        }
        setEngineIsAnalyzing(false);
      }
    };

    if (liveFlushTimerRef.current) clearInterval(liveFlushTimerRef.current);
    liveFlushTimerRef.current = setInterval(flush, LIVE_UI_FLUSH_MS);
  }

  async function startLiveAnalysisOfCurrentFen() {
    if (busyRef.current) return;
    stopLiveAnalysis();
    const token = liveStartTokenRef.current;

    try {
      const worker = await getOrCreateEngineWorker();
      if (!worker) return;
      // A report run or an engine toggle may have taken over while we were booting.
      if (liveStartTokenRef.current !== token || busyRef.current) return;
  
      const currentFen = fen === startingFen ? startingFen : fen;
      const liveDepth = Math.min(Number(inputs.liveDepth) || 12, 30);

      setEngineIsAnalyzing(true);
      setEnginePv("");
      setEngineEval(null);
      setEngineDepthReached(0);
      setEngineNps(0);

      installLiveInfoConsumer(worker, currentFen);
  
      // No "ucinewgame" here on purpose: it wipes the transposition table, which
      // is what makes re-searching a neighbouring position fast.
      worker.postMessage(`position fen ${currentFen}`);
      worker.postMessage(`go depth ${liveDepth} movetime ${LIVE_MOVE_MS}`);
    } catch {
      console.warn("Live engine failed to start");
      setEngineOn(false);
    }
  }

  // Helper to convert coordinate moves (LAN) to human SAN moves
  function convertLanToSan(startFen, lanMoves) {
    try {
      const temp = new Chess(startFen);
      const sanList = [];
      // Take the move number from the FEN's fullmove counter: history() is empty
      // for a position loaded from a bare FEN, which used to restart numbering at 1.
      let moveNum = Number(startFen.split(" ")[5]) || 1;

      for (const lan of lanMoves) {
        const from = lan.slice(0, 2);
        const to = lan.slice(2, 4);
        const promotion = lan.slice(4, 5) || undefined;
        const move = temp.move({ from, to, promotion });
        if (!move) break;
        if (move.color === "w") {
          sanList.push(`${moveNum}. ${move.san}`);
        } else {
          if (!sanList.length) sanList.push(`${moveNum}...`);
          sanList.push(move.san);
          moveNum++;
        }
      }
      return sanList.join(" ");
    } catch {
      return lanMoves.join(" ");
    }
  }

  function getOrCreateEngineWorker() {
    // Share a single in-flight handshake: a second caller must never be handed a
    // worker that has not answered "uciok"/"readyok" yet, and must not boot a
    // duplicate engine (that would be a second ~95MB wasm download).
    if (engineInitRef.current) return engineInitRef.current;
    if (engineWorkerRef.current) return Promise.resolve(engineWorkerRef.current);

    const init = new Promise((resolve, reject) => {
      try {
        // Stockfish 19's glue derives its wasm URL from the loading script's own
        // pathname (".js" -> ".wasm"), so the worker must BE /stockfish.js.
        // Wrapping it in a separate worker file makes it request /wrapper.wasm and
        // the engine then starts up silently without ever answering "uci".
        const worker = new Worker(`${window.location.origin}/stockfish.js`);
        engineWorkerRef.current = worker;

        // The full NNUE network is ~95MB; allow generous time on first load.
        const timer = setTimeout(() => {
          worker.terminate();
          engineWorkerRef.current = null;
          engineInitRef.current = null;
          reject(new Error("Engine setup timed out loading Stockfish."));
        }, 120000);

        worker.onerror = (event) => {
          clearTimeout(timer);
          worker.terminate();
          engineWorkerRef.current = null;
          engineInitRef.current = null;
          reject(new Error(event.message || "Engine worker failed to start."));
        };

        worker.onmessage = (event) => {
          const line = typeof event.data === "string" ? event.data : "";
          if (line.includes("uciok")) {
            // Tune once, before any search. A bigger hash makes re-searches of
            // nearby positions (stepping through moves) much quicker.
            worker.postMessage("setoption name Hash value 96");
            worker.postMessage("setoption name Move Overhead value 50");
            worker.postMessage("setoption name Ponder value false");
            worker.postMessage("setoption name MultiPV value 1");
            worker.postMessage("isready");
          } else if (line.includes("readyok")) {
            // Messages are processed in order, so this readyok confirms the
            // setoptions above have been applied.
            clearTimeout(timer);
            engineInitRef.current = null;
            engineReadyRef.current = true;
            resolve(worker);
          }
        };

        worker.postMessage("uci");
      } catch (err) {
        engineInitRef.current = null;
        reject(err);
      }
    });

    engineInitRef.current = init;
    return init;
  }

  // Full analysis evaluations
  const evaluatePositionSync = (worker, fenStr, depth, timeMs) => {
    return new Promise((resolve, reject) => {
      let bestMove = null;
      let latestScore = { type: "cp", value: 0 };
      const timeout = setTimeout(() => {
        cleanup();
        worker.postMessage("stop");
        reject(new Error("Engine evaluation timed out."));
      }, timeMs + 8000);

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
        worker.removeEventListener("message", handler);
      };

      worker.addEventListener("message", handler);
      worker.postMessage(`position fen ${fenStr}`);
      worker.postMessage(`go depth ${depth} movetime ${timeMs}`);
    });
  };

  const parseScore = (line) => {
    // Bound scores are not exact evaluations; using them corrupted the report's
    // centipawn deltas (a real +3 could be reported as 0.00 before the drop).
    if (/lowerbound|upperbound/.test(line)) return null;
    const mateMatch = line.match(/score mate (-?\d+)/);
    if (mateMatch) return { type: "mate", value: Number(mateMatch[1]) };
    const cpMatch = line.match(/score cp (-?\d+)/);
    if (cpMatch) return { type: "cp", value: Number(cpMatch[1]) };
    return null;
  };

  // Engine scores are always reported from the point of view of the SIDE TO MOVE,
  // which is not the same thing as the player being graded. The position after a
  // player's move has the opponent to move, so its sign must be flipped by the
  // mover first and only then re-expressed for the player.
  const normalizeEngineScore = (score, sideToMove, playerColor) => {
    if (!score) return 0;
    const otherColor = sideToMove === "w" ? "b" : "w";

    if (score.type === "mate") {
      // "mate N" (N > 0) = side to move delivers mate; "mate -N" or "mate 0" =
      // the side to move gets mated (0 meaning it is already mate/stalemate).
      const matingColor = score.value > 0 ? sideToMove : otherColor;
      return matingColor === playerColor ? 10000 : -10000;
    }

    const whiteValue = sideToMove === "w" ? score.value : -score.value;
    return playerColor === "w" ? whiteValue : -whiteValue;
  };

  // Trigger full analysis of game
  const analyzeGameHandler = async () => {
    setBusy(true);
    busyRef.current = true;
    setAnalysis(null);
    setGameMode("analyze");
    stopLiveAnalysis();

    try {
      setStatus("Loading game content...");
      const pgn = await resolvePgnInput();
      const chessObj = new Chess();
      try {
        chessObj.loadPgn(pgn);
      } catch (err) {
        throw new Error("I couldn't parse that PGN game. Export the standard PGN from Chess.com and paste it directly. Detail: " + err.message);
      }

      const headers = chessObj.header();
      const verboseMoves = chessObj.history({ verbose: true });

      if (!verboseMoves.length) {
        throw new Error("This game has no moves to analyze.");
      }

      const playerColor = detectPlayerColor(headers);
      setStatus("Starting Stockfish analysis engine...");

      let worker = null;
      let depthNum = Math.min(Number(inputs.engineDepth) || 12, 30);
      const budgetMs = thinkingMsForDepth(depthNum);
      try {
        worker = await getOrCreateEngineWorker();
        activeAnalysisModeRef.current = "engine";
        worker.postMessage("ucinewgame");
      } catch (err) {
        console.warn("Stockfish could not start, falling back to heuristic analysis", err);
        activeAnalysisModeRef.current = "heuristic";
      }

      const playerMoves = [];
      const records = [];
      const phaseBuckets = { opening: [], middlegame: [], endgame: [] };
      const analyzerGame = new Chess();

      for (let i = 0; i < verboseMoves.length; i++) {
        const move = verboseMoves[i];
        const turnColor = analyzerGame.turn();
        const isPlayerMove = turnColor === playerColor;
        const fenBefore = analyzerGame.fen();
        const phase = classifyPhase(analyzerGame, i);

        let evaluationBefore = 0;
        let bestMove = null;
        let evaluationAfter = 0;
        let mateBefore = null;
        let mateAfter = null;
        let centipawnLoss = 0;
        let moveLabel = "Opponent";

        setStatus(`Analyzing move ${Math.ceil((i + 1) / 2)} of ${Math.ceil(verboseMoves.length / 2)}...`);

        if (isPlayerMove) {
          if (activeAnalysisModeRef.current === "engine") {
            const resultBefore = await evaluatePositionSync(worker, fenBefore, depthNum, budgetMs);
            evaluationBefore = normalizeEngineScore(resultBefore.score, turnColor, playerColor);
            mateBefore = resultBefore.score.type === "mate" ? Math.abs(resultBefore.score.value) : null;
            bestMove = resultBefore.bestMove;
            // Convert best move coords to SAN
            bestMove = convertLanToSan(fenBefore, [bestMove]).replace(/^\d+(?:\.\.\.|\.)?\s*/, "");
          } else {
            evaluationBefore = evaluateHeuristic(analyzerGame, playerColor);
            bestMove = pickHeuristicBestMove(analyzerGame, playerColor);
          }
        }

        analyzerGame.move(move);

        if (isPlayerMove) {
          if (activeAnalysisModeRef.current === "engine") {
            if (analyzerGame.isCheckmate()) {
              // The player delivered mate: the engine has nothing to search here
              // (it answers "bestmove (none)"), so score it directly.
              evaluationAfter = 10000;
              mateAfter = 0;
            } else if (analyzerGame.isStalemate()) {
              evaluationAfter = 0;
            } else {
              const resultAfter = await evaluatePositionSync(worker, analyzerGame.fen(), depthNum, budgetMs);
              evaluationAfter = normalizeEngineScore(resultAfter.score, analyzerGame.turn(), playerColor);
              mateAfter = resultAfter.score.type === "mate" ? Math.abs(resultAfter.score.value) : null;
            }
          } else {
            evaluationAfter = evaluateHeuristic(analyzerGame, playerColor);
          }

          centipawnLoss = Math.min(
            Math.max(
              calculateCentipawnLoss(evaluationBefore, evaluationAfter),
              mateDistancePenalty(evaluationBefore, evaluationAfter, mateBefore, mateAfter)
            ),
            1000
          );
          // The engine's own top choice is a stronger signal than a small eval
          // swing: shallow searches routinely disagree with themselves by 10-20
          // pawns between neighbouring positions, which used to label accurate
          // moves as inaccuracies.
          const playedTheBestMove =
            activeAnalysisModeRef.current === "engine" &&
            sanKey(bestMove) === sanKey(move.san);
          moveLabel = playedTheBestMove ? "Best" : classifyMove(centipawnLoss, evaluationAfter);

          const record = {
            index: i,
            moveNumber: Math.ceil((i + 1) / 2),
            color: turnColor,
            san: move.san,
            fenBefore,
            phase,
            evaluationBefore,
            evaluationAfter,
            mateBefore,
            mateAfter,
            // Kept in White's own perspective so the eval bar can be painted while
            // reviewing the game with the engine switched off.
            whiteEvalAfter: playerColor === "w" ? evaluationAfter : -evaluationAfter,
            centipawnLoss,
            bestMove,
            label: moveLabel,
            themes: detectThemes(move, analyzerGame, phase),
          };

          playerMoves.push(record);
          phaseBuckets[phase].push(record);
          records.push(record);
        }
      }

      setStatus("Compiling report analytics...");
      const summaryResult = summarizeAnalysis({
        headers,
        playerColor,
        playerMoves,
        phaseBuckets,
        records,
        analysisMode: activeAnalysisModeRef.current,
      });

      // Update states
      setAnalysis(summaryResult);
      setMoves(verboseMoves);
      setGame(chessObj);
      setCurrentMoveIndex(verboseMoves.length - 1);
      setFen(chessObj.fen());
      setOrientation(playerColor === "w" ? "white" : "black");
      setRightPanelTab("moves");
      setStatus("Analysis completed successfully!");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Something went wrong during game analysis.");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const resolvePgnInput = async () => {
    const pasted = inputs.pgnInput.trim();
    if (pasted) return normalizePgn(pasted);

    const rawUrl = inputs.gameUrl.trim();
    if (!rawUrl) throw new Error("Please enter a game URL or paste PGN data.");

    const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    let parsedUrl;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      throw new Error("Please enter a valid Chess.com link.");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname !== "chess.com" && !hostname.endsWith(".chess.com")) {
      throw new Error("URL importing is supported for Chess.com game links only. Paste PGN for other sites.");
    }

    const gameIdMatch = parsedUrl.pathname.match(/\/game\/(?:live|daily|link|blitz|rapid|bullet|board|[\w-]+)\/(\d+)/);
    const gameId = gameIdMatch ? gameIdMatch[1] : null;
    if (!gameId) {
      throw new Error("I couldn't read a game ID from that link. Use a full Chess.com game URL like chess.com/game/live/123456789, or paste the PGN.");
    }

    const username = inputs.playerName.trim();
    if (!username) {
      throw new Error("To import by URL, also enter the Chess.com username of one player. The public API looks up games by username. Or just paste the PGN.");
    }

    setStatus("Locating game via the Chess.com public API...");
    try {
      const pgn = await fetchPgnFromChessComApi(username, gameId);
      handleInputChange("pgnInput", pgn);
      return pgn;
    } catch (err) {
      throw new Error(err.message || "Couldn't import this game from Chess.com. Double-check the URL and username, or paste the PGN export instead.");
    }
  };

  // Resolve a PGN from a Chess.com game ID using the CORS-enabled public API.
  // The public API only exposes games grouped by player + month, so we scan
  // that player's archives (newest first) until we find the matching game.
  const fetchPgnFromChessComApi = async (username, gameId) => {
    const archiveResp = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`
    );
    if (!archiveResp.ok) {
      throw new Error(`No Chess.com data found for user "${username}". Check the spelling, or paste the PGN.`);
    }
    const archiveJson = await archiveResp.json();
    const archives = (archiveJson.archives || []).slice().reverse();

    for (const archiveUrl of archives) {
      const monthResp = await fetch(archiveUrl);
      if (!monthResp.ok) continue;
      const monthJson = await monthResp.json();
      const games = monthJson.games || [];
      const found = games.find(
        (g) => String(g.uuid) === String(gameId) || (g.url && g.url.endsWith(`/game/${g.url.includes("/daily") ? "daily" : "live"}/${gameId}`))
      );
      if (found && found.pgn) {
        return normalizePgn(found.pgn);
      }
    }

    throw new Error("Couldn't find that game in this player's Chess.com history. Make sure the username played this exact game, or paste the PGN export.");
  };

  const normalizePgn = (raw) => {
    const trimmed = raw.replace(/^\uFEFF/, "").trim();
    const tagStart = trimmed.search(/\[\w+\s+"(?:[^"\\]|\\.)*"\]/);
    const movetextStart = trimmed.search(/(?:^|\n)\s*\d+\.(?:\.\.)?/);

    if (tagStart === 0) return trimmed;
    if (tagStart > 0 && (movetextStart === -1 || tagStart < movetextStart)) {
      return trimmed.slice(tagStart).trim();
    }
    if (movetextStart >= 0) return trimmed.slice(movetextStart).trim();
    return trimmed;
  };

  const detectPlayerColor = (headers) => {
    const selected = inputs.playerColor;
    if (selected === "w" || selected === "b") return selected;

    const username = inputs.playerName.trim().toLowerCase();
    const white = (headers.White || "").trim();
    const black = (headers.Black || "").trim();

    if (username) {
      if (white.toLowerCase() === username) return "w";
      if (black.toLowerCase() === username) return "b";
      throw new Error(`The username "${inputs.playerName}" is not listed in this PGN game (${white} vs ${black}). Please select White/Black color manually.`);
    }

    throw new Error(`Auto-detect needs your Chess.com username. Enter your username, or select White/Black manually.`);
  };

  // Demo Game Loader
  const loadDemoGame = () => {
    const demoInputs = {
      ...defaultInputs,
      playerName: "TrainingWhite",
      playerColor: "w",
      pgnInput: demoPgn,
    };
    setInputs(demoInputs);
    try {
      localStorage.setItem(inputDraftStorageKey, JSON.stringify(demoInputs));
    } catch (e) {
      console.warn("Could not save input draft.", e);
    }
    setStatus("Demo game loaded. Click Analyze Game to compile review.");
  };

  // Clear inputs
  const clearInputs = () => {
    setInputs({ ...defaultInputs });
    localStorage.removeItem(inputDraftStorageKey);
    setStatus("Draft inputs cleared.");
  };

  // Step through moves of analyzed game
  const selectMoveIndex = (index) => {
    if (!moves.length) return;

    if (index === -1) {
      const startingFen = moves[0].before;
      setFen(startingFen);
      setGame(new Chess(startingFen));
      setCurrentMoveIndex(-1);
      return;
    }

    const selectedMove = moves[index];
    if (selectedMove) {
      setFen(selectedMove.after);
      setGame(new Chess(selectedMove.after));
    }
    setCurrentMoveIndex(index);
  };

  // Board Navigation Controls
  const stepFirst = () => {
    if (!moves.length) return;
    // Reuse the selection path so Home lands on the game's own starting position:
    // a game loaded from a FEN or a variant PGN does not start on the standard one.
    selectMoveIndex(-1);
  };

  const stepPrev = () => {
    if (!moves.length || currentMoveIndex < 0) return;
    selectMoveIndex(currentMoveIndex - 1);
  };

  const stepNext = () => {
    if (!moves.length || currentMoveIndex >= moves.length - 1) return;
    selectMoveIndex(currentMoveIndex + 1);
  };

  const stepLast = () => {
    if (!moves.length) return;
    selectMoveIndex(moves.length - 1);
  };

  const flipBoard = () => {
    // Both pieces of state derive from the current orientation. Nesting
    // setPlayerColorPref inside the setOrientation updater made the value stale
    // for anything reading it in the same tick (e.g. starting Play mode).
    const next = orientation === "white" ? "black" : "white";
    setOrientation(next);
    setPlayerColorPref(next === "white" ? "w" : "b");
  };

  // Keyboard stepping through a reviewed game. Clicking a move in the list focuses
  // it, and the arrow keys then did nothing; the buttons and the keys share the same
  // handlers. The latest closures live in a ref so the listener is bound once
  // instead of being re-attached on every render.
  const boardNavRef = useRef(null);
  boardNavRef.current = {
    enabled: moves.length > 0 && !busy && gameMode === "analyze",
    stepFirst,
    stepPrev,
    stepNext,
    stepLast,
    flipBoard,
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

      // Only Left/Right are claimed: vertical scrolling keeps working, and typing
      // into the PGN / URL fields is never interrupted.
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End" && event.key !== "f" && event.key !== "F") {
        return;
      }

      const target = event.target;
      const tag = target && target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable)) return;

      const nav = boardNavRef.current;
      if (!nav || !nav.enabled) return;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          nav.stepNext();
          break;
        case "ArrowLeft":
          event.preventDefault();
          nav.stepPrev();
          break;
        case "Home":
          event.preventDefault();
          nav.stepFirst();
          break;
        case "End":
          event.preventDefault();
          nav.stepLast();
          break;
        case "f":
        case "F":
          nav.flipBoard();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle move made manually by user on chessboard (Free analysis or VS Engine mode)
  const handleBoardMove = (sourceSquare, targetSquare) => {
    try {
      const copy = new Chess(game.fen());
      const p = copy.get(sourceSquare);

      const isPromotion = 
        p && p.type === "p" && 
        ((p.color === "w" && sourceSquare[1] === "7" && targetSquare[1] === "8") ||
         (p.color === "b" && sourceSquare[1] === "2" && targetSquare[1] === "1"));

      const move = copy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: isPromotion ? "q" : undefined,
      });

      if (!move) return false;

      // Make user move
      setGame(copy);
      setFen(copy.fen());

      // If playing vs engine, trigger engine response
      if (gameMode === "play") {
        setStatus("Stockfish is calculating...");
        triggerEngineResponse(copy.fen());
      } else {
        // Switch to free play from here
        if (gameMode === "analyze") {
          setGameMode("free");
          setStatus("Entered Free Analysis mode.");
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  // Engine response when playing against Stockfish
  const triggerEngineResponse = async (positionFen) => {
    if (busyRef.current) {
      setStatus("Stockfish is busy finishing the game report - try again in a moment.");
      return;
    }
    // Claim the worker before the first await, so the effect that reacts to the
    // new FEN cannot start a live search on top of this reply search.
    engineThinkingRef.current = true;
    try {
      // Don't run the live-eval search and the reply search at the same time:
      // two overlapping "go" commands serialize and double the wait.
      if (engineOn) stopLiveAnalysis();

      const worker = await getOrCreateEngineWorker();
      if (!worker) {
        engineThinkingRef.current = false;
        return;
      }

      const currentChess = new Chess(positionFen);
      if (currentChess.isGameOver()) {
        engineThinkingRef.current = false;
        setStatus("Game over!");
        return;
      }

      // Check depth selection
      const depth = Math.min(Number(inputs.engineDepth) || 12, 30);
      const freshGame = positionFen === startingFen;

      const handler = (event) => {
        const line = typeof event.data === "string" ? event.data : "";
        if (!line.startsWith("bestmove")) return;

        const lanMove = line.split(" ")[1];
        if (!lanMove || lanMove === "(none)") {
          // Terminal position for the engine: nothing to play.
          engineThinkingRef.current = false;
          worker.removeEventListener("message", handler);
          setStatus("Game over!");
          return;
        }

        const from = lanMove.slice(0, 2);
        const to = lanMove.slice(2, 4);
        const promotion = lanMove.slice(4, 5) || undefined;

        const nextChess = new Chess(positionFen);
        try {
          nextChess.move({ from, to, promotion });
        } catch {
          // A trailing "bestmove" from the live-eval search that was still winding
          // down when this one started: it belongs to the previous position (and so
          // is not even legal here). Ignore it and keep waiting for our own answer.
          return;
        }

        engineThinkingRef.current = false;
        worker.removeEventListener("message", handler);

        setGame(nextChess);
        setFen(nextChess.fen());

        if (nextChess.isGameOver()) {
          setStatus("Game over!");
        } else {
          setStatus("Your move.");
        }
      };

      worker.addEventListener("message", handler);
      if (engineOn) {
        // Same search, two consumers: this listener plays the move, the throttled
        // HUD consumer keeps the eval bar and principal line alive.
        setEngineIsAnalyzing(true);
        installLiveInfoConsumer(worker, positionFen);
      }
      // Only reset the engine on a new game; clearing it every move threw away the
      // transposition table and made each reply start searching from scratch.
      if (freshGame) worker.postMessage("ucinewgame");
      worker.postMessage(`position fen ${positionFen}`);
      // Wall-clock cap keeps the engine's reply snappy even at high depth.
      worker.postMessage(`go depth ${depth} movetime ${PLAY_MOVE_MS}`);
    } catch {
      engineThinkingRef.current = false;
      console.warn("Could not play engine move");
      setStatus("Engine failed to compute move.");
    }
  };

  const handleModeChange = (mode) => {
    setGameMode(mode);
    
    if (mode === "play") {
      // Start fresh game for vs engine
      const freshGame = new Chess();
      setGame(freshGame);
      setFen(startingFen);
      setOrientation(playerColorPref === "w" ? "white" : "black");
      setStatus("Play vs Engine mode. Make your move.");
      
      // If player wants to play black, trigger engine move immediately
      if (playerColorPref === "b") {
        setStatus("Stockfish is playing White...");
        triggerEngineResponse(freshGame.fen());
      }
    } else if (mode === "free") {
      // Retain active position but make it free play
      setStatus("Free Analysis. Drag pieces to analyze FEN.");
    } else {
      // Back to game review index if moves exist
      if (moves.length) {
        selectMoveIndex(currentMoveIndex);
        setOrientation(analysis?.playerColor === "w" ? "white" : "black");
        setStatus("Game review. Step through moves.");
      } else {
        setStatus("No analyzed game loaded yet.");
      }
    }
  };

  const resetFreePlay = () => {
    const fresh = new Chess();
    setGame(fresh);
    setFen(startingFen);
    if (gameMode === "play" && playerColorPref === "b") {
      setStatus("Stockfish is playing White...");
      triggerEngineResponse(fresh.fen());
    } else {
      setStatus(gameMode === "play" ? "Your move." : "Board reset.");
    }
  };

  // The report only stores engine evaluations for the graded side's own moves, so
  // fall back to the most recent one at or before the position being viewed.
  const reviewedEvalForIndex = (index) => {
    const graded = analysis?.moveRecords || [];
    for (let i = index; i >= 0; i -= 1) {
      const record = graded.find((entry) => entry.index === i);
      if (record) {
        const isMate = typeof record.mateAfter === "number";
        if (isMate && record.mateAfter === 0) {
          // Terminal position: the distance is zero, so only the sign carries who
          // actually got mated. Multiplying by 0 would flatten it and paint the
          // bar for the losing side.
          return { type: "mate", value: Math.sign(record.whiteEvalAfter) || 1, now: true };
        }
        return {
          // The HUD prints mate scores as a distance (M3), not as the 10000 sentinel
          // used internally for classification.
          type: isMate ? "mate" : "cp",
          value: isMate ? Math.sign(record.whiteEvalAfter) * record.mateAfter : record.whiteEvalAfter,
        };
      }
    }
    return null;
  };

  return (
    <div className="shell">
      {/* Premium Header */}
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Chess.com Review Studio</p>
          <h1>Turn one game into a practical training plan.</h1>
          <p className="lede">
            Paste a game URL or PGN below to get centipawn analytics, tactical breakdowns, phase reports, and Stockfish recommended improvement lines.
          </p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring orbit-ring-one"></div>
          <div className="orbit-ring orbit-ring-two"></div>
          <div className="hero-piece">N</div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="main-layout">
        {/* Left Side: Chessboard Section */}
        <ChessboardSection
          fen={fen}
          onMoveMade={handleBoardMove}
          orientation={orientation}
          onFlipBoard={flipBoard}
          onStepFirst={stepFirst}
          onStepPrev={stepPrev}
          onStepNext={stepNext}
          onStepLast={stepLast}
          isFirstMove={currentMoveIndex === -1}
          isLastMove={!moves.length || currentMoveIndex === moves.length - 1}
          movesLength={moves.length}
          gameMode={gameMode}
          onChangeGameMode={handleModeChange}
          engineOn={engineOn}
          onToggleEngine={setEngineOn}
          // The saved report evaluations only describe the analyzed game, so they
          // must not be painted beside a fresh play/free position (that left "M0"
          // from the previous game on screen while a new game was being played).
          engineEval={engineOn ? engineEval : gameMode === "analyze" ? reviewedEvalForIndex(currentMoveIndex) : null}
          enginePv={enginePv}
          engineDepth={engineDepthReached}
          engineNps={engineNps}
          engineIsAnalyzing={engineIsAnalyzing}
          onResetFreePlay={resetFreePlay}
        />

        {/* Right Side: Inputs or Moves history */}
        {rightPanelTab === "input" ? (
          <GameInputSection
            inputs={inputs}
            onChangeInput={handleInputChange}
            onAnalyze={analyzeGameHandler}
            onLoadDemo={loadDemoGame}
            onClear={clearInputs}
            busy={busy}
            status={status}
          />
        ) : (
          <MovesListSection
            moves={moves}
            // All graded records, not criticalMoves: the top-8 swing list left most
            // of the player's own moves without any annotation in the move list.
            playerMoves={analysis?.moveRecords || []}
            currentMoveIndex={currentMoveIndex}
            onSelectMoveIndex={selectMoveIndex}
            onShowInput={() => setRightPanelTab("input")}
            headers={analysis?.headers}
          />
        )}
      </main>

      {/* Report Dashboard Section */}
      {analysis && (
        <AnalysisReport 
          analysis={analysis} 
          onSelectMoveIndex={(index) => {
            setGameMode("analyze");
            selectMoveIndex(index);
            // Scroll to board
            window.scrollTo({ top: 120, behavior: "smooth" });
          }} 
        />
      )}
    </div>
  );
}
