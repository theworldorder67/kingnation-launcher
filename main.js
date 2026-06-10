const { app, BrowserWindow, ipcMain, shell, clipboard, Notification, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Store = require('electron-store');

const auth = require('./src/main/auth');
const launcher = require('./src/main/launcher');
const updater = require('./src/main/updater');
const serverStatus = require('./src/main/serverstatus');
const diagnostics = require('./src/main/diagnostics');
const discordRpc = require('./src/main/discord');

const store = new Store({
  defaults: {
    ram: 4,
    profile: null,
    lastVersion: null,
    termsAccepted: false,
    useLitematica: false
  }
});

let mainWindow = null;
let gameRunning = false;
let isInitialUpdateCheck = true;
let updateCheckInterval = null;
let gameChildProcess = null;
let isQuitting = false;

function hideLauncherWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  gameRunning = true;
  mainWindow.hide();
}

function restoreLauncherWindow() {
  gameRunning = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    name: profile.name,
    uuid: profile.uuid,
    avatar: profile.avatar
  };
}

/* ===== Secure profile storage =====
 * Auth tokens (access_token, client_token, refresh) are encrypted at rest with
 * the OS keychain via Electron safeStorage (DPAPI on Windows). Only the public
 * fields (name, uuid, avatar) ever stay in plaintext.
 */
function deleteProfile() {
  store.delete('profile');
  store.delete('profileSecure');
}

function saveProfile(profile) {
  if (!profile) {
    deleteProfile();
    return;
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(profile));
      store.set('profileSecure', encrypted.toString('base64'));
      // Keep only non-sensitive fields readable in plaintext.
      store.set('profile', publicProfile(profile));
      return;
    } catch (err) {
      console.error('Chiffrement du profil impossible, stockage en clair :', err);
    }
  }

  // Fallback: OS encryption unavailable — store the full profile (legacy behaviour).
  store.delete('profileSecure');
  store.set('profile', profile);
}

function loadProfile() {
  const secure = store.get('profileSecure');
  if (secure && safeStorage.isEncryptionAvailable()) {
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(secure, 'base64'));
      return JSON.parse(decrypted);
    } catch (err) {
      console.error('Déchiffrement du profil impossible, reconnexion requise :', err);
      deleteProfile();
      return null;
    }
  }

  // Legacy plaintext profile (pre-encryption installs, or no keychain available).
  return store.get('profile') || null;
}

function openSafeExternalUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

// The preload bridge is privileged, so the renderer must never navigate away
// from our bundled page. External links are opened in the system browser.
function lockNavigation(contents) {
  contents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openSafeExternalUrl(url);
  });
}

let splashWindow = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 330,
    frame: false,
    transparent: true,
    resizable: false,
    show: true,
    icon: path.join(__dirname, 'src/assets/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'src/renderer/splash.html'));
  lockNavigation(splashWindow.webContents);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    show: false,
    title: 'KingNation Launcher',
    icon: path.join(__dirname, 'src/assets/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!gameRunning) mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url);
    return { action: 'deny' };
  });

  lockNavigation(mainWindow.webContents);
}

function initAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.on('checking-for-update', () => {
    console.log('Verification des mises a jour...');
    if (isInitialUpdateCheck) {
      splashWindow?.webContents.send('updater:progress', { status: 'Vérification des mises à jour...' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Mise a jour disponible :', info.version);
    if (isInitialUpdateCheck) {
      splashWindow?.webContents.send('updater:progress', { status: 'Téléchargement de la mise à jour...' });
    } else {
      mainWindow?.webContents.send('updater:available', info);
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (isInitialUpdateCheck) {
      splashWindow?.webContents.send('updater:progress', {
        status: 'Téléchargement de la mise à jour...',
        percent: progressObj.percent
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('Aucune mise a jour disponible.');
    if (isInitialUpdateCheck) {
      splashWindow?.webContents.send('updater:progress', { status: 'Lancement...' });
      setTimeout(() => {
        createMainWindow();
        splashWindow?.close();
        isInitialUpdateCheck = false;
      }, 1000);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Erreur de mise a jour :', err);
    if (isInitialUpdateCheck) {
      splashWindow?.webContents.send('updater:progress', { status: 'Démarrage du launcher...' });
      setTimeout(() => {
        createMainWindow();
        splashWindow?.close();
        isInitialUpdateCheck = false;
      }, 1500);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Mise a jour telechargee. Elle sera installee au redemarrage.');
    if (isInitialUpdateCheck) {
      splashWindow?.webContents.send('updater:progress', {
        status: 'Redémarrage et installation...',
        percent: 100
      });
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true);
      }, 1500);
    } else {
      mainWindow?.webContents.send('updater:readyToInstall', info);
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'Mise à jour KingNation Launcher',
          body: `La version ${info.version} est prête. Cliquez pour redémarrer et l'installer.`,
          icon: path.join(__dirname, 'src/assets/logo.png')
        });
        notification.on('click', () => {
          autoUpdater.quitAndInstall(true, true);
        });
        notification.show();
      }
    }
  });

  autoUpdater.checkForUpdatesAndNotify();

  // Vérification périodique toutes les heures
  updateCheckInterval = setInterval(() => {
    if (!isInitialUpdateCheck) {
      console.log('Vérification périodique des mises à jour...');
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('Erreur lors de la vérification périodique :', err);
      });
    }
  }, 3600000);
}

