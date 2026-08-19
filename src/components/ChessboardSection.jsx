import React, { useState, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RotateCw, Cpu } from "lucide-react";

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
  gameMode,
  onChangeGameMode,
  engineOn,
  onToggleEngine,
  engineEval,
  enginePv,
  engineDepth,
  engineNps,
  engineIsAnalyzing,
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

  // Helper to format evaluation score for display
  const getEvalDisplay = () => {
    if (!engineOn) return "Engine Off";
    if (!engineEval) return "Evaluating...";
    
    if (engineEval.type === "mate") {
      return `M${Math.abs(engineEval.value)}`;
    }
    
    const score = engineEval.value / 100;
    return score >= 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  };

  // Helper to calculate evaluation bar percentage
  // 50% is even. White advantage is higher, Black is lower.
  const getEvalPercentage = () => {
    if (!engineOn || !engineEval) return 50;
    
    if (engineEval.type === "mate") {
      return engineEval.value > 0 ? 100 : 0;
    }
    
    const cp = engineEval.value;
    // Map -800 to +800 cp into 5% to 95% range
    let percentage = 50 + (cp / 16);
    percentage = Math.max(5, Math.min(95, percentage));
    return percentage;
  };

  const evalPercent = getEvalPercentage();
  
  return (
    <section className="panel" style={{ minHeight: "100%" }}>
      <div className="mode-selector">
        <div
          className={`mode-tab ${gameMode === "analyze" ? "active" : ""}`}
          onClick={() => onChangeGameMode("analyze")}
        >
          Game Review
        </div>
        <div
          className={`mode-tab ${gameMode === "play" ? "active" : ""}`}
          onClick={() => onChangeGameMode("play")}
        >
          Play vs Engine
        </div>
        <div
          className={`mode-tab ${gameMode === "free" ? "active" : ""}`}
          onClick={() => onChangeGameMode("free")}
        >
          Free Analysis
        </div>
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

      {/* Engine HUD */}
      <div className="engine-hud">
        <div className="engine-header">
          <div className="engine-title">
            <Cpu size={16} className={engineIsAnalyzing ? "text-accent" : "text-muted"} />
            <span>Stockfish Engine</span>
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
