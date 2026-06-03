"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
module.exports = Editor.Panel.define({
    listeners: {
        show() { console.log('Tool Manager panel shown'); },
        hide() { console.log('Tool Manager panel hidden'); }
    },
    template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/default/tool-manager.html'), 'utf-8'),
    style: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        panelTitle: '#panelTitle',
        createConfigBtn: '#createConfigBtn',
        importConfigBtn: '#importConfigBtn',
        exportConfigBtn: '#exportConfigBtn',
        configSelector: '#configSelector',
        applyConfigBtn: '#applyConfigBtn',
        editConfigBtn: '#editConfigBtn',
        deleteConfigBtn: '#deleteConfigBtn',
        toolsContainer: '#toolsContainer',
        selectAllBtn: '#selectAllBtn',
        deselectAllBtn: '#deselectAllBtn',
        saveChangesBtn: '#saveChangesBtn',
        totalToolsCount: '#totalToolsCount',
        enabledToolsCount: '#enabledToolsCount',
        disabledToolsCount: '#disabledToolsCount',
        configModal: '#configModal',
        modalTitle: '#modalTitle',
        configForm: '#configForm',
        configName: '#configName',
        configDescription: '#configDescription',
        closeModal: '#closeModal',
        cancelConfigBtn: '#cancelConfigBtn',
        saveConfigBtn: '#saveConfigBtn',
        importModal: '#importModal',
        importConfigJson: '#importConfigJson',
        closeImportModal: '#closeImportModal',
        cancelImportBtn: '#cancelImportBtn',
        confirmImportBtn: '#confirmImportBtn'
    },
    methods: {
        async loadToolManagerState() {
            try {
                this.toolManagerState = await Editor.Message.request('cocos-mcp-server', 'getToolManagerState');
                this.currentConfiguration = this.toolManagerState.currentConfiguration;
                this.configurations = this.toolManagerState.configurations;
                this.availableTools = this.toolManagerState.availableTools;
                this.updateUI();
            }
            catch (error) {
                console.error('Failed to load tool manager state:', error);
                this.showError('Failed to load tool manager state');
            }
        },
        updateUI() {
            this.updateConfigSelector();
            this.updateToolsDisplay();
            this.updateStatusBar();
            this.updateButtons();
        },
        updateConfigSelector() {
            const selector = this.$.configSelector;
            selector.innerHTML = '<option value="">Select a configuration...</option>';
            this.configurations.forEach((config) => {
                const option = document.createElement('option');
                option.value = config.id;
                option.textContent = config.name;
                if (this.currentConfiguration && config.id === this.currentConfiguration.id) {
                    option.selected = true;
                }
                selector.appendChild(option);
            });
        },
        updateToolsDisplay() {
            const container = this.$.toolsContainer;
            if (!this.currentConfiguration) {
                container.innerHTML = `
                    <div class="empty-state">
                        <h3>No configuration selected</h3>
                        <p>Select a configuration or create a new one first</p>
                    </div>
                `;
                return;
            }
            const toolsByCategory = {};
            this.currentConfiguration.tools.forEach((tool) => {
                if (!toolsByCategory[tool.category]) {
                    toolsByCategory[tool.category] = [];
                }
                toolsByCategory[tool.category].push(tool);
            });
            container.innerHTML = '';
            Object.entries(toolsByCategory).forEach(([category, tools]) => {
                const categoryDiv = document.createElement('div');
                categoryDiv.className = 'tool-category';
                const enabledCount = tools.filter((t) => t.enabled).length;
                const totalCount = tools.length;
                categoryDiv.innerHTML = `
                    <div class="category-header">
                        <div class="category-name">${this.getCategoryDisplayName(category)}</div>
                        <div class="category-toggle">
                            <span>${enabledCount}/${totalCount}</span>
                            <input type="checkbox" class="checkbox category-checkbox" 
                                   data-category="${category}" 
                                   ${enabledCount === totalCount ? 'checked' : ''}>
                        </div>
                    </div>
                    <div class="tool-list">
                        ${tools.map((tool) => `
                            <div class="tool-item">
                                <div class="tool-info">
                                    <div class="tool-name">${tool.name}</div>
                                    <div class="tool-description">${tool.description}</div>
                                </div>
                                <div class="tool-toggle">
                                    <input type="checkbox" class="checkbox tool-checkbox" 
                                           data-category="${tool.category}" 
                                           data-name="${tool.name}" 
                                           ${tool.enabled ? 'checked' : ''}>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                container.appendChild(categoryDiv);
            });
            this.bindToolEvents();
        },
        bindToolEvents() {
            document.querySelectorAll('.category-checkbox').forEach((checkbox) => {
                checkbox.addEventListener('change', (e) => {
                    const category = e.target.dataset.category;
                    const checked = e.target.checked;
                    this.toggleCategoryTools(category, checked);
                });
            });
            document.querySelectorAll('.tool-checkbox').forEach((checkbox) => {
                checkbox.addEventListener('change', (e) => {
                    const category = e.target.dataset.category;
                    const name = e.target.dataset.name;
                    const enabled = e.target.checked;
                    this.updateToolStatus(category, name, enabled);
                });
            });
        },
        async toggleCategoryTools(category, enabled) {
            if (!this.currentConfiguration)
                return;
            console.log(`Toggling category tools: ${category} = ${enabled}`);
            const categoryTools = this.currentConfiguration.tools.filter((tool) => tool.category === category);
            if (categoryTools.length === 0)
                return;
            const updates = categoryTools.map((tool) => ({
                category: tool.category,
                name: tool.name,
                enabled: enabled
            }));
            try {
                // Update local state first
                categoryTools.forEach((tool) => {
                    tool.enabled = enabled;
                });
                console.log(`Updated local category state: ${category} = ${enabled}`);
                // Update the UI immediately
                this.updateStatusBar();
                this.updateCategoryCounts();
                this.updateToolCheckboxes(category, enabled);
                // Then sync to the backend
                await Editor.Message.request('cocos-mcp-server', 'updateToolStatusBatch', this.currentConfiguration.id, updates);
            }
            catch (error) {
                console.error('Failed to toggle category tools:', error);
                this.showError('Failed to toggle category tools');
                // Roll back local state if the backend update fails
                categoryTools.forEach((tool) => {
                    tool.enabled = !enabled;
                });
                this.updateStatusBar();
                this.updateCategoryCounts();
                this.updateToolCheckboxes(category, !enabled);
            }
        },
        async updateToolStatus(category, name, enabled) {
            if (!this.currentConfiguration)
                return;
            console.log(`Updating tool status: ${category}.${name} = ${enabled}`);
            console.log(`Current config ID: ${this.currentConfiguration.id}`);
            // Update local state first
            const tool = this.currentConfiguration.tools.find((t) => t.category === category && t.name === name);
            if (!tool) {
                console.error(`Tool not found: ${category}.${name}`);
                return;
            }
            try {
                // Update local state first
                tool.enabled = enabled;
                console.log(`Updated local tool state: ${tool.name} = ${tool.enabled}`);
                // Update the UI immediately (stats only; do not rerender the tool list)
                this.updateStatusBar();
                this.updateCategoryCounts();
                // Then sync to the backend
                console.log(`Sending to backend: configId=${this.currentConfiguration.id}, category=${category}, name=${name}, enabled=${enabled}`);
                const result = await Editor.Message.request('cocos-mcp-server', 'updateToolStatus', this.currentConfiguration.id, category, name, enabled);
                console.log('Backend response:', result);
            }
            catch (error) {
                console.error('Failed to update tool status:', error);
                this.showError('Failed to update tool status');
                // Roll back local state if the backend update fails
                tool.enabled = !enabled;
                this.updateStatusBar();
                this.updateCategoryCounts();
            }
        },
        updateStatusBar() {
            if (!this.currentConfiguration) {
                this.$.totalToolsCount.textContent = '0';
                this.$.enabledToolsCount.textContent = '0';
                this.$.disabledToolsCount.textContent = '0';
                return;
            }
            const total = this.currentConfiguration.tools.length;
            const enabled = this.currentConfiguration.tools.filter((t) => t.enabled).length;
            const disabled = total - enabled;
            console.log(`Status bar update: total=${total}, enabled=${enabled}, disabled=${disabled}`);
            this.$.totalToolsCount.textContent = total.toString();
            this.$.enabledToolsCount.textContent = enabled.toString();
            this.$.disabledToolsCount.textContent = disabled.toString();
        },
        updateCategoryCounts() {
            if (!this.currentConfiguration)
                return;
            // Update the count displayed for each category
            document.querySelectorAll('.category-checkbox').forEach((checkbox) => {
                const category = checkbox.dataset.category;
                const categoryTools = this.currentConfiguration.tools.filter((t) => t.category === category);
                const enabledCount = categoryTools.filter((t) => t.enabled).length;
                const totalCount = categoryTools.length;
                // Update the count display
                const countSpan = checkbox.parentElement.querySelector('span');
                if (countSpan) {
                    countSpan.textContent = `${enabledCount}/${totalCount}`;
                }
                // Update the category checkbox state
                checkbox.checked = enabledCount === totalCount;
            });
        },
        updateToolCheckboxes(category, enabled) {
            // Update all tool checkboxes in the selected category
            document.querySelectorAll(`.tool-checkbox[data-category="${category}"]`).forEach((checkbox) => {
                checkbox.checked = enabled;
            });
        },
        updateButtons() {
            const hasCurrentConfig = !!this.currentConfiguration;
            this.$.editConfigBtn.disabled = !hasCurrentConfig;
            this.$.deleteConfigBtn.disabled = !hasCurrentConfig;
            this.$.exportConfigBtn.disabled = !hasCurrentConfig;
            this.$.applyConfigBtn.disabled = !hasCurrentConfig;
        },
        async createConfiguration() {
            this.editingConfig = null;
            this.$.modalTitle.textContent = 'New Configuration';
            this.$.configName.value = '';
            this.$.configDescription.value = '';
            this.showModal('configModal');
        },
        async editConfiguration() {
            if (!this.currentConfiguration)
                return;
            this.editingConfig = this.currentConfiguration;
            this.$.modalTitle.textContent = 'Edit Configuration';
            this.$.configName.value = this.currentConfiguration.name;
            this.$.configDescription.value = this.currentConfiguration.description || '';
            this.showModal('configModal');
        },
        async saveConfiguration() {
            const name = this.$.configName.value.trim();
            const description = this.$.configDescription.value.trim();
            if (!name) {
                this.showError('Configuration name cannot be empty');
                return;
            }
            try {
                if (this.editingConfig) {
                    await Editor.Message.request('cocos-mcp-server', 'updateToolConfiguration', this.editingConfig.id, { name, description });
                }
                else {
                    await Editor.Message.request('cocos-mcp-server', 'createToolConfiguration', name, description);
                }
                this.hideModal('configModal');
                await this.loadToolManagerState();
            }
            catch (error) {
                console.error('Failed to save configuration:', error);
                this.showError('Failed to save configuration');
            }
        },
        async deleteConfiguration() {
            if (!this.currentConfiguration)
                return;
            const confirmed = await Editor.Dialog.warn('Confirm Deletion', {
                detail: `Are you sure you want to delete configuration "${this.currentConfiguration.name}"? This action cannot be undone.`
            });
            if (confirmed) {
                try {
                    await Editor.Message.request('cocos-mcp-server', 'deleteToolConfiguration', this.currentConfiguration.id);
                    await this.loadToolManagerState();
                }
                catch (error) {
                    console.error('Failed to delete configuration:', error);
                    this.showError('Failed to delete configuration');
                }
            }
        },
        async applyConfiguration() {
            const configId = this.$.configSelector.value;
            if (!configId)
                return;
            try {
                await Editor.Message.request('cocos-mcp-server', 'setCurrentToolConfiguration', configId);
                await this.loadToolManagerState();
            }
            catch (error) {
                console.error('Failed to apply configuration:', error);
                this.showError('Failed to apply configuration');
            }
        },
        async exportConfiguration() {
            if (!this.currentConfiguration)
                return;
            try {
                const result = await Editor.Message.request('cocos-mcp-server', 'exportToolConfiguration', this.currentConfiguration.id);
                Editor.Clipboard.write('text', result.configJson);
                Editor.Dialog.info('Export Complete', { detail: 'The configuration has been copied to the clipboard' });
            }
            catch (error) {
                console.error('Failed to export configuration:', error);
                this.showError('Failed to export configuration');
            }
        },
        async importConfiguration() {
            this.$.importConfigJson.value = '';
            this.showModal('importModal');
        },
        async confirmImport() {
            const configJson = this.$.importConfigJson.value.trim();
            if (!configJson) {
                this.showError('Please enter configuration JSON');
                return;
            }
            try {
                await Editor.Message.request('cocos-mcp-server', 'importToolConfiguration', configJson);
                this.hideModal('importModal');
                await this.loadToolManagerState();
                Editor.Dialog.info('Import Complete', { detail: 'The configuration was imported successfully' });
            }
            catch (error) {
                console.error('Failed to import configuration:', error);
                this.showError('Failed to import configuration');
            }
        },
        async selectAllTools() {
            if (!this.currentConfiguration)
                return;
            console.log('Selecting all tools');
            const updates = this.currentConfiguration.tools.map((tool) => ({
                category: tool.category,
                name: tool.name,
                enabled: true
            }));
            try {
                // Update local state first
                this.currentConfiguration.tools.forEach((tool) => {
                    tool.enabled = true;
                });
                console.log('Updated local state: all tools enabled');
                // Update the UI immediately
                this.updateStatusBar();
                this.updateToolsDisplay();
                // Then sync to the backend
                await Editor.Message.request('cocos-mcp-server', 'updateToolStatusBatch', this.currentConfiguration.id, updates);
            }
            catch (error) {
                console.error('Failed to select all tools:', error);
                this.showError('Failed to select all tools');
                // Roll back local state if the backend update fails
                this.currentConfiguration.tools.forEach((tool) => {
                    tool.enabled = false;
                });
                this.updateStatusBar();
                this.updateToolsDisplay();
            }
        },
        async deselectAllTools() {
            if (!this.currentConfiguration)
                return;
            console.log('Deselecting all tools');
            const updates = this.currentConfiguration.tools.map((tool) => ({
                category: tool.category,
                name: tool.name,
                enabled: false
            }));
            try {
                // Update local state first
                this.currentConfiguration.tools.forEach((tool) => {
                    tool.enabled = false;
                });
                console.log('Updated local state: all tools disabled');
                // Update the UI immediately
                this.updateStatusBar();
                this.updateToolsDisplay();
                // Then sync to the backend
                await Editor.Message.request('cocos-mcp-server', 'updateToolStatusBatch', this.currentConfiguration.id, updates);
            }
            catch (error) {
                console.error('Failed to deselect all tools:', error);
                this.showError('Failed to deselect all tools');
                // Roll back local state if the backend update fails
                this.currentConfiguration.tools.forEach((tool) => {
                    tool.enabled = true;
                });
                this.updateStatusBar();
                this.updateToolsDisplay();
            }
        },
        getCategoryDisplayName(category) {
            const categoryNames = {
                'scene': 'Scene Tools',
                'node': 'Node Tools',
                'component': 'Component Tools',
                'prefab': 'Prefab Tools',
                'project': 'Project Tools',
                'debug': 'Debug Tools',
                'preferences': 'Preferences Tools',
                'server': 'Server Tools',
                'broadcast': 'Broadcast Tools',
                'sceneAdvanced': 'Advanced Scene Tools',
                'sceneView': 'Scene View Tools',
                'referenceImage': 'Reference Image Tools',
                'assetAdvanced': 'Advanced Asset Tools',
                'validation': 'Validation Tools'
            };
            return categoryNames[category] || category;
        },
        showModal(modalId) {
            this.$[modalId].style.display = 'block';
        },
        hideModal(modalId) {
            this.$[modalId].style.display = 'none';
        },
        showError(message) {
            Editor.Dialog.error('Error', { detail: message });
        },
        async saveChanges() {
            if (!this.currentConfiguration) {
                this.showError('No configuration selected');
                return;
            }
            try {
                // Ensure the current configuration is saved to the backend
                await Editor.Message.request('cocos-mcp-server', 'updateToolConfiguration', this.currentConfiguration.id, {
                    name: this.currentConfiguration.name,
                    description: this.currentConfiguration.description,
                    tools: this.currentConfiguration.tools
                });
                Editor.Dialog.info('Saved', { detail: 'Configuration changes have been saved' });
            }
            catch (error) {
                console.error('Failed to save changes:', error);
                this.showError('Failed to save changes');
            }
        },
        bindEvents() {
            this.$.createConfigBtn.addEventListener('click', this.createConfiguration.bind(this));
            this.$.editConfigBtn.addEventListener('click', this.editConfiguration.bind(this));
            this.$.deleteConfigBtn.addEventListener('click', this.deleteConfiguration.bind(this));
            this.$.applyConfigBtn.addEventListener('click', this.applyConfiguration.bind(this));
            this.$.exportConfigBtn.addEventListener('click', this.exportConfiguration.bind(this));
            this.$.importConfigBtn.addEventListener('click', this.importConfiguration.bind(this));
            this.$.selectAllBtn.addEventListener('click', this.selectAllTools.bind(this));
            this.$.deselectAllBtn.addEventListener('click', this.deselectAllTools.bind(this));
            this.$.saveChangesBtn.addEventListener('click', this.saveChanges.bind(this));
            this.$.closeModal.addEventListener('click', () => this.hideModal('configModal'));
            this.$.cancelConfigBtn.addEventListener('click', () => this.hideModal('configModal'));
            this.$.configForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveConfiguration();
            });
            this.$.closeImportModal.addEventListener('click', () => this.hideModal('importModal'));
            this.$.cancelImportBtn.addEventListener('click', () => this.hideModal('importModal'));
            this.$.confirmImportBtn.addEventListener('click', this.confirmImport.bind(this));
            this.$.configSelector.addEventListener('change', this.applyConfiguration.bind(this));
        }
    },
    ready() {
        this.toolManagerState = null;
        this.currentConfiguration = null;
        this.configurations = [];
        this.availableTools = [];
        this.editingConfig = null;
        this.bindEvents();
        this.loadToolManagerState();
    },
    beforeClose() {
        // Cleanup
    },
    close() {
        // Cleanup when the panel closes
    }
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL3Rvb2wtbWFuYWdlci9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVDQUF3QztBQUN4QywrQkFBNEI7QUFFNUIsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztJQUNqQyxTQUFTLEVBQUU7UUFDUCxJQUFJLEtBQUssT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNuRCxJQUFJLEtBQUssT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUN2RDtJQUNELFFBQVEsRUFBRSxJQUFBLHVCQUFZLEVBQUMsSUFBQSxXQUFJLEVBQUMsU0FBUyxFQUFFLG9EQUFvRCxDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQ3RHLEtBQUssRUFBRSxJQUFBLHVCQUFZLEVBQUMsSUFBQSxXQUFJLEVBQUMsU0FBUyxFQUFFLHlDQUF5QyxDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQ3hGLENBQUMsRUFBRTtRQUNDLFVBQVUsRUFBRSxhQUFhO1FBQ3pCLGVBQWUsRUFBRSxrQkFBa0I7UUFDbkMsZUFBZSxFQUFFLGtCQUFrQjtRQUNuQyxlQUFlLEVBQUUsa0JBQWtCO1FBQ25DLGNBQWMsRUFBRSxpQkFBaUI7UUFDakMsY0FBYyxFQUFFLGlCQUFpQjtRQUNqQyxhQUFhLEVBQUUsZ0JBQWdCO1FBQy9CLGVBQWUsRUFBRSxrQkFBa0I7UUFDbkMsY0FBYyxFQUFFLGlCQUFpQjtRQUNqQyxZQUFZLEVBQUUsZUFBZTtRQUM3QixjQUFjLEVBQUUsaUJBQWlCO1FBQ2pDLGNBQWMsRUFBRSxpQkFBaUI7UUFDakMsZUFBZSxFQUFFLGtCQUFrQjtRQUNuQyxpQkFBaUIsRUFBRSxvQkFBb0I7UUFDdkMsa0JBQWtCLEVBQUUscUJBQXFCO1FBQ3pDLFdBQVcsRUFB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QUFDLENBQUM7WUFDdkYsSUFBSSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztZQUN0RixJQUFJLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBRWpGLElBQUksQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDekYsQ0FBQztLQUNKO0lBQ0QsS0FBSztRQUNBLElBQVksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUM7UUFDckMsSUFBWSxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQztRQUN6QyxJQUFZLENBQUMsY0FBYyxHQUFHLEVBQUUsQ0FBQztRQUNqQyxJQUFZLENBQUMsY0FBYyxHQUFHLEVBQUUsQ0FBQztRQUNqQyxJQUFZLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQztRQUVsQyxJQUFZLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDMUIsSUFBWSxDQUFDLG9CQUFvQixFQUFFLENBQUM7SUFDekMsQ0FBQztJQUNELFdBQVc7UUFDUCxVQUFVO0lBQ2QsQ0FBQztJQUNELEtBQUs7UUFDRCxnQ0FBZ0M7SUFDcEMsQ0FBQztDQUNHLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxubW9kdWxlLmV4cG9ydHMgPSBFZGl0b3IuUGFuZWwuZGVmaW5lKHtcbiAgICBsaXN0ZW5lcnM6IHtcbiAgICAgICAgc2hvdygpIHsgY29uc29sZS5sb2coJ1Rvb2wgTWFuYWdlciBwYW5lbCBzaG93bicpOyB9LFxuICAgICAgICBoaWRlKCkgeyBjb25zb2xlLmxvZygnVG9vbCBNYW5hZ2VyIHBhbmVsIGhpZGRlbicpOyB9XG4gICAgfSxcbiAgICB0ZW1wbGF0ZTogcmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vc3RhdGljL3RlbXBsYXRlL2RlZmF1bHQvdG9vbC1tYW5hZ2VyLmh0bWwnKSwgJ3V0Zi04JyksXG4gICAgc3R5bGU6IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJy4uLy4uLy4uL3N0YXRpYy9zdHlsZS9kZWZhdWx0L2luZGV4LmNzcycpLCAndXRmLTgnKSxcbiAgICAkOiB7XG4gICAgICAgIHBhbmVsVGl0bGU6ICcjcGFuZWxUaXRsZScsXG4gICAgICAgIGNyZWF0ZUNvbmZpZ0J0bjogJyNjcmVhdGVDb25maWdCdG4nLFxuICAgICAgICBpbXBvcnRDb25maWdCdG46ICcjaW1wb3J0Q29uZmlnQnRuJyxcbiAgICAgICAgZXhwb3J0Q29uZmlnQnRuOiAnI2V4cG9ydENvbmZpZ0J0bicsXG4gICAgICAgIGNvbmZpZ1NlbGVjdG9yOiAnI2NvbmZpZ1NlbGVjdG9yJyxcbiAgICAgICAgYXBwbHlDb25maWdCdG46ICcjYXBwbHlDb25maWdCdG4nLFxuICAgICAgICBlZGl0Q29uZmlnQnRuOiAnI2VkaXRDb25maWdCdG4nLFxuICAgICAgICBkZWxldGVDb25maWdCdG46ICcjZGVsZXRlQ29uZmlnQnRuJyxcbiAgICAgICAgdG9vbHNDb250YWluZXI6ICcjdG9vbHNDb250YWluZXInLFxuICAgICAgICBzZWxlY3RBbGxCdG46ICcjc2VsZWN0QWxsQnRuJyxcbiAgICAgICAgZGVzZWxlY3RBbGxCdG46ICcjZGVzZWxlY3RBbGxCdG4nLFxuICAgICAgICBzYXZlQ2hhbmdlc0J0bjogJyNzYXZlQ2hhbmdlc0J0bicsXG4gICAgICAgIHRvdGFsVG9vbHNDb3VudDogJyN0b3RhbFRvb2xzQ291bnQnLFxuICAgICAgICBlbmFibGVkVG9vbHNDb3VudDogJyNlbmFibGVkVG9vbHNDb3VudCcsXG4gICAgICAgIGRpc2FibGVkVG9vbHNDb3VudDogJyNkaXNhYmxlZFRvb2xzQ291bnQnLFxuICAgICAgICBjb25maWdNb2RhbDogJyNjb25maWdNb2RhbCcsXG4gICAgICAgIG1vZGFsVGl0bGU6ICcjbW9kYWxUaXRsZScsXG4gICAgICAgIGNvbmZpZ0Zvcm06ICcjY29uZmlnRm9ybScsXG4gICAgICAgIGNvbmZpZ05hbWU6ICcjY29uZmlnTmFtZScsXG4gICAgICAgIGNvbmZpZ0Rlc2NyaXB0aW9uOiAnI2NvbmZpZ0Rlc2NyaXB0aW9uJyxcbiAgICAgICAgY2xvc2VNb2RhbDogJyNjbG9zZU1vZGFsJyxcbiAgICAgICAgY2FuY2VsQ29uZmlnQnRuOiAnI2NhbmNlbENvbmZpZ0J0bicsXG4gICAgICAgIHNhdmVDb25maWdCdG46ICcjc2F2ZUNvbmZpZ0J0bicsXG4gICAgICAgIGltcG9ydE1vZGFsOiAnI2ltcG9ydE1vZGFsJyxcbiAgICAgICAgaW1wb3J0Q29uZmlnSnNvbjogJyNpbXBvcnRDb25maWdKc29uJyxcbiAgICAgICAgY2xvc2VJbXBvcnRNb2RhbDogJyNjbG9zZUltcG9ydE1vZGFsJyxcbiAgICAgICAgY2FuY2VsSW1wb3J0QnRuOiAnI2NhbmNlbEltcG9ydEJ0bicsXG4gICAgICAgIGNvbmZpcm1JbXBvcnRCdG46ICcjY29uZmlybUltcG9ydEJ0bidcbiAgICB9LFxuICAgIG1ldGhvZHM6IHtcbiAgICAgICAgYXN5bmMgbG9hZFRvb2xNYW5hZ2VyU3RhdGUodGhpczogYW55KSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMudG9vbE1hbmFnZXJTdGF0ZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAnZ2V0VG9vbE1hbmFnZXJTdGF0ZScpO1xuICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24gPSB0aGlzLnRvb2xNYW5hZ2VyU3RhdGUuY3VycmVudENvbmZpZ3VyYXRpb247XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWd1cmF0aW9ucyA9IHRoaXMudG9vbE1hbmFnZXJTdGF0ZS5jb25maWd1cmF0aW9ucztcbiAgICAgICAgICAgICAgICB0aGlzLmF2YWlsYWJsZVRvb2xzID0gdGhpcy50b29sTWFuYWdlclN0YXRlLmF2YWlsYWJsZVRvb2xzO1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlVUkoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGxvYWQgdG9vbCBtYW5hZ2VyIHN0YXRlOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dFcnJvcignRmFpbGVkIHRvIGxvYWQgdG9vbCBtYW5hZ2VyIHN0YXRlJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgdXBkYXRlVUkodGhpczogYW55KSB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbmZpZ1NlbGVjdG9yKCk7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZVRvb2xzRGlzcGxheSgpO1xuICAgICAgICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQnV0dG9ucygpO1xuICAgICAgICB9LFxuXG4gICAgICAgIHVwZGF0ZUNvbmZpZ1NlbGVjdG9yKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgY29uc3Qgc2VsZWN0b3IgPSB0aGlzLiQuY29uZmlnU2VsZWN0b3I7XG4gICAgICAgICAgICBzZWxlY3Rvci5pbm5lckhUTUwgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPlNlbGVjdCBhIGNvbmZpZ3VyYXRpb24uLi48L29wdGlvbj4nO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb25zLmZvckVhY2goKGNvbmZpZzogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb3B0aW9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG4gICAgICAgICAgICAgICAgb3B0aW9uLnZhbHVlID0gY29uZmlnLmlkO1xuICAgICAgICAgICAgICAgIG9wdGlvbi50ZXh0Q29udGVudCA9IGNvbmZpZy5uYW1lO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uICYmIGNvbmZpZy5pZCA9PT0gdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi5pZCkge1xuICAgICAgICAgICAgICAgICAgICBvcHRpb24uc2VsZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWxlY3Rvci5hcHBlbmRDaGlsZChvcHRpb24pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgdXBkYXRlVG9vbHNEaXNwbGF5KHRoaXM6IGFueSkge1xuICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gdGhpcy4kLnRvb2xzQ29udGFpbmVyO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZW1wdHktc3RhdGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxoMz5ObyBjb25maWd1cmF0aW9uIHNlbGVjdGVkPC9oMz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxwPlNlbGVjdCBhIGNvbmZpZ3VyYXRpb24gb3IgY3JlYXRlIGEgbmV3IG9uZSBmaXJzdDwvcD5cbiAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgYDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHRvb2xzQnlDYXRlZ29yeTogYW55ID0ge307XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLmZvckVhY2goKHRvb2w6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghdG9vbHNCeUNhdGVnb3J5W3Rvb2wuY2F0ZWdvcnldKSB7XG4gICAgICAgICAgICAgICAgICAgIHRvb2xzQnlDYXRlZ29yeVt0b29sLmNhdGVnb3J5XSA9IFtdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0b29sc0J5Q2F0ZWdvcnlbdG9vbC5jYXRlZ29yeV0ucHVzaCh0b29sKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJyc7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHRvb2xzQnlDYXRlZ29yeSkuZm9yRWFjaCgoW2NhdGVnb3J5LCB0b29sc106IFtzdHJpbmcsIGFueV0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjYXRlZ29yeURpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgICAgICAgICAgIGNhdGVnb3J5RGl2LmNsYXNzTmFtZSA9ICd0b29sLWNhdGVnb3J5JztcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBlbmFibGVkQ291bnQgPSB0b29scy5maWx0ZXIoKHQ6IGFueSkgPT4gdC5lbmFibGVkKS5sZW5ndGg7XG4gICAgICAgICAgICAgICAgY29uc3QgdG90YWxDb3VudCA9IHRvb2xzLmxlbmd0aDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjYXRlZ29yeURpdi5pbm5lckhUTUwgPSBgXG4gICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjYXRlZ29yeS1oZWFkZXJcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjYXRlZ29yeS1uYW1lXCI+JHt0aGlzLmdldENhdGVnb3J5RGlzcGxheU5hbWUoY2F0ZWdvcnkpfTwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImNhdGVnb3J5LXRvZ2dsZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzcGFuPiR7ZW5hYmxlZENvdW50fS8ke3RvdGFsQ291bnR9PC9zcGFuPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImNoZWNrYm94IGNhdGVnb3J5LWNoZWNrYm94XCIgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEtY2F0ZWdvcnk9XCIke2NhdGVnb3J5fVwiIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAke2VuYWJsZWRDb3VudCA9PT0gdG90YWxDb3VudCA/ICdjaGVja2VkJyA6ICcnfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRvb2wtbGlzdFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgJHt0b29scy5tYXAoKHRvb2w6IGFueSkgPT4gYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ0b29sLWl0ZW1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRvb2wtaW5mb1wiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRvb2wtbmFtZVwiPiR7dG9vbC5uYW1lfTwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRvb2wtZGVzY3JpcHRpb25cIj4ke3Rvb2wuZGVzY3JpcHRpb259PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidG9vbC10b2dnbGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImNoZWNrYm94IHRvb2wtY2hlY2tib3hcIiBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhLWNhdGVnb3J5PVwiJHt0b29sLmNhdGVnb3J5fVwiIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEtbmFtZT1cIiR7dG9vbC5uYW1lfVwiIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICR7dG9vbC5lbmFibGVkID8gJ2NoZWNrZWQnIDogJyd9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICAgIGApLmpvaW4oJycpfVxuICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICBgO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjYXRlZ29yeURpdik7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5iaW5kVG9vbEV2ZW50cygpO1xuICAgICAgICB9LFxuXG4gICAgICAgIGJpbmRUb29sRXZlbnRzKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLmNhdGVnb3J5LWNoZWNrYm94JykuZm9yRWFjaCgoY2hlY2tib3g6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGNoZWNrYm94LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChlOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSBlLnRhcmdldC5kYXRhc2V0LmNhdGVnb3J5O1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjaGVja2VkID0gZS50YXJnZXQuY2hlY2tlZDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy50b2dnbGVDYXRlZ29yeVRvb2xzKGNhdGVnb3J5LCBjaGVja2VkKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcudG9vbC1jaGVja2JveCcpLmZvckVhY2goKGNoZWNrYm94OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICBjaGVja2JveC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZTogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5ID0gZS50YXJnZXQuZGF0YXNldC5jYXRlZ29yeTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IGUudGFyZ2V0LmRhdGFzZXQubmFtZTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5hYmxlZCA9IGUudGFyZ2V0LmNoZWNrZWQ7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlVG9vbFN0YXR1cyhjYXRlZ29yeSwgbmFtZSwgZW5hYmxlZCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSxcblxuICAgICAgICBhc3luYyB0b2dnbGVDYXRlZ29yeVRvb2xzKHRoaXM6IGFueSwgY2F0ZWdvcnk6IHN0cmluZywgZW5hYmxlZDogYm9vbGVhbikge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uKSByZXR1cm47XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBUb2dnbGluZyBjYXRlZ29yeSB0b29sczogJHtjYXRlZ29yeX0gPSAke2VuYWJsZWR9YCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5VG9vbHMgPSB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLmZpbHRlcigodG9vbDogYW55KSA9PiB0b29sLmNhdGVnb3J5ID09PSBjYXRlZ29yeSk7XG4gICAgICAgICAgICBpZiAoY2F0ZWdvcnlUb29scy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3QgdXBkYXRlcyA9IGNhdGVnb3J5VG9vbHMubWFwKCh0b29sOiBhbnkpID0+ICh7XG4gICAgICAgICAgICAgICAgY2F0ZWdvcnk6IHRvb2wuY2F0ZWdvcnksXG4gICAgICAgICAgICAgICAgbmFtZTogdG9vbC5uYW1lLFxuICAgICAgICAgICAgICAgIGVuYWJsZWQ6IGVuYWJsZWRcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgbG9jYWwgc3RhdGUgZmlyc3RcbiAgICAgICAgICAgICAgICBjYXRlZ29yeVRvb2xzLmZvckVhY2goKHRvb2w6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSBlbmFibGVkO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIGxvY2FsIGNhdGVnb3J5IHN0YXRlOiAke2NhdGVnb3J5fSA9ICR7ZW5hYmxlZH1gKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgdGhlIFVJIGltbWVkaWF0ZWx5XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNhdGVnb3J5Q291bnRzKCk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVUb29sQ2hlY2tib3hlcyhjYXRlZ29yeSwgZW5hYmxlZCk7XG5cbiAgICAgICAgICAgICAgICAvLyBUaGVuIHN5bmMgdG8gdGhlIGJhY2tlbmRcbiAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdjb2Nvcy1tY3Atc2VydmVyJywgJ3VwZGF0ZVRvb2xTdGF0dXNCYXRjaCcsIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLmlkLCB1cGRhdGVzKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHRvZ2dsZSBjYXRlZ29yeSB0b29sczonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgdGhpcy5zaG93RXJyb3IoJ0ZhaWxlZCB0byB0b2dnbGUgY2F0ZWdvcnkgdG9vbHMnKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBSb2xsIGJhY2sgbG9jYWwgc3RhdGUgaWYgdGhlIGJhY2tlbmQgdXBkYXRlIGZhaWxzXG4gICAgICAgICAgICAgICAgY2F0ZWdvcnlUb29scy5mb3JFYWNoKCh0b29sOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdG9vbC5lbmFibGVkID0gIWVuYWJsZWQ7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNhdGVnb3J5Q291bnRzKCk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVUb29sQ2hlY2tib3hlcyhjYXRlZ29yeSwgIWVuYWJsZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIGFzeW5jIHVwZGF0ZVRvb2xTdGF0dXModGhpczogYW55LCBjYXRlZ29yeTogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIGVuYWJsZWQ6IGJvb2xlYW4pIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbikgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRpbmcgdG9vbCBzdGF0dXM6ICR7Y2F0ZWdvcnl9LiR7bmFtZX0gPSAke2VuYWJsZWR9YCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgQ3VycmVudCBjb25maWcgSUQ6ICR7dGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi5pZH1gKTtcblxuICAgICAgICAgICAgLy8gVXBkYXRlIGxvY2FsIHN0YXRlIGZpcnN0XG4gICAgICAgICAgICBjb25zdCB0b29sID0gdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi50b29scy5maW5kKCh0OiBhbnkpID0+IFxuICAgICAgICAgICAgICAgIHQuY2F0ZWdvcnkgPT09IGNhdGVnb3J5ICYmIHQubmFtZSA9PT0gbmFtZSk7XG4gICAgICAgICAgICBpZiAoIXRvb2wpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBUb29sIG5vdCBmb3VuZDogJHtjYXRlZ29yeX0uJHtuYW1lfWApO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgbG9jYWwgc3RhdGUgZmlyc3RcbiAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSBlbmFibGVkO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIGxvY2FsIHRvb2wgc3RhdGU6ICR7dG9vbC5uYW1lfSA9ICR7dG9vbC5lbmFibGVkfWApO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgVUkgaW1tZWRpYXRlbHkgKHN0YXRzIG9ubHk7IGRvIG5vdCByZXJlbmRlciB0aGUgdG9vbCBsaXN0KVxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDYXRlZ29yeUNvdW50cygpO1xuXG4gICAgICAgICAgICAgICAgLy8gVGhlbiBzeW5jIHRvIHRoZSBiYWNrZW5kXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbmRpbmcgdG8gYmFja2VuZDogY29uZmlnSWQ9JHt0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLmlkfSwgY2F0ZWdvcnk9JHtjYXRlZ29yeX0sIG5hbWU9JHtuYW1lfSwgZW5hYmxlZD0ke2VuYWJsZWR9YCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICd1cGRhdGVUb29sU3RhdHVzJywgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24uaWQsIGNhdGVnb3J5LCBuYW1lLCBlbmFibGVkKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQmFja2VuZCByZXNwb25zZTonLCByZXN1bHQpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gdXBkYXRlIHRvb2wgc3RhdHVzOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dFcnJvcignRmFpbGVkIHRvIHVwZGF0ZSB0b29sIHN0YXR1cycpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFJvbGwgYmFjayBsb2NhbCBzdGF0ZSBpZiB0aGUgYmFja2VuZCB1cGRhdGUgZmFpbHNcbiAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSAhZW5hYmxlZDtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ2F0ZWdvcnlDb3VudHMoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICB1cGRhdGVTdGF0dXNCYXIodGhpczogYW55KSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgICAgICAgICB0aGlzLiQudG90YWxUb29sc0NvdW50LnRleHRDb250ZW50ID0gJzAnO1xuICAgICAgICAgICAgICAgIHRoaXMuJC5lbmFibGVkVG9vbHNDb3VudC50ZXh0Q29udGVudCA9ICcwJztcbiAgICAgICAgICAgICAgICB0aGlzLiQuZGlzYWJsZWRUb29sc0NvdW50LnRleHRDb250ZW50ID0gJzAnO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgdG90YWwgPSB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLmxlbmd0aDtcbiAgICAgICAgICAgIGNvbnN0IGVuYWJsZWQgPSB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLmZpbHRlcigodDogYW55KSA9PiB0LmVuYWJsZWQpLmxlbmd0aDtcbiAgICAgICAgICAgIGNvbnN0IGRpc2FibGVkID0gdG90YWwgLSBlbmFibGVkO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU3RhdHVzIGJhciB1cGRhdGU6IHRvdGFsPSR7dG90YWx9LCBlbmFibGVkPSR7ZW5hYmxlZH0sIGRpc2FibGVkPSR7ZGlzYWJsZWR9YCk7XG5cbiAgICAgICAgICAgIHRoaXMuJC50b3RhbFRvb2xzQ291bnQudGV4dENvbnRlbnQgPSB0b3RhbC50b1N0cmluZygpO1xuICAgICAgICAgICAgdGhpcy4kLmVuYWJsZWRUb29sc0NvdW50LnRleHRDb250ZW50ID0gZW5hYmxlZC50b1N0cmluZygpO1xuICAgICAgICAgICAgdGhpcy4kLmRpc2FibGVkVG9vbHNDb3VudC50ZXh0Q29udGVudCA9IGRpc2FibGVkLnRvU3RyaW5nKCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgdXBkYXRlQ2F0ZWdvcnlDb3VudHModGhpczogYW55KSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24pIHJldHVybjtcblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBjb3VudCBkaXNwbGF5ZWQgZm9yIGVhY2ggY2F0ZWdvcnlcbiAgICAgICAgICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5jYXRlZ29yeS1jaGVja2JveCcpLmZvckVhY2goKGNoZWNrYm94OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjYXRlZ29yeSA9IGNoZWNrYm94LmRhdGFzZXQuY2F0ZWdvcnk7XG4gICAgICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnlUb29scyA9IHRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24udG9vbHMuZmlsdGVyKCh0OiBhbnkpID0+IHQuY2F0ZWdvcnkgPT09IGNhdGVnb3J5KTtcbiAgICAgICAgICAgICAgICBjb25zdCBlbmFibGVkQ291bnQgPSBjYXRlZ29yeVRvb2xzLmZpbHRlcigodDogYW55KSA9PiB0LmVuYWJsZWQpLmxlbmd0aDtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3RhbENvdW50ID0gY2F0ZWdvcnlUb29scy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBjb3VudCBkaXNwbGF5XG4gICAgICAgICAgICAgICAgY29uc3QgY291bnRTcGFuID0gY2hlY2tib3gucGFyZW50RWxlbWVudC5xdWVyeVNlbGVjdG9yKCdzcGFuJyk7XG4gICAgICAgICAgICAgICAgaWYgKGNvdW50U3Bhbikge1xuICAgICAgICAgICAgICAgICAgICBjb3VudFNwYW4udGV4dENvbnRlbnQgPSBgJHtlbmFibGVkQ291bnR9LyR7dG90YWxDb3VudH1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgdGhlIGNhdGVnb3J5IGNoZWNrYm94IHN0YXRlXG4gICAgICAgICAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IGVuYWJsZWRDb3VudCA9PT0gdG90YWxDb3VudDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LFxuXG4gICAgICAgIHVwZGF0ZVRvb2xDaGVja2JveGVzKHRoaXM6IGFueSwgY2F0ZWdvcnk6IHN0cmluZywgZW5hYmxlZDogYm9vbGVhbikge1xuICAgICAgICAgICAgLy8gVXBkYXRlIGFsbCB0b29sIGNoZWNrYm94ZXMgaW4gdGhlIHNlbGVjdGVkIGNhdGVnb3J5XG4gICAgICAgICAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKGAudG9vbC1jaGVja2JveFtkYXRhLWNhdGVnb3J5PVwiJHtjYXRlZ29yeX1cIl1gKS5mb3JFYWNoKChjaGVja2JveDogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IGVuYWJsZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSxcblxuICAgICAgICB1cGRhdGVCdXR0b25zKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgY29uc3QgaGFzQ3VycmVudENvbmZpZyA9ICEhdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbjtcbiAgICAgICAgICAgIHRoaXMuJC5lZGl0Q29uZmlnQnRuLmRpc2FibGVkID0gIWhhc0N1cnJlbnRDb25maWc7XG4gICAgICAgICAgICB0aGlzLiQuZGVsZXRlQ29uZmlnQnRuLmRpc2FibGVkID0gIWhhc0N1cnJlbnRDb25maWc7XG4gICAgICAgICAgICB0aGlzLiQuZXhwb3J0Q29uZmlnQnRuLmRpc2FibGVkID0gIWhhc0N1cnJlbnRDb25maWc7XG4gICAgICAgICAgICB0aGlzLiQuYXBwbHlDb25maWdCdG4uZGlzYWJsZWQgPSAhaGFzQ3VycmVudENvbmZpZztcbiAgICAgICAgfSxcblxuICAgICAgICBhc3luYyBjcmVhdGVDb25maWd1cmF0aW9uKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgdGhpcy5lZGl0aW5nQ29uZmlnID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuJC5tb2RhbFRpdGxlLnRleHRDb250ZW50ID0gJ05ldyBDb25maWd1cmF0aW9uJztcbiAgICAgICAgICAgIHRoaXMuJC5jb25maWdOYW1lLnZhbHVlID0gJyc7XG4gICAgICAgICAgICB0aGlzLiQuY29uZmlnRGVzY3JpcHRpb24udmFsdWUgPSAnJztcbiAgICAgICAgICAgIHRoaXMuc2hvd01vZGFsKCdjb25maWdNb2RhbCcpO1xuICAgICAgICB9LFxuXG4gICAgICAgIGFzeW5jIGVkaXRDb25maWd1cmF0aW9uKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uKSByZXR1cm47XG5cbiAgICAgICAgICAgIHRoaXMuZWRpdGluZ0NvbmZpZyA9IHRoaXMuY3VycmVudENvbmZpZ3VyYXRpb247XG4gICAgICAgICAgICB0aGlzLiQubW9kYWxUaXRsZS50ZXh0Q29udGVudCA9ICdFZGl0IENvbmZpZ3VyYXRpb24nO1xuICAgICAgICAgICAgdGhpcy4kLmNvbmZpZ05hbWUudmFsdWUgPSB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLm5hbWU7XG4gICAgICAgICAgICB0aGlzLiQuY29uZmlnRGVzY3JpcHRpb24udmFsdWUgPSB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLmRlc2NyaXB0aW9uIHx8ICcnO1xuICAgICAgICAgICAgdGhpcy5zaG93TW9kYWwoJ2NvbmZpZ01vZGFsJyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgYXN5bmMgc2F2ZUNvbmZpZ3VyYXRpb24odGhpczogYW55KSB7XG4gICAgICAgICAgICBjb25zdCBuYW1lID0gdGhpcy4kLmNvbmZpZ05hbWUudmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgY29uc3QgZGVzY3JpcHRpb24gPSB0aGlzLiQuY29uZmlnRGVzY3JpcHRpb24udmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgICBpZiAoIW5hbWUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dFcnJvcignQ29uZmlndXJhdGlvbiBuYW1lIGNhbm5vdCBiZSBlbXB0eScpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5lZGl0aW5nQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAndXBkYXRlVG9vbENvbmZpZ3VyYXRpb24nLCBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZWRpdGluZ0NvbmZpZy5pZCwgeyBuYW1lLCBkZXNjcmlwdGlvbiB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdjb2Nvcy1tY3Atc2VydmVyJywgJ2NyZWF0ZVRvb2xDb25maWd1cmF0aW9uJywgbmFtZSwgZGVzY3JpcHRpb24pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhpZGVNb2RhbCgnY29uZmlnTW9kYWwnKTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvYWRUb29sTWFuYWdlclN0YXRlKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzYXZlIGNvbmZpZ3VyYXRpb246JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2hvd0Vycm9yKCdGYWlsZWQgdG8gc2F2ZSBjb25maWd1cmF0aW9uJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgYXN5bmMgZGVsZXRlQ29uZmlndXJhdGlvbih0aGlzOiBhbnkpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbikgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBjb25maXJtZWQgPSBhd2FpdCBFZGl0b3IuRGlhbG9nLndhcm4oJ0NvbmZpcm0gRGVsZXRpb24nLCB7XG4gICAgICAgICAgICAgICAgZGV0YWlsOiBgQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGRlbGV0ZSBjb25maWd1cmF0aW9uIFwiJHt0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLm5hbWV9XCI/IFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuYFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChjb25maXJtZWQpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdjb2Nvcy1tY3Atc2VydmVyJywgJ2RlbGV0ZVRvb2xDb25maWd1cmF0aW9uJywgXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb2FkVG9vbE1hbmFnZXJTdGF0ZSgpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBkZWxldGUgY29uZmlndXJhdGlvbjonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2hvd0Vycm9yKCdGYWlsZWQgdG8gZGVsZXRlIGNvbmZpZ3VyYXRpb24nKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgYXN5bmMgYXBwbHlDb25maWd1cmF0aW9uKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnSWQgPSB0aGlzLiQuY29uZmlnU2VsZWN0b3IudmFsdWU7XG4gICAgICAgICAgICBpZiAoIWNvbmZpZ0lkKSByZXR1cm47XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICdzZXRDdXJyZW50VG9vbENvbmZpZ3VyYXRpb24nLCBjb25maWdJZCk7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb2FkVG9vbE1hbmFnZXJTdGF0ZSgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gYXBwbHkgY29uZmlndXJhdGlvbjonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgdGhpcy5zaG93RXJyb3IoJ0ZhaWxlZCB0byBhcHBseSBjb25maWd1cmF0aW9uJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgYXN5bmMgZXhwb3J0Q29uZmlndXJhdGlvbih0aGlzOiBhbnkpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbikgcmV0dXJuO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAnZXhwb3J0VG9vbENvbmZpZ3VyYXRpb24nLCBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi5pZCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgRWRpdG9yLkNsaXBib2FyZC53cml0ZSgndGV4dCcsIHJlc3VsdC5jb25maWdKc29uKTtcbiAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLmluZm8oJ0V4cG9ydCBDb21wbGV0ZScsIHsgZGV0YWlsOiAnVGhlIGNvbmZpZ3VyYXRpb24gaGFzIGJlZW4gY29waWVkIHRvIHRoZSBjbGlwYm9hcmQnIH0pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gZXhwb3J0IGNvbmZpZ3VyYXRpb246JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2hvd0Vycm9yKCdGYWlsZWQgdG8gZXhwb3J0IGNvbmZpZ3VyYXRpb24nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBhc3luYyBpbXBvcnRDb25maWd1cmF0aW9uKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgdGhpcy4kLmltcG9ydENvbmZpZ0pzb24udmFsdWUgPSAnJztcbiAgICAgICAgICAgIHRoaXMuc2hvd01vZGFsKCdpbXBvcnRNb2RhbCcpO1xuICAgICAgICB9LFxuXG4gICAgICAgIGFzeW5jIGNvbmZpcm1JbXBvcnQodGhpczogYW55KSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWdKc29uID0gdGhpcy4kLmltcG9ydENvbmZpZ0pzb24udmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgaWYgKCFjb25maWdKc29uKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zaG93RXJyb3IoJ1BsZWFzZSBlbnRlciBjb25maWd1cmF0aW9uIEpTT04nKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICdpbXBvcnRUb29sQ29uZmlndXJhdGlvbicsIGNvbmZpZ0pzb24pO1xuICAgICAgICAgICAgICAgIHRoaXMuaGlkZU1vZGFsKCdpbXBvcnRNb2RhbCcpO1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9hZFRvb2xNYW5hZ2VyU3RhdGUoKTtcbiAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLmluZm8oJ0ltcG9ydCBDb21wbGV0ZScsIHsgZGV0YWlsOiAnVGhlIGNvbmZpZ3VyYXRpb24gd2FzIGltcG9ydGVkIHN1Y2Nlc3NmdWxseScgfSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBpbXBvcnQgY29uZmlndXJhdGlvbjonLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgdGhpcy5zaG93RXJyb3IoJ0ZhaWxlZCB0byBpbXBvcnQgY29uZmlndXJhdGlvbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIGFzeW5jIHNlbGVjdEFsbFRvb2xzKHRoaXM6IGFueSkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uKSByZXR1cm47XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZWxlY3RpbmcgYWxsIHRvb2xzJyk7XG5cbiAgICAgICAgICAgIGNvbnN0IHVwZGF0ZXMgPSB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLm1hcCgodG9vbDogYW55KSA9PiAoe1xuICAgICAgICAgICAgICAgIGNhdGVnb3J5OiB0b29sLmNhdGVnb3J5LFxuICAgICAgICAgICAgICAgIG5hbWU6IHRvb2wubmFtZSxcbiAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlXG4gICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIGxvY2FsIHN0YXRlIGZpcnN0XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi50b29scy5mb3JFYWNoKCh0b29sOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdG9vbC5lbmFibGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnVXBkYXRlZCBsb2NhbCBzdGF0ZTogYWxsIHRvb2xzIGVuYWJsZWQnKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgdGhlIFVJIGltbWVkaWF0ZWx5XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVRvb2xzRGlzcGxheSgpO1xuXG4gICAgICAgICAgICAgICAgLy8gVGhlbiBzeW5jIHRvIHRoZSBiYWNrZW5kXG4gICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICd1cGRhdGVUb29sU3RhdHVzQmF0Y2gnLCBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi5pZCwgdXBkYXRlcyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzZWxlY3QgYWxsIHRvb2xzOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dFcnJvcignRmFpbGVkIHRvIHNlbGVjdCBhbGwgdG9vbHMnKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBSb2xsIGJhY2sgbG9jYWwgc3RhdGUgaWYgdGhlIGJhY2tlbmQgdXBkYXRlIGZhaWxzXG4gICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi50b29scy5mb3JFYWNoKCh0b29sOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdG9vbC5lbmFibGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVRvb2xzRGlzcGxheSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIGFzeW5jIGRlc2VsZWN0QWxsVG9vbHModGhpczogYW55KSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24pIHJldHVybjtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0Rlc2VsZWN0aW5nIGFsbCB0b29scycpO1xuXG4gICAgICAgICAgICBjb25zdCB1cGRhdGVzID0gdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi50b29scy5tYXAoKHRvb2w6IGFueSkgPT4gKHtcbiAgICAgICAgICAgICAgICBjYXRlZ29yeTogdG9vbC5jYXRlZ29yeSxcbiAgICAgICAgICAgICAgICBuYW1lOiB0b29sLm5hbWUsXG4gICAgICAgICAgICAgICAgZW5hYmxlZDogZmFsc2VcbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgbG9jYWwgc3RhdGUgZmlyc3RcbiAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLmZvckVhY2goKHRvb2w6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnVXBkYXRlZCBsb2NhbCBzdGF0ZTogYWxsIHRvb2xzIGRpc2FibGVkJyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBVSSBpbW1lZGlhdGVseVxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVUb29sc0Rpc3BsYXkoKTtcblxuICAgICAgICAgICAgICAgIC8vIFRoZW4gc3luYyB0byB0aGUgYmFja2VuZFxuICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2NvY29zLW1jcC1zZXJ2ZXInLCAndXBkYXRlVG9vbFN0YXR1c0JhdGNoJywgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudENvbmZpZ3VyYXRpb24uaWQsIHVwZGF0ZXMpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gZGVzZWxlY3QgYWxsIHRvb2xzOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dFcnJvcignRmFpbGVkIHRvIGRlc2VsZWN0IGFsbCB0b29scycpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFJvbGwgYmFjayBsb2NhbCBzdGF0ZSBpZiB0aGUgYmFja2VuZCB1cGRhdGUgZmFpbHNcbiAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzLmZvckVhY2goKHRvb2w6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0b29sLmVuYWJsZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVUb29sc0Rpc3BsYXkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBnZXRDYXRlZ29yeURpc3BsYXlOYW1lKHRoaXM6IGFueSwgY2F0ZWdvcnk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgICAgICAgICBjb25zdCBjYXRlZ29yeU5hbWVzOiBhbnkgPSB7XG4gICAgICAgICAgICAgICAgJ3NjZW5lJzogJ1NjZW5lIFRvb2xzJyxcbiAgICAgICAgICAgICAgICAnbm9kZSc6ICdOb2RlIFRvb2xzJyxcbiAgICAgICAgICAgICAgICAnY29tcG9uZW50JzogJ0NvbXBvbmVudCBUb29scycsXG4gICAgICAgICAgICAgICAgJ3ByZWZhYic6ICdQcmVmYWIgVG9vbHMnLFxuICAgICAgICAgICAgICAgICdwcm9qZWN0JzogJ1Byb2plY3QgVG9vbHMnLFxuICAgICAgICAgICAgICAgICdkZWJ1Zyc6ICdEZWJ1ZyBUb29scycsXG4gICAgICAgICAgICAgICAgJ3ByZWZlcmVuY2VzJzogJ1ByZWZlcmVuY2VzIFRvb2xzJyxcbiAgICAgICAgICAgICAgICAnc2VydmVyJzogJ1NlcnZlciBUb29scycsXG4gICAgICAgICAgICAgICAgJ2Jyb2FkY2FzdCc6ICdCcm9hZGNhc3QgVG9vbHMnLFxuICAgICAgICAgICAgICAgICdzY2VuZUFkdmFuY2VkJzogJ0FkdmFuY2VkIFNjZW5lIFRvb2xzJyxcbiAgICAgICAgICAgICAgICAnc2NlbmVWaWV3JzogJ1NjZW5lIFZpZXcgVG9vbHMnLFxuICAgICAgICAgICAgICAgICdyZWZlcmVuY2VJbWFnZSc6ICdSZWZlcmVuY2UgSW1hZ2UgVG9vbHMnLFxuICAgICAgICAgICAgICAgICdhc3NldEFkdmFuY2VkJzogJ0FkdmFuY2VkIEFzc2V0IFRvb2xzJyxcbiAgICAgICAgICAgICAgICAndmFsaWRhdGlvbic6ICdWYWxpZGF0aW9uIFRvb2xzJ1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBjYXRlZ29yeU5hbWVzW2NhdGVnb3J5XSB8fCBjYXRlZ29yeTtcbiAgICAgICAgfSxcblxuICAgICAgICBzaG93TW9kYWwodGhpczogYW55LCBtb2RhbElkOiBzdHJpbmcpIHtcbiAgICAgICAgICAgIHRoaXMuJFttb2RhbElkXS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICAgICAgfSxcblxuICAgICAgICBoaWRlTW9kYWwodGhpczogYW55LCBtb2RhbElkOiBzdHJpbmcpIHtcbiAgICAgICAgICAgIHRoaXMuJFttb2RhbElkXS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICAgICAgICB9LFxuXG4gICAgICAgIHNob3dFcnJvcih0aGlzOiBhbnksIG1lc3NhZ2U6IHN0cmluZykge1xuICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy5lcnJvcignRXJyb3InLCB7IGRldGFpbDogbWVzc2FnZSB9KTtcbiAgICAgICAgfSxcblxuICAgICAgICBhc3luYyBzYXZlQ2hhbmdlcyh0aGlzOiBhbnkpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbikge1xuICAgICAgICAgICAgICAgIHRoaXMuc2hvd0Vycm9yKCdObyBjb25maWd1cmF0aW9uIHNlbGVjdGVkJyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uIGlzIHNhdmVkIHRvIHRoZSBiYWNrZW5kXG4gICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnY29jb3MtbWNwLXNlcnZlcicsICd1cGRhdGVUb29sQ29uZmlndXJhdGlvbicsIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLmlkLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5jdXJyZW50Q29uZmlndXJhdGlvbi5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xzOiB0aGlzLmN1cnJlbnRDb25maWd1cmF0aW9uLnRvb2xzXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIEVkaXRvci5EaWFsb2cuaW5mbygnU2F2ZWQnLCB7IGRldGFpbDogJ0NvbmZpZ3VyYXRpb24gY2hhbmdlcyBoYXZlIGJlZW4gc2F2ZWQnIH0pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2F2ZSBjaGFuZ2VzOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dFcnJvcignRmFpbGVkIHRvIHNhdmUgY2hhbmdlcycpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIGJpbmRFdmVudHModGhpczogYW55KSB7XG4gICAgICAgICAgICB0aGlzLiQuY3JlYXRlQ29uZmlnQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5jcmVhdGVDb25maWd1cmF0aW9uLmJpbmQodGhpcykpO1xuICAgICAgICAgICAgdGhpcy4kLmVkaXRDb25maWdCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCB0aGlzLmVkaXRDb25maWd1cmF0aW9uLmJpbmQodGhpcykpO1xuICAgICAgICAgICAgdGhpcy4kLmRlbGV0ZUNvbmZpZ0J0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMuZGVsZXRlQ29uZmlndXJhdGlvbi5iaW5kKHRoaXMpKTtcbiAgICAgICAgICAgIHRoaXMuJC5hcHBseUNvbmZpZ0J0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMuYXBwbHlDb25maWd1cmF0aW9uLmJpbmQodGhpcykpO1xuICAgICAgICAgICAgdGhpcy4kLmV4cG9ydENvbmZpZ0J0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMuZXhwb3J0Q29uZmlndXJhdGlvbi5iaW5kKHRoaXMpKTtcbiAgICAgICAgICAgIHRoaXMuJC5pbXBvcnRDb25maWdCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCB0aGlzLmltcG9ydENvbmZpZ3VyYXRpb24uYmluZCh0aGlzKSk7XG5cbiAgICAgICAgICAgIHRoaXMuJC5zZWxlY3RBbGxCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCB0aGlzLnNlbGVjdEFsbFRvb2xzLmJpbmQodGhpcykpO1xuICAgICAgICAgICAgdGhpcy4kLmRlc2VsZWN0QWxsQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5kZXNlbGVjdEFsbFRvb2xzLmJpbmQodGhpcykpO1xuICAgICAgICAgICAgdGhpcy4kLnNhdmVDaGFuZ2VzQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5zYXZlQ2hhbmdlcy5iaW5kKHRoaXMpKTtcblxuICAgICAgICAgICAgdGhpcy4kLmNsb3NlTW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLmhpZGVNb2RhbCgnY29uZmlnTW9kYWwnKSk7XG4gICAgICAgICAgICB0aGlzLiQuY2FuY2VsQ29uZmlnQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlTW9kYWwoJ2NvbmZpZ01vZGFsJykpO1xuICAgICAgICAgICAgdGhpcy4kLmNvbmZpZ0Zvcm0uYWRkRXZlbnRMaXN0ZW5lcignc3VibWl0JywgKGU6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNhdmVDb25maWd1cmF0aW9uKCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy4kLmNsb3NlSW1wb3J0TW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLmhpZGVNb2RhbCgnaW1wb3J0TW9kYWwnKSk7XG4gICAgICAgICAgICB0aGlzLiQuY2FuY2VsSW1wb3J0QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlTW9kYWwoJ2ltcG9ydE1vZGFsJykpO1xuICAgICAgICAgICAgdGhpcy4kLmNvbmZpcm1JbXBvcnRCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCB0aGlzLmNvbmZpcm1JbXBvcnQuYmluZCh0aGlzKSk7XG5cbiAgICAgICAgICAgIHRoaXMuJC5jb25maWdTZWxlY3Rvci5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCB0aGlzLmFwcGx5Q29uZmlndXJhdGlvbi5iaW5kKHRoaXMpKTtcbiAgICAgICAgfVxuICAgIH0sXG4gICAgcmVhZHkoKSB7XG4gICAgICAgICh0aGlzIGFzIGFueSkudG9vbE1hbmFnZXJTdGF0ZSA9IG51bGw7XG4gICAgICAgICh0aGlzIGFzIGFueSkuY3VycmVudENvbmZpZ3VyYXRpb24gPSBudWxsO1xuICAgICAgICAodGhpcyBhcyBhbnkpLmNvbmZpZ3VyYXRpb25zID0gW107XG4gICAgICAgICh0aGlzIGFzIGFueSkuYXZhaWxhYmxlVG9vbHMgPSBbXTtcbiAgICAgICAgKHRoaXMgYXMgYW55KS5lZGl0aW5nQ29uZmlnID0gbnVsbDtcblxuICAgICAgICAodGhpcyBhcyBhbnkpLmJpbmRFdmVudHMoKTtcbiAgICAgICAgKHRoaXMgYXMgYW55KS5sb2FkVG9vbE1hbmFnZXJTdGF0ZSgpO1xuICAgIH0sXG4gICAgYmVmb3JlQ2xvc2UoKSB7XG4gICAgICAgIC8vIENsZWFudXBcbiAgICB9LFxuICAgIGNsb3NlKCkge1xuICAgICAgICAvLyBDbGVhbnVwIHdoZW4gdGhlIHBhbmVsIGNsb3Nlc1xuICAgIH1cbn0gYXMgYW55KTsgIl19