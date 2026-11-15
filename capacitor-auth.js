(function () {
  "use strict";

  const app = window.piqueueApp;
  const capacitor = window.Capacitor;
  const isNative = Boolean(capacitor &&
    typeof capacitor.isNativePlatform === "function" &&
    capacitor.isNativePlatform());
  if (!isNative) {
    app.setNativeAuthReady(Promise.resolve(true));
    return;
  }

  function reportError(error) {
    const message = error && error.message
      ? error.message
      : "Android email callback setup failed.";
    app.setError("auth", message);
    window.dispatchEvent(new CustomEvent("piqueueball:auth-error", { detail: message }));
  }

  function handleCallback(rawUrl) {
    let callback;
    try {
      callback = new URL(rawUrl);
    } catch (error) {
      return;
    }

    const redirect = new URL(window.PIQUEUEBALL_SUPABASE.nativeAuthRedirectUrl);
    if (callback.protocol !== redirect.protocol ||
        callback.host !== redirect.host ||
        callback.pathname !== redirect.pathname ||
        (!callback.search && !callback.hash)) {
      return;
    }

    const destination = new URL("login.html", window.location.href);
    destination.search = callback.search;
    const query = new URLSearchParams(destination.search);
    const hash = new URLSearchParams(callback.hash.slice(1));
    if (query.has("code") || hash.has("code") || hash.has("access_token")) {
      query.set("email_confirmed", "1");
    }
    destination.search = query.toString();
    destination.hash = callback.hash;
    window.location.replace(destination.toString());
  }

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Android email callback support could not be loaded."));
      document.head.append(script);
    });
  }

  app.setNativeAuthReady(loadScript("capacitor-core.js")
    .then(() => loadScript("capacitor-app-plugin.js"))
    .then(async () => {
      const App = window.capacitorApp && window.capacitorApp.App;
      if (!App) throw new Error("The Capacitor App plugin is unavailable.");
      await App.addListener("appUrlOpen", ({ url }) => handleCallback(url));
      const launch = await App.getLaunchUrl();
      if (launch && launch.url) handleCallback(launch.url);
      return true;
    })
    .catch((error) => {
      reportError(error);
      return false;
    }));
}());
