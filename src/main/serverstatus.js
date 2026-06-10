const axios = require('axios');

const CACHE_TTL_MS = 25 * 1000;
let cache = { key: null, value: null, at: 0 };

/**
 * Récupère le statut live d'un serveur Minecraft via mcsrvstat.us (API publique gratuite).
 * Renvoie un objet normalisé que le renderer peut consommer directement.
 */
async function getServerStatus(serverIp) {
  if (!serverIp) {
    return { online: false, reason: 'no-ip' };
  }

  const ipForCache = String(serverIp).trim();
  const now = Date.now();
  if (cache.key === ipForCache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  try {
    const url = `https://api.mcsrvstat.us/3/${encodeURIComponent(ipForCache)}`;
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'KingNationLauncher/1.0' }
    });

    const status = {
      online: !!data.online,
      ip: data.ip || ipForCache,
      port: data.port || null,
      version: data.version || null,
      motd: Array.isArray(data?.motd?.clean) ? data.motd.clean.join(' ').trim() : null,
      players: {
        online: data?.players?.online ?? 0,
        max: data?.players?.max ?? 0,
        list: Array.isArray(data?.players?.list)
          ? data.players.list.map((p) => p.name || p).slice(0, 20)
          : []
      },
      icon: data.icon || null
    };

    cache = { key: ipForCache, value: status, at: now };
    return status;
  } catch (err) {
    const fallback = { online: false, reason: err.message };
    cache = { key: ipForCache, value: fallback, at: now };
    return fallback;
  }
}

module.exports = { getServerStatus };
