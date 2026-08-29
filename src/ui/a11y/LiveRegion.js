/**
 * @fileoverview LiveRegion — a tiny wrapper over an ARIA live region so the
 * app can announce transient status to screen readers without stealing
 * focus. Used for notifications ("Saved successfully") and for canvas
 * selection changes ("Circle 3 selected, 2 of 7 shapes").
 *
 * @module ui/a11y/LiveRegion
 */
export class LiveRegion {
    /**
     * @param {HTMLElement} element - An element with role="status" (polite)
     *   or role="alert" (assertive). Its text content is replaced on announce.
     */
    constructor(element) {
        this.element = element;
    }

    /**
     * Announce a message. Clearing first guarantees repeated identical
     * messages are still spoken (some screen readers debounce duplicates).
     * @param {string} message
     */
    announce(message) {
        if (!this.element) return;
        this.element.textContent = '';
        // Next frame so assistive tech registers the change as new.
        requestAnimationFrame(() => {
            this.element.textContent = message;
        });
    }
}
