const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeManifestPath, normalizeDropbox, normalizeHash } = require('../src/main/updater');

/* ===== normalizeManifestPath: the zip-slip / path-traversal guard ===== */

test('normalizeManifestPath maps a bare .jar into mods/', () => {
  assert.strictEqual(normalizeManifestPath('cool-mod.jar'), 'mods/cool-mod.jar');
});

test('normalizeManifestPath keeps an explicit sub-path', () => {
  assert.strictEqual(normalizeManifestPath('config/options.txt'), 'config/options.txt');
});

test('normalizeManifestPath normalizes backslashes to forward slashes', () => {
  assert.strictEqual(normalizeManifestPath('mods\\sub\\a.jar'), 'mods/sub/a.jar');
});

test('normalizeManifestPath rejects parent-directory traversal', () => {
  assert.throws(() => normalizeManifestPath('../evil.jar'));
  assert.throws(() => normalizeManifestPath('mods/../../etc/passwd'));
});

test('normalizeManifestPath rejects null bytes', () => {
  const withNullByte = 'mods/a' + String.fromCharCode(0) + '.jar';
  assert.throws(() => normalizeManifestPath(withNullByte));
});

test('normalizeManifestPath rejects empty input', () => {
  assert.throws(() => normalizeManifestPath('   '));
});

test('normalizeManifestPath rejects Windows absolute paths', { skip: process.platform !== 'win32' }, () => {
  assert.throws(() => normalizeManifestPath('C:\\Windows\\system32\\evil.jar'));
});

/* ===== normalizeDropbox ===== */

test('normalizeDropbox forces dl=1 on dropbox links', () => {
  assert.match(normalizeDropbox('https://www.dropbox.com/s/abc/pack.zip?dl=0'), /[?&]dl=1\b/);
  assert.match(normalizeDropbox('https://www.dropbox.com/s/abc/pack.zip'), /[?&]dl=1\b/);
});

test('normalizeDropbox leaves an empty value empty', () => {
  assert.strictEqual(normalizeDropbox(''), '');
});

/* ===== normalizeHash ===== */

test('normalizeHash trims and lowercases', () => {
  assert.strictEqual(normalizeHash('  ABCdef123  '), 'abcdef123');
});

test('normalizeHash coerces nullish to empty string', () => {
  assert.strictEqual(normalizeHash(null), '');
  assert.strictEqual(normalizeHash(undefined), '');
});
