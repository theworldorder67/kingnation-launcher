const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const crypto = require('node:crypto');

const { withRetry, downloadFileAtomic, checkFreeSpace, mapWithConcurrency, verifyMavenSha256 } = require('../src/main/download');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kn-download-test-'));
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/* ===== withRetry: download resilience ===== */

test('withRetry returns on first success without retrying', async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls += 1; return 'ok'; }, { attempts: 3, baseDelayMs: 1 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 1);
});

test('withRetry retries then succeeds', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error('flaky');
    return 'ok';
  }, { attempts: 3, baseDelayMs: 1 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 3);
});

test('withRetry throws the last error after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw new Error(`fail ${calls}`); }, { attempts: 3, baseDelayMs: 1 }),
    /fail 3/
  );
  assert.strictEqual(calls, 3);
});

/* ===== downloadFileAtomic: no partial file may ever land on `dest` ===== */

test('downloadFileAtomic writes the full file and cleans up the .part', async (t) => {
  const tmpDir = makeTmpDir();
  const payload = 'hello kingnation';
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': String(Buffer.byteLength(payload)) });
    res.end(payload);
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const dest = path.join(tmpDir, 'file.jar');
  const url = `http://127.0.0.1:${server.address().port}/file.jar`;
  await downloadFileAtomic(url, dest, null, { attempts: 1 });

  assert.strictEqual(fs.readFileSync(dest, 'utf8'), payload);
  assert.ok(!fs.existsSync(`${dest}.part`));
});

test('downloadFileAtomic reports progress', async (t) => {
  const tmpDir = makeTmpDir();
  const payload = Buffer.alloc(4096, 'a');
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': String(payload.length) });
    res.end(payload);
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const dest = path.join(tmpDir, 'file.bin');
  const url = `http://127.0.0.1:${server.address().port}/file.bin`;
  let lastDownloaded = 0;
  let lastTotal = 0;
  await downloadFileAtomic(url, dest, (downloaded, total) => {
    lastDownloaded = downloaded;
    lastTotal = total;
  }, { attempts: 1 });

  assert.strictEqual(lastDownloaded, payload.length);
  assert.strictEqual(lastTotal, payload.length);
});

test('downloadFileAtomic rejects on a mid-stream connection drop and leaves no file behind', async (t) => {
  const tmpDir = makeTmpDir();
  const server = await startServer((req, res) => {
    // Announce more bytes than we send, then kill the socket: simulates a
    // network drop in the middle of a download.
    res.writeHead(200, { 'Content-Length': '100000' });
    res.write('only-a-few-bytes');
    setTimeout(() => res.destroy(), 10);
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const dest = path.join(tmpDir, 'file.jar');
  const url = `http://127.0.0.1:${server.address().port}/file.jar`;
  await assert.rejects(() => downloadFileAtomic(url, dest, null, { attempts: 2, baseDelayMs: 5 }));

  assert.ok(!fs.existsSync(dest), 'dest must not exist after a failed download');
  assert.ok(!fs.existsSync(`${dest}.part`), 'the .part file must be cleaned up');
});

test('downloadFileAtomic recovers when a retry succeeds after a dropped attempt', async (t) => {
  const tmpDir = makeTmpDir();
  const payload = 'complete content after retry';
  let calls = 0;
  const server = await startServer((req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(200, { 'Content-Length': '100000' });
      res.write('partial');
      setTimeout(() => res.destroy(), 10);
      return;
    }
    res.writeHead(200, { 'Content-Length': String(Buffer.byteLength(payload)) });
    res.end(payload);
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const dest = path.join(tmpDir, 'file.jar');
  const url = `http://127.0.0.1:${server.address().port}/file.jar`;
  await downloadFileAtomic(url, dest, null, { attempts: 3, baseDelayMs: 5 });

  assert.strictEqual(calls, 2);
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), payload);
  assert.ok(!fs.existsSync(`${dest}.part`));
});

test('downloadFileAtomic rejects on an HTTP error status without creating dest', async (t) => {
  const tmpDir = makeTmpDir();
  const server = await startServer((req, res) => {
    res.writeHead(404);
    res.end('not found');
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const dest = path.join(tmpDir, 'file.jar');
  const url = `http://127.0.0.1:${server.address().port}/file.jar`;
  await assert.rejects(() => downloadFileAtomic(url, dest, null, { attempts: 1 }));

  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(`${dest}.part`));
});

/* ===== mapWithConcurrency: parallel mod downloads ===== */

test('mapWithConcurrency never exceeds the limit and keeps result order', async () => {
  let active = 0;
  let maxActive = 0;
  const items = [5, 1, 4, 2, 3, 6, 0, 7];

  const results = await mapWithConcurrency(items, 3, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    // Varying delays force out-of-order completion.
    await new Promise((resolve) => setTimeout(resolve, item * 3));
    active -= 1;
    return item * 10;
  });

  assert.ok(maxActive <= 3, `expected at most 3 concurrent tasks, saw ${maxActive}`);
  assert.ok(maxActive > 1, 'tasks should actually run in parallel');
  assert.deepStrictEqual(results, items.map((i) => i * 10));
});

test('mapWithConcurrency rethrows the first error and stops scheduling new tasks', async () => {
  const started = [];
  await assert.rejects(
    () => mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (item === 2) throw new Error('boom on 2');
    }),
    /boom on 2/
  );
  assert.ok(started.length < 8, `scheduling should stop after the failure, saw ${started.length} starts`);
});

