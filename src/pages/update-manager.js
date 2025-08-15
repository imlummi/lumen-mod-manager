// src/pages/update-manager.js
class UpdateManagerUI {
    constructor() {
        this.selectedMods = new Set();
        this.modList = [];
        this.isUpdating = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupIPCListeners();
        
        // Auto-check for updates on load
        this.checkForUpdates();
    }

    initializeElements() {
        this.elements = {
            updateCount: document.getElementById('update-count'),
            refreshBtn: document.getElementById('refresh-btn'),
            updateSelectedBtn: document.getElementById('update-selected-btn'),
            updateAllBtn: document.getElementById('update-all-btn'),
            closeBtn: document.getElementById('close-btn'),
            loadingState: document.getElementById('loading-state'),
            loadingText: document.getElementById('loading-text'),
            modList: document.getElementById('mod-list'),
            progressSection: document.getElementById('progress-section'),
            currentMod: document.getElementById('current-mod'),
            progressCount: document.getElementById('progress-count'),
            progressFill: document.getElementById('progress-fill'),
            progressPercentage: document.querySelector('.progress-percentage')
        };
    }

    setupEventListeners() {
        this.elements.refreshBtn.addEventListener('click', () => this.checkForUpdates());
        this.elements.updateSelectedBtn.addEventListener('click', () => this.updateSelectedMods());
        this.elements.updateAllBtn.addEventListener('click', () => this.updateAllMods());
        this.elements.closeBtn.addEventListener('click', () => this.closeWindow());
    }

    setupIPCListeners() {
        window.electronAPI.onUpdateCheckStarted((data) => {
            this.showLoading(`Checking ${data.modCount} mods for updates...`);
        });

        window.electronAPI.onCheckingMod((data) => {
            this.elements.loadingText.textContent = 
                `Checking ${data.mod} (${data.progress}/${data.total})`;
        });

        window.electronAPI.onUpdateCheckCompleted((data) => {
            this.hideLoading();
            this.displayUpdateResults(data.results);
            this.updateStats(data.updatesAvailable);
        });

        window.electronAPI.onBatchUpdateProgress((data) => {
            this.updateProgress(data.current, data.total, data.modName);
        });

        window.electronAPI.onUpdateStarted((data) => {
            this.showProgress();
        });

        window.electronAPI.onDownloadProgress((data) => {
            this.updateDownloadProgress(data.mod, data.progress);
        });

        window.electronAPI.onBatchUpdateCompleted((data) => {
            this.hideProgress();
            this.showUpdateResults(data.results);
            this.checkForUpdates(); // Refresh the list
        });
    }

    async checkForUpdates() {
        const profileId = await window.electronAPI.getCurrentProfile();
        this.modList = await window.electronAPI.checkForUpdates(profileId);
    }

    displayUpdateResults(mods) {
        this.modList = mods;
        this.elements.modList.innerHTML = '';

        if (mods.length === 0) {
            this.elements.modList.innerHTML = '<div class="no-mods">No mods found in this profile.</div>';
            return;
        }

        mods.forEach(mod => {
            const modElement = this.createModElement(mod);
            this.elements.modList.appendChild(modElement);
        });

        // Auto-select mods with updates
        const modsWithUpdates = mods.filter(mod => mod.hasUpdate);
        modsWithUpdates.forEach(mod => {
            this.selectedMods.add(mod.fileName);
            const checkbox = document.querySelector(`input[data-mod="${mod.fileName}"]`);
            if (checkbox) checkbox.checked = true;
        });

        this.updateButtonStates();
    }

