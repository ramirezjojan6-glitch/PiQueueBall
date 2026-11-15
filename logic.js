(function (root, factory) {
  "use strict";

  const logic = factory();
  if (typeof module === "object" && module.exports) module.exports = logic;
  if (root) root.PickleballLogic = logic;
  if (typeof window !== "undefined") window.PickleballLogic = logic;
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function createGameState(mode, teams, firstServerId) {
    if (!Array.isArray(teams) || teams.length !== 2
      || !teams.every(Array.isArray) || (mode !== "singles" && mode !== "doubles")) {
      throw new TypeError("A pickleball game requires two valid teams and a supported mode.");
    }
    const teamIndex = teams.findIndex((team) => team.includes(firstServerId));
    if (teamIndex === -1) throw new RangeError("The first server must be in the match.");
    if (teams.some((team) => team.length !== (mode === "doubles" ? 2 : 1))) {
      throw new RangeError("The team sizes do not match the game mode.");
    }

    return {
      mode,
      teams: teams.map((team) => team.slice()),
      scores: [0, 0],
      servingTeam: teamIndex,
      serverId: firstServerId,
      serverNumber: mode === "doubles" ? 2 : null,
      openingServe: mode === "doubles",
      firstServerId,
      rightPlayerIds: mode === "doubles"
        ? teams.map((team, index) => index === teamIndex ? firstServerId : team[0])
        : []
    };
  }

  function flipFirstServer(playerIds, randomValue) {
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      throw new RangeError("At least one player is required for a serve coin flip.");
    }
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError("The coin-flip value must be between zero and one.");
    }
    return playerIds[Math.floor(randomValue * playerIds.length)];
  }

  function sideForPlayer(state, teamIndex, playerId) {
    const team = state.teams[teamIndex];
    if (state.mode === "singles") return state.scores[teamIndex] % 2 === 0 ? "right" : "left";
    const startsOnRight = state.rightPlayerIds[teamIndex];
    const rightPlayer = state.scores[teamIndex] % 2 === 0
      ? startsOnRight
      : team.find((id) => id !== startsOnRight);
    return playerId === rightPlayer ? "right" : "left";
  }

  function courtPositions(state) {
    const singlesServeSide = state.scores[state.servingTeam] % 2 === 0 ? "right" : "left";
    return state.teams.map((team, teamIndex) => {
      if (state.mode === "singles") {
        return {
          teamIndex,
          right: singlesServeSide === "right" ? team[0] : null,
          left: singlesServeSide === "left" ? team[0] : null
        };
      }
      const rightPlayer = state.scores[teamIndex] % 2 === 0
        ? state.rightPlayerIds[teamIndex]
        : team.find((id) => id !== state.rightPlayerIds[teamIndex]);
      return {
        teamIndex,
        right: rightPlayer,
        left: team.find((id) => id !== rightPlayer)
      };
    });
  }

  function scoreCall(state) {
    const receiverTeam = 1 - state.servingTeam;
    const scores = [
      state.scores[state.servingTeam],
      state.scores[receiverTeam]
    ];
    return state.mode === "doubles"
      ? scores[0] + "-" + scores[1] + "-" + state.serverNumber
      : scores[0] + "-" + scores[1];
  }

  function servingInfo(state) {
    return {
      teamIndex: state.servingTeam,
      serverId: state.serverId,
      serverNumber: state.serverNumber,
      side: sideForPlayer(state, state.servingTeam, state.serverId),
      scoreCall: scoreCall(state)
    };
  }

  function sideOut(state) {
    const servingTeam = 1 - state.servingTeam;
    const serverId = state.mode === "singles"
      ? state.teams[servingTeam][0]
      : state.scores[servingTeam] % 2 === 0
        ? state.rightPlayerIds[servingTeam]
        : state.teams[servingTeam].find((id) => id !== state.rightPlayerIds[servingTeam]);
    return {
      ...state,
      servingTeam,
      serverId,
      serverNumber: state.mode === "doubles" ? 1 : null,
      openingServe: false
    };
  }

  function rallyWon(state) {
    const scores = state.scores.slice();
    scores[state.servingTeam] += 1;
    return { ...state, scores, openingServe: false };
  }

  function rallyLost(state) {
    if (state.mode === "singles" || state.openingServe || state.serverNumber === 2) {
      return sideOut(state);
    }
    const partner = state.teams[state.servingTeam].find((id) => id !== state.serverId);
    return {
      ...state,
      serverId: partner,
      serverNumber: 2
    };
  }

  return {
    createGameState,
    flipFirstServer,
    courtPositions,
    servingInfo,
    scoreCall,
    rallyWon,
    rallyLost
  };
}));


