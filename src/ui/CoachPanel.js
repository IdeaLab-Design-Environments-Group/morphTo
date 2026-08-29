/**
 * @fileoverview CoachPanel — the AI Fabrication Coach as a toolbar flyover.
 *
 * A single "AI" button in the top-right of the toolbar toggles this popover.
 * When open it gathers the active scene through {@link SceneContext}, runs the
 * deterministic laser-cutting rules plus (when a key is configured) Gemini's
 * open-ended review, and lists the findings. No key is required for the local
 * checks; a BYOK field appears when Gemini is not configured.
 *
 * It follows Otto's existing flyover pattern (see EdgeJoineryMenu): a
 * body-appended `role="dialog"` anchored under its trigger, dismissed on
 * click-outside or Escape, with a FocusTrap while open. All model-provided text
 * is written via `textContent`, never innerHTML.
 */
import { Component } from './Component.js';
import { FocusTrap } from './a11y/FocusTrap.js';
import { createCoach, saveApiKey, loadLlmConfig } from '../review/index.js';

/** Leading glyph per severity, matching the coach's vocabulary. */
const SEVERITY_ICON = { error: '✕', warning: '⚠', info: 'ℹ', praise: '✓' };

export class CoachPanel extends Component {
    /**
     * @param {import('../core/SceneContext.js').SceneContext} context
     *   Live accessor for the active tab's shapeStore / parameterStore.
     * @param {Object} [opts]
     * @param {() => string} [opts.getCode]  Returns the current AQUI source, if any.
     * @param {HTMLElement} [opts.button]  The toolbar button that toggles the flyover.
     */
    constructor(context, { getCode = () => '', button = null } = {}) {
        const root = document.createElement('div');
        root.className = 'coach-flyover';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'AI Fabrication Coach');
        root.setAttribute('aria-hidden', 'true');
        // Clicks inside the flyover must not bubble to the document-level
        // dismiss handler that closes it.
        root.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(root);

        super(root);
        this.context = context;
        this.getCode = getCode;
        this.button = button;

        /** @type {?import('../review/FabricationCoach.js').FabricationCoach} */
        this.coach = null;
        this.busy = false;
        this.isOpen = false;
        /** Latest render state: 'idle' | 'loading' | 'findings' | 'error'. */
        this.state = 'idle';
        this.findings = [];
        this.errorMessage = '';
        this.focusTrap = null;

        this.onDocumentMouseDown = (e) => this.handleDocumentMouseDown(e);
        this.onDocumentKeyDown = (e) => this.handleDocumentKeyDown(e);

