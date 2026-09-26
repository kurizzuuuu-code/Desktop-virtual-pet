const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  backupConfig: () => ipcRenderer.invoke('backup-config'),
  restoreBackup: () => ipcRenderer.invoke('restore-backup'),
  getFactoryDefaults: () => ipcRenderer.invoke('get-factory-defaults'),
  getCursor: () => ipcRenderer.invoke('get-cursor'),
  getWorkArea: () => ipcRenderer.invoke('get-work-area'),
  getOtherPets: () => ipcRenderer.invoke('get-other-pets'),
  getPetBounds: () => ipcRenderer.invoke('get-pet-bounds'),
  movePet: (pos) => ipcRenderer.invoke('move-pet', pos),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  setCursorOverPet: (over) => ipcRenderer.send('pet-cursor-over', !!over),
  reportHitRegions: (regions) => ipcRenderer.send('pet-hit-regions', regions),
  openSettings: () => ipcRenderer.send('open-settings'),
  showPetMenu: () => ipcRenderer.send('show-pet-menu'),
  startPetDrag: (offset) => ipcRenderer.send('pet-drag-start', offset),
  endPetDrag: () => ipcRenderer.send('pet-drag-end'),
  onPetDragRelease: (cb) => {
    ipcRenderer.on('pet-drag-release', (_, pos) => cb(pos));
  },
  tryCloseRandomApp: () => ipcRenderer.send('try-close-random-app'),
  testCloseRandomApp: () => ipcRenderer.invoke('test-close-random-app'),
  onChaosClose: (cb) => {
    ipcRenderer.on('chaos-close', (_, data) => cb(data));
  },
  triggerPrank: (effect) => ipcRenderer.send('prank-trigger', effect),
  prankTest: (effect, petId) => ipcRenderer.invoke('prank-test', effect, petId),
  onPrankEffect: (cb) => {
    ipcRenderer.on('prank-effect', (_, data) => cb(data));
  },
  onPrankEnd: (cb) => {
    ipcRenderer.on('prank-end', (_, data) => cb(data));
  },
  prankDone: (effect) => ipcRenderer.send('prank-done', effect),
  prankAbort: (effect) => ipcRenderer.send('prank-abort', effect),
  reportAudioLevel: (data) => ipcRenderer.send('audio-level', data),
  sendSystemAudioLevel: (data) => ipcRenderer.send('system-audio-level', data),
  stopSystemAudio: () => ipcRenderer.send('system-audio-stopped'),
  onAudioLevel: (cb) => {
    ipcRenderer.on('audio-level', (_, data) => cb(data));
  },
  onSystemAudioLevel: (cb) => {
    ipcRenderer.on('system-audio-level', (_, data) => cb(data));
  },
  onConfigUpdated: (cb) => {
    ipcRenderer.on('config-updated', (_, config) => cb(config));
  },
  startWanderSession: (durationMs) => ipcRenderer.invoke('start-wander-session', durationMs),
  onWanderSessionStart: (cb) => {
    ipcRenderer.on('wander-session-start', (_, ms) => cb(ms));
  },
  reportWanderStatus: (status) => ipcRenderer.send('wander-session-status', status),
  onWanderSessionStatus: (cb) => {
    ipcRenderer.on('wander-session-status', (_, status) => cb(status));
  },
  setPetEnabled: (enabled) => ipcRenderer.invoke('set-pet-enabled', enabled),
  quitApp: () => ipcRenderer.send('quit-app'),
  onPetPowerChanged: (cb) => {
    ipcRenderer.on('pet-power-changed', (_, enabled) => cb(enabled));
  },
  onPetPower: (cb) => {
    ipcRenderer.on('pet-power', (_, enabled) => cb(enabled));
  },
  pickAvatarGif: (slot, petId) => ipcRenderer.invoke('pick-avatar-gif', slot, petId),
  clearAvatarGif: (slot, petId) => ipcRenderer.invoke('clear-avatar-gif', slot, petId),
  listCharacterPacks: () => ipcRenderer.invoke('list-character-packs'),
  applyCharacterPack: (name, petId) => ipcRenderer.invoke('apply-character-pack', name, petId),
  openCharacterPacksFolder: () => ipcRenderer.invoke('open-character-packs-folder'),
  saveCharacterPack: (name, petId) => ipcRenderer.invoke('save-character-pack', name, petId),
  removeAvatarVariant: (slot, index, petId) => ipcRenderer.invoke('remove-avatar-variant', slot, index, petId),
  setAvatarMode: (slot, mode, petId) => ipcRenderer.invoke('set-avatar-mode', slot, mode, petId),
  setVariantNext: (slot, index, next, petId) => ipcRenderer.invoke('set-variant-next', slot, index, next, petId),
  packPreview: (name) => ipcRenderer.invoke('pack-preview', name),
  pickSpeechSound: (slot, petId) => ipcRenderer.invoke('pick-speech-sound', slot, petId),
  clearSpeechSound: (slot, petId) => ipcRenderer.invoke('clear-speech-sound', slot, petId),
  addPet: () => ipcRenderer.invoke('add-pet'),
  removePet: (petId) => ipcRenderer.invoke('remove-pet', petId),
  duplicatePet: (petId) => ipcRenderer.invoke('duplicate-pet', petId),
  getPetId: () => new URLSearchParams(window.location.search).get('petId'),
  startTagSession: (data) => ipcRenderer.send('tag-session-start', data),
  endTagSession: () => ipcRenderer.send('tag-session-end'),
  testTagSession: () => ipcRenderer.invoke('test-tag-session'),
  testGift: () => ipcRenderer.invoke('test-gift'),
  voxTest: () => ipcRenderer.invoke('vox-test'),
  voxSpeakers: () => ipcRenderer.invoke('vox-speakers'),
  speakText: (text, petId) => ipcRenderer.invoke('vox-speak', text, petId),
  voxCoreStatus: () => ipcRenderer.invoke('vox-core-status'),
  voxCoreDownload: () => ipcRenderer.invoke('vox-core-download'),
  voxCoreCancel: () => ipcRenderer.invoke('vox-core-cancel'),
  voxModelDownload: (vvm) => ipcRenderer.invoke('vox-model-download', vvm),
  voxGpuStatus: () => ipcRenderer.invoke('vox-gpu-status'),
  voxGpuDownload: () => ipcRenderer.invoke('vox-gpu-download'),
  voxGpuCancel: () => ipcRenderer.invoke('vox-gpu-cancel'),
  onVoxCoreProgress: (cb) => {
    ipcRenderer.on('vox-core-progress', (_, data) => cb(data));
  },
  onGiftGiveNow: (cb) => {
    ipcRenderer.on('gift-give-now', (_, data) => cb(data));
  },
  chatSend: (data) => ipcRenderer.send('chat-send', data),
  chatReply: (data) => ipcRenderer.send('chat-reply', data),
  onChatMessage: (cb) => {
    ipcRenderer.on('chat-message', (_, data) => cb(data));
  },
  onChatReply: (cb) => {
    ipcRenderer.on('chat-reply', (_, data) => cb(data));
  },
  aiChat: (messages) => ipcRenderer.invoke('ai-chat', messages),
  proactiveChat: (brief) => ipcRenderer.invoke('proactive-chat', brief),
  aiStatus: () => ipcRenderer.invoke('ai-status'),

  testForegroundContext: (options) => ipcRenderer.invoke('test-foreground-context', options),
  onTagSession: (cb) => {
    ipcRenderer.on('tag-session', (_, data) => cb(data));
  },
  onForegroundContext: (cb) => {
    ipcRenderer.on('foreground-context', (_, data) => cb(data));
  },
  onPerformanceMode: (cb) => {
    ipcRenderer.on('performance-mode', (_, data) => cb(data));
  },
  sendGift: (data) => ipcRenderer.send('gift-send', data),
  sendSocialGreet: (data) => ipcRenderer.send('social-greet', data),
  onSocialGreetReceive: (cb) => {
    ipcRenderer.on('social-greet-receive', (_, data) => cb(data));
  },
  sendSocialChat: (data) => ipcRenderer.send('social-chat', data),
  onSocialChatReceive: (cb) => {
    ipcRenderer.on('social-chat-receive', (_, data) => cb(data));
  },
  sendJealous: (data) => ipcRenderer.send('social-jealous', data),
  onJealousReceive: (cb) => {
    ipcRenderer.on('social-jealous-receive', (_, data) => cb(data));
  },
  onBondMilestone: (cb) => {
    ipcRenderer.on('bond-milestone', (_, data) => cb(data));
  },
  onRpsStart: (cb) => {
    ipcRenderer.on('rps-start', (_, data) => cb(data));
  },
  onPetDirect: (cb) => {
    ipcRenderer.on('pet-direct', (_, data) => cb(data));
  },
  petDirectReply: (msg) => ipcRenderer.send('pet-direct-reply', msg),
  pickPrankImage: (which) => ipcRenderer.invoke('pick-prank-image', which),
  prankNow: () => ipcRenderer.invoke('prank-now'),
  reportMemory: (patch) => ipcRenderer.send('pet-memory', patch),
  addBond: (otherId, delta) => ipcRenderer.send('pet-bond', { otherId, delta }),
  onGiftReceive: (cb) => {
    ipcRenderer.on('gift-receive', (_, data) => cb(data));
  },
  testProcessWatch: () => ipcRenderer.invoke('test-process-watch'),
  testOcrScan: () => ipcRenderer.invoke('test-ocr-scan'),
  onOcrStatus: (cb) => {
    ipcRenderer.on('ocr-status', (_, data) => cb(data));
  },
  windowMin: () => ipcRenderer.send('window-min'),
  windowMaxToggle: () => ipcRenderer.send('window-max-toggle'),
  windowClose: () => ipcRenderer.send('window-close'),
  ocrManual: () => ipcRenderer.send('ocr-manual'),
  getOcrLog: () => ipcRenderer.invoke('get-ocr-log'),
});
