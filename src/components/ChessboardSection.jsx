import React, { useState, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RotateCw, Cpu } from "lucide-react";

// Which engine actually came up, said in the user's terms. A report graded by the
// lite build, or by heuristics after both engines failed, is still worth reading - it
// must just never look identical to a full Stockfish one.
const ENGINE_NOTICES = {
  loading:
    "Starting Stockfish 19. The first visit downloads a 94.5 MB neural network, which can take a minute or two.",
  "loading-lite":
    "The full engine is too slow on this connection - starting the 1.7 MB build instead.",
  lite: "Running the lightweight Stockfish build: real engine analysis, slightly weaker than the full network.",
  failed:
    "Stockfish could not load, so this analysis is heuristic and not engine-verified. Check the connection and run it again.",
};

export default function ChessboardSection({
  fen,
  onMoveMade,
  orientation,
  onFlipBoard,
  onStepFirst,
  onStepPrev,
  onStepNext,
  onStepLast,
  isFirstMove,
  isLastMove,
  movesLength,
  gameMode,
  onChangeGameMode,
  engineOn,
  onToggleEngine,
  engineEval,
  enginePv,
  engineDepth,
  engineNps,
  engineIsAnalyzing,
  engineStatus,
  engineVariant,
  onResetFreePlay,
}) {
  const containerRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(400);

  // Resize board dynamically to fit the container
  useEffect(() => {
    if (!containerRef.current) return;
    
    const handleResize = () => {
      const width = containerRef.current.getBoundingClientRect().width;
      // Subtract 64px to account for the eval bar and spacing, cap between 260px and 500px
      setBoardWidth(Math.max(260, Math.min(width - 64, 500)));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    
    // Tiny delay to ensure styles are painted and layout is stable
    const timer = setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, []);

  // Evaluations arrive in White's point of view, but the bar sits beside a board
  // that can be flipped. Reading it as "how much the player at the bottom owns the
  // position" keeps the number, the fill and the board agreeing after a flip.
  const bottomIsWhite = orientation !== "black";
  const evalForView = engineEval
    ? { ...engineEval, value: bottomIsWhite ? engineEval.value : -engineEval.value }
    : null;

  // Helper to format evaluation score for display
  const getEvalDisplay = () => {
    if (!evalForView) {
      return engineOn ? "Evaluating..." : "Engine Off";
    }
    
    if (evalForView.type === "mate") {
      // "now" marks an already-terminal position (UCI mate 0), where the mate
      // distance is zero: show it as M0 rather than the +/-1 sentinel.
      return evalForView.now ? "M0" : `M${Math.abs(evalForView.value)}`;
    }
    
    const score = evalForView.value / 100;
    return score >= 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  };

  // Helper to calculate the fill percentage for the evaluation bar.
  // A linear map made a healthy +1.5 advantage look dead even, so this uses the
  // same arctan curve the review sites do: it grows fast for small advantages and
  // saturates for winning ones instead of running off the bar.
  const fillPercentForScore = (cp) => {
    const percent = 50 + 50 * (2 / Math.PI) * Math.atan(cp / 350);
    return Math.max(2, Math.min(98, percent));
  };

  const getEvalPercentage = () => {
    if (!evalForView) return 50;
    
    if (evalForView.type === "mate") {
      return evalForView.value > 0 ? 98 : 2;
    }
    
    // The fill is anchored at the bottom of the bar, so it always measures the
    // bottom side's share of the position.
    return fillPercentForScore(evalForView.value);
  };

  const evalPercent = getEvalPercentage();
  
  return (
    <section className="panel" style={{ minHeight: "100%" }}>
      <div className="mode-selector" role="group" aria-label="Board mode">
        <button
          type="button"
          className={`mode-tab ${gameMode === "analyze" ? "active" : ""}`}
          onClick={() => onChangeGameMode("analyze")}
          aria-pressed={gameMode === "analyze"}
        >
          Game Review
        </button>
        <button
          type="button"
          className={`mode-tab ${gameMode === "play" ? "active" : ""}`}
          onClick={() => onChangeGameMode("play")}
          aria-pressed={gameMode === "play"}
        >
          Play vs Engine
        </button>
        <button
          type="button"
          className={`mode-tab ${gameMode === "free" ? "active" : ""}`}
          onClick={() => onChangeGameMode("free")}
          aria-pressed={gameMode === "free"}
        >
          Free Analysis
        </button>
      </div>

      <div className="board-container" ref={containerRef}>
        {/* Interactive Evaluation Bar */}
        <div className="eval-bar-wrapper">
          <div 
            className="eval-bar-fill" 
            style={{ 
              height: `${evalPercent}%`, 
              backgroundColor: "#f0ece7" 
            }} 
          />
          <div className="eval-bar-text">
            {getEvalDisplay()}
          </div>
        </div>

        {/* The Chessboard */}
        <div className="board-wrapper" style={{ width: boardWidth, height: boardWidth }}>
          <Chessboard
            key={fen}
            options={{
              position: fen ? fen.split(" ")[0] : "start",
              boardOrientation: orientation,
              allowDragging: gameMode !== "analyze",
              darkSquareStyle: { backgroundColor: "#7a6b5d" },
              lightSquareStyle: { backgroundColor: "#e6dac2" },
              boardStyle: {
                borderRadius: "8px",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)",
                border: "5px solid #4a3f35"
              },
              onPieceDrop: ({ sourceSquare, targetSquare }) => onMoveMade(sourceSquare, targetSquare)
            }}
          />
        </div>
      </div>

      {/* Active FEN Display */}
      <div 
        className="fen-display"
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          textAlign: "center",
          fontFamily: "monospace",
          backgroundColor: "rgba(0,0,0,0.03)",
          padding: "6px 12px",
          borderRadius: "6px",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          border: "1px dashed rgba(0,0,0,0.1)",
          margin: "0 auto 12px auto",
          width: "fit-content"
        }}
        title={fen}
      >
        Active FEN: {fen}
      </div>

      {/* Board Controls */}
      <div className="board-controls">
        {gameMode === "analyze" ? (
          <>
            <button
              className="control-btn"
              onClick={onStepFirst}
              disabled={isFirstMove}
              title="First move"
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              className="control-btn"
              onClick={onStepPrev}
              disabled={isFirstMove}
              title="Previous move"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="control-btn"
              onClick={onStepNext}
              disabled={isLastMove}
              title="Next move"
            >
              <ChevronRight size={16} />
            </button>
            <button
              className="control-btn"
              onClick={onStepLast}
              disabled={isLastMove}
              title="Last move"
            >
              <ChevronsRight size={16} />
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={onResetFreePlay}>
            Reset Board
          </button>
        )}
        <button
          className="control-btn"
          onClick={onFlipBoard}
          title="Flip board"
        >
          <RotateCw size={16} />
        </button>
      </div>

      {gameMode === "analyze" && movesLength > 0 && (
        <p
          className="board-hint"
          style={{ fontSize: "0.72rem", color: "var(--text-muted)", textAlign: "center", margin: "-4px 0 12px" }}
        >
          ← / → step moves · Home / End jump · F flips the board
        </p>
      )}

      {/* Engine HUD */}
      <div className="engine-hud">
        <div className="engine-header">
          <div className="engine-title">
            <Cpu size={16} className={engineIsAnalyzing ? "text-accent" : "text-muted"} />
            <span>Stockfish Engine{engineVariant === "lite" ? " (lite)" : ""}</span>
          </div>
          <label className="engine-switch">
            <span>{engineOn ? "Active" : "Disabled"}</span>
            <input
              type="checkbox"
              className="switch-input"
              checked={engineOn}
              onChange={(e) => onToggleEngine(e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>

        {/* Outside the engineOn block on purpose: a report that was graded without a
            working engine has to stay explained after the toggle is switched off. */}
        {ENGINE_NOTICES[engineStatus] && (
          <p
            className={`engine-notice${engineStatus === "failed" ? " is-error" : ""}`}
            role="status"
          >
            {ENGINE_NOTICES[engineStatus]}
          </p>
        )}

        {engineOn && (
          <>
            <div className="engine-stats">
              <div>Eval: <strong>{getEvalDisplay()}</strong></div>
              <div>Depth: <strong>{engineDepth || "-"}</strong></div>
              <div>NPS: <strong>{engineNps ? Math.round(engineNps / 1000) + "k" : "-"}</strong></div>
            </div>
            <div className="engine-pv">
              <strong>Line: </strong>
              {enginePv ? (
                <span>{enginePv}</span>
              ) : (
                <span className="muted">Calculating principal variation...</span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
