"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");

test("offline cache version advances with app screen changes", () => {
  assert.match(source, /const CACHE_NAME = "piqueueball-offline-v23";/);
});

test("offline precache includes shared app and queue view scripts", async () => {
  const listeners = new Map();
  let cachedFiles = [];
  const self = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() }
  };
  const caches = {
    open: async () => ({
      addAll: async (files) => {
        cachedFiles = files;
      }
    })
  };

  vm.runInNewContext(source, { self, caches, Promise, URL });
  let installTask;
  listeners.get("install")({
    waitUntil: (promise) => {
      installTask = promise;
    }
  });
  await installTask;

  assert.ok(cachedFiles.includes("./app-state.js"));
  assert.ok(cachedFiles.includes("./auth-validation.js"));
  assert.ok(cachedFiles.includes("./queue-view-utils.js"));
  assert.ok(cachedFiles.includes("./assets/pickleball-court.png"));
});
