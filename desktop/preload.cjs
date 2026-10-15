'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const STATE_CHANNEL = 'streamly-update:state';

contextBridge.exposeInMainWorld('streamlyUpdater', {
  getState: () => ipcRenderer.invoke('streamly-update:get-state'),
  download: () => ipcRenderer.invoke('streamly-update:download'),
  install: () => ipcRenderer.invoke('streamly-update:install'),
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(STATE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(STATE_CHANNEL, listener);
  },
});