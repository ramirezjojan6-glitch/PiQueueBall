(function () {
  "use strict";

  const panel = document.getElementById("court-admin-panel");
  if (!panel) return;

  const createForm = document.getElementById("create-venue-form");
  const venueSettings = document.getElementById("venue-mode-settings");
  const modeSelect = document.getElementById("court-operating-mode");
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
    const mode = activeMatch || queuedPlayer ? "multicourt" : singleMatch ? "single" : selectedMode();
    setSelectedMode(mode);
    modeInputs.forEach((input) => {
      input.disabled = Boolean(activeMatch) || (singleMatch && input.value === "multicourt");
    });
    document.getElementById("queue").hidden = mode === "multicourt";

    const isVenueAdmin = Boolean(context && context.role === "admin");
    venueSettings.hidden = !isVenueAdmin;
    createForm.hidden = Boolean(context) || mode !== "multicourt";
    if (context) {
      modeSelect.value = context.venue.operatingMode;
      modeSelect.disabled = !isVenueAdmin || !multicourtSchemaReady;
      status.textContent = multicourtSchemaReady
        ? ""
        : "The venue database needs the latest multicourt-setup.sql migration.";
      document.getElementById("court-venue-name").textContent = context.venue.name
        + (isVenueAdmin ? " · Venue administrator" : " · Venue member");
      manageLink.hidden = false;
      manageLink.textContent = isVenueAdmin ? "Manage courts and queue" : "Open venue queue and courts";
      if (context.venue.joinCode) {
        joinLink.replaceChildren();
        const anchor = document.createElement("a");
        anchor.href = invitationUrl();
        anchor.textContent = "Venue invite link (code " + context.venue.joinCode + ")";
        joinLink.append(anchor);
      }
    } else {
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
      playerStatus.textContent = "Multicourt selected · Queue position " + position
        + " · Waiting since " + new Date(queuedPlayer.joinedAt).toLocaleTimeString([], {
          hour: "numeric", minute: "2-digit"
        }) + ".";
      actionButton.textContent = "Leave Multicourt Queue and use Single-Court";
      actionButton.hidden = false;
      actionButton.onclick = leaveQueue;
    } else if (mode === "single") {
      playerStatus.textContent = "Single-Court selected. Your existing queue is ready.";
    } else if (!context) {
      playerStatus.textContent = "Join a venue using its invite link, or create a venue below.";
    } else if (context.venue.operatingMode !== "multicourt") {
      playerStatus.textContent = "Multicourt is not enabled for this venue yet. Ask its administrator to enable it.";
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
      || Object.prototype.hasOwnProperty.call(context, "currentUserId");
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
    if (context.venue.operatingMode !== "multicourt") {
      playerStatus.textContent = "The venue administrator must enable Multicourt Mode before players can join its queue.";
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
      localStorage.setItem(modePreferenceKey(), mode);
      if (mode === "single" && queuedPlayer) {
        leaveQueue();
      } else {
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

  modeSelect.addEventListener("change", async () => {
    const requestedMode = modeSelect.value;
    const previousMode = requestedMode === "multicourt" ? "single" : "multicourt";
    const confirmation = requestedMode === "multicourt"
      ? "Enable Multicourt for this venue? Players can then choose whether to join its shared queue."
      : "Disable Multicourt for this venue? Queue, court, and match data will be kept.";
    if (!window.confirm(confirmation)) {
      modeSelect.value = previousMode;
      return;
    }
    modeSelect.disabled = true;
    status.textContent = "";
    try {
      await rpc("set_court_operating_mode", { p_mode: requestedMode });
      await loadContext();
      render();
      status.textContent = requestedMode === "multicourt"
        ? "Multicourt is enabled. Players can opt in from this screen."
        : "Multicourt is disabled. Venue data was kept.";
    } catch (error) {
      status.textContent = error.message || "Unable to change the venue's Multicourt availability.";
      modeSelect.value = previousMode;
    } finally {
      modeSelect.disabled = false;
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
      setSelectedMode(localStorage.getItem(modePreferenceKey()) || "single");
    }
    render();
  }

  initialize().catch((error) => {
    if (/function .* does not exist|schema cache/i.test(error.message || "")) return;
    const queueStatus = document.getElementById("queue-status");
    if (queueStatus) queueStatus.textContent = error.message
      || "Court operating mode settings could not be loaded.";
  });
}());
