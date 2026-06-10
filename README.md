# KingNation Launcher

Launcher Minecraft Premium pour le serveur **KingNation** (NeoForge 1.21.1), construit avec Electron.

## Caractéristiques

- Authentification Microsoft Premium (msmc)
- Lancement automatique de Minecraft NeoForge 1.21.1
- Synchronisation automatique du modpack (Gist + Dropbox)
- Interface Liquid Glass moderne (noir + accents rouges)
- Détection automatique de la RAM système avec recommandation
- Le launcher reste ouvert pendant que vous jouez

## Prérequis

- **Node.js 18+** et **npm** (développement uniquement)
- Un compte Microsoft Premium avec Minecraft Java Edition

> **Java 21** n'a pas besoin d'être installé : le launcher télécharge automatiquement son propre JRE 21 (Adoptium) dans `%APPDATA%\.kingnation\runtime\java21` au premier lancement.

## Installation

```powershell
cd "C:\Users\oksuz\Desktop\KINGNATION LAUNCHER"
npm install
```

## Lancement en développement

```powershell
npm run dev
```

## Build de l'installateur Windows

```powershell
npm run build:win
```

Le fichier `.exe` se trouvera dans `dist/`.

## Publier une release (mise à jour automatique)

Le launcher embarque `electron-updater` : les launchers déjà installés chez les joueurs **se mettent à jour tout seuls** au démarrage, à condition que les releases GitHub contiennent les fichiers générés par electron-builder (`kingnation_installer.exe` + `latest.yml` + `.blockmap`). Un upload manuel du `.exe` seul ne suffit pas — sans `latest.yml`, l'auto-update ne détecte rien.

Procédure de release :

```powershell
# 1. Monter la version dans package.json (ex. 1.4.5 -> 1.4.6)
# 2. Définir un token GitHub avec accès en écriture au repo ATLASINTER/kingnation-launcher
$env:GH_TOKEN = "ghp_votre_token"
# 3. Builder et publier la release GitHub en une commande
npm run release:win
```

`npm run build:win` reste le build local sans publication. Le build CI (GitHub Actions) utilise `--publish never` et ne publie jamais rien : seule la commande `release:win` lancée par vous crée une release.

## Tests

```powershell
npm test
```

## Configuration

### Pourquoi un Gist ?

Le Gist GitHub permet de **modifier la config du serveur sans rebuilder le launcher**. Vous changez d'IP ? Vous publiez un nouveau modpack ? Vous éditez le Gist, et tous vos joueurs reçoivent la mise à jour automatiquement au prochain lancement.

### 1. Créer le Gist

Allez sur https://gist.github.com et créez un Gist (public ou secret) avec un fichier nommé **exactement** `kingnation-config.json` :

**Minimum (2 champs) :**
```json
{
  "serverIp": "play.kingnation.fr:25565",
  "modpackUrl": "https://www.dropbox.com/scl/fi/XXXX/modpack.zip?rlkey=YYYY&dl=1"
}
```

**Avec champs optionnels :**
```json
{
  "serverIp": "play.kingnation.fr:25565",
  "modpackUrl": "https://www.dropbox.com/scl/fi/XXXX/modpack.zip?rlkey=YYYY&dl=1",
  "discordUrl": "https://discord.gg/TON_INVITATION",
  "playersOnline": 42
}
```

| Champ | Rôle | Optionnel |
|---|---|---|
| `serverIp` | IP utilisée pour le statut et le lancement direct | non |
| `modpackUrl` | Lien direct Dropbox vers le `.zip` contenant les mods | non * |
| `discordUrl` | Invitation Discord ouverte par le bouton sidebar | oui |
| `playersOnline` | Compteur joueurs sur la home | oui |

*Sans `modpackUrl`, le launcher démarre Minecraft sans mods.

> **Détection automatique des mises à jour :** le launcher interroge l'en-tête HTTP (`ETag` + `Content-Length`) de votre fichier Dropbox. Dès que vous remplacez le zip, ces valeurs changent et tous les joueurs téléchargent automatiquement la nouvelle version au prochain JOUER. Aucun numéro de version à gérer.

#### Champs optionnels avancés

