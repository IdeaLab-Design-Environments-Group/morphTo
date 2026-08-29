/**
 * @fileoverview FocusTrap — confines Tab/Shift+Tab focus within a container
 * (a modal dialog) and restores focus to the invoking element on release.
 * Escape handling is left to the caller.
 *
 * @module ui/a11y/FocusTrap
 */
const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

export class FocusTrap {
    /**
     * @param {HTMLElement} container - The element to trap focus within.
     */
    constructor(container) {
        this.container = container;
        this.previouslyFocused = null;
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    /** Focusable descendants, in DOM order. */
    focusable() {
        return Array.from(this.container.querySelectorAll(FOCUSABLE))
            .filter(el => el.offsetParent !== null || el === document.activeElement);
    }

    /** Activate the trap and move focus to the first focusable element. */
    activate() {
        this.previouslyFocused = document.activeElement;
        this.container.addEventListener('keydown', this.onKeyDown);
        const items = this.focusable();
        (items[0] || this.container).focus();
    }

    /** Release the trap and restore focus to the invoker. */
    release() {
        this.container.removeEventListener('keydown', this.onKeyDown);
        if (this.previouslyFocused && typeof this.previouslyFocused.focus === 'function') {
            this.previouslyFocused.focus();
        }
    }

    /** @private */
    onKeyDown(e) {
        if (e.key !== 'Tab') return;
        const items = this.focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}