app.whenReady().then(() => {
  discordRpc.init();
  discordRpc.showLauncherActivity();

  if (!app.isPackaged) {
    createMainWindow();
  } else {
    createSplashWindow();
    initAutoUpdater();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!app.isPackaged) createMainWindow();
      else createSplashWindow();
    }
    else if (!gameRunning) restoreLauncherWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;

  // Clear the hourly update check interval so the event loop can drain
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }

  // Kill the game child process if it's still attached
  if (gameChildProcess) {
    try {
      gameChildProcess.removeAllListeners();
      gameChildProcess.stdout?.removeAllListeners();
      gameChildProcess.stderr?.removeAllListeners();
      gameChildProcess.stdin?.removeAllListeners();
      gameChildProcess.unref();
    } catch {}
    gameChildProcess = null;
  }

  // Shut down Discord RPC with a timeout to prevent hanging
  discordRpc.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Safety force exit after 5 seconds in case something keeps the process alive
    setTimeout(() => {
      console.warn('Force quitting after timeout.');
      process.exit(0);
    }, 5000).unref();

    app.quit();
  }
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => {
  if (gameRunning) {
    // If the game is running, quit the entire app (the game is detached and will keep running)
    app.quit();
  } else {
    mainWindow?.close();
  }
});

ipcMain.handle('auth:login', async () => {
  try {
    const profile = await auth.login();
    saveProfile(profile);
    return { success: true, profile: publicProfile(profile) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  deleteProfile();
  return { success: true };
});

ipcMain.handle('auth:getProfile', async () => {
  return publicProfile(loadProfile());
});

ipcMain.handle('auth:refresh', async () => {
  try {
    const stored = loadProfile();
    if (!stored) return { success: false, error: 'No profile' };
    const profile = await auth.refresh(stored);
    saveProfile(profile);
    return { success: true, profile: publicProfile(profile) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Skin customization features removed.

ipcMain.handle('config:fetch', async () => {
  try {
    const config = await updater.fetchServerConfig();
    return { success: true, config };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('server:getStatus', async (event, serverIp) => {
  try {
    const status = await serverStatus.getServerStatus(serverIp);
    return { success: true, status };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('game:getInfo', async () => {
  try {
    const java = await launcher.getJavaRuntimeInfo();
    return {
      success: true,
      info: {
        minecraftVersion: launcher.MC_VERSION,
        loaderName: 'NeoForge',
        loaderVersion: launcher.NEOFORGE_VERSION,
        java
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:check', async () => {
  try {
    const status = await updater.checkMods();
    return { success: true, status };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:update', async (event) => {
  try {
    const sender = event.sender;
    const result = await updater.updateMods((progress) => {
      sender.send('mods:progress', progress);
    });
    await syncLitematica(store.get('useLitematica'), sender);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:reinstall', async (event) => {
  try {
    const sender = event.sender;
    const result = await updater.reinstallMods((progress) => {
      sender.send('mods:progress', progress);
    });
    await syncLitematica(store.get('useLitematica'), sender);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mods:repair', async (event) => {
  try {
    const sender = event.sender;
    sender.send('mods:progress', { phase: 'repair', percent: 0, message: 'Verification du contenu' });

    const mods = await updater.repairMods((progress) => {
      sender.send('mods:progress', progress);
    });

    sender.send('mods:progress', { phase: 'game', percent: 92, message: 'Verification de Java et NeoForge' });
    const game = await launcher.repairGame({ ram: store.get('ram') }, (evt, data = {}) => {
      if (evt === 'download-status') {
        sender.send('mods:progress', {
          phase: 'game',
          percent: data.status === 'done' ? 100 : 94,
          file: data.name,
          status: data.status
        });
      }
    });
    const modDiagnostics = await updater.getModDiagnostics();

    await syncLitematica(store.get('useLitematica'), sender);

    return { success: true, result: { mods, game, diagnostics: modDiagnostics } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('diagnostics:collect', async () => {
  try {
    const report = await diagnostics.collectDiagnostics();
    return { success: true, report };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('diagnostics:copy', async () => {
  try {
    const report = await diagnostics.collectDiagnostics();
    clipboard.writeText(diagnostics.formatDiagnostics(report));
    return { success: true, report };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch:start', async (event, options) => {
  let gameClosed = false;

  try {
    const profile = loadProfile();
    if (!profile) throw new Error('Aucun profil connecté');

    // Sync Litematica mod state before running
    await syncLitematica(store.get('useLitematica'));

    const settings = {
      ram: store.get('ram'),
      ...options
    };

    if (!settings.serverIp) {
      try {
        const config = await updater.fetchServerConfig();
        settings.serverIp = config.serverIp || config.ip || config.server || config.address;
      } catch {
        /* The launcher has a built-in fallback server address. */
      }
    }

    const sender = event.sender;
    const childProc = await launcher.launch(profile, settings, (evt, data) => {
      if (!sender.isDestroyed()) sender.send(`launch:${evt}`, data);

      if (evt === 'close') {
        gameClosed = true;
        gameChildProcess = null;
        discordRpc.showLauncherActivity();
        restoreLauncherWindow();
      }
    });

    // Store the child process reference for cleanup on quit
    if (childProc && !gameClosed) {
      gameChildProcess = childProc;
    }

    if (!gameClosed) {
      discordRpc.showGameActivity(profile.name);
      hideLauncherWindow();
    }
    return { success: true };
  } catch (err) {
    discordRpc.showLauncherActivity();
    restoreLauncherWindow();
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:get', async (event, key) => {
  return key ? store.get(key) : store.store;
});

ipcMain.handle('settings:set', async (event, key, value) => {
  store.set(key, value);
  return { success: true };
});

ipcMain.handle('app:openExternal', async (event, url) => {
  return { success: openSafeExternalUrl(url) };
});

ipcMain.handle('app:openFolder', async () => {
  const folder = launcher.getGameDirectory();
  shell.openPath(folder);
});

function openGameSubfolder(subfolder) {
  const folder = path.join(launcher.getGameDirectory(), subfolder);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
}

ipcMain.handle('app:openLogsFolder', async () => {
  openGameSubfolder('logs');
});

ipcMain.handle('app:openCrashFolder', async () => {
  openGameSubfolder('crash-reports');
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('updater:quitAndInstall', () => {
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.handle('system:getRamInfo', () => {
  const totalGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const maxAllowed = Math.max(2, Math.min(32, totalGb - 2));
  return {
    totalGb,
    minGb: 2,
    maxGb: maxAllowed,
    recommendedGb: Math.min(8, Math.max(4, Math.floor(totalGb / 2)))
  };
});

/* ===== Resources Manager IPC Handlers ===== */
function getResourceSubfolder(type) {
  const base = launcher.getGameDirectory();
  let sub = 'resourcepacks';
  if (type === 'shaders') sub = 'shaderpacks';
  else if (type === 'schematics') sub = 'schematics';
  
  const dir = path.join(base, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('resources:list', async (event, type) => {
  try {
    const dir = getResourceSubfolder(type);
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    return {
      success: true,
      files: files
        .filter(f => f.isFile())
        .map(f => f.name)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('resources:delete', async (event, type, filename) => {
  try {
    const safeName = path.basename(filename);
    const filePath = path.join(getResourceSubfolder(type), safeName);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('resources:download', async (event, type, name, url) => {
  const sender = event.sender;
  try {
    const parsedUrl = new URL(url);
    const safeName = decodeURIComponent(path.basename(parsedUrl.pathname)) || 'downloaded_resource.zip';
    const destPath = path.join(getResourceSubfolder(type), safeName);
    
    const axios = require('axios');
    const { data, headers } = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000
    });

    const totalLength = parseInt(headers['content-length'], 10) || 0;
    let downloadedLength = 0;

    const writer = fs.createWriteStream(destPath);
    data.pipe(writer);

    await new Promise((resolve, reject) => {
      data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        if (totalLength > 0) {
          const percent = Math.round((downloadedLength / totalLength) * 100);
          sender.send(`resources:download-progress:${url}`, { percent });
        }
      });

      writer.on('finish', resolve);
      writer.on('error', (err) => {
        writer.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
      data.on('error', (err) => {
        writer.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });

    return { success: true, filename: safeName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('resources:openFolder', async (event, type) => {
  try {
    const dir = getResourceSubfolder(type);
    await shell.openPath(dir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/* ===== Litematica / Forgematica Management ===== */

// Default Litematica mods (NeoForge 1.21.1). Used as a fallback when the Gist
// config does not provide `litematica.mods`, so the toggle keeps working with
// zero server-side setup. Override per-server from the Gist without rebuilding:
//   "litematica": { "mods": [ { "url": "...", "fileName": "...", "label": "..." } ] }
const DEFAULT_LITEMATICA_MODS = [
  {
    url: 'https://cdn.modrinth.com/data/dCKRaeBC/versions/bNQ9lJbg/forgematica-0.4.1%2Bmc1.21.1.jar',
    fileName: 'forgematica-0.4.1+mc1.21.1.jar',
    label: 'Forgematica'
  },
  {
    url: 'https://cdn.modrinth.com/data/SKI34J7B/versions/CgDQ0u0Q/mafglib-0.4.3%2Bmc1.21.1.jar',
    fileName: 'mafglib-0.4.3+mc1.21.1.jar',
    label: 'MaFgLib'
  }
];

// Filename prefixes treated as launcher-managed Litematica mods. Kept in sync
// with the skip lists in updater.js (emptyDirectory / listExtraMods) so a modpack
// update never deletes them. Configured mods must keep these prefixes.
const LITEMATICA_MANAGED_PREFIXES = ['forgematica', 'mafglib'];

function sanitizeJarFileName(name) {
  const base = path.basename(String(name || '').trim());
  if (!base.toLowerCase().endsWith('.jar')) return null;
  if (base.includes('..') || base.includes('\0')) return null;
  return base;
}

function isManagedLitematicaFile(fileName, targetNames) {
  const lower = fileName.toLowerCase();
  if (targetNames.has(lower)) return true;
  return LITEMATICA_MANAGED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Resolve the Litematica mod list from the Gist, falling back to the bundled
// defaults. Never throws: any config/parse/offline error keeps the defaults.
async function resolveLitematicaMods() {
  try {
    const config = await updater.fetchServerConfig();
    const raw = config?.litematica?.mods ?? config?.litematicaMods;
    if (!Array.isArray(raw) || !raw.length) return DEFAULT_LITEMATICA_MODS;

    const mods = [];
    for (const entry of raw) {
      const url = String(entry?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) continue;

      let fileName = sanitizeJarFileName(entry?.fileName);
      if (!fileName) {
        try {
          fileName = sanitizeJarFileName(decodeURIComponent(path.basename(new URL(url).pathname)));
        } catch {
          fileName = null;
        }
      }
      if (!fileName) continue;

      mods.push({ url, fileName, label: String(entry?.label || fileName) });
    }

    return mods.length ? mods : DEFAULT_LITEMATICA_MODS;
  } catch {
    return DEFAULT_LITEMATICA_MODS;
  }
}

async function syncLitematica(enabled, sender = null) {
  const modsDir = path.join(launcher.getGameDirectory(), 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

  const mods = await resolveLitematicaMods();
  const targetNames = new Set(mods.map((mod) => mod.fileName.toLowerCase()));

  if (enabled) {
    const axios = require('axios');

    // Remove stale managed versions (e.g. an old Forgematica when the Gist now
    // points to a newer one) so we never leave two copies of the same mod.
    for (const file of fs.readdirSync(modsDir)) {
      const lower = file.toLowerCase();
      const isStale = LITEMATICA_MANAGED_PREFIXES.some((prefix) => lower.startsWith(prefix))
        && !targetNames.has(lower);
      if (isStale) {
        try { fs.unlinkSync(path.join(modsDir, file)); } catch {}
      }
    }

    const download = async (mod) => {
      const dest = path.join(modsDir, mod.fileName);
      if (fs.existsSync(dest)) return;
      if (sender && !sender.isDestroyed()) {
        sender.send('litematica:progress', { message: `Téléchargement de ${mod.label}...` });
      }

      const { data } = await axios({
        url: mod.url,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000
      });

      const writer = fs.createWriteStream(dest);
      data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          writer.close();
          try { fs.unlinkSync(dest); } catch {}
          reject(err);
        });
        data.on('error', (err) => {
          writer.close();
          try { fs.unlinkSync(dest); } catch {}
          reject(err);
        });
      });
    };

    for (const mod of mods) {
      await download(mod);
    }
  } else {
    // Remove every managed Litematica mod (known prefixes + configured names).
    for (const file of fs.readdirSync(modsDir)) {
      if (isManagedLitematicaFile(file, targetNames)) {
        try { fs.unlinkSync(path.join(modsDir, file)); } catch {}
      }
    }
  }
}

ipcMain.handle('litematica:sync', async (event, enabled) => {
  try {
    store.set('useLitematica', enabled);
    await syncLitematica(enabled, event.sender);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
