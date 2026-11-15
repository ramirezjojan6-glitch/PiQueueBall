(function () {
  "use strict";

  const OFFLINE_MODE_KEY = "piqueueball.offline.v1";
  const initialState = {
    errors: {
      supabase: "",
      auth: ""
    },
    supabase: null,
    nativeAuthReady: Promise.resolve(true),
    auth: {
      ready: Promise.resolve(null)
    },
    offlineMode: false
  };

  function refreshOfflineMode() {
    initialState.offlineMode = localStorage.getItem(OFFLINE_MODE_KEY) === "true";
    return initialState.offlineMode;
  }

  function setError(scope, message) {
    if (!scope || !Object.prototype.hasOwnProperty.call(initialState.errors, scope)) return;
    initialState.errors[scope] = message || "";
    return initialState.errors[scope];
  }

  function getError(scope) {
    if (!scope || !Object.prototype.hasOwnProperty.call(initialState.errors, scope)) return "";
    return initialState.errors[scope] || "";
  }

  function setSupabase(client) {
    initialState.supabase = client;
    return client;
  }

  function getSupabase() {
    return initialState.supabase;
  }

  function setOfflineMode(value) {
    initialState.offlineMode = Boolean(value);
    if (initialState.offlineMode) {
      localStorage.setItem(OFFLINE_MODE_KEY, "true");
    } else {
      localStorage.removeItem(OFFLINE_MODE_KEY);
    }
    return initialState.offlineMode;
  }

  function getOfflineMode() {
    return refreshOfflineMode();
  }

  function sanitizeText(value, { maxLength = 80, fallback = "" } = {}) {
    const raw = String(value === null || value === undefined ? "" : value);
    let text = "";
    for (let index = 0; index < raw.length; index += 1) {
      const code = raw.charCodeAt(index);
      if (code === 0 || code < 32 || code === 127) {
        text += " ";
      } else {
        text += raw.charAt(index);
      }
    }
    text = text.replace(/\s+/g, " ").trim();
    const trimmed = text.length > maxLength ? text.slice(0, maxLength).trim() : text;
    return trimmed || fallback;
  }

  function getStatusElement() {
    return document.getElementById("queue-status")
      || document.getElementById("profile-status")
      || document.getElementById("score-status")
      || document.getElementById("tracker-status")
      || document.getElementById("friends-status")
      || document.getElementById("auth-status");
  }

  const app = {
    state: initialState,
    getState: () => initialState,
    setError,
    getError,
    clearError(scope) {
      return setError(scope, "");
    },
    setSupabase,
    getSupabase,
    setNativeAuthReady(value) {
      initialState.nativeAuthReady = value || Promise.resolve(true);
      return initialState.nativeAuthReady;
    },
    getNativeAuthReady() {
      return initialState.nativeAuthReady;
    },
    getOfflineMode,
    setOfflineMode,
    sanitizeText,
    getStatusElement,
    isPublicPage(pageName) {
      return ["index.html", "login.html", "signup.html"].includes(pageName);
    }
  };

  window.piqueueApp = app;

  Object.defineProperties(window, {
    piqueueSupabase: {
      get: getSupabase,
      set: setSupabase,
      configurable: true
    },
    piqueueballSupabaseError: {
      get: () => getError("supabase"),
      set: (value) => {
        setError("supabase", value);
      },
      configurable: true
    },
    piqueueballAuthError: {
      get: () => getError("auth"),
      set: (value) => {
        setError("auth", value);
      },
      configurable: true
    },
    piqueueballNativeAuthReady: {
      get: () => initialState.nativeAuthReady,
      set: (value) => {
        initialState.nativeAuthReady = value || Promise.resolve(true);
      },
      configurable: true
    },
    piqueueAuth: {
      get: () => initialState.auth,
      set: (value) => {
        initialState.auth = value || { ready: Promise.resolve(null) };
      },
      configurable: true
    }
  });

  refreshOfflineMode();
}());
