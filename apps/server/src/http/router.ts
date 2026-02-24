import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type RouteMethod = HttpMethod | readonly HttpMethod[] | "*";

export type RouteContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string;
};

export type RouteHandler = (context: RouteContext) => void | Promise<void>;

export type RouteDefinition = {
  method: RouteMethod;
  path: string;
  handler: RouteHandler;
};

export type AppRouterOptions = {
  lobbyRoutes?: readonly RouteDefinition[];
  actionRoutes?: readonly RouteDefinition[];
};

export type AppRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
} as const;

function toMethodList(routeMethod: RouteMethod): string[] {
  if (routeMethod === "*") {
    return [];
  }
  if (isMethodList(routeMethod)) {
    return [...routeMethod];
  }

  return [routeMethod];
}

function methodMatches(routeMethod: RouteMethod, method: string): boolean {
  if (routeMethod === "*") {
    return true;
  }
  if (isMethodList(routeMethod)) {
    return routeMethod.includes(method as HttpMethod);
  }

  return routeMethod === method;
}

function isMethodList(routeMethod: RouteMethod): routeMethod is readonly HttpMethod[] {
  return Array.isArray(routeMethod);
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(statusCode, { ...JSON_HEADERS, ...headers });
  response.end(JSON.stringify(payload));
}

function createHealthRoute(): RouteDefinition {
  return {
    method: ["GET", "HEAD"],
    path: "/health",
    handler: ({ method, response }) => {
      if (method === "HEAD") {
        response.writeHead(200, JSON_HEADERS);
        response.end();
        return;
      }

      respondJson(response, 200, {
        status: "ok",
        service: "fun-euchre-server",
        uptimeSeconds: Math.floor(process.uptime())
      });
    }
  };
}

function buildRouteTable(options: AppRouterOptions): RouteDefinition[] {
  return [
    createHealthRoute(),
    ...(options.lobbyRoutes ?? []),
    ...(options.actionRoutes ?? [])
  ];
}

export function createAppRouter(options: AppRouterOptions = {}): AppRequestHandler {
  const routes = buildRouteTable(options);

  return async (request, response) => {
    if (!request.url) {
      respondJson(response, 400, { error: "Missing request URL" });
      return;
    }

    const method = request.method ?? "GET";
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const pathRoutes = routes.filter((route) => route.path === url.pathname);

    if (pathRoutes.length === 0) {
      respondJson(response, 404, { error: "Not found" });
      return;
    }

    const matchedRoute = pathRoutes.find((route) => methodMatches(route.method, method));
    if (!matchedRoute) {
      const allow = Array.from(
        new Set(pathRoutes.flatMap((route) => toMethodList(route.method)))
      ).join(", ");
      respondJson(response, 405, { error: "Method not allowed" }, { allow });
      return;
    }

    await matchedRoute.handler({
      request,
      response,
      url,
      method
    });
  };
}
