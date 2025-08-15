// src/app.js (combined with settings and titlebar functionality)
class LumenModManager {
  constructor() {
    this.setupScreen = document.getElementById('setup-screen');
    this.mainScreen = document.getElementById('main-screen');
    this.currentTab = 'browse';
    this.searchResults = [];
    this.installedMods = [];
    this.settings = {};
    
    this.init();
  }

  async init() {
    await this.setupTitlebar();
    await this.loadSettings();
    await this.checkSetupStatus();
    this.setupEventListeners();
  }

  async setupTitlebar() {
    // Setup window controls
    document.getElementById('minimize-btn').addEventListener('click', () => {
      electronAPI.windowMinimize();
    });

    document.getElementById('maximize-btn').addEventListener('click', async () => {
      const isMaximized = await electronAPI.windowMaximize();
      const btn = document.getElementById('maximize-btn');
      btn.classList.toggle('maximized', isMaximized);
    });

    document.getElementById('close-btn').addEventListener('click', () => {
      electronAPI.windowClose();
    });

    // Check initial maximize state
    const isMaximized = await electronAPI.windowIsMaximized();
    document.getElementById('maximize-btn').classList.toggle('maximized', isMaximized);
  }

  async loadSettings() {
    try {
      this.settings = await electronAPI.getSettings();
      this.applySettings();
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  applySettings() {
    // Apply theme
    if (this.settings.theme === 'light') {
      document.body.setAttribute('data-theme', 'light');
    } else if (this.settings.theme === 'auto') {
      // Use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }

  async saveSettings(newSettings) {
    try {
      this.settings = await electronAPI.saveSettings(newSettings);
      this.applySettings();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  async checkSetupStatus() {
    const status = await electronAPI.getSetupStatus();
    
    if (status.isSetup) {
      this.showMainScreen();
      this.updateModsPath(status.modsPath);
      await this.loadInstalledMods();
    } else {
      this.showSetupScreen();
    }
  }

  showSetupScreen() {
    this.setupScreen.classList.remove('hidden');
    this.mainScreen.classList.add('hidden');
  }

  showMainScreen() {
    this.setupScreen.classList.add('hidden');
    this.mainScreen.classList.remove('hidden');
  }

  updateModsPath(path) {
    const display = document.getElementById('mods-path-display');
    const fileName = path.split(/[\\/]/).pop();
    const parentDir = path.split(/[\\/]/).slice(-2, -1)[0];
    display.textContent = `.../${parentDir}/${fileName}`;
    display.title = path;
  }

  setupEventListeners() {
    // Setup screen
    document.getElementById('browse-mods-btn').addEventListener('click', async () => {
      const button = document.getElementById('browse-mods-btn');
      const originalText = button.innerHTML;
      
      button.innerHTML = '<div class="spinner" style="width: 16px; height: 16px;"></div> Selecting...';
      button.disabled = true;
      
      try {
        const result = await electronAPI.browseModsFolder();
        if (result.success) {
          this.showMainScreen();
          this.updateModsPath(result.path);
          await this.loadInstalledMods();
        } else {
          this.showError(result.error || 'Failed to set mods folder');
        }
      } catch (error) {
        this.showError('Failed to set mods folder: ' + error.message);
      } finally {
        button.innerHTML = originalText;
        button.disabled = false;
      }
    });

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Search functionality
    document.getElementById('search-btn').addEventListener('click', () => {
      this.performSearch();
    });

    document.getElementById('search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });

    // Filter changes
    document.getElementById('minecraft-version').addEventListener('change', () => {
      if (this.searchResults.length > 0) {
        this.performSearch();
      }
    });

    document.getElementById('mod-loader').addEventListener('change', () => {
      if (this.searchResults.length > 0) {
        this.performSearch();
      }
    });

    // Installed mods refresh
    document.getElementById('refresh-installed-btn').addEventListener('click', () => {
      this.loadInstalledMods();
    });

    // Open mods folder
    document.getElementById('open-mods-folder-btn').addEventListener('click', async () => {
      await electronAPI.openModsFolder();
    });

    // Modal close
    document.getElementById('close-modal').addEventListener('click', () => {
      this.closeModal();
    });

    // Click outside modal to close
    document.getElementById('mod-modal').addEventListener('click', (e) => {
      if (e.target.id === 'mod-modal') {
        this.closeModal();
      }
    });

    // Settings event listeners
    document.getElementById('change-mods-path').addEventListener('click', async () => {
      const result = await electronAPI.browseModsFolder();
      if (result.success) {
        this.updateModsPath(result.path);
        this.updateSettingsDisplay();
      }
    });

    // Settings form handlers
    document.getElementById('auto-update-setting').addEventListener('change', (e) => {
      this.saveSettings({ autoUpdate: e.target.checked });
    });

    document.getElementById('notifications-setting').addEventListener('change', (e) => {
      this.saveSettings({ showNotifications: e.target.checked });
    });

    document.getElementById('compact-view-setting').addEventListener('change', (e) => {
      this.saveSettings({ compactView: e.target.checked });
    });

    document.getElementById('theme-setting').addEventListener('change', (e) => {
      this.saveSettings({ theme: e.target.value });
    });

    document.getElementById('download-location-setting').addEventListener('change', (e) => {
      this.saveSettings({ downloadLocation: e.target.value });
    });
  }

  switchTab(tabName) {
    // Update navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.toggle('hidden', !tab.id.startsWith(tabName));
    });

    this.currentTab = tabName;

    // Load data if needed
    if (tabName === 'installed') {
      this.loadInstalledMods();
    } else if (tabName === 'settings') {
      this.updateSettingsDisplay();
    }
  }

  updateSettingsDisplay() {
    // Update settings form with current values
    document.getElementById('mods-path-setting').value = this.settings.modsPath || '';
    document.getElementById('auto-update-setting').checked = this.settings.autoUpdate || false;
    document.getElementById('notifications-setting').checked = this.settings.showNotifications !== false;
    document.getElementById('compact-view-setting').checked = this.settings.compactView || false;
    document.getElementById('theme-setting').value = this.settings.theme || 'dark';
    document.getElementById('download-location-setting').value = this.settings.downloadLocation || 'mods-folder';
  }

  async performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) {
      this.showError('Please enter a search term');
      return;
    }

    const loading = document.getElementById('loading');
    const resultsContainer = document.getElementById('search-results');
    
    loading.classList.remove('hidden');
    resultsContainer.innerHTML = '';

    const filters = {
      versions: document.getElementById('minecraft-version').value ? 
        [document.getElementById('minecraft-version').value] : [],
      loaders: document.getElementById('mod-loader').value ? 
        [document.getElementById('mod-loader').value] : []
    };

    try {
      const result = await electronAPI.searchMods(query, filters);
      loading.classList.add('hidden');

      if (result.success) {
        this.searchResults = result.data.hits;
        this.displaySearchResults();
      } else {
        this.showError('Search failed: ' + result.error);
      }
    } catch (error) {
      loading.classList.add('hidden');
      this.showError('Search failed: ' + error.message);
    }
  }

  displaySearchResults() {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (this.searchResults.length === 0) {
      container.innerHTML = '<div class="no-results">No mods found matching your search</div>';
      return;
    }

    this.searchResults.forEach(mod => {
      const modCard = this.createModCard(mod);
      container.appendChild(modCard);
    });
  }

  createModCard(mod) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    
    const iconUrl = mod.icon_url || this.getDefaultIcon();
    
    card.innerHTML = `
      <img src="${iconUrl}" alt="${mod.title}" onerror="this.src='${this.getDefaultIcon()}'">
      <h3>${this.escapeHtml(mod.title)}</h3>
      <p>${this.escapeHtml(mod.description)}</p>
      <div class="mod-stats">
        <span title="Downloads">📥 ${this.formatNumber(mod.downloads)}</span>
        <span title="Followers">⭐ ${this.formatNumber(mod.follows)}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      this.showModDetails(mod.project_id || mod.slug);
    });

    return card;
  }

  async showModDetails(projectId) {
    const modal = document.getElementById('mod-modal');
    const title = document.getElementById('modal-title');
    const info = document.getElementById('modal-info');
    const versions = document.getElementById('modal-versions');

    // Show modal with loading
    title.textContent = 'Loading...';
    info.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading mod details...</span></div>';
    versions.innerHTML = '';
    modal.classList.remove('hidden');

    try {
      const result = await electronAPI.getModDetails(projectId);
      
      if (result.success) {
        const { project, versions: modVersions } = result;
        
        title.textContent = project.title;
        
        info.innerHTML = `
          <div class="mod-detail-info">
            <img src="${project.icon_url || this.getDefaultIcon()}" alt="${this.escapeHtml(project.title)}" onerror="this.src='${this.getDefaultIcon()}'">
            <p><strong>Author:</strong> ${this.escapeHtml(project.team || 'Unknown')}</p>
            <p><strong>Downloads:</strong> ${this.formatNumber(project.downloads)}</p>
            <p><strong>Followers:</strong> ${this.formatNumber(project.followers)}</p>
            <p><strong>Categories:</strong> ${project.categories ? project.categories.join(', ') : 'None'}</p>
            <p><strong>License:</strong> ${project.license ? project.license.name : 'Unknown'}</p>
            <div style="margin-top: 1rem;">
              <strong>Description:</strong>
              <p>${this.escapeHtml(project.description)}</p>
            </div>
          </div>
        `;

        // Display versions
        const versionsToShow = modVersions.slice(0, 10);
        versions.innerHTML = `
          <h3>Available Versions</h3>
          <div class="versions-list">
            ${versionsToShow.map(version => `
              <div class="version-item">
                <div class="version-info">
                  <div class="version-number">${this.escapeHtml(version.name)} (${this.escapeHtml(version.version_number)})</div>
                  <div class="version-details">
                    <span>${version.game_versions ? version.game_versions.join(', ') : 'Unknown'}</span>
                    <span>${version.loaders ? version.loaders.join(', ') : 'Unknown'}</span>
                    <span>${this.formatDate(version.date_published)}</span>
                  </div>
                </div>
                <button class="primary-btn download-btn" data-version='${JSON.stringify(version)}' data-filename="${version.files && version.files[0] ? version.files[0].filename : 'mod.jar'}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/>
                  </svg>
                  Download
                </button>
              </div>
            `).join('')}
          </div>
        `;

        // Add download event listeners
        versions.querySelectorAll('.download-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const versionData = JSON.parse(btn.dataset.version);
            const filename = btn.dataset.filename;
            
            if (versionData.files && versionData.files[0]) {
              await this.downloadMod(versionData.files[0], filename);
            }
          });
        });
        
      } else {
        info.innerHTML = `<div class="error">Failed to load mod details: ${result.error}</div>`;
      }
    } catch (error) {
      info.innerHTML = `<div class="error">Failed to load mod details: ${error.message}</div>`;
    }
  }

  async downloadMod(fileData, filename) {
    const downloadBtns = document.querySelectorAll('.download-btn');
    
    // Disable all download buttons
    downloadBtns.forEach(btn => {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px;"></div> Downloading...';
    });

    try {
      const result = await electronAPI.downloadMod(fileData, filename);
      
      if (result.success) {
        this.showSuccess('Mod downloaded successfully!');
        this.closeModal();
        if (this.currentTab === 'installed') {
          await this.loadInstalledMods();
        }
      } else {
        this.showError('Download failed: ' + result.error);
      }
    } catch (error) {
      this.showError('Download failed: ' + error.message);
    } finally {
      // Re-enable download buttons
      downloadBtns.forEach(btn => {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/>
          </svg>
          Download
        `;
      });
    }
  }

  async loadInstalledMods() {
    const container = document.getElementById('installed-mods');
    
    try {
      const result = await electronAPI.getInstalledMods();
      
      if (result.success) {
        this.installedMods = result.mods;
        this.displayInstalledMods();
      } else {
        container.innerHTML = `<div class="error">Failed to load installed mods: ${result.error}</div>`;
      }
    } catch (error) {
      container.innerHTML = `<div class="error">Failed to load installed mods: ${error.message}</div>`;
    }
  }

  displayInstalledMods() {
    const container = document.getElementById('installed-mods');
    
    if (this.installedMods.length === 0) {
      container.innerHTML = '<div class="no-mods">No mods installed yet. Browse and download some mods to get started!</div>';
      return;
    }

    container.innerHTML = '';
    
    this.installedMods.forEach(mod => {
      const modCard = document.createElement('div');
      modCard.className = 'installed-card';
      
      modCard.innerHTML = `
        <div class="installed-info">
          <h3>${this.escapeHtml(mod.name)}</h3>
          <p>Size: ${this.formatFileSize(mod.size)}</p>
        </div>
        <div class="installed-actions">
          <button class="danger-btn delete-mod-btn" data-path="${mod.path}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/>
            </svg>
            Delete
          </button>
        </div>
      `;

      // Add delete functionality
      const deleteBtn = modCard.querySelector('.delete-mod-btn');
      deleteBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        
        if (confirm(`Are you sure you want to delete ${mod.name}?`)) {
          const originalHTML = deleteBtn.innerHTML;
          deleteBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px;"></div> Deleting...';
          deleteBtn.disabled = true;
          
          try {
            const result = await electronAPI.deleteMod(mod.path);
            
            if (result.success) {
              await this.loadInstalledMods();
              this.showSuccess('Mod deleted successfully');
            } else {
              this.showError('Failed to delete mod: ' + result.error);
              deleteBtn.innerHTML = originalHTML;
              deleteBtn.disabled = false;
            }
          } catch (error) {
            this.showError('Failed to delete mod: ' + error.message);
            deleteBtn.innerHTML = originalHTML;
            deleteBtn.disabled = false;
          }
        }
      });

      container.appendChild(modCard);
    });
  }

  closeModal() {
    document.getElementById('mod-modal').classList.add('hidden');
  }

  // Utility methods
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num?.toString() || '0';
  }

  formatFileSize(bytes) {
    if (bytes >= 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    } else if (bytes >= 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return bytes + ' B';
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getDefaultIcon() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzFhMWExYSIgc3Ryb2tlPSIjMzMzMzMzIiBzdHJva2Utd2lkdGg9IjIiLz4KPHN2ZyB4PSIxNiIgeT0iMTYiIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDEwMCAxMDAiPgo8ZyBzdHJva2U9IiM0RkMzRjciIHN0cm9rZS13aWR0aD0iNiIgZmlsbD0ibm9uZSI+CjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjE4IiBmaWxsPSIjODFENEZBIi8+CjwvZz4KPC9zdmc+Cjwvc3ZnPg==';
  }

  showError(message) {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = 'toast error';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--error-color);
      color: white;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: var(--shadow-large);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 3000);
  }

  showSuccess(message) {
   const toast = document.createElement('div');
   toast.className = 'toast success';
   toast.style.cssText = `
     position: fixed;
     top: 20px;
     right: 20px;
     background: var(--success-color);
     color: white;
     padding: 1rem;
     border-radius: 8px;
     box-shadow: var(--shadow-large);
     z-index: 10000;
     animation: slideIn 0.3s ease;
   `;
   toast.textContent = message;
   
   document.body.appendChild(toast);
   
   setTimeout(() => {
     toast.style.animation = 'slideOut 0.3s ease';
     setTimeout(() => {
       document.body.removeChild(toast);
     }, 300);
   }, 3000);
 }
}

// Initialize the app
const app = new LumenModManager();