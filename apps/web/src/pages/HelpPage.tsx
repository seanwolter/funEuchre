import type { RouteView } from "./RouteView.js";

export const helpPage: RouteView = {
  badge: "Help Route",
  title: "Quick Euchre Reminders Without Leaving Play",
  subtitle:
    "Reference core trump and scoring rules in a compact, friendly panel designed for short in-game checks.",
  bullets: [
    "Right bower (trump jack) ranks highest in the hand",
    "Left bower counts as trump even though suit symbol differs",
    "First team to target score wins; MVP target remains 10"
  ],
  panelTitle: "Current Focus",
  panelBody:
    "Help content stays lightweight by design so new players can recover context quickly and return to active turns.",
  statusLabel: "Onboarding baseline",
  statusText: "Rule hints are route-level now and will be reusable as in-game tooltips later."
};
