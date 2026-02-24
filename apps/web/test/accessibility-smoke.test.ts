import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const themeEntry = join(process.cwd(), "src", "styles", "theme.css");
const lobbyPageEntry = join(process.cwd(), "src", "pages", "LobbyPage.tsx");
const startControlsEntry = join(
  process.cwd(),
  "src",
  "components",
  "StartControls.tsx"
);
const seatGridEntry = join(process.cwd(), "src", "components", "SeatGrid.tsx");
const biddingPanelEntry = join(
  process.cwd(),
  "src",
  "components",
  "BiddingPanel.tsx"
);
const cardHandEntry = join(process.cwd(), "src", "components", "CardHand.tsx");
const trickTableEntry = join(process.cwd(), "src", "components", "TrickTable.tsx");

test("theme defines visible focus styles and touch-friendly controls", async () => {
  const css = await readFile(themeEntry, "utf8");

  assert.match(css, /--focus-ring:/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.action-button\s*\{[\s\S]*min-height:\s*44px;/);
  assert.match(css, /\.card-button\s*\{[\s\S]*min-height:\s*44px;/);
});

test("theme includes responsive hardening for tablet and narrow mobile widths", async () => {
  const css = await readFile(themeEntry, "utf8");

  assert.match(css, /@media \(max-width: 880px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
});

test("lobby and gameplay modules expose semantic labels and live regions", async () => {
  const lobbyPageSource = await readFile(lobbyPageEntry, "utf8");
  const startControlsSource = await readFile(startControlsEntry, "utf8");
  const seatGridSource = await readFile(seatGridEntry, "utf8");
  const biddingSource = await readFile(biddingPanelEntry, "utf8");
  const cardHandSource = await readFile(cardHandEntry, "utf8");
  const trickSource = await readFile(trickTableEntry, "utf8");

  assert.match(lobbyPageSource, /role="status" aria-live="polite"/);
  assert.match(startControlsSource, /aria-describedby="start-hint-text"/);
  assert.match(seatGridSource, /aria-label="Lobby seat assignments"/);
  assert.match(biddingSource, /role="group" aria-label="Bidding actions"/);
  assert.match(cardHandSource, /aria-label="Your hand cards"/);
  assert.match(trickSource, /<caption class="visually-hidden">/);
});

test("primary interactions use keyboard-friendly native controls", async () => {
  const lobbyPageSource = await readFile(lobbyPageEntry, "utf8");
  const biddingSource = await readFile(biddingPanelEntry, "utf8");
  const cardHandSource = await readFile(cardHandEntry, "utf8");
  const startControlsSource = await readFile(startControlsEntry, "utf8");

  assert.match(lobbyPageSource, /<form id="lobby-create-form"/);
  assert.match(lobbyPageSource, /<form id="lobby-join-form"/);
  assert.match(lobbyPageSource, /<button id="lobby-create-submit" class="action-button" type="submit">/);
  assert.match(startControlsSource, /id="lobby-start-button"/);
  assert.match(biddingSource, /<button[\s\S]*data-action="pass"/);
  assert.match(biddingSource, /<button[\s\S]*data-action="order-up"/);
  assert.match(cardHandSource, /<button[\s\S]*data-action="play-card"/);
});