test('mapWithConcurrency handles an empty list', async () => {
  const results = await mapWithConcurrency([], 4, async () => { throw new Error('never called'); });
  assert.deepStrictEqual(results, []);
});

/* ===== verifyMavenSha256 ===== */

test('verifyMavenSha256 accepts a matching checksum (maven "<hash>  <file>" format)', async (t) => {
  const tmpDir = makeTmpDir();
  const payload = 'jar-bytes';
  const filePath = path.join(tmpDir, 'lib.jar');
  fs.writeFileSync(filePath, payload);
  const goodHash = crypto.createHash('sha256').update(payload).digest('hex');

  const server = await startServer((req, res) => {
    assert.strictEqual(req.url, '/lib.jar.sha256');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`${goodHash}  lib.jar`);
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const ok = await verifyMavenSha256(`http://127.0.0.1:${server.address().port}/lib.jar`, filePath);
  assert.strictEqual(ok, true);
  assert.ok(fs.existsSync(filePath));
});

test('verifyMavenSha256 deletes the file and throws on a checksum mismatch', async (t) => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'lib.jar');
  fs.writeFileSync(filePath, 'tampered-bytes');

  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('a'.repeat(64));
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await assert.rejects(
    () => verifyMavenSha256(`http://127.0.0.1:${server.address().port}/lib.jar`, filePath),
    /SHA-256 invalide/
  );
  assert.ok(!fs.existsSync(filePath), 'a corrupt file must be deleted');
});

test('verifyMavenSha256 keeps the file when the checksum is unavailable', async (t) => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'lib.jar');
  fs.writeFileSync(filePath, 'jar-bytes');

  const server = await startServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const ok = await verifyMavenSha256(`http://127.0.0.1:${server.address().port}/lib.jar`, filePath);
  assert.strictEqual(ok, false);
  assert.ok(fs.existsSync(filePath), 'the file must be kept when no checksum is published');
});

/* ===== checkFreeSpace ===== */

test('checkFreeSpace passes when enough space is available', async () => {
  await checkFreeSpace(os.tmpdir(), 1);
});

test('checkFreeSpace throws when the requirement cannot be met', async () => {
  // ~954 To required: no machine running this suite has that much free.
  await assert.rejects(
    () => checkFreeSpace(os.tmpdir(), 1e9),
    /Espace disque insuffisant/
  );
});

test('checkFreeSpace creates a missing directory instead of failing', async (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const nested = path.join(tmpDir, 'does', 'not', 'exist');
  await checkFreeSpace(nested, 1);
  assert.ok(fs.existsSync(nested));
});
