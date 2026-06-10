const { Client } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { downloadFileAtomic, checkFreeSpace, verifyMavenSha256 } = require('./download');


const MC_VERSION = '1.21.1';
const NEOFORGE_VERSION = '21.1.233';
const NEOFORGE_FULL = `${MC_VERSION}-neoforge-${NEOFORGE_VERSION}`;
const DEFAULT_SERVER_IP = 'play.kingnation.fr:25565';
const MAVEN_NEOFORGED_RELEASES = 'https://maven.neoforged.net/releases';
const MINECRAFT_WINDOW_ICON_ASSETS = [16, 32, 48, 128, 256].map((size) => ({
  assetPath: `icons/icon_${size}x${size}.png`,
  fileName: `icon_${size}x${size}.png`
}));
const NEOFORGE_PROCESSOR_LIBRARIES = [
  {
    group: 'net.neoforged.installertools',
    artifact: 'binarypatcher',
    version: '2.1.2',
    classifier: 'fatjar'
  }
];
const BUNDLED_CLIENT_MODS = [
  {
    fileName: 'kingnation-menu-1.0.0.jar',
    targetName: 'kingnation-menu-1.0.0.jar'
  }
];
// Client mods the launcher used to install but no longer ships. Removed from
// existing installs on launch/repair (see ensureBundledClientMods).
const DEPRECATED_CLIENT_MODS = [
  'kingnation-auth-mod-1.0.0.jar'
];
const FML_CONFIG_TEMPLATE = `#Disables File Watcher. Used to automatically update config if its file has been modified.
disableConfigWatcher = false
#Should we control the window. Disabling this removes the NeoForge early loading window.
earlyWindowControl = false
#Max threads for early initialization parallelism,  -1 is based on processor count
maxThreads = -1
#Enable NeoForge global version checking
versionCheck = true
#Default config path for servers
defaultConfigPath = "defaultconfigs"
#Disables Optimized DFU client-side - already disabled on servers
disableOptimizedDFU = true
#Early window provider
earlyWindowProvider = "fmlearlywindow"
#Early window width
earlyWindowWidth = 1280
#Early window height
earlyWindowHeight = 720
#Early window framebuffer scale
earlyWindowFBScale = 1
#Early window starts maximized
earlyWindowMaximized = false
#Skip specific GL versions, may help with buggy graphics card drivers
earlyWindowSkipGLVersions = []
#Squir?
earlyWindowSquir = false
#Define dependency overrides below
#Dependency overrides can be used to forcibly remove a dependency constraint from a mod or to force a mod to load AFTER another mod
#Using dependency overrides can cause issues. Use at your own risk.
dependencyOverrides = {}
`;

function getGameDirectory() {
  const base = process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), '.kingnation')
    : path.join(os.homedir(), '.kingnation');

  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

function getNeoForgeInstallerPath() {
  const dir = path.join(getGameDirectory(), 'installers');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `neoforge-${NEOFORGE_VERSION}-installer.jar`);
}

function getBundledMinecraftIconPath(fileName) {
  return path.join(__dirname, '..', 'assets', 'minecraft-icons', fileName);
}

function getBundledModPath(fileName) {
  return path.join(__dirname, '..', 'assets', 'bundled-mods', fileName);
}

function mavenArtifactPath({ group, artifact, version, classifier = '' }) {
  const groupPath = group.replace(/\./g, '/');
  const suffix = classifier ? `-${classifier}` : '';
  return `${groupPath}/${artifact}/${version}/${artifact}-${version}${suffix}.jar`;
}

