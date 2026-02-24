import {
  bootstrapAppSession,
  type BootstrapNotice,
} from "./app/bootstrap.js";
import {
  ROUTE_KEYS,
  createHashRouter,
  type AppRoute
} from "./app/router.js";
import { createHttpClient } from "./lib/httpClient.js";
import { createSessionClient } from "./lib/session.js";
import { gamePage, mountGamePage } from "./pages/GamePage.js";
import { helpPage } from "./pages/HelpPage.js";
import { lobbyPage, mountLobbyPage } from "./pages/LobbyPage.js";
import type { RouteView } from "./pages/RouteView.js";
import { createGameStore } from "./state/gameStore.js";

const appRootId = "app";
const themeLinkId = "fun-euchre-theme";

const ROUTE_VIEWS: Record<AppRoute, RouteView> = {
  lobby: lobbyPage,
  game: gamePage,
  help: helpPage
};

type AppRuntime = {
  store: ReturnType<typeof createGameStore>;
  httpClient: ReturnType<typeof createHttpClient>;
  sessionClient: ReturnType<typeof createSessionClient>;
  bootstrapNotice: BootstrapNotice | null;
};

function ensureThemeStyles(documentRef: Document): void {
  if (documentRef.getElementById(themeLinkId)) {
    return;
  }

  const link = documentRef.createElement("link");
  link.id = themeLinkId;
  link.rel = "stylesheet";
  link.href = new URL("../src/styles/theme.css", import.meta.url).toString();
  documentRef.head.appendChild(link);
}

function tabMarkup(route: AppRoute, activeRoute: AppRoute): string {
  const label = route.charAt(0).toUpperCase() + route.slice(1);
  const classes = route === activeRoute ? "tab active" : "tab";
  return `<a href="#/${route}" class="${classes}" data-route="${route}">${label}</a>`;
}

function renderStaticRoute(
  route: AppRoute,
  tabs: string,
  documentRef: Document,
  root: HTMLElement
): void {
  const view = ROUTE_VIEWS[route];
  const bullets = view.bullets.map((bullet) => `<li>${bullet}</li>`).join("");

  root.innerHTML = `
    <div class="shell">
      <header class="masthead">
        <span class="badge">${view.badge}</span>
        <h1>${view.title}</h1>
        <p>${view.subtitle}</p>
        <nav class="tabs" aria-label="Primary">${tabs}</nav>
      </header>

      <main class="content-grid">
        <section class="panel" aria-labelledby="checkpoints-heading">
          <h2 id="checkpoints-heading">MVP UI Checkpoints</h2>
          <ul class="checklist">${bullets}</ul>
          <div class="status-row">
            <span class="status-chip">${view.statusLabel}</span>
            <span>${view.statusText}</span>
          </div>
        </section>

        <aside class="panel" aria-labelledby="focus-heading">
          <h3 id="focus-heading">${view.panelTitle}</h3>
          <p>${view.panelBody}</p>
        </aside>
      </main>
    </div>
  `;
}

function renderRoute(
  route: AppRoute,
  documentRef: Document,
  runtime: AppRuntime,
  win: Window,
  activeCleanup: () => void
): () => void {
  activeCleanup();

  const root = documentRef.getElementById(appRootId);
  if (!root) {
    throw new Error(`Expected #${appRootId} container to exist.`);
  }

  const tabs = ROUTE_KEYS.map((candidate) => tabMarkup(candidate, route)).join("");

  if (route === "lobby") {
    return mountLobbyPage({
      root,
      documentRef,
      win,
      tabsMarkup: tabs,
      store: runtime.store,
      httpClient: runtime.httpClient,
      sessionClient: runtime.sessionClient,
      initialFeedback: runtime.bootstrapNotice
    });
  }
  if (route === "game") {
    return mountGamePage({
      root,
      documentRef,
      win,
      tabsMarkup: tabs,
      store: runtime.store,
      httpClient: runtime.httpClient,
      sessionClient: runtime.sessionClient,
      initialFeedback: runtime.bootstrapNotice
    });
  }

  renderStaticRoute(route, tabs, documentRef, root);
  return () => {};
}

async function initializeApp(win: Window = window): Promise<void> {
  ensureThemeStyles(win.document);
  const runtime: AppRuntime = {
    store: createGameStore(),
    httpClient: createHttpClient({
      baseUrl: win.location.href
    }),
    sessionClient: createSessionClient(),
    bootstrapNotice: null
  };

  const bootstrapResult = await bootstrapAppSession({
    store: runtime.store,
    httpClient: runtime.httpClient,
    sessionClient: runtime.sessionClient
  });
  runtime.bootstrapNotice = bootstrapResult.notice;

  let cleanupRoute = () => {};
  const router = createHashRouter({
    win,
    onRouteChange: (route) => {
      cleanupRoute = renderRoute(route, win.document, runtime, win, cleanupRoute);
    }
  });
  router.start();
}

void initializeApp();
