(function () {
  "use strict";

  const app = window.piqueueApp;
  const fallbackValidation = (() => {
    function validateEmail(value) {
      const normalizedEmail = String(value || "").trim().toLowerCase();
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { valid: false, error: "Please enter a valid email address." };
      }
      return { valid: true, email: normalizedEmail };
    }
    function validateCredentials({ email, password, requirePassword = true }) {
      const emailResult = validateEmail(email);
      if (!emailResult.valid) return emailResult;
      if (requirePassword && (typeof password !== "string" || password.length < 8)) {
        return { valid: false, error: "Password must be at least 8 characters long." };
      }
      return { valid: true, email: emailResult.email, password };
    }
    return { validateEmail, validateCredentials };
  })();
  const validation = window.AuthValidation || fallbackValidation;
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const status = document.getElementById("auth-status");
  const resendButton = document.getElementById("resend-confirmation");
  let confirmationEmail = "";
  const isNativeApp = () => Boolean(window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform());
  const confirmationRedirectUrl = () => {
    if (isNativeApp()) return window.PIQUEUEBALL_SUPABASE.nativeAuthRedirectUrl;
    const url = new URL("login.html", window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Open PiQueueBall through a web server before creating an account so email confirmation can return to the app.");
    }
    return url.toString();
  };
  const callbackUrl = new URL(window.location.href);
  const callbackParams = new URLSearchParams(callbackUrl.search);
  const callbackHash = new URLSearchParams(callbackUrl.hash.slice(1));
  const callbackError = callbackParams.get("error_description") ||
    callbackHash.get("error_description") ||
    callbackParams.get("error") ||
    callbackHash.get("error");

  function showError(error) {
    const message = error && error.message ? error.message : "Unable to complete that request. Please try again.";
    app.setError("auth", message);
    status.textContent = message;
  }

  async function landingPage(userId) {
    const { data: profile, error } = await app.getSupabase().from("profiles")
      .select("profile_setup_complete")
      .eq("id", userId)
      .single();
    if (error) {
      if (/column .* does not exist|schema cache/i.test(error.message || "")) {
        throw new Error("Run the updated supabase-setup.sql script to enable profile setup, then sign in again.");
      }
      throw error;
    }
    return profile.profile_setup_complete ? "home.html" : "profile-setup.html";
  }

  window.addEventListener("piqueueball:supabase-error", (event) => {
    status.textContent = event.detail;
  });
  window.addEventListener("piqueueball:auth-error", (event) => {
    status.textContent = event.detail;
  });
  if (app.getError("supabase")) status.textContent = app.getError("supabase");
  if (callbackError) status.textContent = callbackError;

  window.piqueueAuth.ready.then((session) => {
    if (session) return;
    if (callbackParams.get("email_confirmed") === "1" &&
        !callbackError && !app.getError("auth")) {
      status.textContent = "Email confirmed successfully. You can sign in now.";
    }
    if (loginForm) {
      loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = loginForm.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = "Signing in…";
        try {
          const credentials = validation.validateCredentials({
            email: document.getElementById("login-email").value,
            password: document.getElementById("login-password").value
          });
          if (!credentials.valid) {
            throw new Error(credentials.error);
          }
          if (!app.getSupabase()) {
            throw new Error("Supabase is unavailable. Continue offline or check your internet connection.");
          }
          const { data, error } = await app.getSupabase().auth.signInWithPassword({
            email: credentials.email,
            password: credentials.password
          });
          if (error) throw error;
          window.location.replace(await landingPage(data.user.id));
        } catch (error) {
          showError(error);
          button.disabled = false;
        }
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = signupForm.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = "Creating account…";
        try {
          if (isNativeApp() && !await window.piqueueballNativeAuthReady) {
            throw new Error("Android email callback setup failed. Please sync and rebuild the app, then try again.");
          }
          const credentials = validation.validateCredentials({
            email: document.getElementById("signup-email").value,
            password: document.getElementById("signup-password").value
          });
          if (!credentials.valid) {
            throw new Error(credentials.error);
          }
          if (!app.getSupabase()) {
            throw new Error("Supabase is unavailable. Continue offline or check your internet connection.");
          }
          const { data, error } = await app.getSupabase().auth.signUp({
            email: credentials.email,
            password: credentials.password,
            options: {
              emailRedirectTo: confirmationRedirectUrl()
            }
          });
          if (error) throw error;
          if (!data.session) {
            confirmationEmail = credentials.email;
            status.textContent = "Account created. Check your email to confirm it, then sign in. If it does not arrive, resend it.";
            resendButton.hidden = false;
            button.disabled = false;
            return;
          }
          window.location.replace("profile-setup.html");
        } catch (error) {
          showError(error);
          button.disabled = false;
        }
      });
    }
  }).catch(showError);

  if (resendButton) {
    resendButton.addEventListener("click", async () => {
      if (!confirmationEmail) {
        status.textContent = "Create an account first to request a confirmation email.";
        return;
      }
      resendButton.disabled = true;
      status.textContent = "Sending confirmation email…";
      try {
        if (isNativeApp() && !await window.piqueueballNativeAuthReady) {
          throw new Error("Android email callback setup failed. Please sync and rebuild the app, then try again.");
        }
        const emailResult = validation.validateEmail(confirmationEmail);
        if (!emailResult.valid) {
          throw new Error(emailResult.error);
        }
        const credentials = {
          valid: true,
          email: emailResult.email
        };
        if (!credentials.valid) {
          throw new Error(credentials.error);
        }
        const { error } = await app.getSupabase().auth.resend({
          type: "signup",
          email: credentials.email,
          options: { emailRedirectTo: confirmationRedirectUrl() }
        });
        if (error) throw error;
        status.textContent = "Confirmation email sent. Check your inbox and spam folder.";
      } catch (error) {
        showError(error);
      } finally {
        resendButton.disabled = false;
      }
    });
  }

  if (app.getError("auth")) status.textContent = app.getError("auth");
}());
