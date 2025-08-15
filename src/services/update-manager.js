// src/services/update-manager.js
const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');
const axios = require('axios');

class UpdateManager extends EventEmitter {
  constructor(modrinthAPI, profileManager) {
    super();
    this.api = modrinthAPI;
    this.profileManager = profileManager;
    this.isUpdating = false;
  }

  async checkForUpdates(profileId) {
    const profile = this.profileManager.getProfile(profileId);
    const installedMods = await this.getInstalledMods(profile);
    const updateResults = [];

    this.emit('updateCheckStarted', { profileId, modCount: installedMods.length });

    for (let i = 0; i < installedMods.length; i++) {
      const mod = installedMods[i];
      
      try {
        this.emit('checkingMod', { mod: mod.name, progress: i + 1, total: installedMods.length });
        
        const latestVersion = await this.api.getLatestVersion(
          mod.projectId,
          profile.gameVersion,
          profile.loader
        );

        const updateInfo = {
          ...mod,
          hasUpdate: false,
          latestVersion: null,
          canUpdate: false
        };

        if (latestVersion && this.compareVersions(mod.currentVersion, latestVersion.version_number) < 0) {
          updateInfo.hasUpdate = true;
          updateInfo.latestVersion = latestVersion;
          updateInfo.canUpdate = true;
          updateInfo.updateSize = latestVersion.files[0]?.size || 0;
        }

        updateResults.push(updateInfo);

      } catch (error) {
        console.warn(`Failed to check updates for ${mod.name}:`, error);
        updateResults.push({
          ...mod,
          hasUpdate: false,
          error: error.message
        });
      }
    }

    this.emit('updateCheckCompleted', { 
      profileId, 
      results: updateResults,
      updatesAvailable: updateResults.filter(r => r.hasUpdate).length 
    });

    return updateResults;
  }

  async getInstalledMods(profile) {
    const modsPath = profile.modsPath;
    const installedMods = [];

    if (!await fs.pathExists(modsPath)) {
      return installedMods;
    }

    const modRegistry = await this.loadModRegistry(profile.id);
    const files = await fs.readdir(modsPath);
    const jarFiles = files.filter(f => f.endsWith('.jar'));
    
    for (const file of jarFiles) {
      const filePath = path.join(modsPath, file);
      const modInfo = modRegistry[file];
      
      if (modInfo && modInfo.projectId) {
        installedMods.push({
          fileName: file,
          filePath,
          name: modInfo.name,
          currentVersion: modInfo.version,
          projectId: modInfo.projectId,
          lastModified: (await fs.stat(filePath)).mtime
        });
      }
    }

    return installedMods;
  }

  async updateMod(mod, profile) {
    if (!mod.latestVersion) {
      throw new Error('No update available');
    }

    this.emit('updateStarted', { mod: mod.name });

    try {
      await this.createBackup(mod, profile);

      const downloadFile = mod.latestVersion.files.find(f => f.primary) || mod.latestVersion.files[0];
      const tempPath = path.join(profile.path, 'temp', downloadFile.filename);
      
      await this.downloadWithProgress(downloadFile.url, tempPath, (progress) => {
        this.emit('downloading', { mod: mod.name, progress });
      });

      if (await fs.pathExists(mod.filePath)) {
        await fs.remove(mod.filePath);
      }

      const newPath = path.join(path.dirname(mod.filePath), downloadFile.filename);
      await fs.move(tempPath, newPath);

      await this.updateModRegistry(profile.id, mod.fileName, {
        name: mod.name,
        version: mod.latestVersion.version_number,
        projectId: mod.projectId,
        fileName: downloadFile.filename,
        updatedAt: new Date().toISOString(),
        versionId: mod.latestVersion.id,
        gameVersions: mod.latestVersion.game_versions,
        loaders: mod.latestVersion.loaders
      });

      this.emit('updateCompleted', { 
        mod: mod.name, 
        oldVersion: mod.currentVersion,
        newVersion: mod.latestVersion.version_number 
      });

      return {
        success: true,
        oldFile: mod.fileName,
        newFile: downloadFile.filename,
        newVersion: mod.latestVersion.version_number
      };

    } catch (error) {
      this.emit('updateFailed', { mod: mod.name, error: error.message });
      await this.restoreFromBackup(mod, profile);
      throw error;
    }
  }

