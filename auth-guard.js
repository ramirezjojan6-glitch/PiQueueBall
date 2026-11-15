(function () {
  "use strict";

  const app = window.piqueueApp;
  const publicPages = new Set(["index.html", "login.html", "signup.html"]);
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const offlineRequested = new URLSearchParams(window.location.search).get("offline") === "1";

  if (offlineRequested) {
    app.setOfflineMode(true);
  } else if (publicPages.has(currentPage) && navigator.onLine) {
    app.setOfflineMode(false);
  } else if (!navigator.onLine) {
    app.setOfflineMode(true);
  }

  const offlineMode = app.getOfflineMode();
  const ready = new Promise((resolve) => {
    function handleSessionError(error) {
      const message = error && error.message
        ? error.message
        : "Unable to validate your login session. Check your connection and try again.";
      app.setError("auth", message);
      window.dispatchEvent(new CustomEvent("piqueueball:auth-error", { detail: message }));
      if (!publicPages.has(currentPage)) window.location.replace("index.html");
      resolve(null);
    }

    function initialize() {
      if (offlineMode) {
        resolve(null);
        return;
      }
      if (!app.getSupabase()) {
        if (app.getError("supabase") && !publicPages.has(currentPage)) {
          window.location.replace("index.html");
        }
        resolve(null);
        return;
      }
      app.getSupabase().auth.getSession().then(({ data, error }) => {
        if (error) {
          handleSessionError(error);
          return;
        }
        const session = data.session;
        if (session && publicPages.has(currentPage)) {
          app.getSupabase().from("profiles")
            .select("profile_setup_complete")
            .eq("id", session.user.id)
            .single()
            .then(({ data: profile, error: profileError }) => {
              if (profileError) {
                if (/column .* does not exist|schema cache/i.test(profileError.message || "")) {
                  handleSessionError(new Error("Run the updated supabase-setup.sql script to enable profile setup."));
                  return;
                }
                handleSessionError(profileError);
                return;
              }
              window.location.replace(profile.profile_setup_complete ? "home.html" : "profile-setup.html");
            })
            .catch(handleSessionError);
        } else if (!session && !publicPages.has(currentPage)) {
          window.location.replace("index.html");
        }
        resolve(session);
      }).catch(handleSessionError);
    }
    if (offlineMode || app.getSupabase() || app.getError("supabase")) initialize();
    else window.addEventListener("piqueueball:supabase-ready", initialize, { once: true });
    window.addEventListener("piqueueball:supabase-error", () => resolve(null), { once: true });
  });

  window.piqueueAuth = {
    ready,
    client: () => app.getSupabase(),
    async signOut() {
      const client = app.getSupabase();
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw error;
      window.location.replace("index.html");
    }
  };
}());
