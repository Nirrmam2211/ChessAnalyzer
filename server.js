const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = process.env.PORT || 3000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.join(root, requestPath);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "text/plain; charset=utf-8",
    });
    res.end(data);
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`Chess Analyzer running on port ${port}`);
});