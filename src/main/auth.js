const { Auth } = require('msmc');

const authManager = new Auth('select_account');

async function login() {
  const xboxManager = await authManager.launch('electron');
  const token = await xboxManager.getMinecraft();

  if (!token.profile) {
    throw new Error('Aucun profil Minecraft trouvé — un compte Minecraft Premium est requis.');
  }

  const mclcAuth = token.mclc();

  return {
    name: mclcAuth.name,
    uuid: mclcAuth.uuid,
    access_token: mclcAuth.access_token,
    client_token: mclcAuth.client_token,
    user_properties: mclcAuth.user_properties,
    meta: mclcAuth.meta,
    refresh: token.parent.msToken.refresh_token,
    avatar: `https://mc-heads.net/avatar/${encodeURIComponent(mclcAuth.name)}/64`
  };
}

async function refresh(profile) {
  if (!profile?.refresh) throw new Error('Pas de refresh token disponible');

  const xboxManager = await authManager.refresh(profile.refresh);
  const token = await xboxManager.getMinecraft();

  if (!token.profile) throw new Error('Profil Minecraft introuvable');

  const mclcAuth = token.mclc();
  return {
    name: mclcAuth.name,
    uuid: mclcAuth.uuid,
    access_token: mclcAuth.access_token,
    client_token: mclcAuth.client_token,
    user_properties: mclcAuth.user_properties,
    meta: mclcAuth.meta,
    refresh: token.parent.msToken.refresh_token,
    avatar: `https://mc-heads.net/avatar/${encodeURIComponent(mclcAuth.name)}/64`
  };
}

module.exports = { login, refresh };