Ces champs sont **facultatifs** — sans eux, le launcher fonctionne exactement comme avant.

**`modpackSha256`** — empreinte SHA-256 du `.zip` du modpack. Si présente, le launcher refuse d'installer un ZIP dont l'empreinte ne correspond pas (protection contre un téléchargement corrompu ou altéré). Pour la calculer :

```powershell
Get-FileHash .\modpack.zip -Algorithm SHA256 | Select-Object -ExpandProperty Hash
```

> ⚠️ Si vous renseignez ce champ, vous devez mettre à jour sa valeur **à chaque** changement de ZIP, sinon les joueurs auront une erreur d'intégrité. Laissez-le absent si vous préférez ne pas vous en occuper.

**`litematica.mods`** — pour changer les versions de Forgematica / MaFgLib sans rebuilder le launcher. Les noms de fichiers doivent garder leur préfixe (`forgematica…`, `mafglib…`) :

```json
{
  "litematica": {
    "mods": [
      { "url": "https://cdn.modrinth.com/data/dCKRaeBC/versions/XXXX/forgematica-0.5.0+mc1.21.1.jar", "label": "Forgematica" },
      { "url": "https://cdn.modrinth.com/data/SKI34J7B/versions/YYYY/mafglib-0.5.0+mc1.21.1.jar", "label": "MaFgLib" }
    ]
  }
}
```

Sans ce champ, le launcher installe les versions par défaut (Forgematica 0.4.1 + MaFgLib 0.4.3).

### 2. Récupérer l'ID Gist

Une fois créé, l'URL du Gist ressemble à :
```
https://gist.github.com/votrepseudo/abc123def456ghi789
```

L'**ID** est la partie après le slash (`abc123def456ghi789`).

### 3. Coller l'ID dans le launcher

Ouvrez `src/main/updater.js` et remplacez à la ligne 7 :

```js
const GIST_ID = 'abc123def456ghi789';
```

Ou utilisez la variable d'environnement `KINGNATION_GIST_ID`.

### 4. Préparer le modpack Dropbox

1. Créez un dossier contenant tous les `.jar` de vos mods
2. Compressez-le en `.zip` (les `.jar` doivent être à la racine du zip, ou dans un dossier `mods/`)
3. Upload sur Dropbox
4. Récupérez le lien de partage et **changez `?dl=0` en `?dl=1`** pour forcer le téléchargement direct
5. Mettez ce lien dans `modpackUrl`

### 5. Mettre à jour un modpack

1. Remplacez le zip sur Dropbox (ou changez l'URL dans le Gist)
2. C'est tout. Le launcher détecte automatiquement le changement via les en-têtes HTTP, et tous les joueurs téléchargent les nouveaux mods au prochain clic sur JOUER.

## Structure du projet

```
KINGNATION LAUNCHER/
├── package.json
├── main.js                    # Processus principal Electron
├── preload.js                 # Bridge IPC sécurisé
├── gist-example.json          # Modèle de Gist
├── scripts/
│   └── build.js               # Build obfusqué + electron-builder
├── test/                      # Tests unitaires (node --test)
└── src/
    ├── assets/
    │   └── logo.png           # Logo KingNation
    ├── main/
    │   ├── auth.js            # Auth Microsoft (msmc)
    │   ├── launcher.js        # Lancement Minecraft NeoForge
    │   ├── updater.js         # Gist + Dropbox modpack
    │   ├── download.js        # Téléchargements (retry, atomique, SHA-256)
    │   ├── discord.js         # Discord Rich Presence
    │   ├── diagnostics.js     # Diagnostic de crash
    │   └── serverstatus.js    # Statut du serveur Minecraft
    └── renderer/
        ├── index.html         # UI
        ├── styles/main.css    # Style Liquid Glass
        └── js/renderer.js     # Logique UI
```

## Données utilisateur

Le launcher stocke ses fichiers dans :
- **Windows** : `%APPDATA%\.kingnation\`
- **Mac/Linux** : `~/.kingnation/`

Sous-dossiers utiles :
- `mods/` — mods Minecraft synchronisés depuis le Dropbox
- `installers/` — installer NeoForge téléchargé
- `.modpack-version` — empreinte HTTP du modpack actuellement installé
