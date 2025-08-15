// src/main.js (Complete with update manager integration)
const { app } = require('electron');

// Disable GPU acceleration
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const { BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

// Import Update Manager
const UpdateManager = require('./services/update-manager');

class LumenApp {
  constructor() {
    this.mainWindow = null;
    this.modsPath = null;
    this.settings = this.loadSettings();
    this.updateManager = null;
  }

  loadSettings() {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
    return { 
      modsPath: null,
      theme: 'dark',
      autoUpdate: true,
      downloadLocation: 'mods-folder',
      showNotifications: true,
      compactView: false,
      currentProfile: 'default',
      profiles: {
        default: {
          name: 'Default Profile',
          description: 'Default mod configuration',
          createdAt: Date.now(),
          gameVersion: '1.20.1',
          loader: 'fabric'
        }
      }
    };
  }

  saveSettings() {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  getProfilePath(profileId) {
    return path.join(app.getPath('userData'), 'profiles', profileId);
  }

  async createProfileDirectory(profileId) {
    const profilePath = this.getProfilePath(profileId);
    await fs.ensureDir(profilePath);
    return profilePath;
  }

  // Profile Manager for Update Manager
  getProfileManager() {
    return {
      getProfile: (profileId) => {
        const profile = this.settings.profiles[profileId];
        if (!profile) return null;
        
        return {
          id: profileId,
          ...profile,
          path: this.getProfilePath(profileId),
          modsPath: this.settings.modsPath
        };
      },
      getCurrentProfileId: () => this.settings.currentProfile,
      getProfilePath: (profileId) => this.getProfilePath(profileId)
    };
  }

  // Modrinth API wrapper for Update Manager
  getModrinthAPI() {
    return {
      getLatestVersion: async (projectId, gameVersion, loader) => {
        try {
          const response = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, {
            headers: { 'User-Agent': 'Lumen-Mod-Manager/1.0.0' },
            params: {
              game_versions: JSON.stringify([gameVersion]),
              loaders: JSON.stringify([loader])
            }
          });

          const versions = response.data;
          return versions.find(v => 
            v.game_versions.includes(gameVersion) && 
            v.loaders.includes(loader)
          ) || versions[0];
        } catch (error) {
          throw new Error(`Failed to get latest version: ${error.message}`);
        }
      },

      downloadMod: async (downloadUrl, destination) => {
        const response = await axios({
          method: 'GET',
          url: downloadUrl,
          responseType: 'stream',
          headers: { 'User-Agent': 'Lumen-Mod-Manager/1.0.0' }
        });

        // Ensure directory exists
        const dir = path.dirname(destination);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const writer = fs.createWriteStream(destination);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      }
    };
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      frame: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        zoomFactor: 1.0,
        enableRemoteModule: false
      },
      icon: path.join(__dirname, '../assets/icon.png'),
      backgroundColor: '#0f0f1a',
      show: false,
      autoHideMenuBar: true
    });

    // Disable zoom shortcuts (Ctrl+Plus, Ctrl+Minus, Ctrl+0)
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
        event.preventDefault();
      }
    });

    // Prevent zoom changes
    this.mainWindow.webContents.setZoomFactor(1.0);
    this.mainWindow.webContents.on('zoom-changed', () => {
      this.mainWindow.webContents.setZoomFactor(1.0);
    });

    // Disable mouse wheel zoom
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if ((input.control || input.meta) && input.type === 'mouseWheel') {
        event.preventDefault();
      }
    });

    this.mainWindow.loadFile('src/index.html');

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
      
      // Initialize Update Manager after window is ready
      this.initializeUpdateManager();
    });

    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }
  }

  initializeUpdateManager() {
    try {
      const profileManager = this.getProfileManager();
      const modrinthAPI = this.getModrinthAPI();
      
      this.updateManager = new UpdateManager(modrinthAPI, profileManager);
      
      // Set up Update Manager event listeners
      this.updateManager.on('updateCheckStarted', (data) => {
        this.mainWindow.webContents.send('update-check-started', data);
      });

      this.updateManager.on('checkingMod', (data) => {
        this.mainWindow.webContents.send('checking-mod', data);
      });

      this.updateManager.on('updateCheckCompleted', (data) => {
        this.mainWindow.webContents.send('update-check-completed', data);
        
        if (this.settings.showNotifications && data.updatesAvailable > 0) {
          this.showNotification(
            'Updates Available',
            `${data.updatesAvailable} mod updates are available`,
            'info'
          );
        }
      });

      this.updateManager.on('batchUpdateProgress', (data) => {
        this.mainWindow.webContents.send('batch-update-progress', data);
      });

      this.updateManager.on('updateStarted', (data) => {
        this.mainWindow.webContents.send('update-started', data);
      });

      this.updateManager.on('downloading', (data) => {
        this.mainWindow.webContents.send('download-progress', data);
      });

      this.updateManager.on('updateCompleted', (data) => {
        this.mainWindow.webContents.send('update-completed', data);
        
        if (this.settings.showNotifications) {
          this.showNotification(
            'Update Completed',
            `${data.mod} updated to v${data.newVersion}`,
            'success'
          );
        }
      });

      this.updateManager.on('updateFailed', (data) => {
        this.mainWindow.webContents.send('update-failed', data);
        
        if (this.settings.showNotifications) {
          this.showNotification(
            'Update Failed',
            `Failed to update ${data.mod}: ${data.error}`,
            'error'
          );
        }
      });

      this.updateManager.on('batchUpdateCompleted', (data) => {
        this.mainWindow.webContents.send('batch-update-completed', data);
        
        const successful = data.results.filter(r => r.success).length;
        const failed = data.results.filter(r => !r.success).length;
        
        let message = `${successful} mods updated successfully`;
        if (failed > 0) {
          message += `, ${failed} failed`;
        }
        
        if (this.settings.showNotifications) {
          this.showNotification(
            'Batch Update Complete',
            message,
            successful > 0 ? 'success' : 'error'
          );
        }
      });

      console.log('Update Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Update Manager:', error);
    }
  }

  showNotification(title, message, type = 'info') {
    if (Notification.isSupported() && this.settings.showNotifications) {
      new Notification({
        title,
        body: message,
        icon: path.join(__dirname, '../assets/icon.png')
      }).show();
    }
  }

  setupIPC() {
    // Window controls
    ipcMain.handle('window-minimize', () => {
      this.mainWindow.minimize();
    });

    ipcMain.handle('window-maximize', () => {
      if (this.mainWindow.isMaximized()) {
        this.mainWindow.unmaximize();
      } else {
        this.mainWindow.maximize();
      }
      return this.mainWindow.isMaximized();
    });

    ipcMain.handle('window-close', () => {
      this.mainWindow.close();
    });

    ipcMain.handle('window-is-maximized', () => {
      return this.mainWindow.isMaximized();
    });

    // Settings with theme support
    ipcMain.handle('get-settings', () => {
      return this.settings;
    });

    ipcMain.handle('save-settings', (event, newSettings) => {
      this.settings = { ...this.settings, ...newSettings };
      this.saveSettings();
      
      // Apply theme immediately if changed
      if (newSettings.theme) {
        this.mainWindow.webContents.send('theme-changed', newSettings.theme);
      }
      
      return this.settings;
    });

    // Setup
    ipcMain.handle('get-setup-status', () => {
      return {
        isSetup: !!this.settings.modsPath,
        modsPath: this.settings.modsPath
      };
    });

    ipcMain.handle('browse-mods-folder', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Minecraft Mods Folder'
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        if (path.basename(selectedPath) === 'mods' || await this.isValidModsFolder(selectedPath)) {
          this.settings.modsPath = selectedPath;
          this.saveSettings();
          return { success: true, path: selectedPath };
        } else {
          return { success: false, error: 'Please select a valid mods folder' };
        }
      }
      return { success: false, error: 'No folder selected' };
    });

    // Profile Management
    ipcMain.handle('get-profiles', () => {
      return { 
        success: true, 
        profiles: this.settings.profiles,
        currentProfile: this.settings.currentProfile 
      };
    });

    ipcMain.handle('get-current-profile', () => {
      return this.settings.currentProfile;
    });

    ipcMain.handle('create-profile', async (event, profileData) => {
      try {
        const profileId = profileData.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        
        if (this.settings.profiles[profileId]) {
          return { success: false, error: 'Profile with this name already exists' };
        }

        const profilePath = await this.createProfileDirectory(profileId);
        
        // Copy current mods if requested
        if (profileData.copyCurrent && this.settings.modsPath) {
          const currentMods = await fs.readdir(this.settings.modsPath);
          const jarFiles = currentMods.filter(file => file.endsWith('.jar'));
          
          for (const file of jarFiles) {
            await fs.copy(
              path.join(this.settings.modsPath, file),
              path.join(profilePath, file)
            );
          }
        }

        this.settings.profiles[profileId] = {
          name: profileData.name,
          description: profileData.description || '',
          createdAt: Date.now(),
          gameVersion: profileData.gameVersion || '1.20.1',
          loader: profileData.loader || 'fabric'
        };

        this.saveSettings();
        return { success: true, profileId };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('delete-profile', async (event, profileId) => {
      try {
        if (profileId === 'default') {
          return { success: false, error: 'Cannot delete default profile' };
        }

        if (this.settings.currentProfile === profileId) {
          return { success: false, error: 'Cannot delete currently active profile' };
        }

        const profilePath = this.getProfilePath(profileId);
        await fs.remove(profilePath);
        
        delete this.settings.profiles[profileId];
        this.saveSettings();

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('switch-profile', async (event, profileId) => {
      try {
        if (!this.settings.profiles[profileId] || !this.settings.modsPath) {
          return { success: false, error: 'Invalid profile or mods path not set' };
        }

        const currentProfilePath = this.getProfilePath(this.settings.currentProfile);
        await this.createProfileDirectory(this.settings.currentProfile);
        
        await fs.emptyDir(currentProfilePath);
        const currentMods = await fs.readdir(this.settings.modsPath);
        const jarFiles = currentMods.filter(file => file.endsWith('.jar'));
        
        for (const file of jarFiles) {
          await fs.copy(
            path.join(this.settings.modsPath, file),
            path.join(currentProfilePath, file)
          );
        }

        for (const file of jarFiles) {
          await fs.remove(path.join(this.settings.modsPath, file));
        }

        const newProfilePath = this.getProfilePath(profileId);
        if (await fs.pathExists(newProfilePath)) {
          const profileMods = await fs.readdir(newProfilePath);
          const profileJarFiles = profileMods.filter(file => file.endsWith('.jar'));
          
          for (const file of profileJarFiles) {
            await fs.copy(
              path.join(newProfilePath, file),
              path.join(this.settings.modsPath, file)
            );
          }
        }

        this.settings.currentProfile = profileId;
        this.saveSettings();

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-profile-mods', async (event, profileId) => {
      try {
        const profilePath = this.getProfilePath(profileId);
        
        if (!await fs.pathExists(profilePath)) {
          return { success: true, mods: [] };
        }

        const files = await fs.readdir(profilePath);
        const modFiles = files.filter(file => file.endsWith('.jar'));
        
        const mods = await Promise.all(modFiles.map(async (file) => {
          const filePath = path.join(profilePath, file);
          const stats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            size: stats.size
          };
        }));

        return { success: true, mods };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Search mods
    ipcMain.handle('search-mods', async (event, query, filters = {}) => {
      try {
        const facets = [['project_type:mod']];
        
        if (filters.versions && filters.versions.length > 0) {
          facets.push(filters.versions.map(ver => `versions:${ver}`));
        }
        
        if (filters.loaders && filters.loaders.length > 0) {
          facets.push(filters.loaders.map(loader => `categories:${loader}`));
        }

        const params = new URLSearchParams({
          query: query,
          limit: filters.limit || 20,
          offset: filters.offset || 0,
          facets: JSON.stringify(facets)
        });

        const response = await axios.get(`https://api.modrinth.com/v2/search?${params.toString()}`, {
          headers: {
            'User-Agent': 'Lumen-Mod-Manager/1.0.0 (github.com/user/lumen)'
          }
        });

        return { success: true, data: response.data };
      } catch (error) {
        console.error('Search error:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.description || error.message };
      }
    });

    // Get mod details
    ipcMain.handle('get-mod-details', async (event, projectId) => {
      try {
        const [projectResponse, versionsResponse] = await Promise.all([
          axios.get(`https://api.modrinth.com/v2/project/${projectId}`, {
            headers: { 'User-Agent': 'Lumen-Mod-Manager/1.0.0' }
          }),
          axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, {
            headers: { 'User-Agent': 'Lumen-Mod-Manager/1.0.0' }
          })
        ]);

        return {
          success: true,
          project: projectResponse.data,
          versions: versionsResponse.data
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Download mod
    ipcMain.handle('download-mod', async (event, versionData, fileName) => {
      if (!this.settings.modsPath) {
        return { success: false, error: 'Mods folder not configured' };
      }

      try {
        const filePath = path.join(this.settings.modsPath, fileName);
        
        if (await fs.pathExists(filePath)) {
          return { success: false, error: 'Mod already exists' };
        }

        const response = await axios({
          method: 'GET',
          url: versionData.url,
          responseType: 'stream',
          headers: { 'User-Agent': 'Lumen-Mod-Manager/1.0.0' }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            // Update mod registry when mod is downloaded
            this.updateDownloadedModRegistry(fileName, versionData);
            resolve({ success: true, path: filePath });
          });
          writer.on('error', (err) => resolve({ success: false, error: err.message }));
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Get installed mods
    ipcMain.handle('get-installed-mods', async () => {
      if (!this.settings.modsPath) {
        return { success: false, error: 'Mods folder not configured' };
      }

      try {
        const files = await fs.readdir(this.settings.modsPath);
        const modFiles = files.filter(file => 
          file.endsWith('.jar') && !file.startsWith('.')
        );

        const mods = modFiles.map(file => ({
          name: file,
          path: path.join(this.settings.modsPath, file),
          size: fs.statSync(path.join(this.settings.modsPath, file)).size
        }));

        return { success: true, mods };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Delete mod
    ipcMain.handle('delete-mod', async (event, modPath) => {
      try {
        await fs.remove(modPath);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Open mods folder
    ipcMain.handle('open-mods-folder', () => {
      if (this.settings.modsPath) {
        shell.openPath(this.settings.modsPath);
        return { success: true };
      }
      return { success: false, error: 'Mods folder not configured' };
    });

    // Update Manager IPC Handlers
    ipcMain.handle('check-for-updates', async (event, profileId) => {
      if (!this.updateManager) {
        return { success: false, error: 'Update Manager not initialized' };
      }

      try {
        const results = await this.updateManager.checkForUpdates(profileId);
        return { success: true, results };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('update-mods', async (event, mods, profileId) => {
      if (!this.updateManager) {
        return { success: false, error: 'Update Manager not initialized' };
      }

      try {
        const profile = this.getProfileManager().getProfile(profileId);
        const results = await this.updateManager.updateMultipleMods(mods, profile);
        return { success: true, results };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-mod-registry', async (event, profileId) => {
      try {
        const registryPath = path.join(this.getProfilePath(profileId), 'mod-registry.json');
        
        if (await fs.pathExists(registryPath)) {
          const registry = await fs.readJson(registryPath);
          return { success: true, registry };
        }
        
        return { success: true, registry: {} };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('update-mod-registry', async (event, profileId, modData) => {
      try {
        const registryPath = path.join(this.getProfilePath(profileId), 'mod-registry.json');
        let registry = {};
        
        if (await fs.pathExists(registryPath)) {
          registry = await fs.readJson(registryPath);
        }
        
        registry[modData.fileName] = modData;
        await fs.writeJson(registryPath, registry, { spaces: 2 });
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Utility IPC Handlers
    ipcMain.handle('show-notification', async (event, title, message, type) => {
      this.showNotification(title, message, type);
      return { success: true };
    });

    ipcMain.handle('open-changelog', async (event, changelog) => {
      // You could implement a changelog window or open in browser
      shell.openExternal(`data:text/html,<pre>${encodeURIComponent(changelog)}</pre>`);
      return { success: true };
    });

    ipcMain.handle('close-update-manager', async () => {
      // If you have a separate update manager window, close it here
      // For now, we'll just hide the update section
      this.mainWindow.webContents.send('hide-update-manager');
      return { success: true };
    });

    ipcMain.handle('open-file-location', async (event, filePath) => {
      shell.showItemInFolder(filePath);
      return { success: true };
    });

    ipcMain.handle('get-file-stats', async (event, filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          success: true,
          stats: {
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory()
          }
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  // Helper method to update mod registry when downloading
  async updateDownloadedModRegistry(fileName, versionData) {
    try {
      const currentProfile = this.settings.currentProfile;
      const registryPath = path.join(this.getProfilePath(currentProfile), 'mod-registry.json');
      
      let registry = {};
      if (await fs.pathExists(registryPath)) {
        registry = await fs.readJson(registryPath);
      }

      registry[fileName] = {
       name: versionData.name || fileName.replace('.jar', ''),
       version: versionData.version_number,
       projectId: versionData.project_id,
       fileName: fileName,
       downloadedAt: new Date().toISOString(),
       versionId: versionData.id,
       gameVersions: versionData.game_versions,
       loaders: versionData.loaders
     };

     await fs.writeJson(registryPath, registry, { spaces: 2 });
   } catch (error) {
     console.error('Failed to update mod registry:', error);
   }
 }

 async isValidModsFolder(folderPath) {
   try {
     const files = await fs.readdir(folderPath);
     const hasJarFiles = files.some(file => file.endsWith('.jar'));
     const isModsFolder = path.basename(folderPath) === 'mods';
     return hasJarFiles || isModsFolder;
   } catch (error) {
     return false;
   }
 }

 init() {
   app.whenReady().then(() => {
     this.createWindow();
     this.setupIPC();

     app.on('activate', () => {
       if (BrowserWindow.getAllWindows().length === 0) {
         this.createWindow();
       }
     });
   });

   app.on('window-all-closed', () => {
     if (process.platform !== 'darwin') {
       app.quit();
     }
   });

   // Handle app updates and cleanup
   app.on('before-quit', () => {
     // Clean up any temporary files or ongoing operations
     if (this.updateManager) {
       // Cancel any ongoing updates
       this.updateManager.removeAllListeners();
     }
   });
 }
}

const lumenApp = new LumenApp();
lumenApp.init();