"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  gamesPlayed,
  incrementGamesPlayed,
  playerStatus,
  jumblePlan,
  jumblePlayers
} = require("../queue-view-utils.js");

test("player status prioritizes the most recently played match", () => {
  assert.equal(playerStatus("a", ["a", "b"], ["b"]), "Played – waiting for others");
  assert.equal(playerStatus("b", ["a", "b"], ["b"]), "Just played");
  assert.equal(playerStatus("c", ["a", "b"], ["b"]), "Waiting");
});

test("games played validates stored counts and increments only the started match players", () => {
  const players = [
    { id: "a", name: "A", gamesPlayed: 2 },
    { id: "b", name: "B", gamesPlayed: 0 },
    { id: "c", name: "C", gamesPlayed: 3 }
  ];

  assert.equal(gamesPlayed(-1), 0);
  assert.equal(gamesPlayed(1.5), 0);
  assert.deepEqual(incrementGamesPlayed(players, ["a", "b"]), [
    { id: "a", name: "A", gamesPlayed: 3 },
    { id: "b", name: "B", gamesPlayed: 1 },
    { id: "c", name: "C", gamesPlayed: 3 }
  ]);
  assert.equal(players[0].gamesPlayed, 2);
});

test("queue jumble includes only players tied for the lowest games count", () => {
  const players = [
    { id: "a", gamesPlayed: 0 },
    { id: "b", gamesPlayed: 0 },
    { id: "c", gamesPlayed: 1 },
    { id: "d", gamesPlayed: 2 }
  ];
  const plan = jumblePlan(players, 2);

  assert.deepEqual(plan.eligibleIds, ["a", "b"]);
  assert.deepEqual(plan.aheadIds, ["c", "d"]);
  assert.equal(plan.enoughEligible, true);
  assert.deepEqual(jumblePlayers(players, plan, () => 0), [
    players[1], players[0], players[2], players[3]
  ]);
});

test("queue jumble returns everyone when game counts are tied", () => {
  const players = [
    { id: "a", gamesPlayed: 2 },
    { id: "b", gamesPlayed: 2 },
    { id: "c", gamesPlayed: 2 },
    { id: "d", gamesPlayed: 2 }
  ];
  const plan = jumblePlan(players, 4);

  assert.deepEqual(plan.eligibleIds, ["a", "b", "c", "d"]);
  assert.deepEqual(plan.aheadIds, []);
  assert.equal(plan.enoughEligible, true);
});

test("queue jumble does not move anyone when too few lowest-count players can play", () => {
  const players = [
    { id: "a", gamesPlayed: 0 },
    { id: "b", gamesPlayed: 1 },
    { id: "c", gamesPlayed: 1 },
    { id: "d", gamesPlayed: 1 }
  ];
  const plan = jumblePlan(players, 2);

  assert.equal(plan.enoughEligible, false);
  assert.deepEqual(jumblePlayers(players, plan, () => 0), players);
});

test("same-partner jumble moves only complete lowest-count pairs and keeps pairs together", () => {
  const players = [
    { id: "a", gamesPlayed: 0 },
    { id: "b", gamesPlayed: 0 },
    { id: "c", gamesPlayed: 0 },
    { id: "d", gamesPlayed: 1 },
    { id: "e", gamesPlayed: 0 },
    { id: "f", gamesPlayed: 0 }
  ];
  const plan = jumblePlan(players, 4, [["a", "b"], ["c", "d"], ["e", "f"]]);
  const result = jumblePlayers(players, plan, () => 0);

  assert.deepEqual(plan.eligibleIds, ["a", "b", "e", "f"]);
  assert.deepEqual(plan.partnerBlockedIds, ["c"]);
  assert.deepEqual(result.map((player) => player.id), ["e", "f", "c", "d", "a", "b"]);
});

test("same-partner jumble reports insufficient eligible pairs without changing order", () => {
  const players = [
    { id: "a", gamesPlayed: 0 },
    { id: "b", gamesPlayed: 0 },
    { id: "c", gamesPlayed: 0 },
    { id: "d", gamesPlayed: 1 }
  ];
  const plan = jumblePlan(players, 4, [["a", "b"], ["c", "d"]]);

  assert.equal(plan.enoughEligible, false);
  assert.deepEqual(jumblePlayers(players, plan, () => 0), players);
});

test("same-partner jumble includes an unpaired player when all game counts are tied", () => {
  const players = [
    { id: "a", gamesPlayed: 1 },
    { id: "b", gamesPlayed: 1 },
    { id: "c", gamesPlayed: 1 },
    { id: "d", gamesPlayed: 1 },
    { id: "e", gamesPlayed: 1 }
  ];
  const plan = jumblePlan(players, 4, [["a", "b"], ["c", "d"]]);

  assert.deepEqual(plan.eligibleIds, ["a", "b", "c", "d", "e"]);
  assert.equal(plan.enoughEligible, true);
});
