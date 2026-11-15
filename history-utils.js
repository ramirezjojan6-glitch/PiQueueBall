(function () {
  "use strict";

  function queueFromRecord(record) {
    const queueRows = (record.match_queue_players || []).slice()
      .sort((first, second) => first.queue_index - second.queue_index);
    const players = queueRows.map((player) => ({
      id: player.player_id || "guest:" + record.id + ":" + player.queue_index,
      userId: player.player_id,
      name: player.player_name
    }));
    const teams = [0, 1].map((index) => queueRows
      .filter((player) => player.team_index === index)
      .map((player) => ({
        id: player.player_id || "guest:" + record.id + ":" + player.queue_index,
        userId: player.player_id,
        name: player.player_name
      })));

    return {
      id: record.client_match_id,
      startedAt: record.queue_started_at,
      completedAt: record.played_at,
      resultId: record.id,
      mode: record.mode,
      players,
      teams
    };
  }

  function matchIncludesPlayer(match, playerId, playerName) {
    const normalizedName = typeof playerName === "string" ? playerName.trim().toLocaleLowerCase() : "";
    return match.teams.some((team) => team.some((player) => {
      if (player.id === playerId || player.userId === playerId) return true;
      return !player.userId && normalizedName
        && player.name.trim().toLocaleLowerCase() === normalizedName;
    }));
  }

  function removeHistoryMatches(state, shouldRemove, additionalQueueIds = []) {
    const removedQueueIds = new Set(additionalQueueIds);
    const removedResultIds = new Set();
    const keptResults = [];

    state.results.forEach((result) => {
      if (removedQueueIds.has(result.queueId) || shouldRemove(result)) {
        if (result.queueId) removedQueueIds.add(result.queueId);
        if (result.id) removedResultIds.add(result.id);
      } else {
        keptResults.push(result);
      }
    });

    const keptQueues = state.queueHistory.filter((queue) =>
      !removedQueueIds.has(queue.id)
      && !removedQueueIds.has(queue.resultId)
      && !removedResultIds.has(queue.resultId)
    );
    const removedCount = state.results.length - keptResults.length;
    state.results = keptResults;
    state.queueHistory = keptQueues;
    return { removedQueueIds: Array.from(removedQueueIds), removedCount };
  }

  const api = { queueFromRecord, matchIncludesPlayer, removeHistoryMatches };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.piqueueballHistory = api;
}());
