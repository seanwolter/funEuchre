import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const sourceEntry = join(process.cwd(), "src", "main.tsx");
const routerEntry = join(process.cwd(), "src", "app", "router.ts");
const lobbyPageEntry = join(process.cwd(), "src", "pages", "LobbyPage.tsx");
const gamePageEntry = join(process.cwd(), "src", "pages", "GamePage.tsx");
const helpPageEntry = join(process.cwd(), "src", "pages", "HelpPage.tsx");
const seatGridEntry = join(process.cwd(), "src", "components", "SeatGrid.tsx");
const startControlsEntry = join(
  process.cwd(),
  "src",
  "components",
  "StartControls.tsx"
);
const biddingPanelEntry = join(
  process.cwd(),
  "src",
  "components",
  "BiddingPanel.tsx"
);
const cardHandEntry = join(process.cwd(), "src", "components", "CardHand.tsx");
const trickTableEntry = join(process.cwd(), "src", "components", "TrickTable.tsx");
const scoreboardEntry = join(process.cwd(), "src", "components", "Scoreboard.tsx");
const themeEntry = join(process.cwd(), "src", "styles", "theme.css");
const htmlEntry = join(process.cwd(), "index.html");
const builtEntry = join(process.cwd(), "dist", "main.js");

test("web source defines modular route shell", async () => {
  const source = await readFile(sourceEntry, "utf8");
  assert.match(source, /createHashRouter/);
  assert.match(source, /initializeApp\(\)/);
  assert.match(source, /ROUTE_VIEWS/);
});

test("web router and page modules are present", async () => {
  const routerSource = await readFile(routerEntry, "utf8");
  assert.match(routerSource, /export const ROUTE_KEYS = \["lobby", "game", "help"\]/);
  assert.match(routerSource, /createHashRouter/);

  const lobbySource = await readFile(lobbyPageEntry, "utf8");
  const gameSource = await readFile(gamePageEntry, "utf8");
  const helpSource = await readFile(helpPageEntry, "utf8");
  const seatGridSource = await readFile(seatGridEntry, "utf8");
  const startControlsSource = await readFile(startControlsEntry, "utf8");
  const biddingPanelSource = await readFile(biddingPanelEntry, "utf8");
  const cardHandSource = await readFile(cardHandEntry, "utf8");
  const trickTableSource = await readFile(trickTableEntry, "utf8");
  const scoreboardSource = await readFile(scoreboardEntry, "utf8");
  assert.match(lobbySource, /export const lobbyPage/);
  assert.match(lobbySource, /mountLobbyPage/);
  assert.match(gameSource, /export const gamePage/);
  assert.match(gameSource, /mountGamePage/);
  assert.match(helpSource, /export const helpPage/);
  assert.match(seatGridSource, /renderSeatGrid/);
  assert.match(startControlsSource, /deriveStartReadiness/);
  assert.match(biddingPanelSource, /renderBiddingPanel/);
  assert.match(cardHandSource, /renderCardHand/);
  assert.match(trickTableSource, /renderTrickTable/);
  assert.match(scoreboardSource, /renderScoreboard/);

  const themeSource = await readFile(themeEntry, "utf8");
  assert.match(themeSource, /:root/);
  assert.match(themeSource, /\.shell/);
  assert.match(themeSource, /\.seat-grid/);
  assert.match(themeSource, /\.card-hand-grid/);
});

test("web index wires app root and bundle", async () => {
  const html = await readFile(htmlEntry, "utf8");
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /dist\/main\.js/);
});

test("web build artifact is generated", async () => {
  await access(builtEntry, constants.R_OK);
  const builtSource = await readFile(builtEntry, "utf8");
  assert.ok(builtSource.length > 0);
});
