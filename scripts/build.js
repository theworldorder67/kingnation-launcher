const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(ROOT_DIR, 'build-tmp');

console.log('====================================================');
console.log('   PRÉPARATION DU BUILD AVEC OBFUSCATION (v1.3.8)   ');
console.log('====================================================\n');

// 1. Nettoyer et créer le dossier temporaire
function cleanTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    console.log('Nettoyage du dossier temporaire existant...');
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

cleanTempDir();
fs.mkdirSync(TEMP_DIR, { recursive: true });

// 2. Copier les fichiers sources dans le dossier temporaire
const filesToCopy = ['main.js', 'preload.js', 'package.json', 'src'];
console.log('Copie des fichiers vers le dossier de compilation temporaire...');

for (const file of filesToCopy) {
  const srcPath = path.join(ROOT_DIR, file);
  const destPath = path.join(TEMP_DIR, file);
  
  if (fs.existsSync(srcPath)) {
    fs.cpSync(srcPath, destPath, { recursive: true });
  } else {
    console.warn(`[ATTENTION] Fichier/Dossier manquant : ${file}`);
  }
}

// 3. Obfusquer les fichiers JavaScript dans le dossier temporaire
console.log('\nObfuscation du code JavaScript...');

const obfuscationConfig = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  debugProtection: false,          // Désactivé pour éviter les plantages Electron en prod
  disableConsoleOutput: false,     // Garder la console active pour diagnostics.js
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,            // Obligatoirement false pour garder l'architecture IPC/exports intacte
  selfDefending: false,            // Désactivé car pose des soucis avec l'empaquetage ASAR d'Electron
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 12,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8
};

function obfuscateFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(code, obfuscationConfig);
    fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
    console.log(` -> Obfusqué : ${path.relative(TEMP_DIR, filePath)}`);
  } catch (err) {
    console.error(` [ERREUR] Impossible d'obfusquer ${filePath}:`, err.message);
    process.exit(1);
  }
}

function processDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Ignorer les dossiers d'assets ou autres ressources statiques
      if (entry.name !== 'assets' && entry.name !== 'styles') {
        processDirectory(fullPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      obfuscateFile(fullPath);
    }
  }
}

// Obfusquer main.js et preload.js
obfuscateFile(path.join(TEMP_DIR, 'main.js'));
obfuscateFile(path.join(TEMP_DIR, 'preload.js'));

// Obfusquer les fichiers JS dans src/main et src/renderer/js
if (fs.existsSync(path.join(TEMP_DIR, 'src', 'main'))) {
  processDirectory(path.join(TEMP_DIR, 'src', 'main'));
}
if (fs.existsSync(path.join(TEMP_DIR, 'src', 'renderer', 'js'))) {
  processDirectory(path.join(TEMP_DIR, 'src', 'renderer', 'js'));
}

console.log('\nObfuscation terminée avec succès !');

// 4. Lancer electron-builder
console.log('\nLancement du packaging avec electron-builder...');
const args = process.argv.slice(2);

const builderResult = spawnSync(
  'node',
  [path.join(ROOT_DIR, 'node_modules', 'electron-builder', 'cli.js'), ...args],
  {
    cwd: TEMP_DIR,
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN }
  }
);

// 5. Copier le dossier de sortie dist vers la racine du projet
const tempDist = path.join(TEMP_DIR, 'dist');
const finalDist = path.join(ROOT_DIR, 'dist');
if (fs.existsSync(tempDist)) {
  console.log('Copie du dossier de sortie dist vers la racine du projet...');
  if (fs.existsSync(finalDist)) {
    fs.rmSync(finalDist, { recursive: true, force: true });
  }
  fs.cpSync(tempDist, finalDist, { recursive: true });
}

// 6. Nettoyage après compilation
console.log('\nNettoyage du dossier temporaire de compilation...');
cleanTempDir();

// 6. Renvoyer le code de sortie d'electron-builder
if (builderResult.status !== 0) {
  console.error('\n[ERREUR] La compilation a échoué.');
  process.exit(builderResult.status || 1);
} else {
  console.log('\n[SUCCÈS] Compilation et déploiement terminés.');
  process.exit(0);
}
