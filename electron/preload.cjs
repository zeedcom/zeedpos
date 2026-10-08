const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('updater', {
  onAvailable: (cb) => on('update:available', cb),
  onProgress: (cb) => on('update:progress', cb),
  onDownloaded: (cb) => on('update:downloaded', cb),
  onError: (cb) => on('update:error', cb),
  install: () => ipcRenderer.invoke('update:install'),
  check: () => ipcRenderer.invoke('update:check'),
});
contextBridge.exposeInMainWorld('pos', {

  // -------------------------
  // Existing POS functions
  // -------------------------

  getPaths: () =>
    ipcRenderer.invoke('get-paths'),

  getLocalConfig: () =>
    ipcRenderer.invoke('get-local-config'),

  setLocalConfig: (config) =>
    ipcRenderer.invoke(
      'set-local-config',
      config
    ),

  getLanIp: () =>
    ipcRenderer.invoke('get-lan-ip'),

  getApiInfo: () =>
    ipcRenderer.invoke('get-api-info'),

  quit: () =>
    ipcRenderer.send('app-quit'),

  reload: () =>
    ipcRenderer.send('app-reload'),


  // -------------------------
  // License
  // -------------------------

  getLicenseStatus: () =>
    ipcRenderer.invoke(
      'license:get-status'
    ),

  activateLicense: (licenseKey) =>
    ipcRenderer.invoke(
      'license:activate',
      licenseKey
    ),

});