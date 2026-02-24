import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { createAppRouter, type RouteDefinition } from "../src/http/router.js";

const indexSourceEntry = join(process.cwd(), "src", "index.ts");
const routerSourceEntry = join(process.cwd(), "src", "http", "router.ts");
const builtIndexEntry = join(process.cwd(), "dist", "index.js");
const builtServerEntry = join(process.cwd(), "dist", "server.js");
const builtRouterEntry = join(process.cwd(), "dist", "http", "router.js");

type ResponseState = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
};

function headerValueToString(value: string | number | readonly string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value === undefined) {
    return "";
  }

  return value.join(", ");
}

function createMockRequest(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: {
      host: "127.0.0.1:3000"
    }
  } as IncomingMessage;
}

function createMockResponse(): { response: ServerResponse; state: ResponseState } {
  const state: ResponseState = {
    statusCode: null,
    headers: {},
    body: null
  };

  const response = {
    writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): ServerResponse {
      state.statusCode = statusCode;
      state.headers = {};
      for (const [key, value] of Object.entries(headers ?? {})) {
        state.headers[key.toLowerCase()] = headerValueToString(value);
      }
      return response as unknown as ServerResponse;
    },
    end(chunk?: string | Buffer): ServerResponse {
      if (typeof chunk === "string") {
        state.body = chunk;
      } else if (chunk) {
        state.body = chunk.toString("utf8");
      } else {
        state.body = null;
      }
      return response as unknown as ServerResponse;
    }
  };

  return {
    response: response as unknown as ServerResponse,
    state
  };
}

test("index bootstraps server via createAppServer and keeps route logic out of process bootstrap", async () => {
  const source = await readFile(indexSourceEntry, "utf8");
  assert.match(source, /createAppServer/);
  assert.equal(source.includes("createServer("), false);
  assert.equal(source.includes("/health"), false);
});

test("router composes default and injected routes without opening a port", async () => {
  const lobbyRoutes: RouteDefinition[] = [
    {
      method: "GET",
      path: "/lobbies",
      handler: ({ response }) => {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ area: "lobby" }));
      }
    }
  ];
  const actionRoutes: RouteDefinition[] = [
    {
      method: "POST",
      path: "/actions",
      handler: ({ response }) => {
        response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ area: "action" }));
      }
    }
  ];

  const router = createAppRouter({ lobbyRoutes, actionRoutes });
  const lobbyResponse = createMockResponse();
  await router(createMockRequest("GET", "/lobbies"), lobbyResponse.response);
  assert.equal(lobbyResponse.state.statusCode, 200);
  assert.deepEqual(JSON.parse(lobbyResponse.state.body ?? "{}"), { area: "lobby" });

  const actionResponse = createMockResponse();
  await router(createMockRequest("POST", "/actions"), actionResponse.response);
  assert.equal(actionResponse.state.statusCode, 202);
  assert.deepEqual(JSON.parse(actionResponse.state.body ?? "{}"), { area: "action" });
});

test("default /health route enforces methods and payload semantics", async () => {
  const router = createAppRouter();

  const getHealth = createMockResponse();
  await router(createMockRequest("GET", "/health"), getHealth.response);
  assert.equal(getHealth.state.statusCode, 200);
  const payload = JSON.parse(getHealth.state.body ?? "{}");
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "fun-euchre-server");

  const headHealth = createMockResponse();
  await router(createMockRequest("HEAD", "/health"), headHealth.response);
  assert.equal(headHealth.state.statusCode, 200);
  assert.equal(headHealth.state.body, null);

  const postHealth = createMockResponse();
  await router(createMockRequest("POST", "/health"), postHealth.response);
  assert.equal(postHealth.state.statusCode, 405);
  assert.equal(postHealth.state.headers.allow, "GET, HEAD");
});

test("router returns 404 for unknown paths", async () => {
  const router = createAppRouter();
  const result = createMockResponse();
  await router(createMockRequest("GET", "/missing"), result.response);
  assert.equal(result.state.statusCode, 404);
  assert.deepEqual(JSON.parse(result.state.body ?? "{}"), { error: "Not found" });
});

test("server build artifacts are generated for bootstrap, server factory, and router", async () => {
  await Promise.all([
    access(builtIndexEntry, constants.R_OK),
    access(builtServerEntry, constants.R_OK),
    access(builtRouterEntry, constants.R_OK)
  ]);

  const routerBuilt = await readFile(builtRouterEntry, "utf8");
  assert.match(routerBuilt, /\/health/);
});

test("router source defines health endpoint behavior", async () => {
  const source = await readFile(routerSourceEntry, "utf8");
  assert.match(source, /\/health/);
  assert.match(source, /status:\s*"ok"/);
});
