const { Client } = require('@xhayper/discord-rpc');

// Client ID for KingNation application on Discord
const CLIENT_ID = '1511801086090936380';
let rpc = null;
let isReady = false;
let currentActivity = null;

function init() {
  if (rpc) return;

  rpc = new Client({
    clientId: CLIENT_ID,
    transport: { type: 'ipc' }
  });

  rpc.on('ready', () => {
    console.log('Discord RPC connecté.');
    isReady = true;
    if (currentActivity) {
      setActivity(currentActivity);
    }
  });

  rpc.on('disconnected', () => {
    isReady = false;
  });

  rpc.on('error', (err) => {
    console.error('Erreur Discord RPC :', err);
  });

  rpc.login().catch((err) => {
    console.warn('Impossible de se connecter à Discord RPC (Discord est probablement fermé) :', err.message);
    rpc = null;
    isReady = false;
  });
}

function setActivity(activity) {
  currentActivity = activity;
  if (!rpc || !isReady || !rpc.user) return;

  const rpcData = {
    details: activity.details,
    state: activity.state,
    largeImageKey: activity.largeImageKey || 'logo',
    largeImageText: activity.largeImageText || 'KingNation',
    instance: false,
    buttons: [
      { label: 'Rejoindre le Discord', url: 'https://discord.gg/Y8NMcpNzsm' }
    ]
  };

  if (activity.startTimestamp) {
    rpcData.startTimestamp = activity.startTimestamp;
  }

  if (activity.smallImageKey) {
    rpcData.smallImageKey = activity.smallImageKey;
    rpcData.smallImageText = activity.smallImageText || '';
  }

  rpc.user.setActivity(rpcData).catch((err) => {
    console.warn('Erreur lors du changement d\'activité Discord RPC :', err.message);
  });
}

function showLauncherActivity() {
  setActivity({
    details: 'Dans le Launcher',
    state: 'Prêt à jouer',
    largeImageKey: 'logo',
    largeImageText: 'KingNation Launcher'
  });
}

function showGameActivity(playerName) {
  setActivity({
    details: 'En jeu',
    state: 'Sur le serveur KingNation',
    startTimestamp: Date.now(),
    largeImageKey: 'logo',
    largeImageText: 'KingNation Server',
    smallImageKey: 'logo',
    smallImageText: `Joueur : ${playerName}`
  });
}

function shutdown() {
  if (!rpc) return;
  const client = rpc;
  rpc = null;
  isReady = false;
  currentActivity = null;

  // Use a timeout to prevent rpc.destroy() from hanging the quit process
  const timeout = setTimeout(() => {
    console.warn('Discord RPC destroy timed out, forcing shutdown.');
  }, 3000);
  timeout.unref?.();

  client.destroy().catch(() => {}).finally(() => {
    clearTimeout(timeout);
  });
}

module.exports = {
  init,
  showLauncherActivity,
  showGameActivity,
  shutdown
};