        if (this.button) {
            this.button.setAttribute('aria-haspopup', 'dialog');
            this.button.setAttribute('aria-expanded', 'false');
            this.button.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggle();
            });
        }
    }

    /** Build (or rebuild after a key change) the coach lazily. */
    async ensureCoach() {
        if (!this.coach) this.coach = await createCoach();
        return this.coach;
    }

    render() {
        this.container.innerHTML = '';

        // Header: title + close button.
        const header = this.createElement('div', { class: 'coach-flyover__header' });
        header.appendChild(this.createElement('h3', { class: 'coach-flyover__title' },
            'AI Fabrication Coach'));
        const closeBtn = this.createElement('button', {
            class: 'coach-flyover__close', type: 'button', 'aria-label': 'Close'
        }, '✕');
        closeBtn.addEventListener('click', () => this.close());
        header.appendChild(closeBtn);
        this.container.appendChild(header);

        // Body: run button, results, and (when needed) the key row.
        this.body = this.createElement('div', { class: 'coach-flyover__body' });
        this.container.appendChild(this.body);

        const runButton = this.createElement('button', {
            class: 'btn-coach-run', type: 'button', disabled: this.busy
        }, this.busy ? 'Reviewing…' : 'Review my design');
        runButton.addEventListener('click', () => this.runReview());
        this.body.appendChild(runButton);

        // Results region — aria-live so screen readers announce new findings.
        const results = this.createElement('div', { class: 'coach-results', role: 'status' });
        results.setAttribute('aria-live', 'polite');
        this.body.appendChild(results);
        this.renderResults(results);

        this.renderKeyRow();
    }

    /** Render the BYOK key row only when no key is configured. */
    async renderKeyRow() {
        const config = await loadLlmConfig().catch(() => null);
        if (!this.body) return; // closed / re-rendered while awaiting
        const existing = this.body.querySelector('.coach-key-row');
        if (existing) existing.remove();

        const configured = config && config.apiKey
            && config.apiKey !== 'YOUR_GEMINI_API_KEY';
        if (configured) return;

        const row = this.createElement('div', { class: 'coach-key-row' });
        row.appendChild(this.createElement('label', { class: 'coach-key-label' },
            'Gemini API key (stored in this browser only):'));
        const input = this.createElement('input', {
            type: 'password', class: 'coach-key-input',
            placeholder: 'Paste your Gemini API key'
        });
        const saveBtn = this.createElement('button', {
            class: 'btn-coach-key', type: 'button'
        }, 'Save key');
        saveBtn.addEventListener('click', () => {
            const key = input.value.trim();
            if (!key) return;
            saveApiKey(key);
            this.coach = null; // force rebuild with the new key
            this.render();
        });
        const help = this.createElement('a', {
            class: 'coach-key-help',
            href: 'https://aistudio.google.com/apikey',
            target: '_blank', rel: 'noopener'
        }, 'Get a free key');

        row.appendChild(input);
        row.appendChild(saveBtn);
        row.appendChild(help);
        this.body.appendChild(row);
    }

    /** Paint the results region for the current state. */
    renderResults(region = this.container.querySelector('.coach-results')) {
        if (!region) return;
        region.innerHTML = '';

        if (this.state === 'idle') {
            region.appendChild(this.createElement('p', { class: 'coach-hint' },
                'Get feedback on your design before you fabricate it.'));
            return;
        }
        if (this.state === 'loading') {
            region.appendChild(this.createElement('p', { class: 'coach-hint' },
                'Asking the coach…'));
            return;
        }
        if (this.state === 'error') {
            region.appendChild(this.createElement('p', { class: 'coach-error' },
                this.errorMessage));
            return;
        }
        // state === 'findings'
        if (this.findings.length === 0) {
            region.appendChild(this.createElement('p', { class: 'coach-hint' },
                'No feedback returned.'));
            return;
        }
        for (const f of this.findings) region.appendChild(this.renderFinding(f));
    }

    /**
     * @param {{severity: string, title: string, detail: string, suggestion: string}} f
     * @returns {HTMLElement}
     */
    renderFinding(f) {
        const item = this.createElement('div', {
            class: `coach-finding coach-finding--${f.severity}`
        });
        const head = this.createElement('div', { class: 'coach-finding__head' });
        head.appendChild(this.createElement('span', {
            class: 'coach-finding__icon', 'aria-hidden': 'true'
        }, SEVERITY_ICON[f.severity] || 'ℹ'));
        head.appendChild(this.createElement('span', { class: 'coach-finding__title' }, f.title));
        item.appendChild(head);

        if (f.detail) {
            item.appendChild(this.createElement('p', { class: 'coach-finding__detail' }, f.detail));
        }
        if (f.suggestion) {
            item.appendChild(this.createElement('p', { class: 'coach-finding__suggestion' },
                `Try: ${f.suggestion}`));
        }
        return item;
    }

    /** Gather the scene, call the coach, and re-render with the result. */
    async runReview() {
        if (this.busy) return;
        this.busy = true;
        this.state = 'loading';
        this.render();

        try {
            const coach = await this.ensureCoach();
            const shapes = this.context.shapeStore.getResolved();
            const parameters = this.context.parameterStore.getAll();
            const code = this.getCode();

            const { findings } = await coach.review({ shapes, parameters, code });
            this.findings = findings;
            this.state = 'findings';
        } catch (err) {
            this.state = 'error';
            this.errorMessage = err?.message || 'The coach could not complete the review.';
        } finally {
            this.busy = false;
            this.render();
        }
    }

    // --- Flyover open/close/anchor -----------------------------------------

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.render();
        this.position();
        this.container.classList.add('is-open');
        this.container.setAttribute('aria-hidden', 'false');
        this.button?.classList.add('active');
        this.button?.setAttribute('aria-expanded', 'true');

        this.focusTrap = new FocusTrap(this.container);
        this.focusTrap.activate();
        // Defer document listeners so the opening click does not immediately
        // close the flyover.
        setTimeout(() => {
            document.addEventListener('mousedown', this.onDocumentMouseDown);
            document.addEventListener('keydown', this.onDocumentKeyDown);
        }, 0);
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.container.classList.remove('is-open');
        this.container.setAttribute('aria-hidden', 'true');
        this.button?.classList.remove('active');
        this.button?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', this.onDocumentMouseDown);
        document.removeEventListener('keydown', this.onDocumentKeyDown);
        this.focusTrap?.release();
        this.focusTrap = null;
    }

    /** Anchor the flyover under its trigger, right edges aligned. */
    position() {
        this.container.style.position = 'fixed';
        const rect = this.button?.getBoundingClientRect();
        if (rect) {
            this.container.style.top = `${Math.round(rect.bottom + 6)}px`;
            this.container.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
            this.container.style.left = 'auto';
        } else {
            this.container.style.top = '56px';
            this.container.style.right = '12px';
            this.container.style.left = 'auto';
        }
    }

    handleDocumentMouseDown(e) {
        if (e.target === this.button || this.button?.contains(e.target)) return;
        if (!this.container.contains(e.target)) this.close();
    }

    handleDocumentKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    }
}
