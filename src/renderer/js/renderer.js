/* KingNation Launcher — renderer */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const DEFAULT_DISCORD_URL = 'https://discord.gg/aPf2v9MduU';

const state = {
  profile: null,
  config: null,
  launching: false,
  launchBlockReason: '',
  gameInfo: null,
  authPending: false,
  authStatus: 'Vérification de la session...',
  musicAudio: null,
  musicVolume: 50,
  musicMuted: false
};

/* ===== Background motion ===== */
function initBackgroundMotion() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) return;

  const root = document.documentElement;
  const motion = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    lastPointerAt: 0,
    startedAt: performance.now()
  };

  function applyBackgroundMotion(now) {
    motion.x += (motion.targetX - motion.x) * 0.08;
    motion.y += (motion.targetY - motion.y) * 0.08;

    const seconds = (now - motion.startedAt) / 1000;
    const idleDelay = motion.lastPointerAt ? now - motion.lastPointerAt : 2400;
    const idleBlend = Math.min(1, Math.max(0, (idleDelay - 700) / 1800));
    const idleX = Math.sin(seconds * 0.22) * 5.5 * idleBlend;
    const idleY = Math.cos(seconds * 0.18) * 3.8 * idleBlend;
    const idleRotate = Math.sin(seconds * 0.14) * 0.18 * idleBlend;

    root.style.setProperty('--bg-parallax-x', `${motion.x.toFixed(2)}px`);
    root.style.setProperty('--bg-parallax-y', `${motion.y.toFixed(2)}px`);
    root.style.setProperty('--bg-idle-x', `${idleX.toFixed(2)}px`);
    root.style.setProperty('--bg-idle-y', `${idleY.toFixed(2)}px`);
    root.style.setProperty('--bg-idle-rotate', `${idleRotate.toFixed(3)}deg`);
  }

  function renderBackgroundMotion(now) {
    applyBackgroundMotion(now);
    requestAnimationFrame(renderBackgroundMotion);
  }

  function updateParallaxTarget(event) {
    const nx = (event.clientX / window.innerWidth) - 0.5;
    const ny = (event.clientY / window.innerHeight) - 0.5;
    motion.targetX = nx * -18;
    motion.targetY = ny * -12;
    motion.lastPointerAt = performance.now();
    applyBackgroundMotion(motion.lastPointerAt);
  }

  window.addEventListener('pointermove', updateParallaxTarget);
  window.addEventListener('mousemove', updateParallaxTarget);

  window.addEventListener('pointerleave', () => {
    motion.targetX = 0;
    motion.targetY = 0;
    motion.lastPointerAt = performance.now();
    applyBackgroundMotion(motion.lastPointerAt);
  });

  window.addEventListener('blur', () => {
    motion.targetX = 0;
    motion.targetY = 0;
  });

  requestAnimationFrame(renderBackgroundMotion);
}

function minecraftHeadSources(profile) {
  const uuid = String(profile?.uuid || '').replace(/-/g, '');
  const name = encodeURIComponent(profile?.name || '');
  const ids = [...new Set([name, uuid].filter(Boolean))];

  const remoteSources = ids.flatMap((id) => [
    `https://mc-heads.net/avatar/${id}/64`,
    `https://minotar.net/avatar/${id}/64.png`
  ]);

  return [
    ...remoteSources,
    ...(uuid ? [`https://crafatar.com/avatars/${uuid}?size=64&overlay`] : []),
    fallbackAvatarDataUri(profile)
  ];
}

