import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHandScore,
  createTeamScore,
  isGameOver,
  scoreHand,
  winningTeam
} from "../src/index.js";

test("makers earn one point for 3 or 4 tricks (alone or partnered)", () => {
  const threeTricks = scoreHand({
    makers: "teamA",
    makerTricks: 3,
    alone: false
  });
  assert.equal(threeTricks.makerPoints, 1);
  assert.equal(threeTricks.defenderPoints, 0);
  assert.equal(threeTricks.outcome, "MAKERS_ONE_POINT");
  assert.deepEqual(threeTricks.points, { teamA: 1, teamB: 0 });

  const fourTricksAlone = scoreHand({
    makers: "teamB",
    makerTricks: 4,
    alone: true
  });
  assert.equal(fourTricksAlone.makerPoints, 1);
  assert.equal(fourTricksAlone.defenderPoints, 0);
  assert.equal(fourTricksAlone.outcome, "MAKERS_ONE_POINT");
  assert.deepEqual(fourTricksAlone.points, { teamA: 0, teamB: 1 });
});

test("makers earn two points for a partnered march", () => {
  const march = scoreHand({
    makers: "teamB",
    makerTricks: 5,
    alone: false
  });

  assert.equal(march.makerPoints, 2);
  assert.equal(march.defenderPoints, 0);
  assert.equal(march.outcome, "MAKERS_TWO_POINTS");
  assert.deepEqual(march.points, { teamA: 0, teamB: 2 });
});

test("lone march earns four points", () => {
  const loneMarch = scoreHand({
    makers: "teamA",
    makerTricks: 5,
    alone: true
  });

  assert.equal(loneMarch.makerPoints, 4);
  assert.equal(loneMarch.defenderPoints, 0);
  assert.equal(loneMarch.outcome, "MAKERS_FOUR_POINTS");
  assert.deepEqual(loneMarch.points, { teamA: 4, teamB: 0 });
});

test("defenders score two when makers are euchred (0-2 tricks)", () => {
  for (const makerTricks of [0, 1, 2]) {
    const hand = scoreHand({
      makers: "teamA",
      makerTricks,
      alone: false
    });
    assert.equal(hand.makerPoints, 0);
    assert.equal(hand.defenderPoints, 2);
    assert.equal(hand.outcome, "DEFENDERS_TWO_POINTS");
    assert.deepEqual(hand.points, { teamA: 0, teamB: 2 });
    assert.equal(hand.defenderTricks, 5 - makerTricks);
  }
});

test("applyHandScore accumulates running team totals", () => {
  let running = createTeamScore(0, 0);
  const handOne = scoreHand({
    makers: "teamA",
    makerTricks: 3,
    alone: false
  });
  const handTwo = scoreHand({
    makers: "teamB",
    makerTricks: 2,
    alone: false
  });
  const handThree = scoreHand({
    makers: "teamA",
    makerTricks: 5,
    alone: true
  });

  // Hand two euchres the makers (teamB), so defenders (teamA) earn 2 points.
  assert.deepEqual(handTwo.points, { teamA: 2, teamB: 0 });

  running = applyHandScore(running, handOne);
  running = applyHandScore(running, handTwo);
  running = applyHandScore(running, handThree);

  assert.deepEqual(running, { teamA: 7, teamB: 0 });
});

test("game-over and winner detection works at target score", () => {
  const inProgress = createTeamScore(9, 9);
  assert.equal(isGameOver(inProgress), false);
  assert.equal(winningTeam(inProgress), null);

  const teamAWins = createTeamScore(10, 8);
  assert.equal(isGameOver(teamAWins), true);
  assert.equal(winningTeam(teamAWins), "teamA");

  const teamBWins = createTeamScore(7, 10);
  assert.equal(isGameOver(teamBWins), true);
  assert.equal(winningTeam(teamBWins), "teamB");
});

test("invalid trick counts and score targets are rejected", () => {
  assert.throws(
    () =>
      scoreHand({
        makers: "teamA",
        makerTricks: -1,
        alone: false
      }),
    /makerTricks must be an integer between 0 and 5/
  );

  assert.throws(
    () =>
      scoreHand({
        makers: "teamB",
        makerTricks: 6,
        alone: true
      }),
    /makerTricks must be an integer between 0 and 5/
  );

  assert.throws(() => isGameOver(createTeamScore(0, 0), 0), /target must be a positive integer/);
});
