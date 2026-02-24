export const ROUTE_KEYS = ["lobby", "game", "help"] as const;

export type AppRoute = (typeof ROUTE_KEYS)[number];

type RouteListener = (route: AppRoute) => void;

export type HashRouter = {
  start(): void;
  stop(): void;
  current(): AppRoute;
  navigate(route: AppRoute): void;
};

export type HashRouterOptions = {
  onRouteChange: RouteListener;
  win?: Window;
};

const DEFAULT_ROUTE: AppRoute = "lobby";

export function resolveRoute(hash: string): AppRoute {
  const normalized = hash.replace(/^#\/?/, "").toLowerCase();
  if (ROUTE_KEYS.includes(normalized as AppRoute)) {
    return normalized as AppRoute;
  }

  return DEFAULT_ROUTE;
}

export function createHashRouter(options: HashRouterOptions): HashRouter {
  const win = options.win ?? window;
  const onRouteChange = options.onRouteChange;
  const handleHashChange = (): void => {
    onRouteChange(resolveRoute(win.location.hash));
  };
  let started = false;

  return {
    start: () => {
      if (started) {
        return;
      }
      started = true;
      handleHashChange();
      win.addEventListener("hashchange", handleHashChange);
    },
    stop: () => {
      if (!started) {
        return;
      }
      started = false;
      win.removeEventListener("hashchange", handleHashChange);
    },
    current: () => resolveRoute(win.location.hash),
    navigate: (route) => {
      win.location.hash = `/${route}`;
    }
  };
}
