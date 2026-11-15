(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QueueViewUtils = api;
  if (typeof window !== "undefined") window.QueueViewUtils = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function gamesPlayed(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function playerStatus(playerId, playedIds, recentlyPlayedIds) {
    if (recentlyPlayedIds.includes(playerId)) return "Just played";
    if (playedIds.includes(playerId)) return "Played – waiting for others";
    return "Waiting";
  }

  function incrementGamesPlayed(players, playerIds) {
    const playing = new Set(playerIds);
    return players.map((player) => playing.has(player.id)
      ? { ...player, gamesPlayed: gamesPlayed(player.gamesPlayed) + 1 }
      : player);
  }

  function jumblePlan(players, requiredPlayers, partnerPairs) {
    const playerById = new Map(players.map((player) => [player.id, player]));
    const minGames = players.length
      ? Math.min(...players.map((player) => gamesPlayed(player.gamesPlayed)))
      : 0;
    const groups = Array.isArray(partnerPairs)
      ? partnerPairs.map((pair) => pair.filter((id) => playerById.has(id)))
      : players.map((player) => [player.id]);
    const eligibleGroups = [];
    const partnerBlockedIds = new Set();
    const groupedIds = new Set();

    groups.forEach((group) => {
      group.forEach((id) => groupedIds.add(id));
      const validGroup = group.length === (Array.isArray(partnerPairs) ? 2 : 1);
      if (validGroup && group.every((id) => gamesPlayed(playerById.get(id).gamesPlayed) === minGames)) {
        eligibleGroups.push(group);
      } else if (Array.isArray(partnerPairs)
        && group.some((id) => gamesPlayed(playerById.get(id).gamesPlayed) === minGames)
        && group.some((id) => gamesPlayed(playerById.get(id).gamesPlayed) > minGames)) {
        group.filter((id) => gamesPlayed(playerById.get(id).gamesPlayed) === minGames)
          .forEach((id) => partnerBlockedIds.add(id));
      }
    });

    if (Array.isArray(partnerPairs)) {
      players.forEach((player) => {
        if (groupedIds.has(player.id)) return;
        groupedIds.add(player.id);
        if (gamesPlayed(player.gamesPlayed) === minGames) eligibleGroups.push([player.id]);
      });
    }

    const eligibleIds = new Set(eligibleGroups.flat());
    const aheadIds = players
      .filter((player) => gamesPlayed(player.gamesPlayed) > minGames)
      .map((player) => player.id);
    const eligiblePlayerIds = players
      .filter((player) => eligibleIds.has(player.id))
      .map((player) => player.id);

    return {
      minGames,
      eligibleGroups,
      eligibleIds: eligiblePlayerIds,
      aheadIds,
      partnerBlockedIds: Array.from(partnerBlockedIds),
      enoughEligible: eligiblePlayerIds.length >= requiredPlayers
    };
  }

  function jumblePlayers(players, plan, random = Math.random) {
    if (!plan.enoughEligible) return players.slice();

    const byId = new Map(players.map((player) => [player.id, player]));
    const positions = players
      .map((player, index) => plan.eligibleIds.includes(player.id) ? index : -1)
      .filter((index) => index >= 0);
    const groups = plan.eligibleGroups.map((group) => group.map((id) => byId.get(id)));
    for (let index = groups.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [groups[index], groups[other]] = [groups[other], groups[index]];
    }

    const shuffledPlayers = groups.flat();
    const result = players.slice();
    positions.forEach((position, index) => {
      result[position] = shuffledPlayers[index];
    });
    return result;
  }

  return {
    gamesPlayed,
    playerStatus,
    incrementGamesPlayed,
    jumblePlan,
    jumblePlayers
  };
}));
