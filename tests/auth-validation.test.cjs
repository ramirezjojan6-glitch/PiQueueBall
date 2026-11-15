"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateEmail, validateCredentials } = require("../auth-validation.js");

test("validateEmail accepts correctly formatted addresses and ignores surrounding whitespace", () => {
  const result = validateEmail("  USER+TEST@Example.com  ");

  assert.equal(result.valid, true);
  assert.equal(result.email, "user+test@example.com");
});

test("validateEmail rejects malformed addresses", () => {
  assert.deepEqual(validateEmail("not-an-email"), {
    valid: false,
    error: "Please enter a valid email address."
  });
});

test("validateCredentials rejects short passwords and normalizes the email", () => {
  const valid = validateCredentials({ email: "USER@Example.com", password: "supersecure" });
  const invalid = validateCredentials({ email: "USER@Example.com", password: "short" });

  assert.deepEqual(valid, {
    valid: true,
    email: "user@example.com",
    password: "supersecure"
  });
  assert.deepEqual(invalid, {
    valid: false,
    error: "Password must be at least 8 characters long."
  });
});
