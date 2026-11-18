(function () {
  "use strict";

  const panel = document.getElementById("court-admin-panel");
  if (!panel) return;

  const createForm = document.getElementById("create-venue-form");
  const joinForm = document.getElementById("join-venue-form");
  const joinResults = document.getElementById("venue-search-results");
  const venueMemberInfo = document.getElementById("venue-member-info");
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

  async function enterSharedQueue(rpcName, args) {
    await rpc(rpcName, args);
    localStorage.setItem(modePreferenceKey(), "multicourt");
    await loadContext();
    await rpc("join_venue_queue");
    window.location.assign("multicourt.html");
  }

  function renderVenueSearchResults(venues) {
    joinResults.replaceChildren();
    joinResults.hidden = venues.length === 0;
    venues.forEach((venue) => {
      const item = document.createElement("li");
      const details = document.createElement("span");
      details.textContent = venue.venue_name + " · " + venue.waiting_count + " waiting";
      const button = document.createElement("button");
      button.className = "btn secondary-button";
      button.type = "button";
      button.textContent = "Join Queue";
      button.setAttribute("aria-label", "Join " + venue.venue_name + " queue");
      button.addEventListener("click", async () => {
        const submit = joinForm.querySelector('button[type="submit"]');
        button.disabled = true;
        submit.disabled = true;
        status.textContent = "";
        try {
          if (singleCourtQueueContainsUser()) {
            throw new Error("Remove your account from the Single-Court roster before joining the shared queue.");
          }
          await enterSharedQueue("join_court_venue_by_id", { p_venue_id: venue.venue_id });
        } catch (error) {
          status.textContent = error.message || "Unable to join the shared queue.";
          button.disabled = false;
          submit.disabled = false;
        }
      });
      item.append(details, button);
      joinResults.append(item);
    });
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

    venueMemberInfo.hidden = !context || mode !== "multicourt";
    joinForm.hidden = Boolean(context) || mode !== "multicourt";
    createForm.hidden = Boolean(context) || mode !== "multicourt";
    if (context) {
      status.textContent = multicourtSchemaReady
        ? ""
        : "The venue database needs the latest multicourt-setup.sql migration.";
      document.getElementById("court-venue-name").textContent = "Shared queue: " + context.venue.name;
      manageLink.hidden = mode !== "multicourt";
      manageLink.textContent = "Open shared queue";
      if (mode === "multicourt" && context.venue.joinCode) {
        joinLink.replaceChildren();
        const anchor = document.createElement("a");
        anchor.href = invitationUrl();
        anchor.textContent = "Share queue invite (code " + context.venue.joinCode + ")";
        joinLink.append(anchor);
      }
    } else {
      venueMemberInfo.hidden = true;
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
      playerStatus.textContent = "Join your group's queue with an invite code or party name.";
    } else {
      playerStatus.textContent = "Multicourt selected · Start a match when you're ready.";
      actionButton.textContent = "Start Match";
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
      playerStatus.textContent = "Enter a queue code or party name above, or create a new group queue.";
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

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = document.getElementById("venue-join-query").value.trim();
    const button = joinForm.querySelector('button[type="submit"]');
    joinResults.replaceChildren();
    joinResults.hidden = true;
    status.textContent = "";
    if (singleCourtQueueContainsUser()) {
      status.textContent = "Remove your account from the Single-Court roster before joining the shared queue.";
      return;
    }

    button.disabled = true;
    try {
      if (/^[A-F0-9]{8}$/i.test(query)) {
        try {
          await enterSharedQueue("join_court_venue", { p_join_code: query });
          return;
        } catch (error) {
          if (!/join code was not found/i.test(error.message || "")) throw error;
        }
      }

      const venues = await rpc("search_court_venues", { p_search: query });
      renderVenueSearchResults(Array.isArray(venues) ? venues : []);
      status.textContent = venues && venues.length
        ? "Select the correct group to join its queue."
        : "No shared queues matched. Check the name or invite code and try again.";
    } catch (error) {
      status.textContent = error.message || "Unable to find or join that queue.";
    } finally {
      button.disabled = false;
    }
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = createForm.querySelector('button[type="submit"]');
    const courtCount = Number(document.getElementById("venue-court-count").value);
    if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 20) {
      status.textContent = "Choose between 1 and 20 courts for the lobby.";
      return;
    }
    submit.disabled = true;
    status.textContent = "";
    try {
      await rpc("create_court_lobby", {
        p_name: document.getElementById("venue-name").value,
        p_court_count: courtCount
      });
      localStorage.setItem(modePreferenceKey(), "multicourt");
      await loadContext();
      render();
      window.location.assign("multicourt.html");
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
