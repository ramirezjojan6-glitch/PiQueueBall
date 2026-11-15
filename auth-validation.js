(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AuthValidation = api;
  if (typeof window !== "undefined") window.AuthValidation = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isValidEmail(value) {
    const email = normalizeEmail(value);
    return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validateEmail(value) {
    const normalizedEmail = normalizeEmail(value);
    if (!isValidEmail(normalizedEmail)) {
      return {
        valid: false,
        error: "Please enter a valid email address."
      };
    }
    return {
      valid: true,
      email: normalizedEmail
    };
  }

  function validateCredentials({ email, password, requirePassword = true }) {
    const emailResult = validateEmail(email);
    if (!emailResult.valid) {
      return emailResult;
    }
    if (requirePassword && (typeof password !== "string" || password.length < 8)) {
      return {
        valid: false,
        error: "Password must be at least 8 characters long."
      };
    }
    return {
      valid: true,
      email: emailResult.email,
      password
    };
  }

  return {
    normalizeEmail,
    isValidEmail,
    validateEmail,
    validateCredentials
  };
}));
