import React from "react";
import { Play, FileText, Trash2 } from "lucide-react";

export default function GameInputSection({
  inputs,
  onChangeInput,
  onAnalyze,
  onLoadDemo,
  onClear,
  busy,
  status,
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="section-kicker">Input</p>
        <h2>Load your game</h2>
        <p className="section-copy">
          Paste a Chess.com game link or load a raw PGN. URL loading reads public page data. PGN export is the most reliable fallback.
        </p>
      </div>

      <div className="grid-two">
        <label className="field">
          <span>Chess.com game URL</span>
          <input
            type="url"
            value={inputs.gameUrl}
            onChange={(e) => onChangeInput("gameUrl", e.target.value)}
            placeholder="https://www.chess.com/game/live/..."
            disabled={busy}
          />
        </label>

        <label className="field">
          <span>Your Chess.com username</span>
          <input
            type="text"
            value={inputs.playerName}
            onChange={(e) => onChangeInput("playerName", e.target.value)}
            placeholder="Optional, for auto-color detection"
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid-two">
        <label className="field">
          <span>Analyze as</span>
          <select
            value={inputs.playerColor}
            onChange={(e) => onChangeInput("playerColor", e.target.value)}
            disabled={busy}
          >
            <option value="auto">Auto-detect</option>
            <option value="w">White</option>
            <option value="b">Black</option>
          </select>
        </label>

        <label className="field">
          <span>Engine depth</span>
          <select
            value={inputs.engineDepth}
            onChange={(e) => onChangeInput("engineDepth", e.target.value)}
            disabled={busy}
          >
            <option value="10">Fast (depth 10)</option>
            <option value="12">Balanced (depth 12)</option>
            <option value="14">Deep (depth 14)</option>
          </select>
        </label>
      </div>

      <label className="field" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <span>PGN Content</span>
        <textarea
          rows={7}
          value={inputs.pgnInput}
          onChange={(e) => onChangeInput("pgnInput", e.target.value)}
          placeholder='[Event "Live Chess"]&#10;[White "YourName"]&#10;...'
          disabled={busy}
          style={{ flex: 1 }}
        />
      </label>

      <div className="action-row">
        <button
          className="btn btn-accent"
          type="button"
          onClick={onAnalyze}
          disabled={busy || (!inputs.gameUrl.trim() && !inputs.pgnInput.trim())}
        >
          <Play size={16} />
          {busy ? "Analyzing..." : "Analyze Game"}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={onLoadDemo}
          disabled={busy}
        >
          <FileText size={16} />
          Load Demo Game
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={onClear}
          disabled={busy}
        >
          <Trash2 size={16} />
          Clear Input
        </button>
      </div>

      {status && (
        <div className="status-box" aria-live="polite">
          <div className="loader-dot" />
          <span>{status}</span>
        </div>
      )}
    </section>
  );
}