function fallbackAvatarDataUri(profile) {
  const initial = (String(profile?.name || 'K').trim().charAt(0).toUpperCase() || 'K')
    .replace(/[<>&"']/g, '');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="10" fill="#181a20"/>
      <rect x="6" y="6" width="52" height="52" rx="8" fill="#2a1018"/>
      <rect x="10" y="10" width="44" height="44" rx="6" fill="#ff1f3d" opacity=".28"/>
      <text x="32" y="40" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="800" fill="#fff">${initial}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function applyAvatarFallback(img, profile) {
  const sources = minecraftHeadSources(profile);
  let sourceIndex = 0;

  img.onerror = () => {
    sourceIndex += 1;
    if (sourceIndex < sources.length) {
      img.src = sources[sourceIndex];
      return;
    }

    img.onerror = null;
  };

  img.style.visibility = 'visible';
  img.referrerPolicy = 'no-referrer';
  img.src = sources[sourceIndex];
}

/* ===== SFX ===== */
function playSfx(name) {
  window.sfx?.play(name);
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('button, [data-sfx]');
  if (!trigger || trigger.disabled) return;
  const sound = trigger.dataset.sfx || 'click';
  if (sound === 'none') return;
  playSfx(sound);
}, true);

let lastSfxHoverTarget = null;

document.addEventListener('pointerover', (event) => {
  const trigger = event.target.closest('button, [data-sfx-hover]');
  if (!trigger || trigger.disabled || trigger === lastSfxHoverTarget) return;
  if (trigger.dataset.sfx === 'none' || trigger.dataset.sfxHover === 'none') return;

  lastSfxHoverTarget = trigger;
  playSfx(trigger.dataset.sfxHover || 'hover');
}, true);

document.addEventListener('pointerout', (event) => {
  if (!lastSfxHoverTarget) return;
  const leaving = event.target.closest?.('button, [data-sfx-hover]');
  if (leaving && leaving === lastSfxHoverTarget && !leaving.contains(event.relatedTarget)) {
    lastSfxHoverTarget = null;
  }
}, true);

/* ===== Toast ===== */
function toast(message, type = 'info', duration = 3500) {
  if (type === 'success') playSfx('success');
  else if (type === 'error') playSfx('error');

  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    el.style.transition = 'all .25s';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

function formatProgressLabel(progress = {}) {
  const phaseLabels = {
    verifying: 'Vérification',
    downloading: 'Téléchargement',
    extracting: 'Extraction',
    cleaning: 'Nettoyage',
    repair: 'Réparation',
    game: 'Fichiers du jeu',
    done: 'Terminé'
  };

  const phase = phaseLabels[progress.phase] || progress.phase || 'Préparation';
  const file = progress.file || progress.mod || progress.name;
  const percent = typeof progress.percent === 'number' ? ` — ${progress.percent}%` : '';
  const count = progress.current && progress.total ? ` ${progress.current}/${progress.total}` : '';
  return `${phase}${file ? ` : ${file}` : ''}${count}${percent}`;
}

function friendlyLauncherError(message) {
  const raw = String(message || 'Erreur inconnue');

  if (/Missing Jar for processor/i.test(raw)) {
    return 'Installation NeoForge incomplète. Lance "Réparer le jeu" dans Paramètres.';
  }

  if (/requires\s+neoforge|Currently,\s*neoforge/i.test(raw)) {
    return 'Un mod demande une version NeoForge plus récente. Mets à jour le modpack puis répare le jeu.';
  }

  if (/end of central directory|not a ZIP|archive incomplete|page web/i.test(raw)) {
    return 'Le lien modpack ne renvoie pas un vrai ZIP. Vérifie Dropbox avec dl=1, puis réinstalle le contenu.';
  }

  if (/Unknown host|No such host|Connection refused|Timed out/i.test(raw)) {
    return 'Connexion serveur impossible. Vérifie l’adresse serveur dans le Gist et que le serveur est ouvert.';
  }

  if (/Minecraft s.est ferme immediatement|Minecraft s'est ferm/i.test(raw)) {
    return 'Minecraft se ferme au démarrage. Copie le diagnostic pour voir la cause exacte.';
  }

  if (/Java 21|Aucun runtime Java/i.test(raw)) {
    return 'Java 21 est introuvable. Installe Java 21 ou configure un chemin Java valide.';
  }

  return raw;
}

function setMaintenanceStatus(title, detail, type = 'info') {
  const status = $('#maintenance-status');
  const pill = $('#maintenance-pill');
  if (!status) return;

  status.classList.remove('success', 'warning', 'error');
  if (type !== 'info') status.classList.add(type);

  const titleEl = status.querySelector('strong');
  const detailEl = status.querySelector('span');
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
  if (pill) {
    pill.textContent = type === 'success' ? 'OK' : type === 'error' ? 'Erreur' : type === 'warning' ? 'À vérifier' : 'Prêt';
  }
}

// Auto-surface the cause when Minecraft exits with an error code: collect the
// diagnostic, show the most relevant detected issue in the maintenance panel,
// jump to it, and point the player to "Copier diagnostic" / "Aide Discord".
async function showCrashDiagnostic(code) {
  let title = 'Le jeu a planté';
  let detail = 'Cause non identifiée automatiquement. Clique sur « Copier diagnostic », puis demande de l’aide sur Discord.';

  try {
    const res = await window.api.diagnostics.collect();
    const issues = res?.success ? (res.report?.issues || []) : [];
    const top = issues.find((issue) => issue.severity === 'error') || issues[0];
    if (top) {
      title = top.title;
      detail = top.detail;
    }
  } catch {
    /* keep the generic message */
  }

  setMaintenanceStatus(title, `${detail} (code ${code})`, 'error');
  goToPage('settings');
  toast(`Le jeu a planté : ${title}`, 'error', 9000);
}

/* ===== Window controls ===== */
$('#btn-min').addEventListener('click', () => window.api.window.minimize());
$('#btn-max').addEventListener('click', () => window.api.window.maximize());
$('#btn-close').addEventListener('click', () => window.api.window.close());
async function openDiscord() {
  let url = discordUrl();

  /* Si pas encore chargé, on tente une fetch fraîche du Gist */
  if (!url) {
    try {
      const res = await window.api.config.fetch();
      if (res?.success) {
        state.config = res.config;
        url = discordUrl();
      }
    } catch { /* ignore */ }
  }

  if (!url) {
    toast('Lien Discord non configuré dans le Gist.', 'error', 4000);
    return;
  }

  const res = await window.api.app.openExternal(url);
  if (!res?.success) toast('Impossible d\'ouvrir le lien Discord.', 'error');
}

$('#btn-discord')?.addEventListener('click', openDiscord);
$('#btn-help-discord')?.addEventListener('click', openDiscord);

function discordUrl() {
  const configUrl = state.config?.discordUrl || state.config?.discordInvite || state.config?.discord;
  const url = String(configUrl || DEFAULT_DISCORD_URL).trim();
  if (/^https?:\/\/(www\.)?discord\.gg\/kingnation\/?$/i.test(url)) {
    return DEFAULT_DISCORD_URL;
  }
  return url || DEFAULT_DISCORD_URL;
}

/* ===== Navigation ===== */
function goToPage(target) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === target));
  $$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === target));
  const content = $('.content');
  if (content) {
    content.scrollTop = 0;
    content.classList.toggle('is-home', target === 'home');
    content.classList.toggle('is-news', target === 'news');
    content.classList.toggle('is-resources', target === 'resources');
  }
  if (target === 'news') loadNews();
  if (target === 'resources') loadResources();
}

$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});

function renderAuthGate() {
  const locked = !state.profile;
  document.body.classList.toggle('auth-locked', locked);
  document.body.classList.toggle('auth-loading', state.authPending);

  const app = $('.app');
  if (app) app.setAttribute('aria-hidden', locked ? 'true' : 'false');

  const screen = $('#auth-screen');
  if (screen) screen.setAttribute('aria-hidden', locked ? 'false' : 'true');

  const status = $('#auth-status');
  if (status) status.textContent = locked ? (state.authStatus || 'Connexion requise') : '';

  ['#btn-auth-login', '#btn-login'].forEach((selector) => {
    const button = $(selector);
    if (button) button.disabled = state.authPending;
  });
}

async function startMicrosoftLogin() {
  if (state.authPending) return;

  state.authPending = true;
  state.authStatus = 'Ouverture de la fenetre Microsoft...';
  renderAuthGate();
  toast('Ouverture de la fenetre Microsoft...', 'info');

  const res = await window.api.auth.login();
  state.authPending = false;

  if (res.success) {
    state.profile = res.profile;
    state.authStatus = '';
    renderProfile();
    refreshLaunchMeta();
    toast(`Connecte en tant que ${res.profile.name}`, 'success');
    return;
  }

  state.profile = null;
  state.authStatus = `Echec : ${res.error}`;
  renderProfile();
  toast(`Echec : ${res.error}`, 'error', 5000);
}

/* ===== Auth ===== */
$('#btn-auth-login')?.addEventListener('click', startMicrosoftLogin);
$('#btn-login')?.addEventListener('click', startMicrosoftLogin);

$('#btn-logout').addEventListener('click', async () => {
  await window.api.auth.logout();
  state.profile = null;
  state.authStatus = 'Connexion requise';
  renderProfile();
  refreshLaunchMeta();
  toast('Déconnecté', 'info');
});