    createModElement(mod) {
        const div = document.createElement('div');
        div.className = `mod-item ${mod.hasUpdate ? 'has-update' : 'up-to-date'}`;
        
        div.innerHTML = `
            <div class="mod-checkbox">
                <input type="checkbox" 
                       data-mod="${mod.fileName}" 
                       ${!mod.hasUpdate ? 'disabled' : ''}>
            </div>
            <div class="mod-info">
                <div class="mod-header">
                    <h3 class="mod-name">${mod.name}</h3>
                    <span class="mod-status ${mod.hasUpdate ? 'outdated' : 'current'}">
                        ${mod.hasUpdate ? 'Update Available' : 'Up to Date'}
                    </span>
                </div>
                <div class="version-info">
                    <span class="current-version">Current: v${mod.currentVersion}</span>
                    ${mod.hasUpdate ? `
                        <span class="version-arrow">→</span>
                        <span class="latest-version">Latest: v${mod.latestVersion.version_number}</span>
                    ` : ''}
                </div>
                ${mod.hasUpdate ? `
                    <div class="update-details">
                        <span class="file-size">${this.formatFileSize(mod.updateSize)}</span>
                        ${mod.latestVersion.changelog ? `
                            <button class="btn-link changelog-btn" data-mod="${mod.fileName}">
                                View Changelog
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
                ${mod.error ? `
                    <div class="mod-error">Error: ${mod.error}</div>
                ` : ''}
            </div>
        `;

        // Add event listeners
        const checkbox = div.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedMods.add(mod.fileName);
                } else {
                    this.selectedMods.delete(mod.fileName);
                }
                this.updateButtonStates();
            });
        }

        const changelogBtn = div.querySelector('.changelog-btn');
        if (changelogBtn) {
            changelogBtn.addEventListener('click', () => this.showChangelog(mod));
        }

        return div;
    }

    async updateSelectedMods() {
        const selectedModData = this.modList.filter(mod => 
            this.selectedMods.has(mod.fileName) && mod.hasUpdate
        );

        if (selectedModData.length === 0) return;

        const profileId = await window.electronAPI.getCurrentProfile();
        await window.electronAPI.updateMods(selectedModData, profileId);
    }

    async updateAllMods() {
        const modsWithUpdates = this.modList.filter(mod => mod.hasUpdate);
        
        if (modsWithUpdates.length === 0) return;

        // Select all mods with updates
        this.selectedMods.clear();
        modsWithUpdates.forEach(mod => this.selectedMods.add(mod.fileName));
        
        await this.updateSelectedMods();
    }

    updateStats(updatesAvailable) {
        if (updatesAvailable > 0) {
            this.elements.updateCount.textContent = `${updatesAvailable} updates available`;
            this.elements.updateCount.classList.remove('hidden');
        } else {
            this.elements.updateCount.classList.add('hidden');
        }
    }

    updateButtonStates() {
        const selectedCount = this.selectedMods.size;
        const updatesAvailable = this.modList.filter(mod => mod.hasUpdate).length;

        this.elements.updateSelectedBtn.textContent = `Update Selected (${selectedCount})`;
        this.elements.updateSelectedBtn.disabled = selectedCount === 0 || this.isUpdating;
        this.elements.updateAllBtn.disabled = updatesAvailable === 0 || this.isUpdating;
        this.elements.refreshBtn.disabled = this.isUpdating;
    }

    showLoading(text) {
        this.elements.loadingText.textContent = text;
        this.elements.loadingState.classList.remove('hidden');
        this.elements.modList.classList.add('hidden');
    }

    hideLoading() {
        this.elements.loadingState.classList.add('hidden');
        this.elements.modList.classList.remove('hidden');
    }

    showProgress() {
        this.isUpdating = true;
        this.elements.progressSection.classList.remove('hidden');
        this.updateButtonStates();
    }

    hideProgress() {
        this.isUpdating = false;
        this.elements.progressSection.classList.add('hidden');
        this.updateButtonStates();
    }

    updateProgress(current, total, modName) {
        this.elements.currentMod.textContent = `Updating ${modName}`;
        this.elements.progressCount.textContent = `${current} / ${total}`;
        
        const percentage = (current / total) * 100;
        this.elements.progressFill.style.width = `${percentage}%`;
        this.elements.progressPercentage.textContent = `${Math.round(percentage)}%`;
    }

    updateDownloadProgress(modName, progress) {
        this.elements.currentMod.textContent = `Downloading ${modName}`;
        this.elements.progressFill.style.width = `${progress}%`;
        this.elements.progressPercentage.textContent = `${progress}%`;
    }

    showUpdateResults(results) {
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        let message = `Update completed: ${successful} successful`;
        if (failed > 0) {
            message += `, ${failed} failed`;
        }

        // You could show a toast notification here
        alert(message);
    }

    showChangelog(mod) {
        // Open changelog in a new window or modal
        window.electronAPI.openChangelog(mod.latestVersion.changelog);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    closeWindow() {
        window.electronAPI.closeUpdateManager();
    }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new UpdateManagerUI();
});