'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  start: () => ipcRenderer.invoke('bot:start'),
  stop: () => ipcRenderer.invoke('bot:stop'),
  status: () => ipcRenderer.invoke('bot:status'),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('log', listener);
    return () => ipcRenderer.removeListener('log', listener);
  },
});
