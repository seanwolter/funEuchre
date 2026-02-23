const ROUTES = {
    lobby: {
        badge: "Phase 1 Shell",
        title: "Lobby Flow Baseline",
        subtitle: "Create and join private games fast with clear next steps before cards are dealt.",
        bullets: [
            "Create a private lobby and share invite link",
            "Auto-seat all four players into fixed partnerships",
            "Start game only when all seats are filled"
        ],
        panelTitle: "Current Focus",
        panelBody: "This shell models the lobby information layout only. Real-time updates and seat state wiring land in later phases."
    },
    game: {
        badge: "Gameplay Surface",
        title: "Authoritative State Projection",
        subtitle: "Client UI renders server decisions only and highlights whose turn it is with clear context.",
        bullets: [
            "Trick area, trump indicator, and dealer marker",
            "Scoreboard always visible for both teams",
            "Card actions disabled until legal checks pass"
        ],
        panelTitle: "Current Focus",
        panelBody: "This shell reserves space for gameplay components and routing without implementing card logic yet."
    },
    help: {
        badge: "Onboarding",
        title: "Euchre Quick Rules",
        subtitle: "Short reminders for trump, bowers, and scoring to keep first-time players moving.",
        bullets: [
            "Right bower (trump jack) is highest trump",
            "Left bower (same-color jack) counts as trump",
            "Game target score is 10 in MVP"
        ],
        panelTitle: "Current Focus",
        panelBody: "Rules here mirror project defaults and give players enough context without leaving the game screen."
    }
};
const DEFAULT_ROUTE = "lobby";
const ROUTE_HASHES = ["lobby", "game", "help"];
const styleTagId = "fun-euchre-shell-style";
const appRootId = "app";
function ensureStyles() {
    if (document.getElementById(styleTagId)) {
        return;
    }
    const style = document.createElement("style");
    style.id = styleTagId;
    style.textContent = `
    :root {
      --sand-100: #f7f2e8;
      --sand-200: #ede3d0;
      --ink-900: #18202c;
      --ink-700: #2f3f56;
      --pine-600: #0f7b58;
      --pine-700: #0a5e43;
      --ember-500: #de6535;
      --card: rgba(255, 255, 255, 0.92);
      --line: rgba(24, 32, 44, 0.15);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink-900);
      font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      background:
        radial-gradient(circle at 12% 10%, rgba(222, 101, 53, 0.16), transparent 38%),
        radial-gradient(circle at 88% 14%, rgba(15, 123, 88, 0.18), transparent 34%),
        linear-gradient(180deg, var(--sand-100) 0%, var(--sand-200) 100%);
    }

    .shell {
      margin: 0 auto;
      width: min(980px, 100%);
      padding: 20px;
      display: grid;
      gap: 18px;
    }

    .masthead {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--card);
      padding: 18px 20px;
      display: grid;
      gap: 8px;
    }

    .badge {
      width: fit-content;
      border-radius: 999px;
      background: var(--pine-600);
      color: #fff;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      padding: 5px 10px;
    }

    .masthead h1 {
      margin: 0;
      font-size: clamp(1.4rem, 2.5vw, 2rem);
      line-height: 1.15;
      font-family: "Baskerville", "Times New Roman", serif;
    }

    .masthead p {
      margin: 0;
      color: var(--ink-700);
      line-height: 1.4;
    }

    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tab {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink-700);
      border-radius: 999px;
      padding: 7px 14px;
      font-size: 0.85rem;
      text-decoration: none;
      font-weight: 600;
      transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
    }

    .tab:hover {
      border-color: var(--pine-600);
      color: var(--pine-700);
    }

    .tab.active {
      background: var(--pine-600);
      border-color: var(--pine-600);
      color: #fff;
    }

    .content-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 14px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--card);
      padding: 18px;
    }

    .panel h2,
    .panel h3 {
      margin: 0 0 10px;
      font-family: "Baskerville", "Times New Roman", serif;
    }

    .checklist {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }

    .checklist li {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 10px;
      align-items: start;
      color: var(--ink-700);
      line-height: 1.35;
    }

    .checklist li::before {
      content: "✓";
      color: var(--pine-600);
      font-weight: 700;
      margin-top: -1px;
    }

    .status-row {
      margin-top: 14px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 0.83rem;
      color: var(--ink-700);
    }

    .status-chip {
      background: rgba(222, 101, 53, 0.12);
      color: #8e3d1e;
      border: 1px solid rgba(222, 101, 53, 0.28);
      border-radius: 999px;
      padding: 6px 10px;
      font-weight: 600;
    }

    @media (max-width: 820px) {
      .content-grid {
        grid-template-columns: 1fr;
      }

      .shell {
        padding: 14px;
      }

      .masthead,
      .panel {
        border-radius: 14px;
      }
    }
  `;
    document.head.appendChild(style);
}
function resolveRoute(hash) {
    const cleaned = hash.replace(/^#\/?/, "").toLowerCase();
    if (ROUTE_HASHES.includes(cleaned)) {
        return cleaned;
    }
    return DEFAULT_ROUTE;
}
function routeTab(route, activeRoute) {
    const label = route.charAt(0).toUpperCase() + route.slice(1);
    const classes = route === activeRoute ? "tab active" : "tab";
    return `<a href="#/${route}" class="${classes}" data-route="${route}">${label}</a>`;
}
function render(route) {
    const root = document.getElementById(appRootId);
    if (!root) {
        throw new Error(`Expected #${appRootId} container to exist.`);
    }
    const view = ROUTES[route];
    const tabs = ROUTE_HASHES.map((nextRoute) => routeTab(nextRoute, route)).join("");
    const bulletItems = view.bullets.map((item) => `<li>${item}</li>`).join("");
    root.innerHTML = `
    <div class="shell">
      <header class="masthead">
        <span class="badge">${view.badge}</span>
        <h1>${view.title}</h1>
        <p>${view.subtitle}</p>
        <nav class="tabs" aria-label="Primary">${tabs}</nav>
      </header>

      <main class="content-grid">
        <section class="panel" aria-labelledby="focus-heading">
          <h2 id="focus-heading">MVP UI Checkpoints</h2>
          <ul class="checklist">${bulletItems}</ul>
          <div class="status-row">
            <span class="status-chip">Server-authoritative state</span>
            <span>Layout baseline ready for component wiring</span>
          </div>
        </section>

        <aside class="panel" aria-labelledby="panel-heading">
          <h3 id="panel-heading">${view.panelTitle}</h3>
          <p>${view.panelBody}</p>
        </aside>
      </main>
    </div>
  `;
}
function initializeShell() {
    ensureStyles();
    render(resolveRoute(window.location.hash));
    window.addEventListener("hashchange", () => {
        render(resolveRoute(window.location.hash));
    });
}
initializeShell();
export {};
