const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getProfile: () => ipcRenderer.invoke('auth:getProfile'),
    refresh: () => ipcRenderer.invoke('auth:refresh')
  },

  config: {
    fetch: () => ipcRenderer.invoke('config:fetch')
  },

  server: {
    getStatus: (ip) => ipcRenderer.invoke('server:getStatus', ip)
  },

  game: {
    getInfo: () => ipcRenderer.invoke('game:getInfo')
  },

  mods: {
    check: () => ipcRenderer.invoke('mods:check'),
    update: () => ipcRenderer.invoke('mods:update'),
    reinstall: () => ipcRenderer.invoke('mods:reinstall'),
    repair: () => ipcRenderer.invoke('mods:repair'),
    onProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('mods:progress', listener);
      return () => ipcRenderer.removeListener('mods:progress', listener);
    }
  },

  resources: {
    list: (type) => ipcRenderer.invoke('resources:list', type),
    delete: (type, filename) => ipcRenderer.invoke('resources:delete', type, filename),
    download: (type, name, url) => ipcRenderer.invoke('resources:download', type, name, url),
    openFolder: (type) => ipcRenderer.invoke('resources:openFolder', type),
    onDownloadProgress: (url, callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on(`resources:download-progress:${url}`, listener);
      return () => ipcRenderer.removeListener(`resources:download-progress:${url}`, listener);
    }
  },

  launch: {
    start: (options) => ipcRenderer.invoke('launch:start', options),
    onProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('launch:progress', listener);
      return () => ipcRenderer.removeListener('launch:progress', listener);
    },
    onData: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('launch:data', listener);
      return () => ipcRenderer.removeListener('launch:data', listener);
    },
    onClose: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('launch:close', listener);
      return () => ipcRenderer.removeListener('launch:close', listener);
    },
    onError: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('launch:error', listener);
      return () => ipcRenderer.removeListener('launch:error', listener);
    },
    onDownload: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('launch:download-status', listener);
      return () => ipcRenderer.removeListener('launch:download-status', listener);
    }
  },

  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },

  litematica: {
    sync: (enabled) => ipcRenderer.invoke('litematica:sync', enabled),
    onProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('litematica:progress', listener);
      return () => ipcRenderer.removeListener('litematica:progress', listener);
    }
  },

  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    openFolder: () => ipcRenderer.invoke('app:openFolder'),
    openCrashFolder: () => ipcRenderer.invoke('app:openCrashFolder'),
    openLogsFolder: () => ipcRenderer.invoke('app:openLogsFolder'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },

  system: {
    getRamInfo: () => ipcRenderer.invoke('system:getRamInfo')
  },

  diagnostics: {
    collect: () => ipcRenderer.invoke('diagnostics:collect'),
    copy: () => ipcRenderer.invoke('diagnostics:copy')
  },

  updater: {
    onProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('updater:progress', listener);
      return () => ipcRenderer.removeListener('updater:progress', listener);
    },
    onAvailable: (callback) => {
      const listener = (_event, info) => callback(info);
      ipcRenderer.on('updater:available', listener);
      return () => ipcRenderer.removeListener('updater:available', listener);
    },
    onReadyToInstall: (callback) => {
      const listener = (_event, info) => callback(info);
      ipcRenderer.on('updater:readyToInstall', listener);
      return () => ipcRenderer.removeListener('updater:readyToInstall', listener);
    },
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall')
  }
});
