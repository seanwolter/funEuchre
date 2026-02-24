import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5173;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_API_ORIGIN = "http://127.0.0.1:3000";

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
const srcRoot = join(__dirname, "src");
const protocolVendorRoot = join(__dirname, "..", "..", "packages", "protocol", "dist");
const indexPath = join(__dirname, "index.html");
const apiOrigin = new URL(process.env.API_ORIGIN ?? DEFAULT_API_ORIGIN);
const publicOrigin =
  typeof process.env.PUBLIC_ORIGIN === "string" ? process.env.PUBLIC_ORIGIN.trim() : "";
const apiPort =
  apiOrigin.port.length > 0
    ? Number(apiOrigin.port)
    : apiOrigin.protocol === "https:"
      ? 443
      : 80;
const apiHost = apiOrigin.hostname;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host"
]);

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

function safeSourcePath(pathname) {
  const normalized = normalize(pathname.replace(/^\/+/, ""));
  const resolved = join(__dirname, normalized);
  if (!resolved.startsWith(srcRoot)) {
    return null;
  }

  return resolved;
}

function safeProtocolVendorPath(pathname) {
  const normalized = normalize(pathname.replace(/^\/+/, ""));
  const resolved = join(
    protocolVendorRoot,
    normalized.replace(/^vendor\/protocol\//, "")
  );
  if (!resolved.startsWith(protocolVendorRoot)) {
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

function sendAppConfig(res) {
  const payload = `window.__FUN_EUCHRE_CONFIG__ = ${JSON.stringify({
    publicOrigin
  })};\n`;
  res.writeHead(200, {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function shouldProxyHttp(pathname) {
  return (
    pathname === "/health" ||
    pathname === "/actions" ||
    pathname === "/lobbies" ||
    pathname.startsWith("/lobbies/")
  );
}

function filterRequestHeaders(headers) {
  const nextHeaders = {};
  for (const [name, rawValue] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      nextHeaders[name] = rawValue.join(", ");
      continue;
    }
    if (typeof rawValue === "string") {
      nextHeaders[name] = rawValue;
    }
  }
  return nextHeaders;
}

function filterResponseHeaders(headers) {
  const nextHeaders = {};
  for (const [name, value] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    nextHeaders[name] = value;
  }
  return nextHeaders;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  return Buffer.concat(chunks);
}

async function proxyHttp(req, res, incomingUrl) {
  const method = req.method ?? "GET";
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin);
  const body =
    method === "GET" || method === "HEAD" ? null : await readRequestBody(req);

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: filterRequestHeaders(req.headers),
      body
    });
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, filterResponseHeaders(upstream.headers));
    res.end(payload);
  } catch {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Upstream server is unavailable."
      })
    );
  }
}

function normalizeRequestPath(urlValue, hostHeader) {
  const parsed = new URL(urlValue ?? "/", `http://${hostHeader ?? "localhost"}`);
  return parsed.pathname;
}

const port = resolvePort(process.env.PORT);
const host = process.env.HOST ?? DEFAULT_HOST;

const server = createServer(async (req, res) => {
  const incomingUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const incomingPath = incomingUrl.pathname;

  if (incomingPath === "/app-config.js") {
    sendAppConfig(res);
    return;
  }

  if (shouldProxyHttp(incomingPath)) {
    await proxyHttp(req, res, incomingUrl);
    return;
  }

  if (incomingPath === "/vendor/protocol" || incomingPath.startsWith("/vendor/protocol/")) {
    const absolutePath = safeProtocolVendorPath(
      incomingPath === "/vendor/protocol" ? "/vendor/protocol/index.js" : incomingPath
    );
    if (!absolutePath) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid vendor asset path" }));
      return;
    }

    await sendFile(res, absolutePath);
    return;
  }

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

  if (incomingPath === "/src" || incomingPath.startsWith("/src/")) {
    const absolutePath = safeSourcePath(incomingPath);
    if (!absolutePath) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid source path" }));
      return;
    }

    await sendFile(res, absolutePath);
    return;
  }

  await sendFile(res, indexPath);
});

server.on("upgrade", (req, socket, head) => {
  const incomingPath = normalizeRequestPath(req.url, req.headers.host);
  if (incomingPath !== "/realtime/ws") {
    socket.destroy();
    return;
  }

  const upstream = createConnection(
    {
      host: apiHost,
      port: apiPort
    },
    () => {
      let requestHead = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}\r\n`;
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const headerName = req.rawHeaders[index];
        const headerValue = req.rawHeaders[index + 1];
        if (headerName === undefined || headerValue === undefined) {
          continue;
        }
        requestHead += `${headerName}: ${headerValue}\r\n`;
      }
      requestHead += "\r\n";

      upstream.write(requestHead);
      if (head.length > 0) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    }
  );

  upstream.on("error", () => {
    socket.destroy();
  });
  socket.on("error", () => {
    upstream.destroy();
  });
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