function getMavenArtifactLocalPath(root, artifactInfo) {
  return path.join(root, 'libraries', ...mavenArtifactPath(artifactInfo).split('/'));
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function getServerIp(settings = {}) {
  const value = String(settings.serverIp || DEFAULT_SERVER_IP).trim();
  return value || DEFAULT_SERVER_IP;
}

function replaceTomlValue(content, key, value) {
  const line = `${key} = ${value}`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  return `${content.trimEnd()}\n${line}\n`;
}

function ensureNeoForgeLoadingConfig(root, emit) {
  const configDir = path.join(root, 'config');
  const configPath = path.join(configDir, 'fml.toml');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const current = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, { encoding: 'utf8' })
    : FML_CONFIG_TEMPLATE;
  let next = replaceTomlValue(current, 'earlyWindowControl', 'false');

  // Keep the provider value valid if NeoForge later re-enables or regenerates the setting.
  next = replaceTomlValue(next, 'earlyWindowProvider', '"fmlearlywindow"');

  if (next !== current) {
    fs.writeFileSync(configPath, next);
    emit?.('data', { type: 'debug', message: 'Fenetre de chargement NeoForge desactivee.' });
  }
}

function ensureOptimizedOptions(root, force = false) {
  const optionsPath = path.join(root, 'options.txt');
  const defaults = {
    version: '3953',
    graphicsMode: '1',
    enableVsync: 'false',
    entityShadows: 'false',
    renderDistance: '8',
    simulationDistance: '8',
    maxFps: '260',
    clouds: '1',
    biomeBlendRadius: '2',
    mipmapLevels: '4',
    lang: 'fr_fr'
  };

  let current = {};
  if (fs.existsSync(optionsPath)) {
    if (!force) return;
    try {
      const content = fs.readFileSync(optionsPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const index = line.indexOf(':');
        if (index !== -1) {
          const key = line.substring(0, index).trim();
          const val = line.substring(index + 1).trim();
          if (key) current[key] = val;
        }
      }
    } catch {
      current = {};
    }
  }

  const merged = { ...current, ...defaults };
  const outLines = Object.entries(merged).map(([k, v]) => `${k}:${v}`);
  try {
    fs.writeFileSync(optionsPath, outLines.join('\n') + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write optimized options.txt:', err);
  }
}

function applyMinecraftWindowIcon(root, assetId = MC_VERSION, emit) {
  const assetsRoot = path.join(root, 'assets');
  const indexPath = path.join(assetsRoot, 'indexes', `${assetId}.json`);
  if (!fs.existsSync(indexPath)) return false;

  const index = JSON.parse(fs.readFileSync(indexPath, { encoding: 'utf8' }));
  let applied = 0;

  for (const icon of MINECRAFT_WINDOW_ICON_ASSETS) {
    const objectInfo = index.objects?.[icon.assetPath];
    if (!objectInfo?.hash) continue;

    const sourcePath = getBundledMinecraftIconPath(icon.fileName);
    if (!fs.existsSync(sourcePath)) continue;

    const targetDir = path.join(assetsRoot, 'objects', objectInfo.hash.substring(0, 2));
    const targetPath = path.join(targetDir, objectInfo.hash);
    const iconBytes = fs.readFileSync(sourcePath);

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    if (fs.existsSync(targetPath) && Buffer.compare(fs.readFileSync(targetPath), iconBytes) === 0) {
      applied++;
      continue;
    }

    fs.writeFileSync(targetPath, iconBytes);
    applied++;
  }

  if (applied) {
    emit?.('data', { type: 'debug', message: `Icone Minecraft KingNation appliquee (${applied} tailles).` });
  }

  return applied > 0;
}

function ensureBundledClientMods(root, emit) {
  const modsDir = path.join(root, 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

  let installed = 0;
  for (const mod of BUNDLED_CLIENT_MODS) {
    const sourcePath = getBundledModPath(mod.fileName);
    if (!fs.existsSync(sourcePath)) continue;

    const targetPath = path.join(modsDir, mod.targetName);
    const sourceBytes = fs.readFileSync(sourcePath);
    const alreadyInstalled = fs.existsSync(targetPath)
      && Buffer.compare(fs.readFileSync(targetPath), sourceBytes) === 0;

    if (!alreadyInstalled) {
      fs.writeFileSync(targetPath, sourceBytes);
      installed++;
    }
  }

  // Purge client mods we used to ship but no longer do (e.g. the removed auth
  // mod), so a deprecated managed mod never lingers in existing installs.
  let removed = 0;
  for (const fileName of DEPRECATED_CLIENT_MODS) {
    const targetPath = path.join(modsDir, fileName);
    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
        removed++;
      } catch { /* ignore */ }
    }
  }

  if (installed) {
    emit?.('data', { type: 'debug', message: `Mods client KingNation installes (${installed}).` });
  }
  if (removed) {
    emit?.('data', { type: 'debug', message: `Ancien(s) mod(s) client retire(s) (${removed}).` });
  }
}

