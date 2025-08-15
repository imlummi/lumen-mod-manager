// src/preload.js (Complete with update manager support)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // Theme support
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (event, theme) => callback(theme));
  },
  
  // Setup
  getSetupStatus: () => ipcRenderer.invoke('get-setup-status'),
  browseModsFolder: () => ipcRenderer.invoke('browse-mods-folder'),
  
  // Profile Management
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  createProfile: (profileData) => ipcRenderer.invoke('create-profile', profileData),
  deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),
  switchProfile: (profileId) => ipcRenderer.invoke('switch-profile', profileId),
  getProfileMods: (profileId) => ipcRenderer.invoke('get-profile-mods', profileId),
  getCurrentProfile: () => ipcRenderer.invoke('get-current-profile'),
  
  // Search and download
  searchMods: (query, filters) => ipcRenderer.invoke('search-mods', query, filters),
  getModDetails: (projectId) => ipcRenderer.invoke('get-mod-details', projectId),
  downloadMod: (versionData, fileName) => ipcRenderer.invoke('download-mod', versionData, fileName),
  
  // Mod management
  getInstalledMods: () => ipcRenderer.invoke('get-installed-mods'),
  deleteMod: (modPath) => ipcRenderer.invoke('delete-mod', modPath),
  openModsFolder: () => ipcRenderer.invoke('open-mods-folder'),
  
  // Update Manager APIs
  checkForUpdates: (profileId) => ipcRenderer.invoke('check-for-updates', profileId),
  updateMods: (mods, profileId) => ipcRenderer.invoke('update-mods', mods, profileId),
  getModRegistry: (profileId) => ipcRenderer.invoke('get-mod-registry', profileId),
  updateModRegistry: (profileId, modData) => ipcRenderer.invoke('update-mod-registry', profileId, modData),
  createModBackup: (modPath, profileId) => ipcRenderer.invoke('create-mod-backup', modPath, profileId),
  restoreModBackup: (modPath, profileId) => ipcRenderer.invoke('restore-mod-backup', modPath, profileId),
  
  // Update Manager Event Listeners
  onUpdateCheckStarted: (callback) => {
    ipcRenderer.on('update-check-started', (event, data) => callback(data));
  },
  onCheckingMod: (callback) => {
    ipcRenderer.on('checking-mod', (event, data) => callback(data));
  },
  onUpdateCheckCompleted: (callback) => {
    ipcRenderer.on('update-check-completed', (event, data) => callback(data));
  },
  onBatchUpdateProgress: (callback) => {
    ipcRenderer.on('batch-update-progress', (event, data) => callback(data));
  },
  onUpdateStarted: (callback) => {
    ipcRenderer.on('update-started', (event, data) => callback(data));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  onUpdateCompleted: (callback) => {
    ipcRenderer.on('update-completed', (event, data) => callback(data));
  },
  onUpdateFailed: (callback) => {
    ipcRenderer.on('update-failed', (event, data) => callback(data));
  },
  onBatchUpdateCompleted: (callback) => {
    ipcRenderer.on('batch-update-completed', (event, data) => callback(data));
  },
  
  // Utility functions
  openChangelog: (changelog) => ipcRenderer.invoke('open-changelog', changelog),
  closeUpdateManager: () => ipcRenderer.invoke('close-update-manager'),
  showNotification: (title, message, type) => ipcRenderer.invoke('show-notification', title, message, type),
  
  // File operations
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  
  // Remove event listeners (cleanup)
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});