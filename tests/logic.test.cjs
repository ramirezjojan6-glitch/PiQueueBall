"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const logic = require("../logic.js");

const singlesTeams = [["alice"], ["bob"]];
const doublesTeams = [["alice", "alex"], ["bob", "blair"]];

test("singles serve alternates and only the serving player scores", () => {
  let game = logic.createGameState("singles", singlesTeams, "alice");
  assert.equal(logic.servingInfo(game).side, "right");
  assert.equal(logic.scoreCall(game), "0-0");

  game = logic.rallyWon(game);
  assert.deepEqual(game.scores, [1, 0]);
  assert.equal(logic.servingInfo(game).side, "left");
  assert.equal(logic.scoreCall(game), "1-0");

  game = logic.rallyLost(game);
  assert.equal(game.servingTeam, 1);
  assert.equal(game.serverId, "bob");
  assert.equal(logic.servingInfo(game).side, "right");
  assert.deepEqual(game.scores, [1, 0]);
});

test("the opening doubles server has one turn and starts as server two", () => {
  let game = logic.createGameState("doubles", doublesTeams, "alice");
  assert.equal(logic.servingInfo(game).serverNumber, 2);
  assert.equal(logic.scoreCall(game), "0-0-2");

  game = logic.rallyWon(game);
  assert.deepEqual(game.scores, [1, 0]);
  assert.equal(game.serverId, "alice");
  assert.equal(logic.servingInfo(game).side, "left");

  game = logic.rallyLost(game);
  assert.equal(game.servingTeam, 1);
  assert.equal(game.serverId, "bob");
  assert.equal(logic.servingInfo(game).serverNumber, 1);
  assert.equal(logic.scoreCall(game), "0-1-1");
});

test("doubles passes from server one to server two before side-out", () => {
  let game = logic.createGameState("doubles", doublesTeams, "alice");
  game = logic.rallyLost(game);
  assert.equal(game.servingTeam, 1);
  assert.equal(game.serverId, "bob");
  assert.equal(logic.servingInfo(game).serverNumber, 1);

  game = logic.rallyLost(game);
  assert.equal(game.serverId, "blair");
  assert.equal(logic.servingInfo(game).serverNumber, 2);

  game = logic.rallyLost(game);
  assert.equal(game.servingTeam, 0);
  assert.equal(game.serverId, "alice");
  assert.equal(logic.servingInfo(game).serverNumber, 1);
});

test("court positions follow team score parity", () => {
  let game = logic.createGameState("doubles", doublesTeams, "alice");
  assert.deepEqual(logic.courtPositions(game), [
    { teamIndex: 0, right: "alice", left: "alex" },
    { teamIndex: 1, right: "bob", left: "blair" }
  ]);
  game = logic.rallyWon(game);
  assert.deepEqual(logic.courtPositions(game)[0], {
    teamIndex: 0, right: "alex", left: "alice"
  });
});

test("coin flip uses the supplied random value without side effects", () => {
  const players = ["alice", "alex", "bob", "blair"];
  assert.equal(logic.flipFirstServer(players, 0), "alice");
  assert.equal(logic.flipFirstServer(players, 0.51), "bob");
  assert.deepEqual(players, ["alice", "alex", "bob", "blair"]);
});

test("game initialization rejects invalid teams and first servers", () => {
  assert.throws(() => logic.createGameState("singles", [["alice"], []], "alice"), RangeError);
  assert.throws(() => logic.createGameState("doubles", doublesTeams, "nobody"), RangeError);
  assert.throws(() => logic.createGameState("other", singlesTeams, "alice"), TypeError);
});
