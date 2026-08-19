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

const engineCdn = "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.js";
const inputDraftStorageKey = "chessAnalyzer.inputDraft";
const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function App() {
  // Input fields
  const [inputs, setInputs] = useState({
    gameUrl: "",
    playerName: "",
    playerColor: "auto",
    engineDepth: "12",
    pgnInput: "",
  });

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
  const liveEvalTimeoutRef = useRef(null);
  const activeAnalysisModeRef = useRef("engine"); // engine | heuristic

  // Load inputs from local storage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(inputDraftStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setInputs({
            gameUrl: parsed.gameUrl || "",
            playerName: parsed.playerName || "",
            playerColor: parsed.playerColor || "auto",
            engineDepth: parsed.engineDepth || "12",
            pgnInput: parsed.pgnInput || "",
          });
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
      if (engineWorkerRef.current) {
        engineWorkerRef.current.terminate();
      }
    };
  }, []);

  // Live engine worker manager
  useEffect(() => {
    if (!engineOn) {
      stopLiveAnalysis();
      setEngineEval(null);
      setEnginePv("");
      setEngineDepthReached(0);
      setEngineNps(0);
      setEngineIsAnalyzing(false);
      return;
    }

    startLiveAnalysisOfCurrentFen();
  }, [fen, engineOn]);

  function stopLiveAnalysis() {
    if (engineWorkerRef.current && engineIsAnalyzing) {
      engineWorkerRef.current.postMessage("stop");
      setEngineIsAnalyzing(false);
    }
    if (liveEvalTimeoutRef.current) {
      clearTimeout(liveEvalTimeoutRef.current);
    }
  }

  async function startLiveAnalysisOfCurrentFen() {
    stopLiveAnalysis();
    
    try {
      const worker = await getOrCreateEngineWorker();
      if (!worker) return;

      setEngineIsAnalyzing(true);
      setEnginePv("");
      setEngineDepthReached(0);
      setEngineNps(0);

      // Listen for updates
      worker.onmessage = (event) => {
        const line = typeof event.data === "string" ? event.data : "";
        
        if (line.startsWith("info depth")) {
          // Parse depth and nps
          const depthMatch = line.match(/depth (\d+)/);
          const npsMatch = line.match(/nps (\d+)/);
          if (depthMatch) setEngineDepthReached(Number(depthMatch[1]));
          if (npsMatch) setEngineNps(Number(npsMatch[1]));

          // Parse score
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          
          if (cpMatch) {
            // Adjust score based on who is to move in FEN
            const sideToMove = fen === startingFen ? "w" : fen.split(" ")[1] || "w";
            let val = Number(cpMatch[1]);
            // If black to move, invert the score to represent absolute White advantage
            if (sideToMove === "b") {
              val = -val;
            }
            setEngineEval({ type: "cp", value: val });
          } else if (mateMatch) {
            let val = Number(mateMatch[1]);
            const sideToMove = fen === startingFen ? "w" : fen.split(" ")[1] || "w";
            if (sideToMove === "b") {
              val = -val;
            }
            setEngineEval({ type: "mate", value: val });
          }

          // Parse PV moves and convert to SAN for premium look
          const pvIdx = line.indexOf(" pv ");
          if (pvIdx !== -1) {
            const rawPv = line.substring(pvIdx + 4).trim().split(" ").slice(0, 5);
            const prettyPv = convertLanToSan(fen === startingFen ? startingFen : fen, rawPv);
            setEnginePv(prettyPv);
          }
        }
      };

      worker.postMessage("ucinewgame");
      worker.postMessage(`position fen ${fen === startingFen ? startingFen : fen}`);
      worker.postMessage(`go depth 14`);
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
      let moveNum = Math.ceil((temp.history().length + 1) / 2);
      let turn = temp.turn();

      for (const lan of lanMoves) {
        const from = lan.slice(0, 2);
        const to = lan.slice(2, 4);
        const promotion = lan.slice(4, 5) || undefined;
        const move = temp.move({ from, to, promotion });
        if (turn === "w") {
          sanList.push(`${moveNum}. ${move.san}`);
        } else {
          sanList.push(move.san);
        }
        turn = temp.turn();
        if (turn === "w") {
          moveNum = Math.ceil((temp.history().length + 1) / 2);
        }
      }
      return sanList.join(" ");
    } catch {
      return lanMoves.join(" ");
    }
  }

  function getOrCreateEngineWorker() {
    if (engineWorkerRef.current) return Promise.resolve(engineWorkerRef.current);

    return new Promise((resolve, reject) => {
      try {
        const bootCode = `
          self.Module = {};
          importScripts("${engineCdn}");
        `;
        const workerUrl = URL.createObjectURL(new Blob([bootCode], { type: "application/javascript" }));
        const worker = new Worker(workerUrl);
        engineWorkerRef.current = worker;

        const timer = setTimeout(() => {
          worker.terminate();
          engineWorkerRef.current = null;
          reject(new Error("Engine setup timed out."));
        }, 30000);

        worker.onmessage = (event) => {
          const line = typeof event.data === "string" ? event.data : "";
          if (line.includes("uciok")) {
            worker.postMessage("isready");
          } else if (line.includes("readyok")) {
            clearTimeout(timer);
            resolve(worker);
          }
        };

        worker.postMessage("uci");
      } catch (err) {
        reject(err);
      }
    });
  }

  // Full analysis evaluations
  const evaluatePositionSync = (worker, fenStr, depth) => {
    return new Promise((resolve, reject) => {
      let bestMove = null;
      let latestScore = { type: "cp", value: 0 };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Engine evaluation timed out."));
      }, 15000);

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
      worker.postMessage("ucinewgame");
      worker.postMessage(`position fen ${fenStr}`);
      worker.postMessage(`go depth ${depth}`);
    });
  };

  const parseScore = (line) => {
    const mateMatch = line.match(/score mate (-?\d+)/);
    if (mateMatch) return { type: "mate", value: Number(mateMatch[1]) };
    const cpMatch = line.match(/score cp (-?\d+)/);
    if (cpMatch) return { type: "cp", value: Number(cpMatch[1]) };
    return null;
  };

  const normalizeEngineScore = (score, playerColor) => {
    if (!score) return 0;
    if (score.type === "mate") {
      const mateBase = score.value > 0 ? 10000 : -10000;
      return playerColor === "w" ? mateBase : -mateBase;
    }
    return playerColor === "w" ? score.value : -score.value;
  };

  // Trigger full analysis of game
  const analyzeGameHandler = async () => {
    setBusy(true);
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
      let depthNum = Number(inputs.engineDepth);
      try {
        worker = await getOrCreateEngineWorker();
        activeAnalysisModeRef.current = "engine";
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
        let centipawnLoss = 0;
        let moveLabel = "Opponent";

        setStatus(`Analyzing move ${Math.ceil((i + 1) / 2)} of ${Math.ceil(verboseMoves.length / 2)}...`);

        if (isPlayerMove) {
          if (activeAnalysisModeRef.current === "engine") {
            const resultBefore = await evaluatePositionSync(worker, fenBefore, depthNum);
            evaluationBefore = normalizeEngineScore(resultBefore.score, playerColor);
            bestMove = resultBefore.bestMove;
            // Convert best move coords to SAN
            bestMove = convertLanToSan(fenBefore, [bestMove]).replace(/^\d+\.\s*/, "");
          } else {
            evaluationBefore = evaluateHeuristic(analyzerGame, playerColor);
            bestMove = pickHeuristicBestMove(analyzerGame, playerColor);
          }
        }

        analyzerGame.move(move);

        if (isPlayerMove) {
          if (activeAnalysisModeRef.current === "engine") {
            const resultAfter = await evaluatePositionSync(worker, analyzerGame.fen(), depthNum);
            evaluationAfter = normalizeEngineScore(resultAfter.score, playerColor);
          } else {
            evaluationAfter = evaluateHeuristic(analyzerGame, playerColor);
          }

          centipawnLoss = calculateCentipawnLoss(evaluationBefore, evaluationAfter);
          moveLabel = classifyMove(centipawnLoss, evaluationAfter);

          const record = {
            index: i,
            moveNumber: Math.ceil((i + 1) / 2),
            color: turnColor,
            san: move.san,
            fenBefore,
            phase,
            evaluationBefore,
            evaluationAfter,
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

    if (!parsedUrl.hostname.includes("chess.com")) {
      throw new Error("URL importing is supported for Chess.com game links only. Paste PGN for other sites.");
    }

    setStatus("Fetching game data from Chess.com...");
    try {
      const response = await fetch(parsedUrl.toString());
      if (!response.ok) throw new Error();
      const html = await response.text();
      const match = html.match(/"pgn":"(.*?)"/);
      if (!match) throw new Error("Could not find PGN in this page.");
      
      const escaped = match[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      
      const pgn = normalizePgn(escaped);
      handleInputChange("pgnInput", pgn);
      return pgn;
    } catch {
      throw new Error("The browser could not load this Chess.com page directly due to network restrictions. Please paste the PGN export from the share sheet instead.");
    }
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
    setInputs({
      gameUrl: "",
      playerName: "TrainingWhite",
      playerColor: "w",
      engineDepth: "12",
      pgnInput: demoPgn,
    });
    setStatus("Demo game loaded. Click Analyze Game to compile review.");
  };

  // Clear inputs
  const clearInputs = () => {
    setInputs({
      gameUrl: "",
      playerName: "",
      playerColor: "auto",
      engineDepth: "12",
      pgnInput: "",
    });
    localStorage.removeItem(inputDraftStorageKey);
    setStatus("Draft inputs cleared.");
  };

  // Step through moves of analyzed game
  const selectMoveIndex = (index) => {
    console.log("selectMoveIndex called - index:", index, "moves length:", moves.length);
    if (!moves.length) return;

    if (index === -1) {
      const startingFen = moves[0].before;
      console.log("Selecting starting position, FEN:", startingFen);
      setFen(startingFen);
      setGame(new Chess(startingFen));
      setCurrentMoveIndex(-1);
      return;
    }

    const selectedMove = moves[index];
    console.log("Selected move details:", selectedMove);
    if (selectedMove) {
      console.log("Setting FEN to:", selectedMove.after);
      setFen(selectedMove.after);
      setGame(new Chess(selectedMove.after));
    } else {
      console.warn("No move found at index:", index);
    }
    setCurrentMoveIndex(index);
  };

  // Board Navigation Controls
  const stepFirst = () => {
    if (!moves.length) return;
    setCurrentMoveIndex(-1);
    setFen(startingFen);
    setGame(new Chess());
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
    setOrientation((prev) => {
      const next = prev === "white" ? "black" : "white";
      setPlayerColorPref(next === "white" ? "w" : "b");
      return next;
    });
  };

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
    try {
      const worker = await getOrCreateEngineWorker();
      if (!worker) return;

      const currentChess = new Chess(positionFen);
      if (currentChess.isGameOver()) {
        setStatus("Game over!");
        return;
      }

      // Check depth selection
      const depth = Number(inputs.engineDepth);

      const handler = (event) => {
        const line = typeof event.data === "string" ? event.data : "";
        if (line.startsWith("bestmove")) {
          const lanMove = line.split(" ")[1];
          if (lanMove && lanMove !== "(none)") {
            const from = lanMove.slice(0, 2);
            const to = lanMove.slice(2, 4);
            const promotion = lanMove.slice(4, 5) || undefined;
            
            // Execute engine move
            const nextChess = new Chess(positionFen);
            nextChess.move({ from, to, promotion });

            setGame(nextChess);
            setFen(nextChess.fen());
            
            if (nextChess.isGameOver()) {
              setStatus("Game over!");
            } else {
              setStatus("Your move.");
            }
          }
          worker.removeEventListener("message", handler);
        }
      };

      worker.addEventListener("message", handler);
      worker.postMessage("ucinewgame");
      worker.postMessage(`position fen ${positionFen}`);
      worker.postMessage(`go depth ${depth}`);
    } catch {
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
          gameMode={gameMode}
          onChangeGameMode={handleModeChange}
          engineOn={engineOn}
          onToggleEngine={setEngineOn}
          engineEval={engineEval}
          enginePv={enginePv}
          engineDepth={engineDepthReached}
          engineNps={engineNps}
          engineIsAnalyzing={engineIsAnalyzing}
          onResetFreePlay={resetFreePlay}
          playerColorPreference={playerColorPref}
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
            playerMoves={analysis?.criticalMoves || []}
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
