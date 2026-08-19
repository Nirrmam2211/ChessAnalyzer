import React, { useEffect, useRef } from "react";
import { FileInput } from "lucide-react";

export default function MovesListSection({
  moves,
  playerMoves,
  currentMoveIndex,
  onSelectMoveIndex,
  onShowInput,
  headers,
}) {
  const activeRef = useRef(null);

  // Auto-scroll to active move in the list
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentMoveIndex]);

  // Group moves into pairs (turns)
  const renderMovePairs = () => {
    const pairs = [];
    for (let i = 0; i < moves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteMove = moves[i];
      const blackMove = moves[i + 1];

      // Find analysis records for these moves if they exist
      const whiteRecord = playerMoves.find((m) => m.index === i);
      const blackRecord = playerMoves.find((m) => m.index === i + 1);

      pairs.push({
        num: moveNum,
        white: {
          san: whiteMove.san,
          index: i,
          record: whiteRecord,
        },
        black: blackMove
          ? {
              san: blackMove.san,
              index: i + 1,
              record: blackRecord,
            }
          : null,
      });
    }

    return pairs.map((pair) => {
      const isWhiteSelected = currentMoveIndex === pair.white.index;
      const isBlackSelected = pair.black && currentMoveIndex === pair.black.index;

      const getBadgeClass = (record) => {
        if (!record) return "badge opponent";
        return `badge ${record.label.toLowerCase()}`;
      };

      return (
        <div key={pair.num} className="move-row-container" style={{ display: "flex", gap: "8px", margin: "2px 0" }}>
          <div className="move-num" style={{ width: "36px", padding: "8px 0", color: "var(--muted)", fontFamily: "monospace" }}>
            {pair.num}.
          </div>
          
          {/* White Move Ply */}
          <div
            ref={isWhiteSelected ? activeRef : null}
            className={`move-row ${isWhiteSelected ? "selected" : ""}`}
            onClick={() => onSelectMoveIndex(pair.white.index)}
            style={{ flex: 1 }}
          >
            <span className="move-san">{pair.white.san}</span>
            {pair.white.record && (
              <div className="move-badge-cell">
                <span className={getBadgeClass(pair.white.record)}>
                  {pair.white.record.label}
                </span>
              </div>
            )}
          </div>

          {/* Black Move Ply */}
          {pair.black ? (
            <div
              ref={isBlackSelected ? activeRef : null}
              className={`move-row ${isBlackSelected ? "selected" : ""}`}
              onClick={() => onSelectMoveIndex(pair.black.index)}
              style={{ flex: 1 }}
            >
              <span className="move-san">{pair.black.san}</span>
              {pair.black.record && (
                <div className="move-badge-cell">
                  <span className={getBadgeClass(pair.black.record)}>
                    {pair.black.record.label}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}
        </div>
      );
    });
  };

  return (
    <section className="panel moves-sidebar">
      <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <p className="section-kicker">Navigation</p>
          <h2 style={{ fontSize: "1.4rem" }}>Game Moves</h2>
        </div>
        <button className="btn btn-ghost" onClick={onShowInput} style={{ padding: "8px 12px", fontSize: "0.8rem" }}>
          <FileInput size={14} />
          Load Game
        </button>
      </div>

      {headers && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "14px", borderBottom: "1px solid var(--line)", paddingBottom: "10px" }}>
          <strong>{headers.White || "White"}</strong> vs <strong>{headers.Black || "Black"}</strong>
          <div style={{ fontSize: "0.75rem", marginTop: "2px" }}>{headers.Opening || "Opening not listed"}</div>
        </div>
      )}

      <div className="moves-scrollable">
        {moves.length === 0 ? (
          <div className="muted" style={{ padding: "20px 0", textAlign: "center" }}>
            No moves loaded. Start by running analysis.
          </div>
        ) : (
          renderMovePairs()
        )}
      </div>
    </section>
  );
}
