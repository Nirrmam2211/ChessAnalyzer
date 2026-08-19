import React from "react";
import { Award, AlertTriangle } from "lucide-react";
import { performanceLabel, consistencyLabel, phaseDetail, describeMove } from "../utils/chessAnalyzer";

export default function AnalysisReport({ 
  analysis, 
  onSelectMoveIndex 
}) {
  if (!analysis) return null;

  const {
    performanceScore,
    avgCpl,
    bestPhase,
    worstPhase,
    primaryLeak,
    summary,
    strengths,
    issues,
    phaseScores,
    recommendations,
    criticalMoves,
  } = analysis;

  const capitalize = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  return (
    <div className="results-container">
      {/* Metrics Strip */}
      <div className="overview-strip">
        <div className="metric-block">
          <p className="metric-label">Performance Score</p>
          <h3 className="metric-value">{performanceScore}</h3>
          <p className="metric-note">{performanceLabel(performanceScore)}</p>
        </div>

        <div className="metric-block">
          <p className="metric-label">Avg Centipawn Loss</p>
          <h3 className="metric-value">{avgCpl.toFixed(1)}</h3>
          <p className="metric-note">{consistencyLabel(avgCpl)}</p>
        </div>

        <div className="metric-block">
          <p className="metric-label">Best Phase</p>
          <h3 className="metric-value">{capitalize(bestPhase)}</h3>
          <p className="metric-note">
            {phaseScores[bestPhase] !== null ? `${phaseScores[bestPhase]}/100 score` : "Steady play"}
          </p>
        </div>

        <div className="metric-block">
          <p className="metric-label">Primary Training Target</p>
          <h3 className="metric-value" style={{ fontSize: "1.4rem", margin: "6px 0 2px" }}>
            {primaryLeak}
          </h3>
          <p className="metric-note">Weakest: {capitalize(worstPhase)}</p>
        </div>
      </div>

      {/* Grid: Game Overview & Themes */}
      <div className="grid-report">
        {/* Game Overview */}
        <section className="panel">
          <div className="panel-heading">
            <p className="section-kicker">Summary</p>
            <h2>Game overview</h2>
          </div>
          <div className="meta-list">
            <div className="meta-item">
              <strong>Players</strong>
              <span>{analysis.headers?.White || "White"} vs {analysis.headers?.Black || "Black"}</span>
            </div>
            <div className="meta-item">
              <strong>Analyze color</strong>
              <span>{analysis.playerColor === "w" ? "White" : "Black"}</span>
            </div>
            <div className="meta-item">
              <strong>Opening</strong>
              <span>{analysis.headers?.Opening || "Unknown opening"}</span>
            </div>
            <div className="meta-item">
              <strong>Moves count</strong>
              <span>{analysis.totalMoves || Math.ceil((analysis.criticalMoves[0]?.index || 2) / 2)}</span>
            </div>
            <div className="meta-item">
              <strong>Analysis Mode</strong>
              <span>{analysis.analysisMode === "engine" ? "Stockfish 16 Engine" : "Heuristic fallback"}</span>
            </div>
          </div>
          <p className="summary-copy">{summary}</p>
        </section>

        {/* Strengths & Weaknesses */}
        <section className="panel">
          <div className="panel-heading">
            <p className="section-kicker">Themes</p>
            <h2>Key elements of play</h2>
          </div>
          <div className="grid-two" style={{ gridTemplateColumns: "1fr", gap: "16px" }}>
            <div className="tag-column">
              <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px", color: "#10b981", display: "flex", alignItems: "center", gap: "6px" }}>
                <Award size={16} /> Strengths
              </h3>
              {strengths.map((item, idx) => (
                <article key={idx} className="tag-card strength">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>

            <div className="tag-column" style={{ marginTop: "8px" }}>
              <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px", color: "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
                <AlertTriangle size={16} /> Vulnerabilities
              </h3>
              {issues.map((item, idx) => (
                <article key={idx} className="tag-card issue">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Grid: Phase Breakdown & Recommendations */}
      <div className="grid-report">
        {/* Phase Breakdown */}
        <section className="panel">
          <div className="panel-heading">
            <p className="section-kicker">Phases</p>
            <h2>Opening to endgame</h2>
          </div>
          <div className="phase-grid">
            {["opening", "middlegame", "endgame"].map((phase) => {
              const score = phaseScores[phase];
              return (
                <div key={phase} className="phase-card">
                  <strong>{capitalize(phase)}</strong>
                  <div className="phase-score">
                    {score === null ? "N/A" : `${score}/100`}
                  </div>
                  <p>{phaseDetail(phase, score)}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Actionable Recommendations */}
        <section className="panel">
          <div className="panel-heading">
            <p className="section-kicker">Improvement</p>
            <h2>Targeted training recommendations</h2>
          </div>
          <div className="recommendation-list">
            {recommendations.map((rec, idx) => (
              <article key={idx} className="recommendation-card">
                <strong>{rec.title}</strong>
                <p>{rec.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      {/* Critical Moments Section */}
      <section className="panel" style={{ gridColumn: "span 2" }}>
        <div className="panel-heading">
          <p className="section-kicker">Move Review</p>
          <h2>Critical Moments</h2>
          <p className="section-copy" style={{ maxWidth: "100%" }}>
            Click on any critical moment to jump the board to the position and view details. Focus on correcting blunders and mistakes.
          </p>
        </div>

        <div className="critical-moves-grid">
          {criticalMoves.map((move, idx) => (
            <article 
              key={idx} 
              className="move-card"
              onClick={() => onSelectMoveIndex(move.index)}
            >
              <div className="move-card-header">
                <span className="move-card-title">
                  Move {move.moveNumber}: {move.san}
                </span>
                <span className={`badge ${move.label.toLowerCase()}`}>
                  {move.label}
                </span>
              </div>
              <p>{describeMove(move, analysis.analysisMode)}</p>
              <div className="move-card-meta">
                <span>Best: <strong>{move.bestMove || "N/A"}</strong></span>
                <span>Phase: <strong>{capitalize(move.phase)}</strong></span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
