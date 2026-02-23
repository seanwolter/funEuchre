import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5173;
const DEFAULT_HOST = "0.0.0.0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distRoot = join(__dirname, "dist");
const indexPath = join(__dirname, "index.html");

function resolvePort(rawPort) {
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_PORT;
  }

  return parsed;
}

function contentType(pathname) {
  const extension = extname(pathname);
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

function safeDistPath(pathname) {
  const normalized = normalize(pathname.replace(/^\/+/, ""));
  const resolved = join(distRoot, normalized.replace(/^dist\//, ""));
  if (!resolved.startsWith(distRoot)) {
    return null;
  }

  return resolved;
}

async function sendFile(res, absolutePath, statusCode = 200) {
  try {
    const payload = await readFile(absolutePath);
    res.writeHead(statusCode, { "content-type": contentType(absolutePath) });
    res.end(payload);
  } catch {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
}

const port = resolvePort(process.env.PORT);
const host = process.env.HOST ?? DEFAULT_HOST;

const server = createServer(async (req, res) => {
  const incomingPath = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  ).pathname;

  if (incomingPath === "/dist" || incomingPath.startsWith("/dist/")) {
    const absolutePath = safeDistPath(incomingPath);
    if (!absolutePath) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid asset path" }));
      return;
    }

    await sendFile(res, absolutePath);
    return;
  }

  await sendFile(res, indexPath);
});

server.listen(port, host, () => {
  console.log(`web shell listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down web shell`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
