// Development-only diagnostics.
//
// Every state these describe is already surfaced where a visitor can actually see it:
// the engine HUD says which build loaded, that it fell back to the lite one, or that a
// report was graded without an engine, and a failed analysis prints its message in the
// status line. On a deployed site the console copies of those facts are noise in
// somebody else's developer tools, and they read as leaks to anyone who opens them.
//
// import.meta.env.DEV is replaced with a literal at build time, so the call and its
// message text are eliminated from the production bundle rather than guarded at
// runtime - no bundler flag involved (Vite 8 builds with rolldown, which ignores
// esbuild.drop and treeshake.manualPureFuncs for this).
export function devWarn(...args) {
  if (import.meta.env.DEV) console.warn(...args);
}

export function devError(...args) {
  if (import.meta.env.DEV) console.error(...args);
}
