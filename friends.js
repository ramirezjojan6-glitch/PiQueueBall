(function () {
  "use strict";

  const STORAGE_KEY = "piqueueball.queue.v1";
  const status = document.getElementById("friends-status");
  const form = document.getElementById("friend-form");
  const searchResults = document.getElementById("search-results");
  const emptySearchResults = document.getElementById("empty-search-results");
  let signedInUser;

  function showError(error) {
    status.textContent = error && error.message ? error.message : "Unable to complete that action.";
  }

  function card(profile, actions) {
    const item = document.createElement("li");
    item.className = "friend-item";
    const avatar = document.createElement("span");
    avatar.className = "friend-avatar";
    if (profile.avatar_data_url) {
      const image = document.createElement("img");
      image.src = profile.avatar_data_url;
      image.alt = "";
      avatar.append(image);
    } else {
      avatar.textContent = profile.display_name.slice(0, 2).toLocaleUpperCase();
    }
    const name = document.createElement("strong");
    name.className = "friend-name";
    name.textContent = profile.display_name;
    const controls = document.createElement("div");
    controls.className = "friend-actions";
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.primary ? "btn secondary-button" : "friend-action";
      button.textContent = action.label;
      button.addEventListener("click", action.run);
      controls.append(button);
    });
    item.append(avatar, name, controls);
    return item;
  }

  function addToQueue(profile) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const state = saved ? JSON.parse(saved) : {
        players: [], played: [], partners: [], mode: "singles",
        stayTogether: false, currentMatch: null, results: [], queueHistory: [], profiles: {}
      };
      if (!Array.isArray(state.players)) throw new Error("The saved queue data is invalid.");
      if (state.currentMatch) {
        status.textContent = "Finish the current match before adding players to the queue.";
        return;
      }
      if (state.players.some((player) => player.onlineId === profile.id)) {
        status.textContent = profile.display_name + " is already in the queue.";
        return;
      }
      state.players.push({
        id: "online-" + profile.id,
        onlineId: profile.id,
        name: profile.display_name,
        avatarDataUrl: profile.avatar_data_url || ""
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      status.textContent = profile.display_name + " added to the queue.";
    } catch (error) {
      status.textContent = "Unable to add this player to the queue. Check browser storage.";
    }
  }

  async function loadFriends(user) {
    status.textContent = "Loading friends…";
    const { data: relations, error } = await window.piqueueSupabase.from("friendships")
      .select("id, requester_id, addressee_id, status, created_at, requester:profiles!friendships_requester_id_fkey(id, display_name, avatar_data_url), addressee:profiles!friendships_addressee_id_fkey(id, display_name, avatar_data_url)")
      .or("requester_id.eq." + user.id + ",addressee_id.eq." + user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const requests = document.getElementById("request-list");
    const friends = document.getElementById("friend-list");
    requests.replaceChildren();
    friends.replaceChildren();
    let pendingCount = 0;
    let friendCount = 0;

    relations.forEach((relation) => {
      const otherId = relation.requester_id === user.id ? relation.addressee_id : relation.requester_id;
      const profile = relation.requester_id === user.id ? relation.addressee : relation.requester;
      if (!profile) return;
      if (relation.status === "accepted") {
        friendCount += 1;
        friends.append(card(profile, [
          { label: "Add to queue", primary: true, run: () => addToQueue(profile) },
          {
            label: "Remove",
            run: async () => {
              const { error: removeError } = await window.piqueueSupabase.rpc("remove_friend", { friend_id: otherId });
              if (removeError) showError(removeError);
              else {
                status.textContent = "Friend removed.";
                await loadFriends(user);
              }
            }
          }
        ]));
      } else {
        pendingCount += 1;
        const incoming = relation.addressee_id === user.id;
        requests.append(card(profile, incoming ? [
          {
            label: "Accept",
            primary: true,
            run: async () => {
              const { error: responseError } = await window.piqueueSupabase.rpc("respond_to_friend_request", {
                request_id: relation.id,
                accept_request: true
              });
              if (responseError) showError(responseError);
              else {
                status.textContent = "Friend request accepted.";
                await loadFriends(user);
              }
            }
          },
          {
            label: "Decline",
            run: async () => {
              const { error: responseError } = await window.piqueueSupabase.rpc("respond_to_friend_request", {
                request_id: relation.id,
                accept_request: false
              });
              if (responseError) showError(responseError);
              else await loadFriends(user);
            }
          }
        ] : [{ label: "Sent", run: () => {} }]));
      }
    });

    document.getElementById("empty-requests").hidden = pendingCount > 0;
    document.getElementById("empty-friends").hidden = friendCount > 0;
    document.getElementById("friends-count").textContent = friendCount + (friendCount === 1 ? " friend" : " friends");
    status.textContent = "";
  }

  async function sendFriendRequest(profile, button) {
    button.disabled = true;
    try {
      const { error } = await window.piqueueSupabase.rpc("request_friend_by_id", {
        friend_id: profile.id
      });
      if (error) throw error;
      status.textContent = "Friend request sent to " + profile.display_name + ".";
      await loadFriends(signedInUser);
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    searchResults.replaceChildren();
    emptySearchResults.hidden = true;
    status.textContent = "Searching players…";
    try {
      const { data: profiles, error } = await window.piqueueSupabase.rpc("search_profiles_by_nickname", {
        nickname_query: document.getElementById("friend-nickname").value.trim()
      });
      if (error) throw error;
      if (!profiles.length) {
        emptySearchResults.hidden = false;
        status.textContent = "";
        return;
      }
      profiles.forEach((profile) => {
        searchResults.append(card(profile, [{
          label: "Add friend",
          primary: true,
          run: (event) => sendFriendRequest(profile, event.currentTarget)
        }]));
      });
      status.textContent = profiles.length + (profiles.length === 1 ? " player found." : " players found.");
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("add-self").addEventListener("click", async () => {
    try {
      const { data: profile, error } = await window.piqueueSupabase.from("profiles")
        .select("id, display_name, avatar_data_url")
        .eq("id", signedInUser.id)
        .single();
      if (error) throw error;
      addToQueue(profile);
    } catch (error) {
      showError(error);
    }
  });

  window.piqueueAuth.ready.then((session) => {
    if (!session) return;
    signedInUser = session.user;
    loadFriends(session.user).catch(showError);
  }).catch(showError);
}());