function renderProfile() {
  const empty = $('#profile-empty');
  const loaded = $('#profile-loaded');

  if (state.profile) {
    state.authStatus = '';
    empty.classList.add('hidden');
    loaded.classList.remove('hidden');
    $('#profile-name').textContent = state.profile.name;
    applyAvatarFallback($('#profile-avatar'), state.profile);
  } else {
    if (!state.authPending && state.authStatus === 'Vérification de la session...') {
      state.authStatus = 'Connexion requise';
    }
    empty.classList.remove('hidden');
    loaded.classList.add('hidden');
  }

  renderAuthGate();
  updatePlayButton();
}

function updatePlayButton() {
  const playBtn = $('#btn-play');
  if (!playBtn) return;

  const canPlay = Boolean(state.profile) && !state.launching && !state.launchBlockReason;
  playBtn.disabled = !canPlay;
  playBtn.classList.toggle('is-ready', canPlay);
}

function profileLookupId() {
  return encodeURIComponent(state.profile?.name || String(state.profile?.uuid || 'Steve').replace(/-/g, '') || 'Steve');
}

/* ===== Fil d'actualités ===== */
function loadNews() {
  const container = $('#news-container');
  if (!container) return;

  const newsList = state.config?.news;
  if (!newsList || !newsList.length) {
    container.innerHTML = '<div class="res-empty-msg">Aucune actualité disponible pour le moment.</div>';
    return;
  }

  container.innerHTML = '';
  newsList.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'news-card-launcher';
    
    let imageHtml = '';
    if (item.image) {
      imageHtml = `<img class="news-banner" src="${escapeHtml(item.image)}" alt="" />`;
    }

    card.innerHTML = `
      ${imageHtml}
      <div class="news-meta">
        <span class="news-badge">Annonce</span>
        <span class="news-date">${escapeHtml(item.date || '')}</span>
      </div>
      <div class="news-card-title">${escapeHtml(item.title || '')}</div>
      <div class="news-card-body">${escapeHtml(item.content || '')}</div>
    `;
    container.appendChild(card);
  });
}

/* ===== Resources Manager ===== */
let activeResTab = 'textures';

function loadResources() {
  const navBtns = $$('.res-nav-btn');
  
  if (navBtns.length) {
    navBtns.forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', () => {
        const tabName = newBtn.dataset.resTab;
        activeResTab = tabName;
        
        $$('.res-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.resTab === tabName));
        $$('.res-tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${tabName}`));
        
        refreshResourcesTab(tabName);
      });
    });
  }

  refreshResourcesTab(activeResTab);
}

function refreshResourcesTab(tabName) {
  if (tabName === 'textures') {
    refreshInstalledResources('textures');
    renderRecommendedResources('textures');
    setupModrinthSearch('textures');
  } else if (tabName === 'shaders') {
    refreshInstalledResources('shaders');
    renderRecommendedResources('shaders');
    setupModrinthSearch('shaders');
  } else if (tabName === 'schematics') {
    refreshInstalledResources('schematics');
    renderRecommendedResources('schematics');
  }
}

function isResourceInstalled(title, slug, installedFiles) {
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanSlug = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (!cleanTitle && !cleanSlug) return false;
  
  return installedFiles.some(file => {
    const cleanFile = file.toLowerCase().replace(/\.(zip|jar|litematic|schem)$/, '').replace(/[^a-z0-9]/g, '');
    if (!cleanFile) return false;
    
    return (
      cleanFile === cleanTitle ||
      cleanFile === cleanSlug ||
      (cleanTitle.length > 3 && cleanFile.startsWith(cleanTitle)) ||
      (cleanSlug.length > 3 && cleanFile.startsWith(cleanSlug)) ||
      (cleanFile.length > 3 && cleanTitle.startsWith(cleanFile)) ||
      (cleanFile.length > 3 && cleanSlug.startsWith(cleanFile))
    );
  });
}

async function refreshInstalledResources(type) {
  const listEl = $(`#installed-${type}-list`);
  const openBtn = $(`#btn-open-dir-${type}`);
  if (!listEl) return;

  if (openBtn) {
    openBtn.onclick = () => window.api.resources.openFolder(type);
  }

  const res = await window.api.resources.list(type);
  if (!res.success) {
    listEl.innerHTML = `<div class="res-empty-msg">Erreur : ${escapeHtml(res.error)}</div>`;
    return;
  }

  const files = res.files || [];
  if (!files.length) {
    listEl.innerHTML = '<div class="res-empty-msg">Aucun fichier installé.</div>';
    return;
  }

  listEl.innerHTML = '';
  files.forEach(filename => {
    const item = document.createElement('div');
    item.className = 'installed-item';
    item.innerHTML = `
      <span class="installed-item-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
      <button class="btn btn-ghost btn-compact btn-delete" style="color: var(--red); border-color: rgba(255, 31, 61, 0.2)">Supprimer</button>
    `;
    item.querySelector('.btn-delete').addEventListener('click', async () => {
      if (confirm(`Voulez-vous vraiment supprimer "${filename}" ?`)) {
        await window.api.resources.delete(type, filename);
        toast('Fichier supprimé', 'info');
        refreshInstalledResources(type);
      }
    });
    listEl.appendChild(item);
  });
}

function renderRecommendedResources(type) {
  const listEl = $(`#recommended-${type}-list`);
  if (!listEl) return;

  const list = state.config?.recommendedResources?.[type];
  if (!list || !list.length) {
    listEl.innerHTML = '<div class="res-empty-msg">Aucune ressource recommandée.</div>';
    return;
  }

  listEl.innerHTML = '';
  list.forEach(item => {
    const el = document.createElement('div');
    el.className = 'recommended-item';
    el.innerHTML = `
      <div class="rec-item-name">${escapeHtml(item.name)}</div>
      <div class="rec-item-desc">${escapeHtml(item.description || '')}</div>
      <div class="rec-item-action">
        <button class="btn btn-primary btn-compact btn-install">Installer</button>
      </div>
    `;
    
    const installBtn = el.querySelector('.btn-install');
    installBtn.addEventListener('click', () => handleDownloadResource(type, item.name, item.url, installBtn));
    listEl.appendChild(el);
  });
}

function setupModrinthSearch(type) {
  const searchInput = $(`#search-${type}-input`);
  const searchBtn = $(`#btn-search-${type}`);
  const sortSelect = $(`#filter-${type}-sort`);
  if (!searchInput || !searchBtn) return;

  searchBtn.onclick = () => performModrinthSearch(type, searchInput.value);
  searchInput.onkeydown = (e) => {
    if (e.key === 'Enter') performModrinthSearch(type, searchInput.value);
  };

  if (sortSelect) {
    sortSelect.onchange = () => performModrinthSearch(type, searchInput.value);
  }

  // Pre-load automatically
  performModrinthSearch(type, searchInput.value);
}

