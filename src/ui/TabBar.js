/**
 * Tab Bar UI using Observer Pattern
 * Displays and manages tabs
 *
 * Markup mirrors morphTo's document-tab strip exactly: the component renders
 * `.doc-tab` items straight into `#doc-tabs`, and the "+" control lives in the
 * page markup as `#doc-new` (wired by MorphToShell), not here.
 */
import { Component } from './Component.js';
import { EVENTS } from '../events/EventBus.js';

export class TabBar extends Component {
    constructor(container, tabManager) {
        super(container);
        this.tabManager = tabManager;
    }

    /**
     * Render the tab bar
     */
    render() {
        this.container.innerHTML = '';

        // Render all tabs
        this.tabManager.tabs.forEach(tab => {
            const isActive = tab.id === this.tabManager.activeTabId;
            this.container.appendChild(this.renderTab(tab, isActive));
        });

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
            class: 'doc-tab' + (isActive ? ' active' : ''),
            'data-doc-id': tab.id
        });

        const title = this.createElement('div', {
            class: 'doc-tab-title'
        }, tab.name);

        const close = this.createElement('button', {
            type: 'button',
            class: 'doc-tab-close',
            title: 'Close'
        }, '×');
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onTabClose(tab.id);
        });

        tabElement.appendChild(title);
        tabElement.appendChild(close);

        tabElement.addEventListener('click', () => this.onTabClick(tab.id));
        tabElement.addEventListener('dblclick', () => this.onTabDoubleClick(tab.id));

        return tabElement;
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
        this.tabManager.createTab(`Untitled ${tabNumber}`);
    }

    /**
     * Handle double click to rename.  morphTo prompts for the new name rather
     * than editing in place, so the tab markup stays the same either way.
     * @param {string} id
     */
    onTabDoubleClick(id) {
        const tab = this.tabManager.getTab(id);
        if (!tab || typeof window === 'undefined' || !window.prompt) return;

        const nextName = window.prompt('Rename tab:', tab.name);
        if (nextName == null) return; // cancelled

        this.finishRename(id, nextName);
    }

    /**
     * Finish renaming a tab
     * @param {string} id
     * @param {string} newName
     */
    finishRename(id, newName) {
        if (String(newName).trim()) {
            this.tabManager.renameTab(id, newName);
        }
    }
}