function parseJavaVersion(output) {
  const match = String(output || '').match(/(?:openjdk|java) version "([^"]+)"/i);
  const version = match?.[1] || '';
  if (!version) return { version: '', major: null };

  const parts = version.split(/[._+-]/);
  const major = parts[0] === '1'
    ? parseInt(parts[1], 10)
    : parseInt(parts[0], 10);

  return {
    version,
    major: Number.isFinite(major) ? major : null
  };
}

function inspectJava(javaPath) {
  return new Promise((resolve) => {
    childProcess.execFile(javaPath, ['-version'], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          path: javaPath,
          run: false,
          valid: false,
          version: '',
          major: null,
          error: error.message
        });
        return;
      }

      const parsed = parseJavaVersion(`${stdout}\n${stderr}`);
      resolve({
        path: javaPath,
        run: true,
        valid: parsed.major >= 21,
        version: parsed.version,
        major: parsed.major,
        error: null
      });
    });
  });
}

function addJavaCandidate(candidates, candidate) {
  if (!candidate) return;
  const normalized = path.isAbsolute(candidate) ? path.normalize(candidate) : candidate;
  if (!candidates.includes(normalized)) candidates.push(normalized);
}

function addJavaHomesFrom(root, candidates) {
  if (!root || !fs.existsSync(root)) return;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const javaExe = path.join(root, entry.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(javaExe)) addJavaCandidate(candidates, javaExe);
  }
}

function getJavaCandidates(customJavaPath) {
  const candidates = [];
  addJavaCandidate(candidates, customJavaPath);

  if (process.env.JAVA_HOME) {
    addJavaCandidate(candidates, path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  }

  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const base of programFiles) {
      addJavaHomesFrom(path.join(base, 'Java'), candidates);
      addJavaHomesFrom(path.join(base, 'Eclipse Adoptium'), candidates);
      addJavaHomesFrom(path.join(base, 'Microsoft'), candidates);
      addJavaHomesFrom(path.join(base, 'Zulu'), candidates);
    }
  } else {
    addJavaHomesFrom('/usr/lib/jvm', candidates);
    addJavaHomesFrom('/Library/Java/JavaVirtualMachines', candidates);
  }

  addJavaCandidate(candidates, 'java');
  return candidates;
}

async function getJavaRuntimeInfo(customJavaPath) {
  const checked = [];

  for (const candidate of getJavaCandidates(customJavaPath)) {
    const info = await inspectJava(candidate);
    checked.push(info);
  }

  const compatible = checked
    .filter((item) => item.valid)
    .sort((a, b) => (a.major - 21) - (b.major - 21))[0];
  if (compatible) {
    return {
      ...compatible,
      requiredMajor: 21,
      checked
    };
  }

  const runnable = checked
    .filter((item) => item.run)
    .sort((a, b) => (b.major || 0) - (a.major || 0))[0];

  return {
    ...(runnable || checked[0] || { path: 'java', run: false, valid: false, version: '', major: null }),
    valid: false,
    requiredMajor: 21,
    checked
  };
}

