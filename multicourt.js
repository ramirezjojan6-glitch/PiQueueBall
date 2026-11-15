(function () {
  "use strict";

  const joinPanel = document.getElementById("join-venue-panel");
  const dashboard = document.getElementById("venue-dashboard");
  const joinForm = document.getElementById("join-venue-form");
  const joinStatus = document.getElementById("join-venue-status");
  const venueStatus = document.getElementById("multicourt-status");
  const playerQueueStatus = document.getElementById("player-queue-status");
  const courtForm = document.getElementById("court-form");
  const statusArea = venueStatus;
  let context = null;
  let currentUserId = null;
  let refreshing = false;

  function modePreferenceKey() {
    return "piqueueball.queue-mode.v1:" + currentUserId;
  }

  async function rpc(name, args) {
    if (!window.piqueueSupabase) throw new Error("Venue actions require an online signed-in account.");
    const { data, error } = await window.piqueueSupabase.rpc(name, args || {});
    if (error) {
      if (/function .* does not exist|schema cache/i.test(error.message || "")) {
        throw new Error("Run the latest multicourt-setup.sql in the Supabase SQL Editor to enable player-based queues.");
      }
      throw error;
    }
    return data;
  }

  function showStatus(message) {
    statusArea.textContent = message || "";
  }

  function activeMatchForCourt(courtId) {
    return context.matches.find((match) => match.courtId === courtId);
  }

  function inviteUrl() {
    const invite = new URL("multicourt.html", window.location.href);
    invite.searchParams.set("join", context.venue.joinCode);
    return invite.toString();
  }

  function currentUserQueuePlayer() {
    return context.players.find((player) => player.profileId === context.currentUserId) || null;
  }

  function currentUserMatch() {
    return context.matches.find((match) =>
      match.teams.flat().some((player) => player.userId === context.currentUserId)) || null;
  }

  function formatWait(joinedAt) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(joinedAt).getTime()) / 60000));
    if (elapsed < 1) return "just joined";
    if (elapsed < 60) return elapsed + " min waiting";
    return Math.floor(elapsed / 60) + " hr " + (elapsed % 60) + " min waiting";
  }

  function renderPlayers() {
    const list = document.getElementById("venue-player-list");
    const empty = document.getElementById("venue-empty-roster");
    list.replaceChildren();
    document.getElementById("venue-roster-count").textContent = context.players.length
      + (context.players.length === 1 ? " player" : " players");
    empty.hidden = context.players.length > 0;
    context.players.forEach((player, index) => {
      const item = document.createElement("li");
      item.className = "player-item venue-player-item";
      const order = document.createElement("span");
      order.className = "player-number";
      order.textContent = String(index + 1);
      const details = document.createElement("div");
      details.className = "player-info";
      const name = document.createElement("strong");
      name.className = "player-name";
      name.textContent = player.name;
      const games = document.createElement("span");
      games.className = "player-games";
      games.textContent = "Games: " + player.gamesPlayed + " · " + formatWait(player.joinedAt);
      details.append(name, games);
      item.append(order);
      if (player.avatarDataUrl) {
        const avatar = document.createElement("img");
        avatar.className = "player-avatar";
        avatar.src = player.avatarDataUrl;
        avatar.alt = "";
        item.append(avatar);
      }
      item.append(details);
      if (context.role === "admin") {
        const remove = document.createElement("button");
        remove.className = "remove-player";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", "Remove " + player.name + " from the venue queue");
        remove.disabled = false;
        remove.title = "Remove player from the shared queue.";
        remove.addEventListener("click", async () => {
          if (!window.confirm("Remove " + player.name + " from the shared queue? Their match history will remain.")) return;
          remove.disabled = true;
          try {
            await rpc("remove_venue_queue_player", { p_player_id: player.id });
            await refresh();
            showStatus(player.name + " was removed from the queue. Match history was kept.");
          } catch (error) {
            showStatus(error.message || "Unable to remove the player.");
            remove.disabled = false;
          }
        });
        item.append(remove);
      }
      list.append(item);
    });

    const ownQueuePlayer = currentUserQueuePlayer();
    const ownMatch = currentUserMatch();
    const joinButton = document.getElementById("join-shared-queue");
    joinButton.hidden = Boolean(ownQueuePlayer || ownMatch);
    if (ownMatch) {
      const court = context.courts.find((entry) => entry.id === ownMatch.courtId);
      const courtName = ownMatch.courtName || court && court.name || "your assigned court";
      const teams = ownMatch.teams.map((team) => team.map((player) => player.name).join(" + "));
      const ownTeam = ownMatch.teams.find((team) =>
        team.some((player) => player.userId === context.currentUserId)) || [];
      const partners = ownTeam.filter((player) => player.userId !== context.currentUserId)
        .map((player) => player.name);
      const opponents = ownMatch.teams.find((team) => team !== ownTeam)
        .map((player) => player.name);
      const assignment = "You are assigned to " + courtName + ". Go to that court to play.";
      const matchInfo = teams.length ? " " + teams.join(" vs ") + "." : "";
      const teamInfo = partners.length || opponents.length
        ? " Teammates: " + (partners.join(", ") || "none") + "; opponents: " + opponents.join(", ") + "."
        : "";
      playerQueueStatus.textContent = assignment + matchInfo + teamInfo
        + " Match in progress: " + ownMatch.scoreOne + "–" + ownMatch.scoreTwo + ".";
    } else if (ownQueuePlayer) {
      const position = context.players.findIndex((player) => player.id === ownQueuePlayer.id) + 1;
      playerQueueStatus.textContent = "You are in the shared queue at position " + position
        + " · " + formatWait(ownQueuePlayer.joinedAt) + ".";
    } else {
      playerQueueStatus.textContent = "You are not in the shared queue. Join when you are ready to play.";
    }
  }

  function editCourt(court) {
    document.getElementById("court-edit-id").value = court ? court.id : "";
    document.getElementById("court-name").value = court ? court.name : "";
    document.getElementById("court-format").value = court ? court.mode : "doubles";
    document.getElementById("court-enabled").checked = court ? court.enabled : true;
    document.getElementById("save-court-button").textContent = court ? "Save court" : "Add court";
    document.getElementById("cancel-court-edit").hidden = !court;
    if (court) document.getElementById("court-name").focus();
  }

  function renderCourtConfig() {
    const list = document.getElementById("court-config-list");
    list.replaceChildren();
    context.courts.forEach((court) => {
      const item = document.createElement("li");
      const details = document.createElement("span");
      details.textContent = court.name + " · " + (court.mode === "doubles" ? "Doubles" : "Singles")
        + (court.enabled ? "" : " · Inactive");
      const edit = document.createElement("button");
      edit.className = "btn secondary-button";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.disabled = Boolean(activeMatchForCourt(court.id));
      edit.addEventListener("click", () => editCourt(court));
      item.append(details, edit);
      list.append(item);
    });
  }

  function renderCourts() {
    const grid = document.getElementById("court-card-grid");
    grid.replaceChildren();
    const courts = context.courts.filter((court) => court.enabled);
    if (!courts.length) {
      const empty = document.createElement("p");
      empty.className = "tracker-empty";
      empty.textContent = "No active courts are configured yet.";
      grid.append(empty);
      return;
    }
    courts.forEach((court) => {
      const card = document.createElement("article");
      card.className = "court-live-card";
      const heading = document.createElement("div");
      heading.className = "court-live-heading";
      const title = document.createElement("h3");
      title.textContent = court.name;
      const mode = document.createElement("span");
      mode.className = "match-format";
      mode.textContent = court.mode === "doubles" ? "Doubles" : "Singles";
      heading.append(title, mode);
      card.append(heading);
      const match = activeMatchForCourt(court.id);
      const state = document.createElement("p");
      state.className = "court-live-status";
      if (match) {
        state.textContent = match.teams.map((team) => team.map((player) => player.name).join(" + "))
          .join(" vs ") + " · " + match.scoreOne + "–" + match.scoreTwo;
        const open = document.createElement("a");
        open.className = "btn dark start-button";
        open.href = "score.html?courtMatch=" + encodeURIComponent(match.id);
        open.textContent = "Open scoreboard";
        card.append(state, open);
      } else {
        const needed = court.mode === "doubles" ? 4 : 2;
        const waitingCount = context.players.length;
        state.textContent = waitingCount < needed
          ? "Available · " + waitingCount + " waiting; need " + (needed - waitingCount) + " more"
          : "Available · assigning the next " + needed + " queued players automatically";
        card.append(state);
      }
      grid.append(card);
    });
    const activeCount = context.courts.filter((court) => court.enabled
      && activeMatchForCourt(court.id)).length;
    const availableCount = courts.length - activeCount;
    document.getElementById("courts-heading").textContent =
      "Court status · " + activeCount + " occupied · " + availableCount + " available";
  }

  function render() {
    if (!context) return;
    joinPanel.hidden = true;
    dashboard.hidden = context.venue.operatingMode !== "multicourt";
    if (dashboard.hidden) {
      joinPanel.hidden = false;
      joinForm.hidden = true;
      joinStatus.textContent = "This venue is in Single-Court Mode. Its venue queue and court data are preserved.";
      return;
    }
    joinForm.hidden = true;

    document.getElementById("venue-title").textContent = context.venue.name;
    document.getElementById("venue-member-role").textContent = context.role === "admin"
      ? "Administrator"
      : "Venue member";
    document.getElementById("court-config-panel").hidden = context.role !== "admin";
    document.getElementById("venue-queue-tools").hidden = context.role !== "admin";
    renderPlayers();
    renderCourtConfig();
    renderCourts();

    const modeSettings = document.getElementById("multicourt-mode-settings");
    if (modeSettings) modeSettings.hidden = context.role !== "admin";
    modeSelect.value = context.venue.operatingMode;
    const inviteAnchor = document.getElementById("venue-invite-link");
    if (inviteAnchor && context.venue.joinCode) {
      inviteAnchor.href = inviteUrl();
      inviteAnchor.textContent = "Share venue invite";
      inviteAnchor.hidden = false;
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const nextContext = await rpc("get_court_context");
      if (nextContext && !Object.prototype.hasOwnProperty.call(nextContext, "currentUserId")) {
        throw new Error("Run the latest multicourt-setup.sql in the Supabase SQL Editor to enable player-based queues.");
      }
      context = nextContext;
      if (!context) {
        dashboard.hidden = true;
        joinPanel.hidden = false;
        return;
      }
      render();
    } finally {
      refreshing = false;
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = joinForm.querySelector('button[type="submit"]');
    button.disabled = true;
    joinStatus.textContent = "";
    try {
      await rpc("join_court_venue", {
        p_join_code: document.getElementById("venue-join-code").value
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState(null, "", url.toString());
      await refresh();
      joinStatus.textContent = "Joined the venue.";
    } catch (error) {
      joinStatus.textContent = error.message || "Unable to join this venue.";
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("join-shared-queue").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    showStatus("");
    try {
      await rpc("join_venue_queue");
      localStorage.setItem(modePreferenceKey(), "multicourt");
      await refresh();
      showStatus("You joined the shared queue. Courts are assigned automatically.");
    } catch (error) {
      showStatus(error.message || "Unable to join the shared queue.");
    } finally {
      button.disabled = false;
    }
  });

  courtForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("save-court-button");
    button.disabled = true;
    showStatus("");
    try {
      await rpc("save_venue_court", {
        p_court_id: document.getElementById("court-edit-id").value || null,
        p_name: document.getElementById("court-name").value,
        p_mode: document.getElementById("court-format").value,
        p_enabled: document.getElementById("court-enabled").checked
      });
      editCourt(null);
      await refresh();
      showStatus("Court settings saved.");
    } catch (error) {
      showStatus(error.message || "Unable to save court settings.");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("cancel-court-edit").addEventListener("click", () => editCourt(null));

  document.getElementById("venue-new-session").addEventListener("click", async () => {
    if (!window.confirm("Start a new venue session? This resets queue games-played counts and round status. Match history will remain.")) return;
    try {
      await rpc("reset_venue_session");
      await refresh();
      showStatus("New venue session started.");
    } catch (error) {
      showStatus(error.message || "Unable to start a new venue session.");
    }
  });

  document.getElementById("back-to-single-court").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await rpc("leave_venue_queue");
      localStorage.setItem(modePreferenceKey(), "single");
      window.location.assign("home.html");
    } catch (error) {
      showStatus(error.message || "Unable to leave Multicourt mode.");
      button.disabled = false;
    }
  });

  const modeSelect = document.getElementById("multicourt-operating-mode");
  modeSelect.addEventListener("change", async () => {
    if (modeSelect.value !== "single") return;
    if (!window.confirm("Switch to Single-Court Mode? Finish all active court matches first. Venue data will be kept.")) {
      modeSelect.value = "multicourt";
      return;
    }
    modeSelect.disabled = true;
    try {
      await rpc("set_court_operating_mode", { p_mode: "single" });
      window.location.assign("home.html");
    } catch (error) {
      showStatus(error.message || "Unable to switch operating mode.");
      modeSelect.value = "multicourt";
      modeSelect.disabled = false;
    }
  });

  async function initialize() {
    const session = await window.piqueueAuth.ready;
    currentUserId = session && session.user.id;
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode && navigator.onLine && localStorage.getItem("piqueueball.offline.v1") !== "true") {
      await rpc("join_court_venue", { p_join_code: joinCode });
      localStorage.setItem(modePreferenceKey(), "multicourt");
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState(null, "", url.toString());
      window.location.assign("home.html");
      return;
    }
    await refresh();
    if (!context) joinPanel.hidden = false;
    const initialError = new URLSearchParams(window.location.search).get("error");
    if (initialError) showStatus(initialError);
  }

  initialize().catch((error) => {
    if (context) {
      showStatus(error.message || "Unable to join the venue.");
      return;
    }
    joinPanel.hidden = false;
    if (/multicourt-setup\.sql/i.test(error.message || "")) joinForm.hidden = true;
    joinStatus.textContent = error.message || "Unable to load venue information.";
  });
  window.setInterval(() => {
    if (navigator.onLine && !document.hidden) {
      refresh().catch((error) => showStatus(error.message || "Unable to refresh venue status."));
    }
  }, 5000);
}());
