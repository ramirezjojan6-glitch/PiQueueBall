(function () {
  "use strict";

  const STORAGE_KEY = "piqueueball.queue.v1";
  const form = document.getElementById("add-player-form");
  const nameInput = document.getElementById("player-name");
  const playerList = document.getElementById("player-list");
  const emptyRoster = document.getElementById("empty-roster");
  const rosterCount = document.getElementById("roster-count");
  const nextUpList = document.getElementById("next-up-list");
  const jumbleButton = document.getElementById("jumble-button");
  const newSessionButton = document.getElementById("new-session-button");
  const samePartner = document.getElementById("same-partner");
  const partnerOption = document.getElementById("partner-option");
  const matchTeams = document.getElementById("match-teams");
  const matchStats = document.getElementById("match-stats");
  const matchMessage = document.getElementById("match-message");
  const matchTitle = document.getElementById("match-title");
  const matchEyebrow = document.getElementById("match-eyebrow");
  const matchFormat = document.getElementById("match-format");
  const startButton = document.getElementById("start-match");
  const firstServerPicker = document.getElementById("first-server-picker");
  const firstServerSelect = document.getElementById("first-server");
  const coinFlipButton = document.getElementById("coin-flip");
  const firstServerNote = document.getElementById("first-server-note");
  const queueStatus = document.getElementById("queue-status");
  const fairnessNote = document.getElementById("fairness-note");
  const modeInputs = document.querySelectorAll('input[name="mode"]');
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function removePlayer(playerId) {
    state.players = state.players.filter((player) => player.id !== playerId);
    state.played = state.played.filter((id) => id !== playerId);
    state.recentlyPlayed = state.recentlyPlayed.filter((id) => id !== playerId);
    state.partners = state.partners.filter((pair) => !pair.includes(playerId));
    saveState();
    render();
  }

  function newState() {
    return {
      players: [], played: [], recentlyPlayed: [], partners: [],
      mode: "singles", stayTogether: false, currentMatch: null, results: [],
      queueHistory: [], profiles: {}
    };
  }

  function validScore(score) {
    return Number.isInteger(score) && score >= 0;
  }

  function newUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      return (character === "x" ? random : (random & 3) | 8).toString(16);
    });
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return newState();
      const value = JSON.parse(saved);
      if (!value || !Array.isArray(value.players)) return newState();
      const currentMatch = value.currentMatch && Array.isArray(value.currentMatch.teams) ? value.currentMatch : null;
      if (currentMatch) {
        currentMatch.scores = Array.isArray(currentMatch.scores) && currentMatch.scores.length === 2
          ? currentMatch.scores.map((score) => validScore(score) ? score : null)
          : [0, 0];
      }
      const results = Array.isArray(value.results) ? value.results.filter((result) =>
        result && typeof result.id === "string"
        && typeof result.completedAt === "string"
        && Array.isArray(result.teams) && result.teams.length === 2
        && result.teams.every((team) => Array.isArray(team) && team.every((player) =>
          player && typeof player.id === "string" && typeof player.name === "string"))
        && Array.isArray(result.scores) && result.scores.length === 2
        && result.scores.every(validScore)
        && (result.winner === 0 || result.winner === 1)
      ) : [];
      const queueHistory = Array.isArray(value.queueHistory) ? value.queueHistory.filter((queue) =>
        queue && typeof queue.id === "string"
        && typeof queue.startedAt === "string"
        && Array.isArray(queue.players) && queue.players.every((player) =>
          player && typeof player.id === "string" && typeof player.name === "string")
        && Array.isArray(queue.teams) && queue.teams.length === 2
        && queue.teams.every((team) => Array.isArray(team) && team.every((player) =>
          player && typeof player.id === "string" && typeof player.name === "string"))
      ) : [];
      const profiles = value.profiles && typeof value.profiles === "object" && !Array.isArray(value.profiles)
        ? Object.fromEntries(Object.entries(value.profiles).filter(([, profile]) =>
          profile && typeof profile === "object"
          && (profile.nickname === undefined || typeof profile.nickname === "string")
          && (profile.picture === undefined || typeof profile.picture === "string")
        ).map(([id, profile]) => [id, {
          nickname: typeof profile.nickname === "string" ? profile.nickname : "",
          picture: typeof profile.picture === "string" ? profile.picture : ""
        }]))
        : {};
      return {
        players: value.players.filter((player) => player && typeof player.id === "string" && typeof player.name === "string")
          .map((player) => ({
            ...player,
            gamesPlayed: window.QueueViewUtils.gamesPlayed(player.gamesPlayed)
          })),
        played: Array.isArray(value.played) ? value.played.filter((id) => typeof id === "string") : [],
        recentlyPlayed: Array.isArray(value.recentlyPlayed)
          ? value.recentlyPlayed.filter((id) => typeof id === "string")
          : [],
        partners: Array.isArray(value.partners) ? value.partners.filter((pair) => Array.isArray(pair) && pair.length === 2) : [],
        mode: value.mode === "doubles" ? "doubles" : "singles",
        stayTogether: value.stayTogether === true,
        currentMatch,
        results,
        queueHistory,
        profiles
      };
    } catch (error) {
      queueStatus.textContent = "Saved queue data could not be read. Your changes may not persist after this visit.";
      return newState();
    }
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      queueStatus.textContent = "Unable to save queue changes in this browser. Check its storage settings.";
      return false;
    }
  }

  async function currentAccountProfile() {
    if (!window.piqueueSupabase || !navigator.onLine
      || localStorage.getItem("piqueueball.offline.v1") === "true") return null;
    const session = await window.piqueueAuth.ready;
    if (!session) return null;
    const { data: profile, error } = await window.piqueueSupabase.from("profiles")
      .select("id, display_name, avatar_data_url")
      .eq("id", session.user.id)
      .single();
    if (error) throw error;
    return profile;
  }

  async function requestFriendForQueue(profile) {
    const session = await window.piqueueAuth.ready;
    if (!session) throw new Error("Sign in to link registered players to their accounts.");
    if (session.user.id === profile.id) return "own_profile";
    const { data, error } = await window.piqueueSupabase.rpc("request_friend_for_queue", {
      friend_id: profile.id
    });
    if (error) throw error;
    return data;
  }

  function selectedMode() {
    return state.mode;
  }

  function neededPlayers() {
    return selectedMode() === "doubles" ? 4 : 2;
  }

  function playerById(id) {
    return state.players.find((player) => player.id === id);
  }

  function displayName(player) {
    const nickname = state.profiles[player.id] && state.profiles[player.id].nickname;
    const rawName = nickname && nickname.trim() ? nickname.trim() : player.name;
    return window.piqueueApp ? window.piqueueApp.sanitizeText(rawName, { maxLength: 80, fallback: "Player" }) : rawName;
  }

  function activePartnerPairs() {
    const activeIds = new Set(state.players.map((player) => player.id));
    const assigned = new Set();
    const pairs = [];
    state.partners.forEach((pair) => {
      const [first, second] = pair;
      if (activeIds.has(first) && activeIds.has(second) && !assigned.has(first) && !assigned.has(second)) {
        pairs.push([first, second]);
        assigned.add(first);
        assigned.add(second);
      }
    });
    const waiting = state.players.filter((player) => !assigned.has(player.id) && !state.played.includes(player.id));
    const returning = state.players.filter((player) => !assigned.has(player.id) && state.played.includes(player.id));
    const unpaired = waiting.concat(returning).map((player) => player.id);
    for (let index = 0; index + 1 < unpaired.length; index += 2) {
      pairs.push([unpaired[index], unpaired[index + 1]]);
    }
    return pairs;
  }

  function candidateMatch() {
    const count = neededPlayers();
    if (state.players.length < count) return null;
    if (selectedMode() === "doubles" && samePartner.checked) {
      const pairs = activePartnerPairs();
      const playedOrder = state.played.filter((id) => playerById(id));
      pairs.sort((first, second) => {
        const rank = (pair) => {
          const unplayed = pair.filter((id) => !state.played.includes(id)).length;
          if (unplayed === 2) return 0;
          if (unplayed === 1) return 1;
          return 2 + Math.max(...pair.map((id) => playedOrder.indexOf(id)));
        };
        return rank(first) - rank(second);
      });
      if (pairs.length < 2) return null;
      return [pairs[0], pairs[1]];
    }

    const eligible = state.players.filter((player) => !state.played.includes(player.id));
    const recentlyPlayed = state.players.filter((player) => state.played.includes(player.id))
      .sort((first, second) => state.played.indexOf(first.id) - state.played.indexOf(second.id));
    const eligibleIds = eligible.map((player) => player.id);
    const ordered = eligibleIds.concat(recentlyPlayed.map((player) => player.id));
    const selected = ordered.filter((id, index) => ordered.indexOf(id) === index).slice(0, count);
    if (selected.length < count) return null;
    if (selected.length === 2) return [[selected[0]], [selected[1]]];
    return [[selected[0], selected[1]], [selected[2], selected[3]]];
  }

  function currentJumblePlan() {
    const partnerPairs = state.stayTogether && selectedMode() === "doubles"
      ? activePartnerPairs()
      : null;
    return window.QueueViewUtils.jumblePlan(state.players, neededPlayers(), partnerPairs);
  }

  function jumbleExclusionMessage(player, plan) {
    const games = window.QueueViewUtils.gamesPlayed(player.gamesPlayed);
    if (plan.aheadIds.includes(player.id)) {
      const gamesAhead = games - plan.minGames;
      return "Up " + gamesAhead + " game" + (gamesAhead === 1 ? "" : "s") + " – not in jumble";
    }
    if (plan.partnerBlockedIds.includes(player.id)) {
      return "Partner is ahead – pair stays put";
    }
    return "";
  }

  function renderRoster() {
    const plan = currentJumblePlan();
    const shouldAnimate = !reducedMotion.matches && typeof Element.prototype.animate === "function";
    const previousPositions = shouldAnimate
      ? new Map(Array.from(playerList.children, (item) => [
        item.dataset.playerId,
        item.getBoundingClientRect()
      ]))
      : new Map();
    const fragment = document.createDocumentFragment();
    const items = [];
    state.players.forEach((player, index) => {
      const item = document.createElement("li");
      item.className = "player-item";
      item.dataset.playerId = player.id;
      const number = document.createElement("span");
      number.className = "player-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const info = document.createElement("div");
      info.className = "player-info";
      const playerMain = document.createElement("div");
      playerMain.className = "player-main";
      const name = document.createElement("span");
      name.className = "player-name";
      if (player.avatarDataUrl) {
        const avatar = document.createElement("img");
        avatar.className = "player-avatar";
        avatar.src = player.avatarDataUrl;
        avatar.alt = "";
        name.append(avatar);
      }
      const nameLabel = document.createElement("span");
      nameLabel.className = "player-name-label";
      nameLabel.textContent = displayName(player);
      name.append(nameLabel);
      const games = document.createElement("span");
      games.className = "player-games";
      games.textContent = "Games: " + window.QueueViewUtils.gamesPlayed(player.gamesPlayed);
      playerMain.append(name, games);
      const status = document.createElement("span");
      status.className = "player-turn";
      status.textContent = window.QueueViewUtils.playerStatus(
        player.id,
        state.played,
        state.recentlyPlayed
      );
      status.classList.add(status.textContent === "Just played"
        ? "just-played"
        : status.textContent === "Waiting"
          ? "waiting"
          : "played-waiting");
      info.append(playerMain, status);
      const jumbleReason = jumbleExclusionMessage(player, plan);
      if (jumbleReason) {
        const exclusion = document.createElement("span");
        exclusion.className = "player-jumble-status";
        exclusion.textContent = jumbleReason;
        info.append(exclusion);
      }
      const remove = document.createElement("button");
      remove.className = "remove-player";
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + player.name);
      remove.addEventListener("click", () => {
        remove.disabled = true;
        let removalComplete = false;
        const finishRemoval = () => {
          if (removalComplete) return;
          removalComplete = true;
          removePlayer(player.id);
        };
        if (reducedMotion.matches || typeof item.animate !== "function") {
          finishRemoval();
          return;
        }
        const animation = item.animate([
          { opacity: 1, transform: "translateX(0) scale(1)" },
          { opacity: 0, transform: "translateX(12px) scale(.98)" }
        ], { duration: 170, easing: "ease-in", fill: "forwards" });
        animation.onfinish = finishRemoval;
        animation.oncancel = finishRemoval;
      });
      item.append(number, info, remove);
      fragment.append(item);
      items.push(item);
    });
    playerList.replaceChildren(fragment);
    if (shouldAnimate) {
      const currentPositions = items.map((item) => item.getBoundingClientRect());
      items.forEach((item, index) => {
        const player = state.players[index];
        const previous = previousPositions.get(player.id);
        if (previous) {
          const current = currentPositions[index];
          const x = previous.left - current.left;
          const y = previous.top - current.top;
          if (Math.abs(x) > 1 || Math.abs(y) > 1) {
            item.animate([
              { opacity: .82, transform: "translate(" + x + "px, " + y + "px)" },
              { opacity: 1, transform: "translate(0, 0)" }
            ], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
          }
        } else {
          item.animate([
            { opacity: 0, transform: "translateY(8px) scale(.985)" },
            { opacity: 1, transform: "translateY(0) scale(1)" }
          ], { duration: 180, delay: Math.min(index * 22, 100), easing: "ease-out" });
        }
      });
    }
    emptyRoster.hidden = state.players.length > 0;
    rosterCount.textContent = state.players.length + (state.players.length === 1 ? " player" : " players");
  }

  function renderFirstServerPicker(teams, mode, savedNames) {
    const previousServer = firstServerSelect.value;
    firstServerSelect.replaceChildren();
    if (!teams) {
      firstServerPicker.hidden = true;
      firstServerSelect.disabled = true;
      coinFlipButton.disabled = true;
      return;
    }

    const savedPlayersById = new Map((savedNames || []).flat().map((player) => [player.id, player]));
    const matchPlayers = teams.flat().map((id) => {
      const player = playerById(id);
      const savedPlayer = savedPlayersById.get(id);
      return { id, name: player ? displayName(player) : savedPlayer && savedPlayer.name || "Unknown player" };
    });
    matchPlayers.forEach((player) => firstServerSelect.add(new Option(player.name, player.id)));
    firstServerSelect.value = matchPlayers.some((player) => player.id === previousServer)
      ? previousServer
      : matchPlayers[0].id;
    firstServerPicker.hidden = Boolean(state.currentMatch);
    firstServerSelect.disabled = Boolean(state.currentMatch);
    coinFlipButton.disabled = Boolean(state.currentMatch);
    firstServerNote.textContent = mode === "doubles"
      ? "The first server starts as Server 2. Their team gets one server turn."
      : "The first server starts from the right side at 0–0.";
  }

  function renderMatch(teams, mode, savedNames) {
    matchTeams.replaceChildren();
    matchStats.replaceChildren();
    matchStats.hidden = true;
    renderFirstServerPicker(teams, mode, savedNames);
    if (!teams) {
      matchMessage.textContent = state.players.length < neededPlayers()
        ? "Add " + (neededPlayers() - state.players.length) + " more " + (neededPlayers() - state.players.length === 1 ? "player" : "players") + " to set up this match."
        : "No match is available yet.";
      startButton.disabled = true;
      return;
    }

    startButton.disabled = false;
    const savedPlayersById = new Map((savedNames || []).flat().map((player) => [player.id, player]));
    teams.forEach((team, index) => {
      const card = document.createElement("div");
      card.className = "team-card";
      const label = document.createElement("span");
      label.className = "team-label";
      label.textContent = mode === "singles" ? "PLAYER " + (index + 1) : "TEAM " + (index + 1);
      const names = document.createElement("div");
      names.className = "team-names";
      team.forEach((id) => {
        const player = playerById(id);
        const savedPlayer = savedPlayersById.get(id);
        const nameText = player ? displayName(player) : savedPlayer && savedPlayer.name;
        if (!nameText) return;
        const name = document.createElement("span");
        name.className = "team-player";
        const avatarDataUrl = player && player.avatarDataUrl;
        if (avatarDataUrl) {
          const avatar = document.createElement("img");
          avatar.src = avatarDataUrl;
          avatar.alt = "";
          name.append(avatar);
        }
        const label = document.createElement("span");
        label.textContent = nameText;
        name.append(label);
        names.append(name);
      });
      card.append(label, names);
      matchTeams.append(card);
    });
    const activeIds = new Set(teams.flat());
    const activePlayers = state.players.filter((player) => activeIds.has(player.id));
    if (activePlayers.length) {
      const statsByPlayerId = new Map(activePlayers.map((player) => [
        player.id,
        { played: 0, won: 0, lost: 0 }
      ]));
      state.results.forEach((result) => {
        if (!Array.isArray(result.teams)) return;
        result.teams.forEach((team, teamIndex) => {
          if (!Array.isArray(team)) return;
          team.forEach((entry) => {
            const record = statsByPlayerId.get(entry.id);
            if (!record) return;
            record.played += 1;
            if (result.winner === teamIndex) record.won += 1;
            else record.lost += 1;
          });
        });
      });
      const title = document.createElement("p");
      title.className = "mini-stats-title";
      title.textContent = "Player stats before this match";
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const heading = document.createElement("tr");
      ["Player", "Played", "Won", "Lost"].forEach((label) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        heading.append(cell);
      });
      head.append(heading);
      const body = document.createElement("tbody");
      activePlayers.forEach((player) => {
        const record = statsByPlayerId.get(player.id);
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        const playerLabel = document.createElement("span");
        playerLabel.className = "mini-stats-player";
        if (player.avatarDataUrl) {
          const avatar = document.createElement("img");
          avatar.src = player.avatarDataUrl;
          avatar.alt = "";
          playerLabel.append(avatar);
        }
        const playerName = document.createElement("span");
        playerName.textContent = displayName(player);
        playerLabel.append(playerName);
        nameCell.append(playerLabel);
        row.append(nameCell);
        [record.played, record.won, record.lost].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        });
        body.append(row);
      });
      table.append(head, body);
      matchStats.append(title, table);
      matchStats.hidden = false;
    }
    matchMessage.textContent = state.currentMatch
      ? "This match is in progress. Continue to enter scores and complete it."
      : "Players who have not played this round are selected first.";
  }

  function renderNextUp(teams, mode, savedNames) {
    nextUpList.replaceChildren();
    const savedPlayersById = new Map((savedNames || []).flat().map((player) => [player.id, player]));
    const selectedIds = new Set(teams ? teams.flat() : []);
    let remainingPlayers;
    if (mode === "doubles" && samePartner.checked) {
      const pairs = activePartnerPairs();
      const playedOrder = state.played.filter((id) => playerById(id));
      pairs.sort((first, second) => {
        const rank = (pair) => {
          const unplayed = pair.filter((id) => !state.played.includes(id)).length;
          if (unplayed === 2) return 0;
          if (unplayed === 1) return 1;
          return 2 + Math.max(...pair.map((id) => playedOrder.indexOf(id)));
        };
        return rank(first) - rank(second);
      });
      const pairedIds = new Set(pairs.flat());
      remainingPlayers = pairs
        .filter((pair) => !pair.some((id) => selectedIds.has(id)))
        .flat()
        .map((id) => playerById(id))
        .filter(Boolean);
      const unpairedPlayers = state.players.filter((player) =>
        !pairedIds.has(player.id) && !selectedIds.has(player.id));
      const waiting = unpairedPlayers.filter((player) => !state.played.includes(player.id));
      const returning = unpairedPlayers.filter((player) => state.played.includes(player.id))
        .sort((first, second) => state.played.indexOf(first.id) - state.played.indexOf(second.id));
      remainingPlayers.push(...waiting, ...returning);
    } else {
      const waiting = state.players.filter((player) =>
        !selectedIds.has(player.id) && !state.played.includes(player.id));
      const returning = state.players.filter((player) =>
        !selectedIds.has(player.id) && state.played.includes(player.id))
        .sort((first, second) => state.played.indexOf(first.id) - state.played.indexOf(second.id));
      remainingPlayers = waiting.concat(returning);
    }

    if (!remainingPlayers.length) {
      const empty = document.createElement("li");
      empty.className = "next-up-empty";
      empty.textContent = teams
        ? "No other players are waiting after this match."
        : state.players.length < neededPlayers()
          ? "Add " + (neededPlayers() - state.players.length) + " more "
            + (neededPlayers() - state.players.length === 1 ? "player" : "players")
            + " to set up the next match."
          : "No additional players are available for the next match.";
      nextUpList.append(empty);
      return;
    }

    const matchSize = neededPlayers();
    for (let offset = 0; offset < remainingPlayers.length; offset += matchSize) {
      const players = remainingPlayers.slice(offset, offset + matchSize);
      const item = document.createElement("li");
      item.className = "next-up-team";
      const order = document.createElement("span");
      order.className = "next-up-order";
      order.textContent = players.length === matchSize
        ? "Match " + (Math.floor(offset / matchSize) + (teams ? 2 : 1))
        : "Next";
      const details = document.createElement("div");
      details.className = "next-up-details";
      const label = document.createElement("strong");
      label.className = "next-up-team-label";
      label.textContent = players.length === matchSize
        ? mode === "singles" ? "Singles" : "Doubles"
        : "Waiting for a full match";
      const names = document.createElement("span");
      names.className = "next-up-names";
      const namesInOrder = players.map((player) => {
        const savedPlayer = savedPlayersById.get(player.id);
        return displayName(player) || savedPlayer && savedPlayer.name || "Unknown player";
      });
      names.textContent = mode === "doubles"
        ? players.length === 4
          ? namesInOrder.slice(0, 2).join(" + ") + " vs " + namesInOrder.slice(2).join(" + ")
          : namesInOrder.join(" + ")
        : namesInOrder.join(" vs ");
      details.append(label, names);
      if (players.length < matchSize) {
        const needed = matchSize - players.length;
        const note = document.createElement("span");
        note.className = "next-up-needed";
        note.textContent = "Needs " + needed + " more " + (needed === 1 ? "player" : "players");
        details.append(note);
      }
      item.append(order, details);
      nextUpList.append(item);
    }
  }

  function render() {
    renderRoster();
    modeInputs.forEach((input) => {
      input.checked = input.value === state.mode;
      input.disabled = Boolean(state.currentMatch);
    });
    samePartner.checked = state.stayTogether;
    samePartner.disabled = Boolean(state.currentMatch);
    partnerOption.hidden = state.mode !== "doubles";
    const displayMode = state.currentMatch && state.currentMatch.mode ? state.currentMatch.mode : state.mode;
    matchFormat.textContent = displayMode === "doubles" ? "Doubles" : "Singles";

    const teams = state.currentMatch ? state.currentMatch.teams : candidateMatch();
    if (state.currentMatch) {
      matchTitle.textContent = "Current match";
      matchEyebrow.textContent = "IN PROGRESS";
      startButton.textContent = "Continue match";
      startButton.hidden = false;
    } else {
      matchTitle.textContent = "Next Match";
      matchEyebrow.textContent = "UP NEXT";
      startButton.textContent = "Start match";
      startButton.hidden = false;
    }
    renderMatch(teams, displayMode, state.currentMatch && state.currentMatch.names);
    renderNextUp(teams, displayMode, state.currentMatch && state.currentMatch.names);
    const canJumble = state.players.length > 0 && !state.currentMatch;
    jumbleButton.disabled = !canJumble;
    newSessionButton.disabled = Boolean(state.currentMatch);
    newSessionButton.title = state.currentMatch
      ? "Complete the current match before starting a new session."
      : "Reset games played and round statuses without removing players.";
    fairnessNote.textContent = state.played.length
      ? state.played.length + " player" + (state.played.length === 1 ? " has" : "s have") + " played this round."
      : "Players take turns before anyone gets a second game.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const enteredName = window.piqueueApp
      ? window.piqueueApp.sanitizeText(nameInput.value, { maxLength: 80, fallback: "" })
      : nameInput.value.trim();
    if (!enteredName) {
      nameInput.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let profile = null;
      const emailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enteredName);
      if (!emailAddress) {
        const accountProfile = await currentAccountProfile();
        if (accountProfile
          && enteredName.toLocaleLowerCase() === accountProfile.display_name.trim().toLocaleLowerCase()) {
          profile = accountProfile;
        }
      }
      const enteredEmail = emailAddress;
      if (enteredEmail && navigator.onLine && !window.piqueueSupabase) {
        throw new Error("Profile lookup is not ready yet. Please try again.");
      }
      if (enteredEmail && window.piqueueSupabase && navigator.onLine) {
        const { data, error } = await window.piqueueSupabase.rpc("lookup_profile_by_email", {
          profile_email: enteredName
        });
        if (error) throw error;
        profile = Array.isArray(data) ? data[0] || null : null;
      }
      if (profile && state.players.some((player) =>
        player.registeredProfileId === profile.id || player.onlineId === profile.id
      )) {
        queueStatus.textContent = profile.display_name + " is already in the queue.";
        nameInput.focus();
        return;
      }
      const name = profile ? profile.display_name : enteredName;
      if (state.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        queueStatus.textContent = "That player is already in the queue.";
        nameInput.focus();
        return;
      }
      const safeDisplayName = window.piqueueApp ? window.piqueueApp.sanitizeText(name, { maxLength: 80, fallback: "Player" }) : name;
      const player = profile ? {
        id: "registered-" + profile.id,
        registeredProfileId: profile.id,
        onlineId: profile.id,
        name: safeDisplayName,
        avatarDataUrl: profile.avatar_data_url || "",
        gamesPlayed: 0
      } : {
        id: newUuid(),
        name: safeDisplayName,
        gamesPlayed: 0
      };
      const friendRequestState = profile ? await requestFriendForQueue(profile) : null;
      state.players.push(player);
      nameInput.value = "";
      if (friendRequestState === "request_sent") {
        queueStatus.textContent = safeDisplayName + " added. A friend request was sent; match stats will sync after they accept.";
      } else if (friendRequestState === "request_pending") {
        queueStatus.textContent = safeDisplayName + " added. Your friend request is pending; match stats will sync after they accept.";
      } else if (friendRequestState === "incoming_request") {
        queueStatus.textContent = safeDisplayName + " added. They have sent you a friend request; accept it on the Friends page to sync match stats.";
      } else if (friendRequestState === "own_profile") {
        queueStatus.textContent = safeDisplayName + " added with your registered profile; match stats will count toward your account.";
      } else if (profile) {
        queueStatus.textContent = safeDisplayName + " added with their registered profile; match stats will count toward this account.";
      } else {
        queueStatus.textContent = enteredEmail
          ? "No registered account found. Added without a profile photo."
          : "Player added to the queue.";
      }
      saveState();
      render();
      nameInput.focus();
    } catch (error) {
      queueStatus.textContent = error && error.message
        ? error.message
        : "Unable to look up that profile. Please try again.";
      nameInput.focus();
    } finally {
      button.disabled = false;
    }
  });

  modeInputs.forEach((input) => input.addEventListener("change", () => {
    state.mode = input.value;
    if (state.currentMatch) state.currentMatch.mode = state.mode;
    saveState();
    render();
  }));

  samePartner.addEventListener("change", () => {
    state.stayTogether = samePartner.checked;
    saveState();
    render();
  });

  jumbleButton.addEventListener("click", () => {
    if (state.currentMatch) return;
    const plan = currentJumblePlan();
    if (!plan.enoughEligible) {
      queueStatus.textContent = "Not enough eligible players with the lowest games played count to make a full "
        + (state.mode === "doubles" ? "Doubles match (need 4). " : "Singles match (need 2). ")
        + "Queue order was not changed.";
      return;
    }

    const previousPlayers = state.players;
    const previousPartners = state.partners;
    state.players = window.QueueViewUtils.jumblePlayers(state.players, plan);
    if (state.stayTogether && state.mode === "doubles") {
      plan.eligibleGroups.forEach((pair) => {
        if (pair.length === 2
          && !state.partners.some((saved) => saved.includes(pair[0]) && saved.includes(pair[1]))) {
          state.partners.push(pair.slice());
        }
      });
    }
    if (!saveState()) {
      state.players = previousPlayers;
      state.partners = previousPartners;
      render();
      return;
    }
    const included = plan.eligibleIds.length;
    queueStatus.textContent = included === state.players.length
      ? "Queue jumbled. Everyone was included."
      : "Queue jumbled. Shuffled " + included + " player" + (included === 1 ? "" : "s")
        + " with the lowest games played count; players ahead kept their spots.";
    render();
  });

  newSessionButton.addEventListener("click", () => {
    if (state.currentMatch) return;
    if (!window.confirm("Start a new session? Every player's games played count and round status will reset.")) return;

    const previousPlayers = state.players;
    const previousPlayed = state.played;
    const previousRecentlyPlayed = state.recentlyPlayed;
    state.players = state.players.map((player) => ({ ...player, gamesPlayed: 0 }));
    state.played = [];
    state.recentlyPlayed = [];
    if (saveState()) {
      queueStatus.textContent = "New session started. Games played and round statuses were reset.";
      render();
    } else {
      state.players = previousPlayers;
      state.played = previousPlayed;
      state.recentlyPlayed = previousRecentlyPlayed;
    }
  });

  startButton.addEventListener("click", () => {
    if (state.currentMatch) {
      window.location.href = "score.html";
      return;
    }
    const teams = candidateMatch();
    if (!teams) return;
    const previousState = JSON.stringify(state);
    if (state.mode === "doubles" && samePartner.checked) {
      teams.forEach((team) => {
        const pair = team.slice();
        if (pair.length === 2 && !state.partners.some((saved) => saved.includes(pair[0]) && saved.includes(pair[1]))) {
          state.partners.push(pair);
        }
      });
    }
    const queueId = newUuid();
    let pickleball;
    try {
      pickleball = window.PickleballLogic.createGameState(state.mode, teams, firstServerSelect.value);
    } catch (error) {
      queueStatus.textContent = error.message || "Choose who serves first before starting the match.";
      return;
    }
    const teamSnapshots = teams.map((team) => team.map((id) => {
      const player = playerById(id);
      return {
        id,
        userId: player && player.onlineId ? player.onlineId : null,
        name: player ? displayName(player) : "",
        avatarDataUrl: player && player.avatarDataUrl || ""
      };
    }));
    state.currentMatch = {
      teams, mode: state.mode, scores: [0, 0], queueId, names: teamSnapshots, pickleball
    };
    const playingIds = teams.flat();
    state.players = window.QueueViewUtils.incrementGamesPlayed(state.players, playingIds);
    state.recentlyPlayed = playingIds.slice();
    state.queueHistory.push({
      id: queueId,
      startedAt: new Date().toISOString(),
      mode: state.mode,
      players: state.players.map((player) => ({
        id: player.id,
        userId: player.onlineId || null,
        name: displayName(player)
      })),
      teams: teamSnapshots.map((team) => team.map((player) => ({
        id: player.id, userId: player.userId, name: player.name, avatarDataUrl: player.avatarDataUrl
      })))
    });
    queueStatus.textContent = "Match started.";
    if (saveState()) {
      window.location.href = "score.html";
    } else {
      state = JSON.parse(previousState);
      render();
    }
  });

  coinFlipButton.addEventListener("click", () => {
    const teams = candidateMatch();
    if (!teams) return;
    const playerIds = teams.flat();
    const firstServerId = window.PickleballLogic.flipFirstServer(playerIds, Math.random());
    firstServerSelect.value = firstServerId;
    const player = playerById(firstServerId);
    firstServerNote.textContent = "Coin flip: " + (player ? displayName(player) : "Selected player")
      + " serves first.";
  });

  render();
}());
