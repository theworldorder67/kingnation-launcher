const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const extractZip = require('extract-zip');
const { getGameDirectory } = require('./launcher');
const { USER_AGENT, downloadFile, checkFreeSpace, mapWithConcurrency } = require('./download');

// Up to 4 mods download in parallel: enough to hide per-request latency
// without saturating home connections or the file host.
const DOWNLOAD_CONCURRENCY = 4;

let yauzl = null;
try {
  yauzl = require('yauzl');
} catch {
  yauzl = null;
}

const GIST_ID = process.env.KINGNATION_GIST_ID || '9aa83015464131b96cd1b02a076cca22';
const GIST_FILE = 'kingnation-config.json';
const MANAGED_LAUNCHER_MODS = new Set([
  'kingnation-menu-1.0.0.jar'
]);

let cachedConfig = null;

async function fetchServerConfig() {
  try {
    const url = `https://api.github.com/gists/${GIST_ID}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000
    });

    const file = data.files[GIST_FILE] || Object.values(data.files)[0];
    if (!file) throw new Error('Fichier de configuration introuvable dans le Gist');

    const config = JSON.parse(file.content);

    // Dynamic separate news Gist fetching
    if (config.newsGistId) {
      try {
        const isUrl = String(config.newsGistId).startsWith('http');
        const newsUrl = isUrl 
          ? config.newsGistId 
          : `https://api.github.com/gists/${config.newsGistId}`;

        const newsRes = await axios.get(newsUrl, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 8000
        });

        let rawContent = '';
        if (isUrl) {
          rawContent = typeof newsRes.data === 'string' ? newsRes.data : JSON.stringify(newsRes.data);
        } else {
          const newsFile = Object.values(newsRes.data.files)[0];
          if (newsFile) rawContent = newsFile.content;
        }

        if (rawContent) {
          // Strip // comments safely, ignoring URLs inside quotes
          const cleanContent = rawContent.replace(/("[^"\\]*(?:\\.[^"\\]*)*")|\/\/.*$/gm, (m, str) => {
            return str !== undefined ? str : '';
          });

          const newsData = JSON.parse(cleanContent);
          if (Array.isArray(newsData)) {
            config.news = newsData;
          } else if (newsData && Array.isArray(newsData.news)) {
            config.news = newsData.news;
          }
        }
      } catch (newsErr) {
        console.error('Erreur de chargement du fil d\'actualité :', newsErr.message);
        config.news = [];
      }
    }

    cachedConfig = config;
    return config;
  } catch (err) {
    if (cachedConfig) return cachedConfig;
    throw new Error(`Impossible de charger la configuration : ${err.message}`);
  }
}

