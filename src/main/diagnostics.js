const fs = require('fs');
const path = require('path');

const launcher = require('./launcher');
const updater = require('./updater');

const MAX_LOG_CHARS = 32000;

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function readTail(filePath, maxChars = MAX_LOG_CHARS) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) return '';

  const size = stat.size;
  const start = Math.max(0, size - maxChars);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  return buffer.toString('utf8').replace(/\0/g, '');
}

function latestFileIn(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return null;

  return fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((filePath) => {
      const stat = safeStat(filePath);
      return stat?.isFile() && predicate(path.basename(filePath), filePath);
    })
    .map((filePath) => ({ filePath, mtime: safeStat(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.filePath || null;
}

function pushUnique(items, id, title, detail, severity = 'info') {
  if (items.some((item) => item.id === id)) return;
  items.push({ id, title, detail, severity });
}

function scanLogIssues(text, issues) {
  const log = String(text || '');

  if (/Missing Jar for processor/i.test(log)) {
    pushUnique(
      issues,
      'missing-processor-jar',
      'Installation NeoForge incomplete',
      'Une librairie interne de NeoForge manque. Utilise "Reparer le jeu" pour retélécharger les fichiers NeoForge.',
      'error'
    );
  }

  if (/requires\s+neoforge\s+[\d.]+\s+or above|Currently,\s*neoforge\s+is\s+[\d.]+/i.test(log)) {
    pushUnique(
      issues,
      'neoforge-too-old',
      'Version NeoForge trop ancienne',
      'Au moins un mod demande une version NeoForge plus recente que celle installee localement.',
      'error'
    );
  }

  if (/This channel is missing on the client side|Channel of mod .* failed to connect/i.test(log)) {
    pushUnique(
      issues,
      'client-server-mod-mismatch',
      'Mods client/serveur differents',
      'Le serveur demande des canaux de mods absents du client. Regénere le modpack depuis les memes mods que le serveur puis lance une reparation.',
      'error'
    );
  }

  if (/Unknown host|Name or service not known|No such host is known/i.test(log)) {
    pushUnique(
      issues,
      'unknown-host',
      'Adresse serveur introuvable',
      'Le nom de domaine du serveur ne se resout pas. Verifie serverIp dans le Gist et la connexion internet.',
      'error'
    );
  }

  if (/Connection refused|Connection timed out|Timed out|getsockopt/i.test(log)) {
    pushUnique(
      issues,
      'server-unreachable',
      'Serveur inaccessible',
      'Le client n arrive pas a joindre le serveur. Verifie que le serveur est ouvert, le port correct et que le DNS pointe au bon endroit.',
      'warning'
    );
  }

  if (/Client disconnected with reason:\s*Server closed|Disconnected from server/i.test(log)) {
    pushUnique(
      issues,
      'server-closed-connection',
      'Connexion fermee par le serveur',
      'Minecraft a atteint le serveur, puis la connexion a ete fermee cote serveur ou par un mod reseau pendant la session.',
      'warning'
    );
  }

  if (/Sable\/FATAL|SableUDPClientboundKeepAlivePacket|Cannot invoke "io\.netty\.channel\.Channel\.eventLoop\(\)" because "channel" is null/i.test(log)) {
    pushUnique(
      issues,
      'sable-network-crash',
      'Erreur reseau du mod Sable',
      'Le mod Sable a leve une erreur fatale UDP juste avant la deconnexion. Mets Sable a jour, verifie la meme version cote serveur/client, ou retire-le temporairement pour tester.',
      'error'
    );
  }

  if (/Error loading mods|Mod loading error|Loading errors encountered/i.test(log)) {
    pushUnique(
      issues,
      'mod-loading-error',
      'Erreur de chargement de mods',
      'Un ou plusieurs mods ne chargent pas. Le rapport complet dans latest.log/crash-reports contient le mod exact.',
      'error'
    );
  }

  if (/ZipException|end of central directory|not a valid zip/i.test(log)) {
    pushUnique(
      issues,
      'bad-zip',
      'Archive modpack invalide',
      'Un fichier telecharge ressemble a une page web ou a une archive incomplete. Le lien Dropbox doit finir en dl=1 et pointer vers un vrai ZIP.',
      'error'
    );
  }
}

function scanModIssues(mods, issues) {
  if (!mods) return;

  if (mods.invalidJars?.length) {
    pushUnique(
      issues,
      'invalid-jars',
      'Fichiers mods invalides',
      `${mods.invalidJars.length} fichier(s) .jar ne sont pas des archives valides : ${mods.invalidJars.slice(0, 4).join(', ')}`,
      'error'
    );
  }

  if (mods.duplicates?.length) {
    pushUnique(
      issues,
      'duplicate-mods',
      'Mods en double',
      `${mods.duplicates.length} mod(s) semblent installes plusieurs fois. Une reparation peut nettoyer les doublons.`,
      'warning'
    );
  }

  if (!mods.jarCount) {
    pushUnique(
      issues,
      'empty-mods',
      'Aucun mod serveur installe',
      'Le dossier mods ne contient aucun mod serveur. Le launcher peut lancer le jeu, mais le serveur peut refuser la connexion si le modpack est requis.',
      'warning'
    );
  }
}

async function collectDiagnostics() {
  const root = launcher.getGameDirectory();
  const logsDir = path.join(root, 'logs');
  const crashesDir = path.join(root, 'crash-reports');
  const latestLog = path.join(logsDir, 'latest.log');
  const debugLog = path.join(logsDir, 'debug.log');
  const latestCrash = latestFileIn(crashesDir, (name) => name.endsWith('.txt'));
  const modDiagnostics = await updater.getModDiagnostics();

  const files = [
    latestLog,
    debugLog,
    latestCrash
  ].filter(Boolean).map((filePath) => {
    const stat = safeStat(filePath);
    return {
      path: filePath,
      exists: Boolean(stat),
      size: stat?.size || 0,
      modifiedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
      tail: stat ? readTail(filePath) : ''
    };
  });

  const issues = [];
  scanModIssues(modDiagnostics, issues);
  for (const file of files) scanLogIssues(file.tail, issues);

  return {
    generatedAt: new Date().toISOString(),
    gameDirectory: root,
    minecraftVersion: launcher.MC_VERSION,
    loaderName: 'NeoForge',
    loaderVersion: launcher.NEOFORGE_VERSION,
    mods: modDiagnostics,
    issues,
    files
  };
}

function formatDiagnostics(report) {
  const lines = [
    'KingNation diagnostics',
    `Generated: ${report.generatedAt}`,
    `Game directory: ${report.gameDirectory}`,
    `Minecraft: ${report.minecraftVersion}`,
    `NeoForge: ${report.loaderVersion}`,
    '',
    `Mods: ${report.mods?.jarCount ?? 0} jar(s)`,
    `Invalid jars: ${(report.mods?.invalidJars || []).join(', ') || 'none'}`,
    `Duplicate groups: ${(report.mods?.duplicates || []).length}`,
    ''
  ];

  lines.push('Detected issues:');
  if (report.issues.length) {
    for (const issue of report.issues) {
      lines.push(`- [${issue.severity}] ${issue.title}: ${issue.detail}`);
    }
  } else {
    lines.push('- none detected in available logs');
  }

  lines.push('', 'Files:');
  for (const file of report.files) {
    lines.push(`- ${file.path} (${file.exists ? `${file.size} bytes` : 'missing'})`);
  }

  lines.push('', 'Latest log tails:');
  for (const file of report.files.filter((item) => item.tail)) {
    lines.push('', `===== ${file.path} =====`, file.tail);
  }

  return lines.join('\n');
}

module.exports = {
  collectDiagnostics,
  formatDiagnostics
};
