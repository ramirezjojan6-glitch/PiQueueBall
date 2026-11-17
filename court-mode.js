(function () {
  "use strict";

  const panel = document.getElementById("court-admin-panel");
  if (!panel) return;

  const createForm = document.getElementById("create-venue-form");
  const venueAdminInfo = document.getElementById("venue-admin-info");
  const status = document.getElementById("court-admin-status");
  const playerStatus = document.getElementById("player-mode-status");
  const actionButton = document.getElementById("player-mode-action");
  const joinLink = document.getElementById("court-join-link");
  const manageLink = document.getElementById("manage-courts-link");
  const modeInputs = Array.from(document.querySelectorAll('input[name="player-queue-mode"]'));
  let context = null;
  let multicourtSchemaReady = true;
  let currentUserId = null;
  let queuedPlayer = null;
  let activeMatch = null;
  let invalidSingleMatchData = false;

  function modePreferenceKey() {
    return "piqueueball.queue-mode.v1:" + currentUserId;
  }

  function singleCourtMatchActive() {
    const saved = localStorage.getItem("piqueueball.queue.v1");
    invalidSingleMatchData = false;
    if (!saved) return false;
    try {
      const state = JSON.parse(saved);
      if (!state || !state.currentMatch) return false;
      const matchPlayers = Array.isArray(state.currentMatch.names)
        ? state.currentMatch.names.flat()
        : state.currentMatch.teams.flatMap((team) =>
          team.map((id) => state.players.find((player) => player.id === id)));
      return Boolean(currentUserId) && matchPlayers.some((player) => player
        && (player.userId === currentUserId || player.onlineId === currentUserId));
    } catch {
      invalidSingleMatchData = true;
      return true;
    }
  }

  function singleCourtQueueContainsUser() {
    const saved = localStorage.getItem("piqueueball.queue.v1");
    if (!saved || !currentUserId) return false;
    try {
      const state = JSON.parse(saved);
      return Boolean(state && Array.isArray(state.players) && state.players.some((player) =>
        player && (player.onlineId === currentUserId || player.registeredProfileId === currentUserId)
      ));
    } catch {
      return false;
    }
  }

  async function rpc(name, args) {
    const { data, error } = await window.piqueueSupabase.rpc(name, args || {});
    if (error) {
      if (/function .* does not exist|schema cache/i.test(error.message || "")) {
        throw new Error("Run the latest multicourt-setup.sql in the Supabase SQL Editor to enable player-based queues.");
      }
      throw error;
    }
    return data;
  }

  function selectedMode() {
    const selected = modeInputs.find((input) => input.checked);
    return selected ? selected.value : "single";
  }

  function setSelectedMode(mode) {
    modeInputs.forEach((input) => {
      input.checked = input.value === mode;
    });
  }

  function invitationUrl() {
    const invite = new URL("multicourt.html", window.location.href);
    invite.searchParams.set("join", context.venue.joinCode);
    return invite.toString();
  }

  function render() {
    panel.hidden = false;
    const singleMatch = singleCourtMatchActive();
    const singleQueuePlayer = singleCourtQueueContainsUser();
    const mode = activeMatch || queuedPlayer
      ? "multicourt"
      : singleMatch || singleQueuePlayer ? "single" : selectedMode();
    setSelectedMode(mode);
    modeInputs.forEach((input) => {
      input.disabled = Boolean(activeMatch) || (singleMatch && input.value === "multicourt");
    });
    document.getElementById("queue").hidden = mode === "multicourt";

    const isVenueAdmin = Boolean(context && context.role === "admin"
      && context.venue.createdBy === context.currentUserId);
    venueAdminInfo.hidden = !isVenueAdmin || mode !== "multicourt";
    createForm.hidden = Boolean(context) || mode !== "multicourt";
    if (context) {
      status.textContent = multicourtSchemaReady
        ? ""
        : "The venue database needs the latest multicourt-setup.sql migration.";
      document.getElementById("court-venue-name").textContent =
        context.venue.name + " · Venue Administrator";
      manageLink.hidden = !isVenueAdmin || mode !== "multicourt";
      manageLink.textContent = "Manage Courts and Queue";
      if (isVenueAdmin && mode === "multicourt" && context.venue.joinCode) {
        joinLink.replaceChildren();
        const anchor = document.createElement("a");
        anchor.href = invitationUrl();
        anchor.textContent = "Venue invite link (code " + context.venue.joinCode + ")";
        joinLink.append(anchor);
      }
    } else {
      venueAdminInfo.hidden = true;
      manageLink.hidden = true;
    }

    actionButton.hidden = true;
    actionButton.disabled = false;
    actionButton.onclick = null;
    if (context && !multicourtSchemaReady && mode === "multicourt") {
      playerStatus.textContent = "Run the latest multicourt-setup.sql to enable player-based Multicourt queues.";
    } else if (activeMatch) {
      const court = context.courts.find((entry) => entry.id === activeMatch.courtId);
      const courtName = activeMatch.courtName || court && court.name || "your assigned court";
      playerStatus.textContent = "You are playing on " + courtName + ". Finish the match before changing modes.";
      actionButton.textContent = "Open " + courtName + " scoreboard";
      actionButton.hidden = false;
      actionButton.onclick = () => {
        window.location.assign("score.html?courtMatch=" + encodeURIComponent(activeMatch.id));
      };
    } else if (singleMatch) {
      playerStatus.textContent = invalidSingleMatchData
        ? "The saved Single-Court match data is invalid. Resolve it before changing modes."
        : "Finish your active Single-Court match before switching to Multicourt.";
    } else if (queuedPlayer) {
      const position = context.players.findIndex((player) => player.id === queuedPlayer.id) + 1;
      playerStatus.textContent = (singleQueuePlayer
        ? "You are in both queues. Leave the Multicourt queue before using Single-Court. "
        : "Multicourt selected · Queue position " + position
          + " · Waiting since " + new Date(queuedPlayer.joinedAt).toLocaleTimeString([], {
            hour: "numeric", minute: "2-digit"
          }) + ".");
      actionButton.textContent = "Leave Multicourt Queue and use Single-Court";
      actionButton.hidden = false;
      actionButton.onclick = leaveQueue;
    } else if (mode === "single") {
      playerStatus.textContent = "Single-Court selected. Your existing queue is ready.";
    } else if (!context) {
      playerStatus.textContent = "Join a venue using its invite link, or create a venue below.";
    } else {
      playerStatus.textContent = "Multicourt selected · Join your venue's shared queue when you're ready.";
      actionButton.textContent = "Join Multicourt Queue";
      actionButton.hidden = false;
      actionButton.onclick = joinQueue;
    }
  }

  async function loadContext() {
    context = await rpc("get_court_context");
    multicourtSchemaReady = !context
      || (Object.prototype.hasOwnProperty.call(context, "currentUserId")
        && context.venue
        && Object.prototype.hasOwnProperty.call(context.venue, "createdBy"));
    queuedPlayer = null;
    activeMatch = null;
    if (!context || !multicourtSchemaReady) return;
    queuedPlayer = context.players.find((player) => player.profileId === context.currentUserId) || null;
    activeMatch = context.matches.find((match) =>
      match.teams.flat().some((player) => player.userId === context.currentUserId)) || null;
    if (activeMatch || queuedPlayer) {
      localStorage.setItem(modePreferenceKey(), "multicourt");
    }
  }

  async function joinQueue() {
    if (!context) {
      playerStatus.textContent = "Join using a venue invite link, or create your own venue below.";
      return;
    }
    if (singleCourtQueueContainsUser()) {
      setSelectedMode("single");
      localStorage.setItem(modePreferenceKey(), "single");
      render();
      playerStatus.textContent = "Remove your account from the Single-Court roster before joining the Multicourt queue.";
      return;
    }
    actionButton.disabled = true;
    try {
      await rpc("join_venue_queue");
      localStorage.setItem(modePreferenceKey(), "multicourt");
      window.location.assign("multicourt.html");
    } catch (error) {
      playerStatus.textContent = error.message || "Unable to join the shared queue.";
      actionButton.disabled = false;
    }
  }

  async function leaveQueue() {
    actionButton.disabled = true;
    try {
      await rpc("leave_venue_queue");
      queuedPlayer = null;
      localStorage.setItem(modePreferenceKey(), "single");
      setSelectedMode("single");
      render();
    } catch (error) {
      setSelectedMode("multicourt");
      playerStatus.textContent = error.message || "Unable to leave the shared queue.";
      actionButton.disabled = false;
    }
  }

  document.querySelectorAll('input[name="player-queue-mode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (activeMatch) {
        setSelectedMode("multicourt");
        return;
      }
      const mode = selectedMode();
      if (mode === "multicourt" && singleCourtQueueContainsUser()) {
        setSelectedMode("single");
        localStorage.setItem(modePreferenceKey(), "single");
        render();
        playerStatus.textContent = "Remove your account from the Single-Court roster before joining the Multicourt queue.";
        return;
      }
      if (mode === "single" && queuedPlayer) {
        setSelectedMode("multicourt");
        leaveQueue();
      } else {
        localStorage.setItem(modePreferenceKey(), mode);
        render();
      }
    });
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = createForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = "";
    try {
      await rpc("create_court_venue", {
        p_name: document.getElementById("venue-name").value
      });
      localStorage.setItem(modePreferenceKey(), "multicourt");
      await loadContext();
      render();
      await joinQueue();
    } catch (error) {
      status.textContent = error.message || "Unable to create the venue.";
    } finally {
      submit.disabled = false;
    }
  });

  async function initialize() {
    if (!window.piqueueSupabase || !navigator.onLine
      || localStorage.getItem("piqueueball.offline.v1") === "true") return;
    const session = await window.piqueueAuth.ready;
    if (!session) return;
    currentUserId = session.user.id;
    await loadContext();
    if (!queuedPlayer && !activeMatch) {
      const preferredMode = localStorage.getItem(modePreferenceKey()) || "single";
      if (singleCourtQueueContainsUser()) {
        localStorage.setItem(modePreferenceKey(), "single");
        setSelectedMode("single");
      } else {
        setSelectedMode(preferredMode);
      }
    }
    render();
  }

  initialize().catch((error) => {
    if (/function .* does not exist|schema cache/i.test(error.message || "")) return;
    const queueStatus = document.getElementById("queue-status");
    if (queueStatus) queueStatus.textContent = error.message
      || "Queue mode settings could not be loaded.";
  });
}());
