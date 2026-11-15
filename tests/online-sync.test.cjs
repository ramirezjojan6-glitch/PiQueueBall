"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "online-sync.js"), "utf8");

function createSyncHarness(rpc) {
  const storage = new Map();
  const listeners = new Map();
  const status = { textContent: "" };
  const navigator = { onLine: false };
  const window = {
    piqueueSupabase: {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: "user-1" } } },
          error: null
        })
      },
      rpc
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    dispatchEvent: () => true
  };
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const document = {
    getElementById: (id) => ["tracker-status", "score-status", "queue-status", "profile-status"].includes(id)
      ? status
      : null
  };
  const sessionStorage = {
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value))
  };
  const state = {
    results: [{
      queueId: "queue-1",
      completedAt: "2026-11-15T00:00:00.000Z",
      mode: "singles",
      teams: [
        [{ id: "player-1", userId: "user-1", name: "Player 1" }],
        [{ id: "player-2", name: "Player 2" }]
      ],
      scores: [11, 8],
      syncOwnerId: "user-1",
      syncStatus: "pending"
    }],
    queueHistory: []
  };
  localStorage.setItem("piqueueball.queue.v1", JSON.stringify(state));

  vm.runInNewContext(source, {
    window,
    navigator,
    document,
    localStorage,
    sessionStorage,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    setTimeout: (callback) => {
      callback();
      return 0;
    }
  });

  return {
    window,
    navigator,
    localStorage,
    status,
    async synchronize() {
      navigator.onLine = true;
      await window.piqueueSyncLocalMatches();
    },
    readState() {
      return JSON.parse(localStorage.getItem("piqueueball.queue.v1"));
    }
  };
}

test("failed match sync retries then remains pending with a visible error", async () => {
  let attempts = 0;
  const harness = createSyncHarness(async () => {
    attempts += 1;
    return { error: new Error("network unavailable") };
  });

  await harness.synchronize();

  const result = harness.readState().results[0];
  assert.equal(attempts, 4);
  assert.equal(result.syncStatus, "pending");
  assert.equal(result.syncError, "network unavailable");
  assert.match(harness.status.textContent, /could not sync/);
});

test("a successful retry marks the match synced and clears its previous error", async () => {
  let attempts = 0;
  const harness = createSyncHarness(async () => {
    attempts += 1;
    return attempts === 1
      ? { error: new Error("temporary network failure") }
      : { error: null };
  });

  await harness.synchronize();

  const result = harness.readState().results[0];
  assert.equal(attempts, 2);
  assert.equal(result.syncStatus, "synced");
  assert.equal("syncError" in result, false);
});