  async updateMultipleMods(mods, profile) {
    this.isUpdating = true;
    const results = [];

    for (let i = 0; i < mods.length; i++) {
      const mod = mods[i];
      
      try {
        this.emit('batchUpdateProgress', { 
          current: i + 1, 
          total: mods.length, 
          modName: mod.name 
        });

        const result = await this.updateMod(mod, profile);
        results.push({ mod: mod.name, ...result });
        
      } catch (error) {
        results.push({ 
          mod: mod.name, 
          success: false, 
          error: error.message 
        });
      }
    }

    this.isUpdating = false;
    this.emit('batchUpdateCompleted', { results });
    
    return results;
  }

  compareVersions(current, latest) {
    const parseVersion = (v) => {
      const parts = v.split(/[.-]/).map(part => {
        const num = parseInt(part);
        return isNaN(num) ? part : num;
      });
      return parts;
    };
    
    const currentParts = parseVersion(current);
    const latestParts = parseVersion(latest);
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const curr = currentParts[i] || 0;
      const lat = latestParts[i] || 0;
      
      if (typeof curr === 'number' && typeof lat === 'number') {
        if (curr < lat) return -1;
        if (curr > lat) return 1;
      } else {
        const currStr = String(curr);
        const latStr = String(lat);
        if (currStr < latStr) return -1;
        if (currStr > latStr) return 1;
      }
    }
    
    return 0;
  }

  async createBackup(mod, profile) {
    const backupDir = path.join(profile.path, 'backups', 'mods');
    await fs.ensureDir(backupDir);

    const backupName = `${mod.fileName}.backup.${Date.now()}`;
    const backupPath = path.join(backupDir, backupName);
    
    await fs.copy(mod.filePath, backupPath);
    return backupPath;
  }

  async downloadWithProgress(url, destination, onProgress) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      headers: { 'User-Agent': 'Lumen-Mod-Manager/1.0.0' }
    });

    const totalSize = parseInt(response.headers['content-length'], 10);
    let downloadedSize = 0;

    // Ensure temp directory exists
    const tempDir = path.dirname(destination);
    await fs.ensureDir(tempDir);

    const writer = fs.createWriteStream(destination);
    
    return new Promise((resolve, reject) => {
      response.data.on('data', chunk => {
        downloadedSize += chunk.length;
        const progress = totalSize ? (downloadedSize / totalSize) * 100 : 0;
        onProgress(Math.round(progress));
      });

      response.data.pipe(writer);
      
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async loadModRegistry(profileId) {
    const registryPath = path.join(this.profileManager.getProfilePath(profileId), 'mod-registry.json');
    
    if (await fs.pathExists(registryPath)) {
      return await fs.readJson(registryPath);
    }
    
    return {};
  }

  async updateModRegistry(profileId, oldFileName, modInfo) {
    const registryPath = path.join(this.profileManager.getProfilePath(profileId), 'mod-registry.json');
    const registry = await this.loadModRegistry(profileId);
    
    if (oldFileName !== modInfo.fileName) {
      delete registry[oldFileName];
    }
    
    registry[modInfo.fileName] = modInfo;
    await fs.writeJson(registryPath, registry, { spaces: 2 });
  }

  async restoreFromBackup(mod, profile) {
    const backupDir = path.join(profile.path, 'backups', 'mods');
    
    if (!await fs.pathExists(backupDir)) {
      return;
    }

    const backups = await fs.readdir(backupDir);
    const modBackups = backups
      .filter(f => f.startsWith(mod.fileName + '.backup.'))
      .sort()
      .reverse();

    if (modBackups.length > 0) {
      const latestBackup = path.join(backupDir, modBackups[0]);
      await fs.copy(latestBackup, mod.filePath);
    }
  }
}

module.exports = UpdateManager;