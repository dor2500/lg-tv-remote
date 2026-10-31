const { contextBridge, ipcRenderer } = require('electron');

const events = ['status', 'tv-state', 'frame', 'live-stopped'];

contextBridge.exposeInMainWorld('tvRemote', {
  action: (name, ...args) => ipcRenderer.invoke('tv:action', name, ...args),
  connect: (host, pairingType, brand) => ipcRenderer.invoke('tv:connect', host, pairingType, brand),
  disconnect: () => ipcRenderer.invoke('tv:disconnect'),
  forget: (host) => ipcRenderer.invoke('tv:forget', host),
  saved: () => ipcRenderer.invoke('tv:saved'),
  discover: () => ipcRenderer.invoke('tv:discover'),
  wake: (host) => ipcRenderer.invoke('tv:wake', host),
  liveStart: (ms) => ipcRenderer.invoke('live:start', ms),
  liveInterval: (ms) => ipcRenderer.invoke('live:interval', ms),
  liveStop: () => ipcRenderer.invoke('live:stop'),
  move: (dx, dy) => ipcRenderer.send('pointer:move', dx, dy),
  scroll: (dx, dy) => ipcRenderer.send('pointer:scroll', dx, dy),
  on: (channel, handler) => {
    if (events.includes(channel)) ipcRenderer.on(channel, (_e, payload) => handler(payload));
  },
});
