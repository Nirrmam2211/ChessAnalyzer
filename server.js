import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = process.env.PORT || 3000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  // Required for WebAssembly.instantiateStreaming; without it the engine falls
  // back to downloading the 90MB+ binary as an ArrayBuffer (much slower).
  ".wasm": "application/wasm",
};

// Engine binaries and hashed assets are safe to cache: the browser then skips
// re-fetching ~95MB on every page load.
function cacheControlFor(ext) {
  return ext === ".wasm" || ext === ".js" || ext === ".css"
    ? "public, max-age=86400"
    : "no-cache";
}

http.createServer((req, res) => {
  // Strip the query before deciding anything: /?engine=lite is the app, not a
  // missing file, and the root only maps to index.html once the ?... is gone.
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const distRoot = path.join(root, "dist");
  const filePath = path.join(distRoot, requestPath === "/" ? "index.html" : requestPath);

  // Never serve outside dist/, whatever the URL claims.
  if (!filePath.startsWith(distRoot + path.sep) && filePath !== distRoot) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  // stat first so we can send Content-Length and stream instead of buffering.
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "text/plain; charset=utf-8",
      "Content-Length": stats.size,
      "Cache-Control": cacheControlFor(ext),
    });

    // Stream instead of buffering: readFile would load the whole engine binary
    // into memory for every request.
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`Chess Analyzer serving from dist on port ${port}`);
});