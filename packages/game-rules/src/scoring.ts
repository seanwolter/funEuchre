import type { Team } from "./types.js";

export type TeamScore = {
  teamA: number;
  teamB: number;
};

export type HandOutcome =
  | "MAKERS_ONE_POINT"
  | "MAKERS_TWO_POINTS"
  | "MAKERS_FOUR_POINTS"
  | "DEFENDERS_TWO_POINTS";

export type HandScoringInput = {
  makers: Team;
  makerTricks: number;
  alone: boolean;
};

export type HandScoringResult = {
  makers: Team;
  defenders: Team;
  makerTricks: number;
  defenderTricks: number;
  alone: boolean;
  makerPoints: number;
  defenderPoints: number;
  outcome: HandOutcome;
  points: TeamScore;
};

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
}

function assertTrickCount(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error(`${field} must be an integer between 0 and 5.`);
  }
}

function opposingTeam(team: Team): Team {
  return team === "teamA" ? "teamB" : "teamA";
}

export function createTeamScore(teamA = 0, teamB = 0): TeamScore {
  assertNonNegativeInteger(teamA, "teamA");
  assertNonNegativeInteger(teamB, "teamB");
  return { teamA, teamB };
}

export function scoreHand(input: HandScoringInput): HandScoringResult {
  assertTrickCount(input.makerTricks, "makerTricks");

  const makers = input.makers;
  const defenders = opposingTeam(makers);
  const defenderTricks = 5 - input.makerTricks;

  let makerPoints = 0;
  let defenderPoints = 0;
  let outcome: HandOutcome = "MAKERS_ONE_POINT";

  if (input.makerTricks >= 3) {
    if (input.makerTricks === 5) {
      makerPoints = input.alone ? 4 : 2;
      outcome = input.alone ? "MAKERS_FOUR_POINTS" : "MAKERS_TWO_POINTS";
    } else {
      makerPoints = 1;
      outcome = "MAKERS_ONE_POINT";
    }
  } else {
    defenderPoints = 2;
    outcome = "DEFENDERS_TWO_POINTS";
  }

  const points = createTeamScore();
  points[makers] = makerPoints;
  points[defenders] = defenderPoints;

  return {
    makers,
    defenders,
    makerTricks: input.makerTricks,
    defenderTricks,
    alone: input.alone,
    makerPoints,
    defenderPoints,
    outcome,
    points
  };
}

export function applyHandScore(current: TeamScore, hand: HandScoringResult): TeamScore {
  return createTeamScore(
    current.teamA + hand.points.teamA,
    current.teamB + hand.points.teamB
  );
}

export function isGameOver(score: TeamScore, target = 10): boolean {
  if (!Number.isInteger(target) || target < 1) {
    throw new Error("target must be a positive integer.");
  }

  return score.teamA >= target || score.teamB >= target;
}

export function winningTeam(score: TeamScore, target = 10): Team | null {
  if (!isGameOver(score, target)) {
    return null;
  }

  if (score.teamA === score.teamB) {
    return null;
  }

  return score.teamA > score.teamB ? "teamA" : "teamB";
}
