/**
 * Tab Bar UI using Observer Pattern
 * Displays and manages tabs
 */
import { Component } from './Component.js';
import { EVENTS } from '../events/EventBus.js';

export class TabBar extends Component {
    constructor(container, tabManager) {
        super(container);
        this.tabManager = tabManager;
        this.editingTabId = null;
    }
    
    /**
     * Render the tab bar
     */
    render() {
        // Find or create tabs container (preserve toolbar buttons)
        let tabsContainer = this.container.querySelector('.tabs-container');
        
        if (!tabsContainer) {
            // Create tabs container
            tabsContainer = document.createElement('div');
            tabsContainer.className = 'tabs-container';
            tabsContainer.style.display = 'flex';
            tabsContainer.style.alignItems = 'center';
            tabsContainer.style.gap = '4px';
            tabsContainer.style.flex = '1';
            tabsContainer.style.overflowX = 'auto';
            tabsContainer.style.overflowY = 'hidden';
            
            // Insert after toolbar buttons, or at the end if no toolbar
            const toolbarButtons = this.container.querySelector('.toolbar-buttons');
            if (toolbarButtons) {
                this.container.insertBefore(tabsContainer, toolbarButtons.nextSibling);
            } else {
                this.container.appendChild(tabsContainer);
            }
        } else {
            // Clear existing tabs
            tabsContainer.innerHTML = '';
        }
        
        // Render all tabs
        this.tabManager.tabs.forEach(tab => {
            const isActive = tab.id === this.tabManager.activeTabId;
            const tabElement = this.renderTab(tab, isActive);
            tabsContainer.appendChild(tabElement);
        });
        
        // Render new tab button
        const newTabButton = this.renderNewTabButton();
        tabsContainer.appendChild(newTabButton);
        
        // Subscribe to tab events (only once)
        if (!this._eventsSubscribed) {
            this.subscribeToEvents();
            this._eventsSubscribed = true;
        }
    }
    
    /**
     * Subscribe to tab events
     */
    subscribeToEvents() {
        this.subscribe(EVENTS.TAB_CREATED, () => this.render());
        this.subscribe(EVENTS.TAB_CLOSED, () => this.render());
        this.subscribe(EVENTS.TAB_SWITCHED, () => this.render());
    }
    
    /**
     * Render a single tab
     * @param {Tab} tab 
     * @param {boolean} isActive 
     * @returns {HTMLElement}
     */
    renderTab(tab, isActive) {
        const tabElement = this.createElement('div', {
            class: `tab-item ${isActive ? 'tab-active' : ''}`,
            'data-tab-id': tab.id
        });
        
        // Tab label
        if (this.editingTabId === tab.id) {
            // Show input for editing
            const input = this.createElement('input', {
                type: 'text',
                class: 'tab-rename-input',
                value: tab.name
            });
            
            input.addEventListener('blur', () => {
                this.finishRename(tab.id, input.value);
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    input.blur();
                } else if (e.key === 'Escape') {
                    this.editingTabId = null;
                    this.render();
                }
            });
            
            // Focus and select text
            setTimeout(() => {
                input.focus();
                input.select();
            }, 0);
            
            tabElement.appendChild(input);
        } else {
            // Show tab name
            const label = this.createElement('span', {
                class: 'tab-label'
            }, tab.name);
            label.addEventListener('dblclick', () => this.onTabDoubleClick(tab.id));
            tabElement.appendChild(label);
        }
        
        // Close button
        if (this.tabManager.tabs.length > 1) {
            const closeButton = this.createElement('button', {
                class: 'tab-close',
                type: 'button'
            }, '×');
            closeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onTabClose(tab.id);
            });
            tabElement.appendChild(closeButton);
        }
        
        // Click to switch
        if (!isActive || this.editingTabId !== tab.id) {
            tabElement.addEventListener('click', (e) => {
                if (e.target.classList.contains('tab-close')) return;
                this.onTabClick(tab.id);
            });
        }
        
        return tabElement;
    }
    
    /**
     * Render new tab button
     * @returns {HTMLElement}
     */
    renderNewTabButton() {
        const button = this.createElement('button', {
            class: 'tab-new',
            type: 'button'
        }, '+ New Tab');
        button.addEventListener('click', () => this.onNewTab());
        return button;
    }
    
    /**
     * Handle tab click
     * @param {string} id 
     */
    onTabClick(id) {
        this.tabManager.switchTab(id);
    }
    
    /**
     * Handle tab close
     * @param {string} id 
     */
    onTabClose(id) {
        this.tabManager.closeTab(id);
    }
    
    /**
     * Handle new tab
     */
    onNewTab() {
        const tabNumber = this.tabManager.tabs.length + 1;
        this.tabManager.createTab(`Scene ${tabNumber}`);
    }
    
    /**
     * Handle double click to rename
     * @param {string} id 
     */
    onTabDoubleClick(id) {
        this.editingTabId = id;
        this.render();
    }
    
    /**
     * Finish renaming a tab
     * @param {string} id 
     * @param {string} newName 
     */
    finishRename(id, newName) {
        this.editingTabId = null;
        if (newName.trim()) {
            this.tabManager.renameTab(id, newName);
        } else {
            this.render(); // Re-render if name was empty
        }
    }
}
