const { test } = require('node:test');
const assert = require('node:assert');

// Loading the module must not connect to Discord (init() is never called here),
// so this is a safe, deterministic guard for the @xhayper/discord-rpc migration.
const discord = require('../src/main/discord');

test('discord module exports the expected public API', () => {
  for (const name of ['init', 'showLauncherActivity', 'showGameActivity', 'shutdown']) {
    assert.strictEqual(typeof discord[name], 'function', `${name} should be a function`);
  }
});

test('the migrated @xhayper/discord-rpc package loads and exposes Client', () => {
  const { Client } = require('@xhayper/discord-rpc');
  assert.strictEqual(typeof Client, 'function');
});
