(function () {
  "use strict";

  const STORAGE_KEY = "piqueueball.queue.v1";
  const noCurrentMatch = document.getElementById("no-current-match");
  const scoreMatch = document.getElementById("score-match");
  const scoreTeams = document.getElementById("score-teams");
  const scoreFormat = document.getElementById("score-format");
  const scoreMessage = document.getElementById("score-message");
  const completeButton = document.getElementById("complete-match");
  const status = document.getElementById("score-status");
  const pickleballTracker = document.getElementById("pickleball-tracker");
  const servingPlayer = document.getElementById("serving-player");
  const servingSide = document.getElementById("serving-side");
  const scoreCallElement = document.getElementById("score-call");
  const scoreCallServerHelp = document.getElementById("score-call-server-help");
  const courtTeamLabels = [
    document.getElementById("court-team-0"),
    document.getElementById("court-team-1")
  ];
  const servingTeamWonButton = document.getElementById("serving-team-won");
  const servingTeamLostButton = document.getElementById("serving-team-lost");

  function validScore(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function newUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      return (character === "x" ? random : (random & 3) | 8).toString(16);
    });
  }

  function readState() {
    let value;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      value = JSON.parse(saved);
    } catch (error) {
      status.textContent = "Unable to read saved match data. Return to the queue and try again.";
      return null;
    }
    if (!value || !Array.isArray(value.players)) {
      status.textContent = "Saved match data is invalid. Return to the queue and try again.";
      return null;
    }
    if (!value.currentMatch) return null;
    if (!Array.isArray(value.currentMatch.teams) || value.currentMatch.teams.length !== 2
      || !value.currentMatch.teams.every(Array.isArray)) {
      status.textContent = "Saved match data is invalid. Return to the queue and try again.";
      return null;
    }
    const currentMatch = value.currentMatch;
    currentMatch.mode = currentMatch.mode === "doubles" ? "doubles" : "singles";
    currentMatch.scores = Array.isArray(currentMatch.scores) && currentMatch.scores.length === 2
      ? currentMatch.scores.map((score) => validScore(score) ? score : null)
      : [0, 0];
    value.played = Array.isArray(value.played) ? value.played : [];
    value.results = Array.isArray(value.results) ? value.results : [];
    value.queueHistory = Array.isArray(value.queueHistory) ? value.queueHistory : [];
    return value;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      status.textContent = "Unable to save this match in the browser. Check its storage settings.";
      return false;
    }
  }

  let state = readState();

  function validPickleballState(game, match) {
    return game && game.mode === match.mode
      && Array.isArray(game.teams) && game.teams.length === 2
      && game.teams.every((team, index) => Array.isArray(team)
        && team.length === match.teams[index].length
        && team.every((id, playerIndex) => id === match.teams[index][playerIndex]))
      && Array.isArray(game.scores) && game.scores.length === 2 && game.scores.every(validScore)
      && Number.isInteger(game.servingTeam) && game.servingTeam >= 0 && game.servingTeam <= 1
      && game.teams[game.servingTeam].includes(game.serverId)
      && Array.isArray(game.rightPlayerIds)
      && (game.mode === "singles"
        ? game.rightPlayerIds.length === 0
        : game.rightPlayerIds.length === 2
          && game.rightPlayerIds.every((id, index) => game.teams[index].includes(id)))
      && (game.mode === "singles" || (game.serverNumber === 1 || game.serverNumber === 2))
      && (game.mode === "singles" || typeof game.openingServe === "boolean");
  }

  if (state && state.currentMatch) {
    const match = state.currentMatch;
    if (!validPickleballState(match.pickleball, match)) {
      try {
        match.pickleball = window.PickleballLogic.createGameState(match.mode, match.teams, match.teams[0][0]);
        match.pickleball.scores = match.scores.map((score) => validScore(score) ? score : 0);
        match.scores = match.pickleball.scores.slice();
        saveState();
      } catch (error) {
        status.textContent = error.message || "Unable to initialize the pickleball score tracker.";
        state = null;
      }
    } else {
      match.scores = match.pickleball.scores.slice();
    }
  }

  function playerFor(id) {
    return state.players.find((player) => player.id === id);
  }

  function teamSnapshots() {
    const savedNames = state.currentMatch.names;
    return state.currentMatch.teams.map((team, teamIndex) => team.map((id) => {
      const savedPlayer = savedNames && savedNames[teamIndex]
        ? savedNames[teamIndex].find((player) => player.id === id)
        : null;
      const player = playerFor(id);
      return {
        id,
        userId: player && player.onlineId ? player.onlineId : savedPlayer && savedPlayer.userId || null,
        avatarDataUrl: player && player.avatarDataUrl || "",
        name: savedPlayer ? savedPlayer.name : player ? player.name : "Unknown player"
      };
    }));
  }

  function ensureQueueSnapshot() {
    if (state.currentMatch.queueId) return;
    const queueId = newUuid();
    state.currentMatch.queueId = queueId;
    state.queueHistory.push({
      id: queueId,
      startedAt: new Date().toISOString(),
      mode: state.currentMatch.mode === "doubles" ? "doubles" : "singles",
      players: state.players.map((player) => ({
        id: player.id, userId: player.onlineId || null, name: player.name
      })),
      teams: teamSnapshots().map((team) => team.map((player) => ({
        id: player.id, userId: player.userId, name: player.name, avatarDataUrl: player.avatarDataUrl
      })))
    });
    saveState();
  }

  function renderScores() {
    if (!state) return;
    ensureQueueSnapshot();
    noCurrentMatch.hidden = true;
    scoreMatch.hidden = false;
    const isDoubles = state.currentMatch.mode === "doubles";
    scoreFormat.textContent = isDoubles ? "Doubles" : "Singles";
    scoreTeams.replaceChildren();

    state.currentMatch.teams.forEach((team, index) => {
      const card = document.createElement("div");
      card.className = "team-card";
      const label = document.createElement("span");
      label.className = "team-label";
      label.textContent = (isDoubles ? "TEAM " : "PLAYER ") + (index + 1);
      const names = document.createElement("div");
      names.className = "team-names";
      teamSnapshots()[index].forEach((player) => {
        const name = document.createElement("span");
        name.className = "team-player";
        if (player.avatarDataUrl) {
          const avatar = document.createElement("img");
          avatar.src = player.avatarDataUrl;
          avatar.alt = "";
          name.append(avatar);
        }
        const label = document.createElement("span");
        label.textContent = player.name;
        name.append(label);
        names.append(name);
      });
      const control = document.createElement("div");
      control.className = "team-score";
      const scoreLabel = document.createElement("span");
      scoreLabel.className = "score-label";
      scoreLabel.textContent = "SCORE";
      const score = document.createElement("output");
      score.className = "score-value";
      score.id = "team-score-" + index;
      score.setAttribute("aria-label", (isDoubles ? "Team " : "Player ") + (index + 1) + " score");
      score.textContent = String(state.currentMatch.pickleball.scores[index]);
      control.append(scoreLabel, score);
      card.append(label, names, control);
      scoreTeams.append(card);
    });
    renderPickleballTracker();
    updateScoreMessage();
  }

  function displayName(playerId, teamIndex) {
    const snapshot = state.currentMatch.names && state.currentMatch.names[teamIndex]
      ? state.currentMatch.names[teamIndex].find((player) => player.id === playerId)
      : null;
    const player = playerFor(playerId);
    return snapshot ? snapshot.name : player ? player.name : "Unknown player";
  }

  function renderPickleballTracker() {
    const game = state.currentMatch.pickleball;
    const mode = game.mode;
    const miniCourt = document.querySelector(".mini-court");
    miniCourt.dataset.mode = mode;
    const info = window.PickleballLogic.servingInfo(game);
    const serverName = displayName(info.serverId, info.teamIndex);
    const servingTeamName = mode === "doubles" ? "Team " + (info.teamIndex + 1) : serverName;
    servingPlayer.textContent = serverName + (mode === "doubles" ? " · " + servingTeamName
      + " · Server " + info.serverNumber : "");
    servingSide.textContent = "Serve from " + info.side;
    scoreCallElement.textContent = info.scoreCall;
    scoreCallServerHelp.hidden = mode !== "doubles";
    courtTeamLabels.forEach((label, index) => {
      label.textContent = mode === "doubles"
        ? "TEAM " + (index + 1)
        : displayName(game.teams[index][0], index);
    });

    const positions = window.PickleballLogic.courtPositions(game);
    document.querySelectorAll(".court-half").forEach((half) => {
      const teamIndex = Number(half.dataset.team);
      half.classList.toggle("is-singles", mode === "singles");
      const teamPositions = positions[teamIndex];
      half.querySelectorAll(".court-player").forEach((marker) => {
        const courtSide = marker.dataset.position;
        const playerId = teamPositions[courtSide];
        marker.hidden = !playerId;
        marker.classList.toggle("is-serving", playerId === info.serverId);
        marker.textContent = playerId ? displayName(playerId, teamIndex) : "";
        marker.setAttribute("aria-label", playerId
          ? displayName(playerId, teamIndex)
            + (playerId === info.serverId ? ", serving from the " + info.side + " side" : ", " + courtSide + " side")
          : "");
      });
    });
    pickleballTracker.hidden = false;
  }

  function recordRally(won) {
    if (!state || !state.currentMatch || !state.currentMatch.pickleball) return;
    const previousGame = state.currentMatch.pickleball;
    const previousScores = state.currentMatch.scores;
    const nextGame = won
      ? window.PickleballLogic.rallyWon(previousGame)
      : window.PickleballLogic.rallyLost(previousGame);
    state.currentMatch.pickleball = nextGame;
    state.currentMatch.scores = nextGame.scores.slice();
    status.textContent = "";
    if (!saveState()) {
      state.currentMatch.pickleball = previousGame;
      state.currentMatch.scores = previousScores;
      renderScores();
      return;
    }
    renderScores();
  }

  function updateScoreMessage() {
    const scores = state.currentMatch.scores;
    const valid = scores.length === 2 && scores.every(validScore);
    completeButton.disabled = !valid || scores[0] === scores[1];
    if (!valid) {
      scoreMessage.textContent = "Record each rally to update the score.";
    } else if (scores[0] === scores[1]) {
      scoreMessage.textContent = "The game is tied. Continue recording rallies.";
    } else {
      const winningSide = scores[0] > scores[1] ? 0 : 1;
      scoreMessage.textContent = (state.currentMatch.mode === "doubles" ? "Team " : "Player ")
        + (winningSide + 1) + " is ahead.";
    }
  }

  completeButton.addEventListener("click", async () => {
    if (!state) return;
    const scores = state.currentMatch.scores;
    if (!scores.every(validScore) || scores[0] === scores[1]) {
      updateScoreMessage();
      return;
    }

    const teams = teamSnapshots();
    const winner = scores[0] > scores[1] ? 0 : 1;
    completeButton.disabled = true;
    let syncOwnerId;
    try {
      const session = await window.piqueueAuth.ready;
      syncOwnerId = session ? session.user.id : null;
    } catch (error) {
      status.textContent = error.message || "Unable to verify the signed-in account. The match was not completed.";
      completeButton.disabled = false;
      return;
    }
    const stateSnapshot = JSON.stringify(state);
    const resultId = newUuid();
    const completedAt = new Date().toISOString();
    const queueSnapshot = state.queueHistory.find((queue) => queue.id === state.currentMatch.queueId);
    state.results.push({
      id: resultId,
      queueId: state.currentMatch.queueId,
      completedAt,
      mode: state.currentMatch.mode === "doubles" ? "doubles" : "singles",
      teams: teams.map((team) => team.map((player) => ({
        id: player.id, userId: player.userId, name: player.name
      }))),
      scores: scores.slice(),
      winner,
      syncOwnerId,
      syncStatus: "pending"
    });
    if (queueSnapshot) {
      queueSnapshot.completedAt = completedAt;
      queueSnapshot.resultId = resultId;
      queueSnapshot.scores = scores.slice();
      queueSnapshot.winner = winner;
    }

    const playedNow = state.currentMatch.teams.flat();
    state.played = state.played.filter((id) => playerFor(id));
    playedNow.forEach((id) => {
      if (!playerFor(id)) return;
      state.played = state.played.filter((playedId) => playedId !== id);
      state.played.push(id);
    });
    state.currentMatch = null;
    const activeIds = state.players.map((player) => player.id);
    if (activeIds.length > 0 && activeIds.every((id) => state.played.includes(id))) state.played = [];

    if (!saveState()) {
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, JSON.parse(stateSnapshot));
      renderScores();
      return;
    }

    if (localStorage.getItem("piqueueball.offline.v1") === "true"
      || !navigator.onLine || !window.piqueueSupabase) {
      sessionStorage.setItem("piqueueball.sync-status.v1",
        "Match saved on this device. It will sync when you are online and signed in.");
    }
    if (window.piqueueSyncLocalMatches && navigator.onLine) {
      window.piqueueSyncLocalMatches();
    }
    window.location.href = "home.html";
  });

  servingTeamWonButton.addEventListener("click", () => recordRally(true));
  servingTeamLostButton.addEventListener("click", () => recordRally(false));

  if (state) renderScores();
}());