async function performModrinthSearch(type, query) {
  const resultsEl = $(`#search-${type}-results`);
  if (!resultsEl) return;

  resultsEl.innerHTML = '<div class="news-loading">Recherche sur Modrinth...</div>';

  try {
    const projectType = type === 'textures' ? 'resourcepack' : 'shader';
    const facets = JSON.stringify([[ `project_type:${projectType}` ], [ "versions:1.21.1" ]]);
    
    const sortSelect = $(`#filter-${type}-sort`);
    const index = sortSelect ? sortSelect.value : 'downloads';
    
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(facets)}&index=${index}&limit=20`;
    
    const res = await fetch(url);
    if (!res.ok) throw new Error('Impossible de se connecter à Modrinth');
    const data = await res.json();
    
    const hits = data.hits || [];
    if (!hits.length) {
      resultsEl.innerHTML = '<div class="res-empty-msg">Aucun résultat trouvé sur Modrinth.</div>';
      return;
    }

    const installedRes = await window.api.resources.list(type);
    const installedFiles = installedRes.success ? (installedRes.files || []) : [];

    resultsEl.innerHTML = '';
    hits.forEach(hit => {
      const isInstalled = isResourceInstalled(hit.title, hit.slug || '', installedFiles);
      const card = document.createElement('div');
      card.className = 'res-card';
      
      const iconHtml = hit.icon_url 
        ? `<img class="res-card-img" src="${escapeHtml(hit.icon_url)}" alt="" />`
        : `<div class="res-card-img">${type === 'textures' ? '🎨' : '🔮'}</div>`;

      const downloadsFormatted = Number(hit.downloads).toLocaleString();
      
      const buttonText = isInstalled ? 'Installé' : 'Installer';
      const buttonClass = isInstalled ? 'btn btn-ghost btn-compact btn-install' : 'btn btn-primary btn-compact btn-install';
      const buttonDisabledAttr = isInstalled ? 'disabled' : '';

      card.innerHTML = `
        ${iconHtml}
        <div class="res-card-info">
          <div class="res-card-title-row">
            <span class="res-card-title" title="${escapeHtml(hit.title)}">${escapeHtml(hit.title)}</span>
            <button class="btn-web-link" data-url="https://modrinth.com/${escapeHtml(hit.project_type)}/${escapeHtml(hit.slug)}" title="Voir sur Modrinth">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </button>
          </div>
          <div class="res-card-desc" title="${escapeHtml(hit.description || '')}">${escapeHtml(hit.description || '')}</div>
          <div class="res-card-meta">Par ${escapeHtml(hit.author || 'Inconnu')} &bull; ${downloadsFormatted} téléchargements</div>
        </div>
        <div class="res-card-action">
          <button class="${buttonClass}" ${buttonDisabledAttr}>${buttonText}</button>
        </div>
      `;

      const webBtn = card.querySelector('.btn-web-link');
      if (webBtn) {
        webBtn.addEventListener('click', (e) => {
          e.preventDefault();
          window.api.app.openExternal(webBtn.dataset.url);
        });
      }

      const installBtn = card.querySelector('.btn-install');
      if (installBtn && !isInstalled) {
        installBtn.addEventListener('click', async () => {
          installBtn.disabled = true;
          installBtn.textContent = 'Version...';
          try {
            const fileInfo = await fetchModrinthLatestFile(hit.project_id, projectType);
            await handleDownloadResource(type, hit.title, fileInfo.url, installBtn);
          } catch (err) {
            toast(err.message, 'error');
            installBtn.disabled = false;
            installBtn.textContent = 'Installer';
          }
        });
      }

      resultsEl.appendChild(card);
    });
  } catch (err) {
    resultsEl.innerHTML = `<div class="res-empty-msg">Erreur de recherche : ${escapeHtml(err.message)}</div>`;
  }
}

async function fetchModrinthLatestFile(projectId, projectType) {
  const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
  if (!res.ok) throw new Error('Impossible de récupérer les versions du projet');
  const versions = await res.json();
  
  let bestVersion = versions[0];
  if (projectType === 'resourcepack') {
    const match = versions.find(v => v.game_versions.includes('1.21.1'));
    if (match) bestVersion = match;
  }
  
  if (!bestVersion || !bestVersion.files || !bestVersion.files.length) {
    throw new Error('Aucun fichier compatible trouvé.');
  }
  
  return bestVersion.files[0];
}

async function handleDownloadResource(type, name, url, button) {
  button.disabled = true;
  button.textContent = '0%';
  
  const offProgress = window.api.resources.onDownloadProgress(url, (data) => {
    button.textContent = `${data.percent}%`;
  });
  
  try {
    const res = await window.api.resources.download(type, name, url);
    if (!res.success) throw new Error(res.error);
    
    toast(`"${res.filename}" installé avec succès !`, 'success');
    button.textContent = 'Installé';
    button.classList.add('btn-ghost');
    button.classList.remove('btn-primary');
    refreshInstalledResources(type);
  } catch (err) {
    toast(`Installation échouée : ${err.message}`, 'error');
    button.disabled = false;
    button.textContent = 'Installer';
  } finally {
    offProgress();
  }
}

/* ===== Ambient Music Player ===== */
function initAmbientMusic() {
  if (state.musicAudio) return;
  
  const audio = document.createElement('audio');
  audio.id = 'ambient-music';
  audio.loop = true;
  document.body.appendChild(audio);
  state.musicAudio = audio;
}

function playAmbientMusic() {
  const url = state.config?.bgMusicUrl;
  if (!url || !state.musicAudio) return;

  if (state.musicAudio.src !== url) {
    state.musicAudio.src = url;
  }
  
  state.musicAudio.volume = state.musicVolume / 100;
  state.musicAudio.muted = state.musicMuted;

  if (!state.musicMuted) {
    state.musicAudio.play().catch((err) => {
      console.warn("Autoplay block or music start error:", err);
      const startOnInteraction = () => {
        if (!state.musicMuted && state.musicAudio.paused) {
          state.musicAudio.play().catch(() => {});
        }
        document.removeEventListener('click', startOnInteraction);
      };
      document.addEventListener('click', startOnInteraction);
    });
  }
}

async function loadMusicSettings() {
  let volume = await window.api.settings.get('musicVolume');
  if (volume === undefined || volume === null) volume = 50;
  volume = Math.max(0, Math.min(100, Number(volume) || 0));
  state.musicVolume = volume;

  const muted = Boolean(await window.api.settings.get('musicMuted'));
  state.musicMuted = muted;

  if (state.musicAudio) {
    state.musicAudio.volume = volume / 100;
    state.musicAudio.muted = muted;
  }

  const slider = $('#setting-music');
  if (slider) slider.value = volume;
  updateMusicSliderFill(volume);

  const muteToggle = $('#setting-music-mute');
  if (muteToggle) muteToggle.checked = muted;
}

function updateMusicSliderFill(value) {
  const slider = $('#setting-music');
  if (slider) {
    slider.style.setProperty('--music-pct', `${value}%`);
    const valText = $('#setting-music-value');
    if (valText) valText.textContent = value;
  }
}

$('#setting-music')?.addEventListener('input', (e) => {
  const value = parseInt(e.target.value, 10);
  updateMusicSliderFill(value);
  state.musicVolume = value;
  if (state.musicAudio) {
    state.musicAudio.volume = value / 100;
  }
});

$('#setting-music')?.addEventListener('change', (e) => {
  const value = parseInt(e.target.value, 10);
  window.api.settings.set('musicVolume', value);
});

$('#setting-music-mute')?.addEventListener('change', (e) => {
  const muted = e.target.checked;
  state.musicMuted = muted;
  window.api.settings.set('musicMuted', muted);
  if (state.musicAudio) {
    state.musicAudio.muted = muted;
    if (!muted && state.musicAudio.paused && state.config?.bgMusicUrl) {
      state.musicAudio.play().catch(err => console.log('Autoplay blocked:', err));
    } else if (muted) {
      state.musicAudio.pause();
    }
  }
});

/* ===== Config (Gist) + Live server status ===== */
async function loadConfig() {
  try {
    const res = await window.api.config.fetch();
    if (res.success) {
      state.config = res.config;
      if (res.config.playersOnline !== undefined) {
        animateCounter($('#stat-players'), res.config.playersOnline);
      }
      /* Lance le polling live dès qu'on a l'IP */
      refreshServerStatus();

      // Auto-load news if we switch or start on news tab
      if ($('.page.active')?.dataset.page === 'news') {
        loadNews();
      }

      // Background music initialization & playback
      initAmbientMusic();
      await loadMusicSettings();
      playAmbientMusic();
    }
  } catch (err) {
    console.error('Erreur lors du chargement de la config :', err);
  }
}

let serverPollTimer = null;
async function refreshServerStatus() {
  const ip = state.config?.serverIp;
  if (!ip) return;
  try {
    const res = await window.api.server.getStatus(ip);
    if (!res.success || !res.status) return;
    applyServerStatus(res.status);
  } catch { /* ignore */ }
  if (!serverPollTimer) serverPollTimer = setInterval(refreshServerStatus, 30000);
}

function applyServerStatus(status) {
  const dot = document.querySelector('#server-status .status-dot');
  const sidebarBlock = document.querySelector('#server-status');

  if (status.online) {
    if (dot) {
      dot.classList.remove('offline', 'live-offline');
      dot.classList.add('live-online');
    }
    /* Animation compteur joueurs avec valeur live */
    const playersEl = $('#stat-players');
    if (playersEl) animateCounter(playersEl, status.players.online);

    /* Slots totaux */
    const slotsEl = $('#stat-slots');
    if (slotsEl) animateCounter(slotsEl, status.players.max);

    /* État serveur */
    const statusEl = $('#stat-status');
    if (statusEl) {
      statusEl.textContent = 'EN LIGNE';
      statusEl.style.color = '#4ade80';
      statusEl.style.webkitTextFillColor = '#4ade80';
      statusEl.style.background = 'none';
    }

    /* Tooltip liste de joueurs si dispo */
    if (sidebarBlock) {
      renderPlayerTooltip(sidebarBlock, status.players);
    }

  } else {
    if (dot) {
      dot.classList.remove('live-online');
      dot.classList.add('live-offline');
    }
    if (sidebarBlock) sidebarBlock.removeAttribute('data-has-players');

    const statusEl = $('#stat-status');
    if (statusEl) {
      statusEl.textContent = 'HORS LIGNE';
      statusEl.style.color = '#ff4a63';
      statusEl.style.webkitTextFillColor = '#ff4a63';
      statusEl.style.background = 'none';
    }
  }
}

function renderPlayerTooltip(parent, players) {
  let tip = parent.querySelector('.player-tooltip');
  const hasList = players?.list?.length > 0;

  parent.setAttribute('data-has-players', hasList ? 'true' : 'false');

  if (!hasList) {
    if (tip) tip.dataset.show = 'false';
    return;
  }

  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'player-tooltip';
    parent.appendChild(tip);
  }

  tip.dataset.show = 'true';
  tip.innerHTML = `
    <div class="player-tooltip-title">${Number(players.online) || 0} / ${Number(players.max) || 0} en ligne</div>
    <ul>${players.list.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
  `;
}

/* ===== Block-break particles (au clic du bouton JOUER) ===== */
const BREAK_COLORS = ['#5b8c2a', '#4a7a1f', '#6b9c3a', '#866043', '#6b4a30', '#a07650'];

function spawnBlockParticles(originX, originY, count = 14) {
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement('div');
    p.className = 'block-particle';
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const distance = 60 + Math.random() * 90;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance + 40; /* gravité */
    const dr = (Math.random() - 0.5) * 540;
    const size = 5 + Math.floor(Math.random() * 4);
    const color = BREAK_COLORS[Math.floor(Math.random() * BREAK_COLORS.length)];

    p.style.cssText = `
      left: ${originX - size / 2}px;
      top: ${originY - size / 2}px;
      width: ${size}px;
      height: ${size}px;
      --dx: ${dx}px;
      --dy: ${dy}px;
      --dr: ${dr}deg;
      --break-color: ${color};
      background: ${color};
    `;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
}

(function setupBlockBreakOnPlay() {
  const btn = document.getElementById('btn-play');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    spawnBlockParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 16);
  });
})();

/* ===== Counter tween (ease-out) ===== */
function animateCounter(el, target, duration = 900) {
  if (!el) return;
  const startTxt = (el.textContent || '0').replace(/[^\d]/g, '');
  const start = parseInt(startTxt, 10) || 0;
  const end = Number(target) || 0;
  if (start === end) {
    el.textContent = end;
    return;
  }
  const t0 = performance.now();
  function step(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
    const val = Math.round(start + (end - start) * eased);
    el.textContent = val;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ===== Parallax sur les couches de fond ===== */
(function setupParallax() {
  const layers = [
    { sel: '.bg-overlay',    factor: 0.012 },
    { sel: '.bg-clouds',     factor: 0.025 },
    { sel: '.bg-mountains',  factor: 0.010 }
  ];
  let raf = null;
  document.addEventListener('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      const cx = (e.clientX / window.innerWidth - 0.5) * 2;
      const cy = (e.clientY / window.innerHeight - 0.5) * 2;
      for (const { sel, factor } of layers) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const dx = -cx * 100 * factor;
        const dy = -cy * 100 * factor;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
      raf = null;
    });
  });
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatLastPlayed(timestamp) {
  const value = Number(timestamp);
  if (!value) return 'Jamais';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Jamais';

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function applyLaunchCompatibility(info) {
  const java = info?.java;
  state.launchBlockReason = '';

  if (java && !java.valid) {
    const detected = java.run
      ? `Java ${java.version || java.major || 'trop ancien'} détecté`
      : 'Java introuvable';
    state.launchBlockReason = `${detected}. Java 21 est requis pour lancer le jeu.`;

    if (!state.launching) {
      $('#launch-status').textContent = 'Java 21 requis';
      $('#launch-sub').textContent = java.run
        ? `${detected}. Installez Java 21 ou corrigez JAVA_HOME/PATH.`
        : 'Installez Java 21 pour lancer le jeu.';
    }
  } else if (!state.launching) {
    $('#launch-status').textContent = 'Prêt à jouer';
    $('#launch-sub').textContent = 'Cliquez sur JOUER pour lancer le jeu';
  }

  updatePlayButton();
}

async function refreshLaunchMeta() {
  const [ram, lastPlayed, gameRes] = await Promise.all([
    window.api.settings.get('ram'),
    window.api.settings.get('lastPlayed'),
    window.api.game.getInfo()
  ]);

  const info = gameRes.success ? gameRes.info : null;
  state.gameInfo = info;

  const versionEl = $('#launch-meta-version');
  if (versionEl) {
    versionEl.textContent = 'Nations';
    versionEl.title = 'Mode de jeu KingNation';
  }

  const ramEl = $('#launch-meta-ram');
  if (ramEl) ramEl.textContent = ram ? `${ram} Go` : '—';

  const lastEl = $('#launch-meta-last');
  if (lastEl) lastEl.textContent = formatLastPlayed(lastPlayed);

  applyLaunchCompatibility(info);
}

/* ===== Launch ===== */
$('#btn-play').addEventListener('click', async () => {
  if (state.launching || !state.profile) return;
  if (state.launchBlockReason) {
    toast(state.launchBlockReason, 'error', 6000);
    return;
  }

  state.launching = true;
  updatePlayButton();

  const status = $('#launch-status');
  const sub = $('#launch-sub');
  const wrapper = $('#progress-wrapper');
  const fill = $('#progress-fill');
  const label = $('#progress-label');

  status.textContent = 'Préparation du jeu…';
  sub.textContent = 'Patientez quelques instants';
  wrapper.classList.remove('hidden');
  fill.style.width = '0%';

  let offProgress, offDownload, offData, offClose;

  function resetLaunchUI() {
    setTimeout(() => {
      state.launching = false;
      wrapper.classList.add('hidden');
      $('#launch-status').textContent = 'Prêt à jouer';
      $('#launch-sub').textContent = 'Cliquez sur JOUER pour lancer le jeu';
      offProgress?.();
      offDownload?.();
      offData?.();
      offClose?.();
      refreshLaunchMeta();
      updatePlayButton();
    }, 3000);
  }

  let offModsProgress;
  try {
    const modsCheck = await window.api.mods.check();
    if (modsCheck.success && !modsCheck.status.upToDate) {
      status.textContent = 'Mise à jour du contenu...';
      sub.textContent = 'Synchronisation avec KingNation';
      offModsProgress = window.api.mods.onProgress((p) => {
        if (typeof p.percent === 'number') fill.style.width = `${p.percent}%`;
        label.textContent = formatProgressLabel(p);
      });

      const updated = await window.api.mods.update();
      if (!updated.success) throw new Error(updated.error);
      setMaintenanceStatus('Contenu synchronisé', 'Les fichiers KingNation sont prêts.', 'success');
    } else if (!modsCheck.success) {
      toast(`Vérification du contenu impossible : ${friendlyLauncherError(modsCheck.error)}`, 'info', 6500);
      label.textContent = 'Mode local';
    }
  } catch (err) {
    const message = friendlyLauncherError(err.message || err);
    status.textContent = 'Réparation requise';
    sub.textContent = 'Va dans Paramètres puis lance "Réparer le jeu".';
    fill.style.width = '0%';
    label.textContent = 'Préparation arrêtée';
    wrapper.classList.add('hidden');
    state.launching = false;
    offModsProgress?.();
    setMaintenanceStatus('Action requise', message, 'error');
    toast(message, 'error', 8000);
    updatePlayButton();
    refreshLaunchMeta();
    return;
  } finally {
    offModsProgress?.();
  }

  status.textContent = 'Préparation du jeu…';
  fill.style.width = '0%';

  offProgress = window.api.launch.onProgress((p) => {
    const pct = p.total ? Math.round((p.task / p.total) * 100) : 0;
    fill.style.width = `${pct}%`;
    label.textContent = `${p.type} ${pct}%`;
  });

  offDownload = window.api.launch.onDownload((d) => {
    label.textContent = `${d.name} — ${d.status}`;
  });

  offData = window.api.launch.onData((d) => {
    if (d.type === 'log' && /Setting user/.test(d.message)) {
      status.textContent = 'Le jeu est lancé';
      sub.textContent = 'Le launcher reste ouvert pendant que vous jouez.';
    }
  });

  offClose = window.api.launch.onClose((data) => {
    resetLaunchUI();
    // Resume music if enabled
    if (!state.musicMuted && state.musicAudio) {
      state.musicAudio.play().catch(() => {});
    }

    const code = data?.code;
    if (code && code !== 0) {
      // Minecraft exited with an error code → auto-surface the diagnostic.
      status.textContent = 'Le jeu a planté';
      sub.textContent = `Consulte le diagnostic ci-dessous (code ${code}).`;
      showCrashDiagnostic(code);
    } else {
      status.textContent = 'Jeu fermé';
      sub.textContent = 'Prêt à rejouer';
    }
  });

  const res = await window.api.launch.start({});

  if (!res.success) {
    const message = friendlyLauncherError(res.error);
    toast(`Échec lancement : ${message}`, 'error', 8000);
    setMaintenanceStatus('Lancement échoué', message, 'error');
    resetLaunchUI();
  } else {
    // Pause background music
    if (state.musicAudio) {
      state.musicAudio.pause();
    }
    toast('Lancement réussi', 'success');
    window.api.settings.set('lastPlayed', Date.now());
    refreshLaunchMeta();
  }
});

/* ===== Settings (RAM only) ===== */
const ramConfig = { min: 2, max: 16, recommended: 4 };

function updateRamSliderFill(value) {
  const { min, max } = ramConfig;
  const pct = ((value - min) / (max - min)) * 100;
  $('#setting-ram').style.setProperty('--ram-pct', `${pct}%`);
  $('#setting-ram-value').textContent = value;
}

function buildRamTicks() {
  const { min, max, recommended } = ramConfig;
  const ticksContainer = $('#ram-ticks');
  ticksContainer.innerHTML = '';

  const range = max - min;
  const step = range <= 8 ? 1 : range <= 16 ? 2 : range <= 24 ? 4 : 4;
  const values = [];
  for (let v = min; v <= max; v += step) values.push(v);
  if (values[values.length - 1] !== max) values.push(max);

  for (const v of values) {
    const span = document.createElement('span');
    span.textContent = v;
    if (v === recommended) span.classList.add('is-recommended');
    ticksContainer.appendChild(span);
  }
}

async function loadSettings() {
  const info = await window.api.system.getRamInfo();
  ramConfig.min = info.minGb;
  ramConfig.max = info.maxGb;
  ramConfig.recommended = info.recommendedGb;

  const slider = $('#setting-ram');
  slider.min = info.minGb;
  slider.max = info.maxGb;

  let ram = (await window.api.settings.get('ram')) || info.recommendedGb;
  if (ram > info.maxGb) ram = info.maxGb;
  if (ram < info.minGb) ram = info.minGb;

  slider.value = ram;
  await window.api.settings.set('ram', ram);
  updateRamSliderFill(ram);
  buildRamTicks();

  $('#ram-total').textContent = `${info.totalGb} Go`;
  $('#ram-recommended').textContent = `${info.recommendedGb} Go`;
}

$('#setting-ram').addEventListener('input', (e) => {
  updateRamSliderFill(e.target.value);
});

$('#setting-ram').addEventListener('change', (e) => {
  window.api.settings.set('ram', parseInt(e.target.value, 10));
  refreshLaunchMeta();
});

$('#ram-quick-rec').addEventListener('click', () => {
  $('#setting-ram').value = ramConfig.recommended;
  updateRamSliderFill(ramConfig.recommended);
  window.api.settings.set('ram', ramConfig.recommended);
  toast(`RAM réglée à ${ramConfig.recommended} Go (recommandée)`, 'info', 2500);
});

$('#ram-quick-max').addEventListener('click', () => {
  $('#setting-ram').value = ramConfig.max;
  updateRamSliderFill(ramConfig.max);
  window.api.settings.set('ram', ramConfig.max);
  toast(`RAM réglée à ${ramConfig.max} Go (maximum)`, 'info', 2500);
});

/* ===== SFX Settings ===== */
function updateSfxSliderFill(value) {
  $('#setting-sfx').style.setProperty('--sfx-pct', `${value}%`);
  $('#setting-sfx-value').textContent = value;
}

async function loadSfxSettings() {
  let volume = await window.api.settings.get('sfxVolume');
  if (volume === undefined || volume === null) volume = 45;
  volume = Math.max(0, Math.min(100, Number(volume) || 0));

  const muted = Boolean(await window.api.settings.get('sfxMuted'));

  window.sfx?.setVolume(volume / 100);
  window.sfx?.setMuted(muted);

  const slider = $('#setting-sfx');
  if (slider) slider.value = volume;
  updateSfxSliderFill(volume);

  const muteToggle = $('#setting-sfx-mute');
  if (muteToggle) muteToggle.checked = muted;
}

$('#setting-sfx')?.addEventListener('input', (e) => {
  const value = parseInt(e.target.value, 10);
  updateSfxSliderFill(value);
  window.sfx?.setVolume(value / 100);
});

$('#setting-sfx')?.addEventListener('change', (e) => {
  const value = parseInt(e.target.value, 10);
  window.api.settings.set('sfxVolume', value);
});

$('#setting-sfx-mute')?.addEventListener('change', (e) => {
  const muted = e.target.checked;
  window.sfx?.setMuted(muted);
  window.api.settings.set('sfxMuted', muted);
  if (!muted) playSfx('click');
});

$('#btn-sfx-test')?.addEventListener('click', () => {
  playSfx('preview');
});

$('#btn-open-folder').addEventListener('click', () => window.api.app.openFolder());
$('#btn-open-logs')?.addEventListener('click', () => window.api.app.openLogsFolder());
$('#btn-open-crash')?.addEventListener('click', () => window.api.app.openCrashFolder());

function setMaintenanceButtonsDisabled(disabled) {
  ['#btn-repair-game', '#btn-reinstall-mods', '#btn-copy-diagnostic'].forEach((selector) => {
    const button = $(selector);
    if (button) button.disabled = disabled;
  });
}

async function runMaintenanceAction(button, action, busyText, startTitle, startDetail) {
  if (!button || button.dataset.busy === '1') return;

  button.dataset.busy = '1';
  const originalText = button.textContent;
  button.textContent = busyText;
  setMaintenanceButtonsDisabled(true);
  button.disabled = true;
  setMaintenanceStatus(startTitle, startDetail, 'warning');

  const off = window.api.mods.onProgress((p) => {
    const label = formatProgressLabel(p);
    button.textContent = typeof p.percent === 'number' ? `${p.percent}%` : busyText;
    setMaintenanceStatus('Maintenance en cours', label, 'warning');
  });

  const res = await window.api.mods[action]();
  off?.();

  setMaintenanceButtonsDisabled(false);
  button.dataset.busy = '0';
  button.textContent = originalText;

  if (res.success) {
    const result = action === 'repair' ? res.result.mods : res.result;
    const installed = action === 'repair'
      ? (res.result.diagnostics?.jarCount ?? result?.installed ?? 0)
      : (result?.installed ?? 0);
    const removed = (result?.removedDuplicates || []).length + (result?.removedExtra || []).length;
    const detail = removed
      ? `${installed} fichier(s) en place, ${removed} fichier(s) nettoyé(s).`
      : `${installed} fichier(s) en place.`;
    setMaintenanceStatus('Installation prête', detail, 'success');
    toast(action === 'repair' ? 'Jeu réparé' : 'Contenu réinstallé', 'success');
    refreshLaunchMeta();
  } else {
    const message = friendlyLauncherError(res.error);
    setMaintenanceStatus('Maintenance échouée', message, 'error');
    toast(`Erreur : ${message}`, 'error', 8000);
  }
}

$('#btn-repair-game')?.addEventListener('click', () => {
  runMaintenanceAction(
    $('#btn-repair-game'),
    'repair',
    'Réparation...',
    'Réparation du jeu',
    'Téléchargement/verrouillage du contenu, NeoForge et fichiers KingNation.'
  );
});

$('#btn-reinstall-mods')?.addEventListener('click', () => {
  runMaintenanceAction(
    $('#btn-reinstall-mods'),
    'reinstall',
    'Réinstallation...',
    'Réinstallation du contenu',
    'Suppression du contenu serveur local puis nouveau téléchargement.'
  );
});

$('#btn-copy-diagnostic')?.addEventListener('click', async () => {
  const btn = $('#btn-copy-diagnostic');
  if (btn.dataset.busy === '1') return;

  const originalText = btn.textContent;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = 'Copie...';
  setMaintenanceStatus('Diagnostic', 'Lecture des derniers logs Minecraft...', 'warning');

  const res = await window.api.diagnostics.copy();

  btn.dataset.busy = '0';
  btn.disabled = false;
  btn.textContent = originalText;

  if (res.success) {
    const count = res.report?.issues?.length || 0;
    const detail = count
      ? `${count} point(s) détecté(s). Le rapport est copié dans le presse-papiers.`
      : 'Aucun problème évident trouvé dans les logs disponibles. Rapport copié.';
    setMaintenanceStatus('Diagnostic copié', detail, count ? 'warning' : 'success');
    toast('Diagnostic copié', 'success');
  } else {
    const message = friendlyLauncherError(res.error);
    setMaintenanceStatus('Diagnostic impossible', message, 'error');
    toast(`Diagnostic : ${message}`, 'error', 7000);
  }
});

/* ===== Init ===== */
function tagSfxButtons() {
  const playBtn = $('#btn-play');
  if (playBtn) playBtn.dataset.sfx = 'launch';
  $$('.nav-item').forEach((b) => { b.dataset.sfx = 'page'; });
  const discord = $('#btn-discord');
  if (discord) discord.dataset.sfx = 'pop';
  ['#btn-min', '#btn-max', '#btn-close'].forEach((sel) => {
    const el = $(sel);
    if (el) el.dataset.sfx = 'none';
  });
}

/* ===== Terms & Rules ===== */
async function checkTerms() {
  const accepted = await window.api.settings.get('termsAccepted');
  if (!accepted) {
    const backdrop = $('#terms-backdrop');
    if (backdrop) backdrop.classList.remove('hidden');

    $('#btn-terms-accept')?.addEventListener('click', async () => {
      await window.api.settings.set('termsAccepted', true);
      backdrop.classList.add('hidden');
      playSfx('success');
      toast('Charte acceptée, bienvenue sur KingNation !', 'success');
    });

    $('#btn-terms-decline')?.addEventListener('click', () => {
      window.api.window.close();
    });
  }
}

async function initLitematicaSettings() {
  const litematicaToggle = $('#toggle-litematica');
  if (!litematicaToggle) return;

  const useLitematica = Boolean(await window.api.settings.get('useLitematica'));
  litematicaToggle.checked = useLitematica;

  litematicaToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    litematicaToggle.disabled = true;
    
    const toastId = toast(enabled ? "Téléchargement et activation de Litematica..." : "Désactivation de Litematica...", 'info', 15000);
    playSfx('click');

    const unbindProgress = window.api.litematica.onProgress((data) => {
      if (data.message) {
        console.log('[Litematica Sync]', data.message);
      }
    });
    
    try {
      const res = await window.api.litematica.sync(enabled);
      if (!res.success) throw new Error(res.error);
      
      toast(enabled ? "Litematica (Forgematica + MaFgLib) installé avec succès !" : "Litematica désactivé.", 'success');
      playSfx('success');
    } catch (err) {
      toast(`Erreur Litematica : ${err.message}`, 'error');
      litematicaToggle.checked = !enabled;
    } finally {
      litematicaToggle.disabled = false;
      unbindProgress();
    }
  });
}

async function init() {
  await checkTerms();
  initBackgroundMotion();
  tagSfxButtons();
  await loadSfxSettings();

  const version = await window.api.app.getVersion();
  const settingsVersion = $('#app-version-2');
  if (settingsVersion) settingsVersion.textContent = `v${version}`;

  const stored = await window.api.auth.getProfile();
  if (stored) {
    state.profile = stored;
    renderProfile();
    const refreshed = await window.api.auth.refresh();
    if (refreshed.success) {
      state.profile = refreshed.profile;
      renderProfile();
    } else {
      await window.api.auth.logout();
      state.profile = null;
      state.authStatus = 'Session expirée. Reconnectez-vous avec Microsoft.';
      renderProfile();
    }
  } else {
    renderProfile();
  }

  await loadSettings();
  await initLitematicaSettings();
  loadConfig();
  refreshLaunchMeta();

  // Écouteurs pour les mises à jour périodiques en arrière-plan
  window.api.updater.onAvailable((info) => {
    toast(`Une mise à jour (${info.version}) est disponible et se télécharge en arrière-plan...`, 'info', 6000);
  });

  window.api.updater.onReadyToInstall((info) => {
    const container = $('#toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast success';
    el.style.cursor = 'pointer';
    el.style.borderLeft = '4px solid #4ade80';
    el.innerHTML = `<div><strong>Mise à jour prête (v${info.version})</strong><br>Cliquez ici pour redémarrer et l'installer.</div>`;
    el.addEventListener('click', () => {
      window.api.updater.quitAndInstall();
    });
    container.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) {
        el.style.opacity = '0';
        el.style.transform = 'translateX(40px)';
        el.style.transition = 'all .25s';
        setTimeout(() => el.remove(), 250);
      }
    }, 15000);
  });
}

init().catch((e) => {
  console.error(e);
  toast(`Erreur d'initialisation : ${e.message}`, 'error');
});
