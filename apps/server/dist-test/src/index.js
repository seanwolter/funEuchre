import { createServer } from "node:http";
import { URL } from "node:url";
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
function resolvePort(rawPort) {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return DEFAULT_PORT;
    }
    return parsed;
}
const port = resolvePort(process.env.PORT);
const host = process.env.HOST ?? DEFAULT_HOST;
const server = createServer((req, res) => {
    if (!req.url) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Missing request URL" }));
        return;
    }
    const method = req.method ?? "GET";
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
        if (method !== "GET" && method !== "HEAD") {
            res.writeHead(405, {
                "content-type": "application/json; charset=utf-8",
                allow: "GET, HEAD"
            });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }
        const payload = JSON.stringify({
            status: "ok",
            service: "fun-euchre-server",
            uptimeSeconds: Math.floor(process.uptime())
        });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        if (method === "HEAD") {
            res.end();
            return;
        }
        res.end(payload);
        return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
});
server.listen(port, host, () => {
    console.log(`fun-euchre server listening on http://${host}:${port}`);
});
function shutdown(signal) {
    console.log(`received ${signal}, shutting down`);
    server.close(() => {
        process.exit(0);
    });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