function findJavaExecutable(dir, binName) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      const found = findJavaExecutable(fullPath, binName);
      if (found) return found;
    } else if (file.isFile() && file.name.toLowerCase() === binName.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

function getJavaDownloadUrl() {
  const platform = process.platform;
  const arch = process.arch === 'ia32' ? 'x86' : (process.arch === 'arm64' ? 'aarch64' : 'x64');
  
  let osName = '';
  if (platform === 'win32') osName = 'windows';
  else if (platform === 'darwin') osName = 'mac';
  else if (platform === 'linux') osName = 'linux';
  else throw new Error(`Système d'exploitation non supporté : ${platform}`);
  
  return `https://api.adoptium.net/v3/binary/latest/21/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
}

async function downloadAndExtractJava21(emit) {
  const rootDir = getGameDirectory();
  const runtimeDir = path.join(rootDir, 'runtime');
  const targetDir = path.join(runtimeDir, 'java21');

  if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });

  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const existingJava = findJavaExecutable(targetDir, binName);
  if (existingJava) {
    const check = await inspectJava(existingJava);
    if (check.valid) return check;
  }

  await checkFreeSpace(rootDir, 500);

  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const url = getJavaDownloadUrl();
  const tmpZip = path.join(rootDir, 'tmp-java.zip');
  if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);

  emit?.('download-status', { name: 'Java 21 JRE (Téléchargement)', status: 'downloading' });

  await downloadFileAtomic(url, tmpZip, (downloaded, total) => {
    const percent = Math.round((downloaded / total) * 100);
    emit?.('progress', { type: 'downloading-java', task: downloaded, total: total, percent });
  });

  emit?.('download-status', { name: 'Java 21 JRE (Extraction)', status: 'extracting' });

  const extractZip = require('extract-zip');
  try {
    await extractZip(tmpZip, { dir: targetDir });
  } catch (err) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`Échec de l'extraction de Java 21 : ${err.message}`);
  } finally {
    if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
  }

  const javaPath = findJavaExecutable(targetDir, binName);
  if (!javaPath) {
    throw new Error("L'exécutable Java 21 est introuvable après l'extraction.");
  }

  const check = await inspectJava(javaPath);
  if (!check.valid) {
    throw new Error(`La version de Java téléchargée (${check.version}) n'est pas valide pour Minecraft 1.21.1.`);
  }

  return check;
}

async function requireJavaRuntime(customJavaPath, emit) {
  const info = await getJavaRuntimeInfo(customJavaPath);
  if (info.valid) return info;

  // Recherche dans les runtimes locaux déjà téléchargés
  const localRuntimeDir = path.join(getGameDirectory(), 'runtime', 'java21');
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const localJavaPath = findJavaExecutable(localRuntimeDir, binName);
  if (localJavaPath) {
    const localInfo = await inspectJava(localJavaPath);
    if (localInfo.valid) return localInfo;
  }

  // Téléchargement si aucune version compatible n'est trouvée
  try {
    return await downloadAndExtractJava21(emit);
  } catch (err) {
    if (!info.run) {
      throw new Error(`Java 21 est requis pour Minecraft ${MC_VERSION}, mais Java est introuvable. Installe Java 21 puis relance le launcher. (Téléchargement automatique échoué: ${err.message})`);
    }
    throw new Error(`Java 21 est requis pour Minecraft ${MC_VERSION}. Version détectée : Java ${info.version || info.major} (${info.path}). Installe Java 21 ou corrige JAVA_HOME/PATH. (Téléchargement automatique échoué: ${err.message})`);
  }
}

function waitForEarlyExit(processHandle, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      processHandle.removeListener('close', onClose);
      resolve();
    }, timeoutMs);

    function onClose(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code && code !== 0) {
        reject(new Error(`Minecraft s'est fermé immédiatement (code ${code}).`));
        return;
      }

      resolve();
    }

    processHandle.once('close', onClose);
  });
}