function getModsDirectory() {
  const dir = path.join(getGameDirectory(), 'mods');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getVersionFile() {
  return path.join(getGameDirectory(), '.modpack-version');
}

function getLocalManifestFile() {
  return path.join(getGameDirectory(), '.modpack-manifest.json');
}

function getDownloadDirectory() {
  const dir = path.join(getGameDirectory(), '.downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readLocalId() {
  try {
    return fs.readFileSync(getVersionFile(), 'utf8').trim();
  } catch {
    return null;
  }
}

function writeLocalId(id) {
  fs.writeFileSync(getVersionFile(), String(id));
}

function readLocalManifest() {
  try {
    return JSON.parse(fs.readFileSync(getLocalManifestFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeLocalManifest(manifest) {
  fs.writeFileSync(getLocalManifestFile(), JSON.stringify(manifest, null, 2));
}

function normalizeDropbox(url) {
  const value = String(url || '').trim();
  if (!value) return value;

  try {
    const parsed = new URL(value);
    if (parsed.hostname.endsWith('dropbox.com')) {
      parsed.searchParams.set('dl', '1');
      return parsed.toString();
    }
  } catch {
    /* fallback below */
  }

  if (/[?&]dl=0\b/.test(value)) return value.replace(/([?&])dl=0\b/, '$1dl=1');
  if (/[?&]dl=1\b/.test(value)) return value;
  return `${value}${value.includes('?') ? '&' : '?'}dl=1`;
}

function assertInsideGameDirectory(targetPath) {
  const root = path.resolve(getGameDirectory());
  const resolved = path.resolve(targetPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Chemin modpack non autorise : ${resolved}`);
  }
}

function safeUnlink(filePath) {
  try {
    assertInsideGameDirectory(filePath);
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

function safeRm(targetPath) {
  assertInsideGameDirectory(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function emptyDirectory(dir) {
  assertInsideGameDirectory(dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const item of fs.readdirSync(dir)) {
    const lower = item.toLowerCase();
    if (lower.startsWith('forgematica') || lower.startsWith('mafglib')) {
      continue;
    }
    safeRm(path.join(dir, item));
  }
}

function copyDirectoryContents(sourceDir, destinationDir) {
  assertInsideGameDirectory(sourceDir);
  assertInsideGameDirectory(destinationDir);
  if (!fs.existsSync(destinationDir)) fs.mkdirSync(destinationDir, { recursive: true });

  for (const item of fs.readdirSync(sourceDir)) {
    fs.cpSync(path.join(sourceDir, item), path.join(destinationDir, item), { recursive: true });
  }
}

function isZipFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const signature = Buffer.alloc(4);
    fs.readSync(fd, signature, 0, 4, 0);
    fs.closeSync(fd);

    return (
      signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      signature.equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
      signature.equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
    );
  } catch {
    return false;
  }
}

function invalidZipMessage(filePath, headers = {}) {
  const type = String(headers['content-type'] || '').toLowerCase();
  let preview = '';
  try {
    preview = fs.readFileSync(filePath).subarray(0, 120).toString('utf8').trim();
  } catch {
    /* ignore */
  }

  if (type.includes('text/html') || preview.startsWith('<!DOCTYPE') || preview.startsWith('<html')) {
    return 'Le lien modpack telecharge une page web au lieu du ZIP. Verifie modpackUrl dans le Gist : il doit pointer vers un fichier .zip direct, par exemple un lien Dropbox avec dl=1.';
  }

  return 'Le modpack telecharge n est pas un ZIP valide. Verifie que le fichier Dropbox est bien un .zip complet et accessible publiquement.';
}

function directJarFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.toLowerCase().endsWith('.jar'))
      .map((file) => path.join(dir, file));
  } catch {
    return [];
  }
}

function directJarCount(dir) {
  return directJarFiles(dir)
    .filter((file) => !MANAGED_LAUNCHER_MODS.has(path.basename(file).toLowerCase()))
    .length;
}

function getExtractedModsSource(stagingDir) {
  const nestedModsDir = path.join(stagingDir, 'mods');
  if (fs.existsSync(nestedModsDir) && fs.statSync(nestedModsDir).isDirectory()) {
    return nestedModsDir;
  }
  return stagingDir;
}

function normalizeManifestPath(input) {
  let value = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!value) throw new Error('Chemin vide dans le manifest modpack');
  if (value.includes('\0') || value.split('/').includes('..') || path.isAbsolute(value)) {
    throw new Error(`Chemin refuse dans le manifest modpack : ${value}`);
  }

  if (!value.includes('/') && value.toLowerCase().endsWith('.jar')) {
    value = `mods/${value}`;
  }

  return value;
}

function resolveGameRelativePath(relativePath) {
  const normalized = normalizeManifestPath(relativePath);
  const target = path.join(getGameDirectory(), ...normalized.split('/'));
  assertInsideGameDirectory(target);
  return target;
}

function relativeGamePath(filePath) {
  return path.relative(getGameDirectory(), filePath).replace(/\\/g, '/');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function normalizeHash(value) {
  return String(value || '').trim().toLowerCase();
}

function fileMatchesManifestEntry(filePath, entry) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (Number.isFinite(entry.size) && entry.size > 0 && stat.size !== entry.size) return false;
  if (entry.sha256 && sha256File(filePath) !== entry.sha256) return false;
  return true;
}

function manifestFileSet(manifest) {
  return new Set((manifest.files || []).map((file) => normalizeManifestPath(file.path).toLowerCase()));
}

function normalizeManifest(rawManifest, sourceUrl) {
  const raw = typeof rawManifest === 'string' ? JSON.parse(rawManifest) : rawManifest;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Manifest modpack invalide');
  }

  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  if (!rawFiles.length) {
    throw new Error('Manifest modpack vide : aucun fichier a installer');
  }

  const files = rawFiles.map((file) => {
    const targetPath = normalizeManifestPath(file.path || file.target || file.name || file.file);
    const downloadUrl = normalizeDropbox(file.url || file.downloadUrl || file.href);
    if (!downloadUrl) {
      throw new Error(`Manifest incomplet : ${targetPath} n a pas d URL de telechargement`);
    }

    const size = Number(file.size || file.bytes || 0);
    return {
      path: targetPath,
      url: downloadUrl,
      sha256: normalizeHash(file.sha256 || file.hash || file.checksum),
      size: Number.isFinite(size) && size > 0 ? size : null
    };
  });

  return {
    version: String(raw.version || raw.id || raw.name || 'manifest'),
    sourceUrl,
    files
  };
}

async function fetchRemoteManifest(config) {
  const manifestUrl = config.modpackManifestUrl || config.manifestUrl || config.modManifestUrl;
  if (!manifestUrl) return null;

  const url = normalizeDropbox(manifestUrl);
  const response = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: { 'User-Agent': USER_AGENT },
    responseType: 'text',
    transformResponse: [(data) => data]
  });

  return normalizeManifest(response.data, url);
}

async function getRemoteModpackId(url) {
  const headers = { 'User-Agent': USER_AGENT };

  try {
    const r = await axios.head(url, {
      headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400
    });
    const etag = (r.headers.etag || '').replace(/"/g, '');
    const size = r.headers['content-length'] || '';
    if (etag || size) return `${etag}|${size}`;
  } catch {
    /* HEAD unsupported, fallback to Range. */
  }

  const r = await axios.get(url, {
    headers: { ...headers, Range: 'bytes=0-0' },
    timeout: 15000,
    maxRedirects: 5,
    responseType: 'arraybuffer',
    validateStatus: (s) => s < 400
  });
  const etag = (r.headers.etag || '').replace(/"/g, '');
  const range = r.headers['content-range'] || '';
  const size = range.split('/').pop() || r.headers['content-length'] || '';
  return `${etag}|${size}`;
}

async function verifyManifest(manifest) {
  const missing = [];
  const outdated = [];
  const installed = [];

  for (const entry of manifest.files) {
    const target = resolveGameRelativePath(entry.path);
    if (!fs.existsSync(target)) {
      missing.push(entry.path);
      continue;
    }

    if (!fileMatchesManifestEntry(target, entry)) {
      outdated.push(entry.path);
      continue;
    }

    installed.push(entry.path);
  }

  const extras = listExtraMods(manifest);
  const duplicates = await scanDuplicateMods(getModsDirectory());

  return {
    missing,
    outdated,
    installed,
    extras,
    duplicates,
    upToDate: missing.length === 0 && outdated.length === 0 && extras.length === 0 && duplicates.length === 0
  };
}

async function checkMods() {
  const config = await fetchServerConfig();
  const manifest = await fetchRemoteManifest(config);

  if (manifest) {
    const verification = await verifyManifest(manifest);
    return {
      manifest: true,
      manifestVersion: manifest.version,
      upToDate: verification.upToDate,
      total: directJarCount(getModsDirectory()),
      need: verification.missing.length + verification.outdated.length + verification.extras.length + verification.duplicates.length,
      hasModpack: true,
      missing: verification.missing.length,
      outdated: verification.outdated.length,
      extra: verification.extras.length,
      duplicateGroups: verification.duplicates.length
    };
  }

  if (!config.modpackUrl) {
    const duplicates = await scanDuplicateMods(getModsDirectory());
    return {
      upToDate: duplicates.length === 0,
      total: directJarCount(getModsDirectory()),
      need: duplicates.length,
      hasModpack: false,
      duplicateGroups: duplicates.length
    };
  }

  const url = normalizeDropbox(config.modpackUrl);
  let remoteId = null;
  try {
    remoteId = await getRemoteModpackId(url);
  } catch {
    /* Offline: local install can still be used. */
  }

  const localId = readLocalId();
  const modsDir = getModsDirectory();
  const installedCount = directJarCount(modsDir);
  const duplicates = await scanDuplicateMods(modsDir);
  const upToDate = remoteId
    ? localId === remoteId && installedCount > 0 && duplicates.length === 0
    : installedCount > 0 && duplicates.length === 0;

  return {
    remoteId,
    localId,
    upToDate,
    total: installedCount,
    need: upToDate ? 0 : 1,
    hasModpack: true,
    duplicateGroups: duplicates.length
  };
}

function listExtraMods(manifest) {
  const allowed = manifestFileSet(manifest);
  const extras = [];

  for (const jarPath of directJarFiles(getModsDirectory())) {
    const baseName = path.basename(jarPath).toLowerCase();
    if (MANAGED_LAUNCHER_MODS.has(baseName)) continue;
    if (baseName.startsWith('forgematica') || baseName.startsWith('mafglib')) continue;

    const rel = relativeGamePath(jarPath).toLowerCase();
    if (!allowed.has(rel)) extras.push(jarPath);
  }

  return extras;
}

function removeExtraMods(manifest) {
  const extras = listExtraMods(manifest);
  for (const filePath of extras) safeUnlink(filePath);
  return extras.map((filePath) => path.basename(filePath));
}

function compareVersionish(a, b) {
  const aNums = path.basename(a).match(/\d+/g)?.map(Number) || [];
  const bNums = path.basename(b).match(/\d+/g)?.map(Number) || [];
  const length = Math.max(aNums.length, bNums.length);

  for (let i = 0; i < length; i += 1) {
    const av = aNums[i] || 0;
    const bv = bNums[i] || 0;
    if (av !== bv) return av - bv;
  }

  return path.basename(a).localeCompare(path.basename(b));
}

function fallbackModIdentity(fileName) {
  return path.basename(fileName, '.jar')
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/[-_]?mc?\d+(\.\d+){1,3}.*$/, '')
    .replace(/[-_](neoforge|forge|fabric).*$/, '')
    .replace(/[-_]?v?\d+(\.\d+){1,5}.*$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || path.basename(fileName, '.jar').toLowerCase();
}

function readZipEntryTexts(zipPath, wantedEntries) {
  if (!yauzl) return Promise.resolve({});

  return new Promise((resolve) => {
    const results = {};
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr || !zipfile) {
        resolve(results);
        return;
      }

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (!wantedEntries.includes(entry.fileName)) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            zipfile.readEntry();
            return;
          }

          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            results[entry.fileName] = Buffer.concat(chunks).toString('utf8');
            zipfile.readEntry();
          });
          stream.on('error', () => zipfile.readEntry());
        });
      });

      zipfile.on('end', () => resolve(results));
      zipfile.on('error', () => resolve(results));
    });
  });
}

function parseModIdsFromMetadata(text) {
  const ids = [];
  const modIdPattern = /\bmodId\s*=\s*["']([^"']+)["']/g;
  const fabricIdPattern = /"id"\s*:\s*"([^"]+)"/g;
  let match;

  while ((match = modIdPattern.exec(text))) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }

  while ((match = fabricIdPattern.exec(text))) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }

  return ids;
}

async function readJarModIds(filePath) {
  const texts = await readZipEntryTexts(filePath, [
    'META-INF/neoforge.mods.toml',
    'META-INF/mods.toml',
    'fabric.mod.json',
    'quilt.mod.json'
  ]);

  const ids = [];
  for (const text of Object.values(texts)) {
    for (const id of parseModIdsFromMetadata(text)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }

  return ids.length ? ids : [fallbackModIdentity(filePath)];
}

async function scanDuplicateMods(modsDir = getModsDirectory()) {
  const groups = new Map();

  for (const filePath of directJarFiles(modsDir)) {
    const baseName = path.basename(filePath).toLowerCase();
    if (MANAGED_LAUNCHER_MODS.has(baseName)) continue;

    const ids = await readJarModIds(filePath);
    const id = ids[0] || fallbackModIdentity(filePath);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(filePath);
  }

  return [...groups.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([modId, files]) => ({
      modId,
      files: files.map((file) => path.basename(file))
    }));
}

async function dedupeMods(modsDir = getModsDirectory()) {
  const duplicateGroups = await scanDuplicateMods(modsDir);
  const removed = [];

  for (const group of duplicateGroups) {
    const fullPaths = group.files.map((file) => path.join(modsDir, file));
    fullPaths.sort(compareVersionish);
    const keep = fullPaths[fullPaths.length - 1];

    for (const filePath of fullPaths) {
      if (filePath === keep) continue;
      safeUnlink(filePath);
      removed.push({
        modId: group.modId,
        file: path.basename(filePath),
        kept: path.basename(keep)
      });
    }
  }

  return removed;
}

function buildInstalledManifest(source, id = null) {
  const files = directJarFiles(getModsDirectory())
    .filter((filePath) => !MANAGED_LAUNCHER_MODS.has(path.basename(filePath).toLowerCase()))
    .map((filePath) => ({
      path: relativeGamePath(filePath),
      size: fs.statSync(filePath).size,
      sha256: sha256File(filePath)
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    source,
    id,
    generatedAt: new Date().toISOString(),
    files
  };
}

async function updateFromManifest(manifest, onProgress) {
  const verification = await verifyManifest(manifest);
  const toInstall = manifest.files.filter((file) => (
    verification.missing.includes(file.path) || verification.outdated.includes(file.path)
  ));

  let completed = 0;
  const totalFiles = Math.max(1, toInstall.length);
  const inFlightProgress = new Map();

  onProgress?.({ phase: 'verifying', percent: 5, current: 0, total: totalFiles });

  const reportProgress = (fileName) => {
    let inFlight = 0;
    for (const fraction of inFlightProgress.values()) inFlight += fraction;
    onProgress?.({
      phase: 'downloading',
      file: fileName,
      current: Math.min(completed + 1, totalFiles),
      total: totalFiles,
      percent: Math.round(Math.min((completed + inFlight) / totalFiles, 1) * 90)
    });
  };

  await mapWithConcurrency(toInstall, DOWNLOAD_CONCURRENCY, async (entry, index) => {
    const target = resolveGameRelativePath(entry.path);
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const fileName = path.basename(entry.path);
    // Index keeps tmp names unique across parallel downloads even when two
    // manifest entries share a basename.
    const tmp = path.join(getDownloadDirectory(), `${fileName}.${index}.download`);
    safeUnlink(tmp);

    inFlightProgress.set(entry.path, 0);
    reportProgress(fileName);

    try {
      await downloadFile(entry.url, tmp, (downloaded, totalBytes) => {
        inFlightProgress.set(entry.path, totalBytes ? Math.min(downloaded / totalBytes, 1) : 0);
        reportProgress(fileName);
      });

      if (!fileMatchesManifestEntry(tmp, entry)) {
        safeUnlink(tmp);
        throw new Error(`Fichier corrompu ou incomplet : ${fileName}`);
      }

      safeUnlink(target);
      fs.renameSync(tmp, target);
      completed += 1;
    } finally {
      inFlightProgress.delete(entry.path);
    }
  });

  onProgress?.({ phase: 'cleaning', percent: 92 });
  const removedExtra = removeExtraMods(manifest);
  const removedDuplicates = await dedupeMods(getModsDirectory());

  writeLocalManifest({
    source: 'manifest',
    version: manifest.version,
    sourceUrl: manifest.sourceUrl,
    installedAt: new Date().toISOString(),
    files: manifest.files.map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256
    }))
  });

  onProgress?.({ phase: 'done', percent: 100 });

  return {
    manifest: true,
    version: manifest.version,
    installed: directJarCount(getModsDirectory()),
    removedExtra,
    removedDuplicates
  };
}

async function updateFromZip(config, onProgress) {
  if (!config.modpackUrl) {
    throw new Error('Aucun modpack configure dans le Gist (champ "modpackUrl" manquant)');
  }

  const url = normalizeDropbox(config.modpackUrl);
  const modsDir = getModsDirectory();
  const tmpZip = path.join(getGameDirectory(), 'tmp-modpack.zip');
  const stagingDir = path.join(getGameDirectory(), '.modpack-staging');

  safeUnlink(tmpZip);
  safeRm(stagingDir);

  onProgress?.({ phase: 'downloading', percent: 0 });
  const headers = await downloadFile(url, tmpZip, (downloaded, total) => {
    onProgress?.({ phase: 'downloading', percent: Math.round((downloaded / total) * 100) });
  });

  if (!isZipFile(tmpZip)) {
    const message = invalidZipMessage(tmpZip, headers);
    safeUnlink(tmpZip);
    throw new Error(message);
  }

  // Optional integrity check: if the Gist provides modpackSha256, verify the
  // downloaded ZIP before extracting. Absent = no check (backwards compatible).
  const expectedHash = normalizeHash(config.modpackSha256 || config.modpackHash || config.modpackChecksum);
  if (expectedHash) {
    const actualHash = sha256File(tmpZip);
    if (actualHash !== expectedHash) {
      safeUnlink(tmpZip);
      throw new Error(
        'Le modpack telecharge ne correspond pas a l empreinte SHA-256 attendue. '
        + 'Verifie le champ modpackSha256 dans le Gist (ou mets-le a jour apres avoir change le ZIP). '
        + `Attendu ${expectedHash.slice(0, 12)}..., obtenu ${actualHash.slice(0, 12)}...`
      );
    }
  }

  onProgress?.({ phase: 'extracting', percent: 0 });
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    await extractZip(tmpZip, { dir: stagingDir });
  } catch (err) {
    safeRm(stagingDir);
    safeUnlink(tmpZip);
    throw new Error(`Impossible d extraire le modpack : ${err.message}. Verifie que le fichier est un ZIP valide.`);
  }

  const extractedModsSource = getExtractedModsSource(stagingDir);
  const extractedCount = directJarCount(extractedModsSource);
  if (!extractedCount) {
    safeRm(stagingDir);
    safeUnlink(tmpZip);
    throw new Error('Le ZIP du modpack ne contient aucun fichier .jar a la racine. Mets les mods directement dans le ZIP, ou dans un dossier mods/.');
  }

  onProgress?.({ phase: 'cleaning', percent: 100 });
  emptyDirectory(modsDir);
  copyDirectoryContents(extractedModsSource, modsDir);
  const removedDuplicates = await dedupeMods(modsDir);

  safeRm(stagingDir);
  safeUnlink(tmpZip);

  let newId = null;
  try {
    newId = await getRemoteModpackId(url);
    if (newId) writeLocalId(newId);
  } catch {
    /* ignore */
  }

  writeLocalManifest(buildInstalledManifest('zip', newId));
  onProgress?.({ phase: 'done', percent: 100 });

  return {
    manifest: false,
    installed: directJarCount(modsDir),
    removedDuplicates
  };
}
async function updateMods(onProgress) {
  await checkFreeSpace(getGameDirectory(), 3000);

  let config = {};
  try {
    config = await fetchServerConfig();
  } catch (err) {
    onProgress?.({ phase: 'cleaning', percent: 50 });
    const removedDuplicates = await dedupeMods(getModsDirectory());
    writeLocalManifest(buildInstalledManifest('local-offline', null));
    onProgress?.({ phase: 'done', percent: 100 });
    return {
      manifest: false,
      installed: directJarCount(getModsDirectory()),
      removedDuplicates,
      offline: true,
      warning: err.message
    };
  }

  const manifest = await fetchRemoteManifest(config);
  if (manifest) return updateFromManifest(manifest, onProgress);
  if (!config.modpackUrl) {
    onProgress?.({ phase: 'cleaning', percent: 50 });
    const removedDuplicates = await dedupeMods(getModsDirectory());
    writeLocalManifest(buildInstalledManifest('local', null));
    onProgress?.({ phase: 'done', percent: 100 });
    return {
      manifest: false,
      installed: directJarCount(getModsDirectory()),
      removedDuplicates,
      skippedDownload: true
    };
  }

  return updateFromZip(config, onProgress);
}

async function reinstallMods(onProgress) {
  safeUnlink(getVersionFile());
  safeUnlink(getLocalManifestFile());
  return updateMods(onProgress);
}

async function repairMods(onProgress) {
  const result = await reinstallMods(onProgress);
  const removedDuplicates = await dedupeMods(getModsDirectory());
  return {
    ...result,
    removedDuplicates: [...(result.removedDuplicates || []), ...removedDuplicates]
  };
}

async function getModDiagnostics() {
  const modsDir = getModsDirectory();
  const jars = directJarFiles(modsDir);
  const invalidJars = jars
    .filter((filePath) => !isZipFile(filePath))
    .map((filePath) => path.basename(filePath));
  const duplicates = await scanDuplicateMods(modsDir);
  const localManifest = readLocalManifest();

  return {
    modsDir,
    jarCount: directJarCount(modsDir),
    invalidJars,
    duplicates,
    localManifest: localManifest ? {
      source: localManifest.source,
      version: localManifest.version,
      id: localManifest.id,
      generatedAt: localManifest.generatedAt,
      installedAt: localManifest.installedAt,
      files: Array.isArray(localManifest.files) ? localManifest.files.length : 0
    } : null
  };
}

module.exports = {
  fetchServerConfig,
  checkMods,
  updateMods,
  reinstallMods,
  repairMods,
  getModDiagnostics,
  GIST_ID,
  // Exported for unit tests (pure path/URL/hash helpers).
  normalizeManifestPath,
  normalizeDropbox,
  normalizeHash
};
