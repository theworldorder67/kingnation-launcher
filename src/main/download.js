const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const USER_AGENT = 'KingNationLauncher/1.0';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry an async operation a few times with linear backoff. Makes downloads
// resilient to transient network failures (flaky Wi-Fi, brief drops).
async function withRetry(fn, { attempts = 3, baseDelayMs = 1500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await delay(attempt * baseDelayMs);
    }
  }
  throw lastError;
}

function downloadFileOnce(url, dest, onProgress) {
  return axios
    .get(url, {
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
      headers: { 'User-Agent': USER_AGENT }
    })
    .then((response) => {
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(dest);
        let failure = null;
        let finished = false;

        const fail = (err) => {
          if (failure) return;
          failure = err;
          response.data.destroy();
          writer.destroy();
        };

        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total && onProgress) onProgress(downloaded, total);
        });
        response.data.on('error', fail);
        writer.on('error', fail);
        writer.on('finish', () => { finished = true; });
        // Settle only on 'close', once the file descriptor is released —
        // Windows keeps an open file locked, which would make the retry's
        // truncate/rename or the cleanup unlink fail with EPERM.
        writer.on('close', () => {
          if (failure) reject(failure);
          else if (finished) resolve(response.headers);
          else reject(new Error('Téléchargement interrompu avant la fin.'));
        });
        response.data.pipe(writer);
      });
    });
}

// createWriteStream truncates `dest` on each attempt, so a retry cleanly
// overwrites any partial file left by a failed attempt.
function downloadFile(url, dest, onProgress, retryOptions) {
  return withRetry(() => downloadFileOnce(url, dest, onProgress), retryOptions);
}

// Downloads to `dest + '.part'` then renames, so `dest` either does not exist
// or is a fully downloaded file — callers that skip the download when the
// file already exists can never pick up a half-written one.
async function downloadFileAtomic(url, dest, onProgress, retryOptions) {
  const partPath = `${dest}.part`;
  try {
    const headers = await downloadFile(url, partPath, onProgress, retryOptions);
    fs.renameSync(partPath, dest);
    return headers;
  } finally {
    if (fs.existsSync(partPath)) {
      try { fs.unlinkSync(partPath); } catch {}
    }
  }
}

// Best-effort: if statfs is unavailable the check is skipped rather than
// blocking the download; only a confirmed lack of space throws.
async function checkFreeSpace(dirPath, requiredMB = 3000) {
  let freeBytes;
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    const st = await fsPromises.statfs(dirPath);
    freeBytes = st.bavail * st.bsize;
  } catch {
    return;
  }
  const requiredBytes = requiredMB * 1024 * 1024;
  if (freeBytes < requiredBytes) {
    const freeMB = Math.floor(freeBytes / (1024 * 1024));
    throw new Error(`Espace disque insuffisant. Vous avez besoin d'au moins ${requiredMB} Mo libres (actuellement ${freeMB} Mo).`);
  }
}

// Run `worker` over `items` with at most `limit` tasks in flight. Results
// keep the order of `items`; the first error stops new tasks from starting
// and is rethrown once the in-flight ones have settled.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  if (items.length === 0) return results;

  let nextIndex = 0;
  let firstError = null;

  async function run() {
    while (nextIndex < items.length && !firstError) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
  }

  const runners = [];
  const count = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < count; i += 1) runners.push(run());
  await Promise.all(runners);

  if (firstError) throw firstError;
  return results;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Maven repositories publish a `<artifact>.sha256` next to each artifact.
// Best-effort: when the checksum cannot be fetched the download is kept
// as-is (returns false); a confirmed mismatch deletes the file and throws.
async function verifyMavenSha256(url, filePath) {
  let expected;
  try {
    const { data } = await axios.get(`${url}.sha256`, {
      timeout: 15000,
      responseType: 'text',
      headers: { 'User-Agent': USER_AGENT }
    });
    expected = String(data).trim().split(/\s+/)[0].toLowerCase();
  } catch {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;

  const actual = await sha256File(filePath);
  if (actual !== expected) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(`Somme de contrôle SHA-256 invalide pour ${path.basename(filePath)} — fichier supprimé, relancez le téléchargement.`);
  }
  return true;
}

module.exports = {
  USER_AGENT,
  delay,
  withRetry,
  downloadFile,
  downloadFileAtomic,
  checkFreeSpace,
  mapWithConcurrency,
  verifyMavenSha256
};