async function ensureNeoForgeInstaller(emit, force = false) {
  const dest = getNeoForgeInstallerPath();
  if (force && fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  if (fs.existsSync(dest)) return dest;

  const url = `${MAVEN_NEOFORGED_RELEASES}/net/neoforged/neoforge/${NEOFORGE_VERSION}/neoforge-${NEOFORGE_VERSION}-installer.jar`;
  emit?.('download-status', { name: 'NeoForge installer', status: 'downloading' });

  await downloadFileAtomic(url, dest);
  await verifyMavenSha256(url, dest);

  emit?.('download-status', { name: 'NeoForge installer', status: 'done' });
  return dest;
}

async function ensureNeoForgeProcessorLibraries(root, emit, force = false) {
  for (const artifactInfo of NEOFORGE_PROCESSOR_LIBRARIES) {
    const localPath = getMavenArtifactLocalPath(root, artifactInfo);
    if (force && fs.existsSync(localPath)) fs.rmSync(localPath, { force: true });
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      continue;
    }

    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

    const url = `${MAVEN_NEOFORGED_RELEASES}/${mavenArtifactPath(artifactInfo)}`;
    emit?.('download-status', { name: `${artifactInfo.artifact} ${artifactInfo.classifier || ''}`.trim(), status: 'downloading' });

    await downloadFileAtomic(url, localPath);
    await verifyMavenSha256(url, localPath);

    emit?.('download-status', { name: `${artifactInfo.artifact} ${artifactInfo.classifier || ''}`.trim(), status: 'done' });
  }
}

function ensureNeoForgeWrappedProfile(root, emit, force = false) {
  const forgeProfileDir = path.join(root, 'forge', MC_VERSION);
  const forgeProfilePath = path.join(forgeProfileDir, 'version.json');
  if (!fs.existsSync(forgeProfilePath)) return;

  if (force) {
    if (!isPathInside(root, forgeProfileDir)) {
      throw new Error(`Profil NeoForge invalide hors dossier launcher : ${forgeProfileDir}`);
    }

    fs.rmSync(forgeProfileDir, { recursive: true, force: true });
    emit?.('data', { type: 'debug', message: `Profil NeoForge supprime, regeneration en ${NEOFORGE_VERSION}.` });
    return;
  }

  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(forgeProfilePath, { encoding: 'utf8' }));
  } catch {
    profile = null;
  }

  const raw = profile ? JSON.stringify(profile) : '';
  const isExpectedProfile = raw.includes(`"id":"neoforge-${NEOFORGE_VERSION}"`)
    || raw.includes(`"id": "neoforge-${NEOFORGE_VERSION}"`)
    || raw.includes(`"${NEOFORGE_VERSION}"`);

  if (isExpectedProfile) return;
  if (!isPathInside(root, forgeProfileDir)) {
    throw new Error(`Profil NeoForge invalide hors dossier launcher : ${forgeProfileDir}`);
  }

  fs.rmSync(forgeProfileDir, { recursive: true, force: true });
  emit?.('data', { type: 'debug', message: `Ancien profil NeoForge supprime, regeneration en ${NEOFORGE_VERSION}.` });
}

async function repairGame(settings = {}, emit) {
  const root = getGameDirectory();
  emit?.('download-status', { name: 'Java', status: 'checking' });
  const java = await requireJavaRuntime(settings.javaPath, emit);

  emit?.('download-status', { name: 'NeoForge', status: 'checking' });
  await ensureNeoForgeInstaller(emit, true);
  await ensureNeoForgeProcessorLibraries(root, emit, true);
  ensureNeoForgeWrappedProfile(root, emit, true);
  ensureNeoForgeLoadingConfig(root, emit);
  ensureBundledClientMods(root, emit);
  ensureOptimizedOptions(root, true);

  let iconApplied = false;
  try {
    iconApplied = applyMinecraftWindowIcon(root, MC_VERSION, emit);
  } catch (err) {
    emit?.('data', { type: 'debug', message: `Icone Minecraft ignoree pendant la reparation : ${err.message}` });
  }

  emit?.('download-status', { name: 'Reparation', status: 'done' });
  return {
    gameDirectory: root,
    minecraftVersion: MC_VERSION,
    loaderName: 'NeoForge',
    loaderVersion: NEOFORGE_VERSION,
    java: {
      path: java.path,
      version: java.version,
      major: java.major
    },
    iconApplied
  };
}

