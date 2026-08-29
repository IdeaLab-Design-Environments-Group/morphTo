/**
 * @fileoverview RovingTabindex — the standard keyboard pattern for a widget
 * that is a single Tab stop internally navigated with arrow keys (toolbars,
 * listboxes, tablists). Exactly one item has tabindex="0"; the rest have
 * tabindex="-1". Arrow keys move the "0" and focus.
 *
 * @module ui/a11y/RovingTabindex
 */
export class RovingTabindex {
    /**
     * @param {HTMLElement} container - Holds the items.
     * @param {Object} [options]
     * @param {string} [options.itemSelector='[role="option"]'] - Item selector.
     * @param {'horizontal'|'vertical'|'both'} [options.orientation='both']
     * @param {(item: HTMLElement) => void} [options.onActivate] - Enter/Space handler.
     */
    constructor(container, { itemSelector = '[role="option"]', orientation = 'both', onActivate = null } = {}) {
        this.container = container;
        this.itemSelector = itemSelector;
        this.orientation = orientation;
        this.onActivate = onActivate;
        this.onKeyDown = this.onKeyDown.bind(this);
        this.container.addEventListener('keydown', this.onKeyDown);
        this.refresh();
    }

    items() {
        return Array.from(this.container.querySelectorAll(this.itemSelector));
    }

    /** Ensure exactly one item is the tab stop (the first, or the active one). */
    refresh() {
        const items = this.items();
        if (items.length === 0) return;
        const current = items.find(el => el.getAttribute('tabindex') === '0') || items[0];
        items.forEach(el => el.setAttribute('tabindex', el === current ? '0' : '-1'));
    }

    /** @private */
    focusItem(items, index) {
        const clamped = (index + items.length) % items.length;
        items.forEach((el, i) => el.setAttribute('tabindex', i === clamped ? '0' : '-1'));
        items[clamped].focus();
    }

    /** @private */
    onKeyDown(e) {
        const items = this.items();
        if (items.length === 0) return;
        const currentIndex = items.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        const next = this.orientation !== 'vertical' ? ['ArrowRight'] : [];
        const prev = this.orientation !== 'vertical' ? ['ArrowLeft'] : [];
        if (this.orientation !== 'horizontal') {
            next.push('ArrowDown');
            prev.push('ArrowUp');
        }

        if (next.includes(e.key)) {
            e.preventDefault();
            this.focusItem(items, currentIndex + 1);
        } else if (prev.includes(e.key)) {
            e.preventDefault();
            this.focusItem(items, currentIndex - 1);
        } else if (e.key === 'Home') {
            e.preventDefault();
            this.focusItem(items, 0);
        } else if (e.key === 'End') {
            e.preventDefault();
            this.focusItem(items, items.length - 1);
        } else if ((e.key === 'Enter' || e.key === ' ') && this.onActivate) {
            e.preventDefault();
            this.onActivate(items[currentIndex]);
        }
    }

    destroy() {
        this.container.removeEventListener('keydown', this.onKeyDown);
    }
}
