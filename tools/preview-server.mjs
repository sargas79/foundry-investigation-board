/**
 * A dependency-free static file server for previewing the board's look without launching Foundry.
 *
 *   node tools/preview-server.mjs          # http://localhost:4173
 *   PORT=5000 node tools/preview-server.mjs
 *
 * Serves the repository root, so the preview page can reference the real stylesheets, fonts and
 * textures by the same relative paths the module uses.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".hbs": "text/plain; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, url === "/" ? "tools/preview/index.html" : url);

  // Never serve outside the repository.
  if ( !filePath.startsWith(ROOT) ) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if ( fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() ) {
    filePath = path.join(filePath, "index.html");
  }

  if ( !fs.existsSync(filePath) ) {
    res.writeHead(404, {"content-type": "text/plain"}).end(`Not found: ${url}`);
    return;
  }

  res.writeHead(200, {
    "content-type": TYPES[path.extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log(`Preview server on http://localhost:${PORT}`));