async function launch(profile, settings, emit) {
  const root = getGameDirectory();
  const java = await requireJavaRuntime(settings.javaPath, emit);
  const installer = await ensureNeoForgeInstaller(emit);
  await ensureNeoForgeProcessorLibraries(root, emit);
  ensureNeoForgeWrappedProfile(root, emit);
  ensureNeoForgeLoadingConfig(root, emit);
  ensureBundledClientMods(root, emit);
  ensureOptimizedOptions(root, false);

  const ramMb = Math.max(1024, (settings.ram || 4) * 1024);
  const serverIp = getServerIp(settings);

  const opts = {
    authorization: {
      access_token: profile.access_token,
      client_token: profile.client_token,
      uuid: profile.uuid,
      name: profile.name,
      user_properties: profile.user_properties || '{}',
      meta: profile.meta || { type: 'msa', demo: false }
    },
    root,
    javaPath: java.path,
    version: {
      number: MC_VERSION,
      type: 'release'
    },
    forge: installer,
    memory: {
      max: `${ramMb}M`,
      min: `${ramMb}M`
    },
    customArgs: [
      `-Dkingnation.serverIp=${serverIp}`,

      // GC Optimization
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=50',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8m',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',

      // Thread & Performance Tweaks
      '-XX:+UseStringDeduplication',
      '-XX:ReservedCodeCacheSize=512m',
      '-XX:+UseFastUnorderedTimeStamps'
    ],
    window: { width: 1280, height: 720 },
    overrides: {
      detached: true
    }
  };

  const launcher = new Client();
  let lastDebugMessage = '';
  let lastErrorMessage = '';
  let windowIconApplied = false;

  launcher.on('debug', (msg) => {
    lastDebugMessage = String(msg);
    emit?.('data', { type: 'debug', message: lastDebugMessage });
    if (!windowIconApplied && lastDebugMessage.includes('[MCLC]: Downloaded assets')) {
      windowIconApplied = true;
      try {
        applyMinecraftWindowIcon(root, MC_VERSION, emit);
      } catch (err) {
        emit?.('data', { type: 'debug', message: `Icone Minecraft KingNation ignoree : ${err.message}` });
      }
    }
  });
  launcher.on('data', (msg) => emit?.('data', { type: 'log', message: String(msg) }));
  launcher.on('progress', (data) => emit?.('progress', data));
  launcher.on('download-status', (data) => emit?.('download-status', data));
  launcher.on('arguments', (args) => emit?.('data', { type: 'args', message: 'Lancement avec arguments JVM/Game' }));
  launcher.on('close', (code) => emit?.('close', { code }));
  launcher.on('error', (err) => {
    lastErrorMessage = err?.message || String(err);
    emit?.('error', { message: lastErrorMessage });
  });

  try {
    const processHandle = await launcher.launch(opts);
    if (!processHandle) {
      const message = lastErrorMessage || lastDebugMessage || 'Erreur inconnue.';
      throw new Error(`Le lancement Minecraft a échoué avant l'ouverture du jeu. ${message}`);
    }

    // Unref stdio pipes so the Electron process can exit while the detached game runs
    try {
      processHandle.stdout?.unref?.();
      processHandle.stderr?.unref?.();
      processHandle.stdin?.unref?.();
      processHandle.unref();
    } catch {}

    await waitForEarlyExit(processHandle);
    emit?.('progress', { type: 'launched', task: 1, total: 1 });
    return processHandle;
  } catch (err) {
    emit?.('error', { message: err.message });
    throw err;
  }
}

module.exports = {
  launch,
  repairGame,
  getGameDirectory,
  getJavaRuntimeInfo,
  applyMinecraftWindowIcon,
  ensureNeoForgeLoadingConfig,
  ensureBundledClientMods,
  MC_VERSION,
  NEOFORGE_VERSION
};
