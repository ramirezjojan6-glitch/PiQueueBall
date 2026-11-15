(function () {
  "use strict";

  const app = window.piqueueApp;
  let loading = false;

  function reportError(message) {
    app.setError("supabase", message);
    window.dispatchEvent(new CustomEvent("piqueueball:supabase-error", {
      detail: app.getError("supabase")
    }));
  }

  function initialize() {
    if (!window.PIQUEUEBALL_SUPABASE) {
      reportError("Supabase configuration is missing.");
      return;
    }
    if (!window.supabase) {
      reportError("Supabase is unavailable. Continue offline or check your internet connection.");
      return;
    }

    app.setSupabase(window.supabase.createClient(
      window.PIQUEUEBALL_SUPABASE.url,
      window.PIQUEUEBALL_SUPABASE.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    ));
    window.dispatchEvent(new Event("piqueueball:supabase-ready"));
  }

  function loadSupabase() {
    if (app.getSupabase() || loading || !window.PIQUEUEBALL_SUPABASE) return;
    if (window.supabase) {
      initialize();
      return;
    }
    loading = true;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0";
    script.crossOrigin = "anonymous";
    script.async = true;
    script.addEventListener("load", () => {
      loading = false;
      initialize();
    }, { once: true });
    script.addEventListener("error", () => {
      loading = false;
      reportError("Supabase could not be loaded. Continue offline or check your internet connection.");
    }, { once: true });
    document.head.append(script);
  }

  if (window.supabase) {
    initialize();
  } else {
    window.addEventListener("online", loadSupabase);
    loadSupabase();
  }
}());
