/**
 * Edge Joinery Context Menu
 * Shows joint type options and parameters for the selected edge.
 */
import { FocusTrap } from './a11y/FocusTrap.js';
import { JOINT_TYPES, ALIGN_OPTIONS, normalizeJoineryType } from '../models/joinery.js';

const DEFAULT_THICKNESS_MM = 3;
const DEFAULT_FINGER_COUNT = 6;
const DEFAULT_ALIGN = 'left';

export class EdgeJoineryMenu {
    constructor({ getShapeStore }) {
        this.getShapeStore = getShapeStore;
        this.edge = null;
        this.activeType = null;
        this.activeAlign = DEFAULT_ALIGN;
        this.isOpen = false;
        this.root = document.createElement('div');
        this.root.className = 'edge-joinery-menu';
        // A modal-ish popover for configuring an edge joint: dialog semantics
        // + focus trap so keyboard users stay within it until they act/dismiss.
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.setAttribute('aria-label', 'Edge joinery');
        this.root.setAttribute('aria-hidden', 'true');
        this.root.addEventListener('mousedown', (e) => e.stopPropagation());
        this.root.addEventListener('contextmenu', (e) => e.preventDefault());

        this.typeButtons = new Map();
        this.alignButtons = new Map();
        this.buildMenu();

        document.body.appendChild(this.root);

        this.onDocumentMouseDown = (e) => this.handleDocumentMouseDown(e);
        this.onDocumentKeyDown = (e) => this.handleDocumentKeyDown(e);
    }

    buildMenu() {
        const list = document.createElement('div');
        list.className = 'edge-joinery-menu__list';

        JOINT_TYPES.forEach((joint) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'edge-joinery-menu__item';
            button.textContent = joint.label;
            button.setAttribute('role', 'menuitem');
            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.setActiveType(joint.id, true);
            });
            this.typeButtons.set(joint.id, button);
            list.appendChild(button);
        });

        this.submenu = document.createElement('div');
        this.submenu.className = 'edge-joinery-menu__submenu';

        this.submenuTitle = document.createElement('div');
        this.submenuTitle.className = 'edge-joinery-menu__title';
        this.submenu.appendChild(this.submenuTitle);

        this.submenuDesc = document.createElement('p');
        this.submenuDesc.className = 'edge-joinery-menu__desc';
        this.submenu.appendChild(this.submenuDesc);

        const thicknessGroup = document.createElement('div');
        thicknessGroup.className = 'edge-joinery-menu__field';

        const thicknessLabel = document.createElement('label');
        thicknessLabel.className = 'edge-joinery-menu__label';
        thicknessLabel.textContent = 'Thickness (mm)';
        thicknessLabel.setAttribute('for', 'edge-joinery-thickness');

        this.thicknessInput = document.createElement('input');
        this.thicknessInput.type = 'number';
        this.thicknessInput.id = 'edge-joinery-thickness';
        this.thicknessInput.min = '0';
        this.thicknessInput.step = '0.1';
        this.thicknessInput.value = String(DEFAULT_THICKNESS_MM);
        this.thicknessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.applyJoinery();
            }
        });

        thicknessGroup.appendChild(thicknessLabel);
        thicknessGroup.appendChild(this.thicknessInput);
        this.submenu.appendChild(thicknessGroup);

        const countGroup = document.createElement('div');
        countGroup.className = 'edge-joinery-menu__field';

        const countLabel = document.createElement('label');
        countLabel.className = 'edge-joinery-menu__label';
        countLabel.textContent = 'Finger count';
        countLabel.setAttribute('for', 'edge-joinery-count');

        this.countInput = document.createElement('input');
        this.countInput.type = 'number';
        this.countInput.id = 'edge-joinery-count';
        this.countInput.min = '2';
        this.countInput.step = '1';
        this.countInput.value = String(DEFAULT_FINGER_COUNT);
        this.countInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.applyJoinery();
            }
        });

        countGroup.appendChild(countLabel);
        countGroup.appendChild(this.countInput);
        this.submenu.appendChild(countGroup);

        // Alignment buttons
        const alignGroup = document.createElement('div');
        alignGroup.className = 'edge-joinery-menu__field';

        const alignLabel = document.createElement('label');
        alignLabel.className = 'edge-joinery-menu__label';
        alignLabel.textContent = 'Alignment';

        const alignButtonsContainer = document.createElement('div');
        alignButtonsContainer.className = 'edge-joinery-menu__align-buttons';

        ALIGN_OPTIONS.forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'edge-joinery-menu__align-btn';
            btn.textContent = opt.label;
            btn.dataset.align = opt.id;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.setActiveAlign(opt.id);
            });
            this.alignButtons.set(opt.id, btn);
            alignButtonsContainer.appendChild(btn);
        });

        alignGroup.appendChild(alignLabel);
        alignGroup.appendChild(alignButtonsContainer);
        this.submenu.appendChild(alignGroup);

        const actions = document.createElement('div');
        actions.className = 'edge-joinery-menu__actions';

        this.applyButton = document.createElement('button');
        this.applyButton.type = 'button';
        this.applyButton.className = 'edge-joinery-menu__apply';
        this.applyButton.textContent = 'Apply';
        this.applyButton.addEventListener('click', () => this.applyJoinery());

        this.cancelButton = document.createElement('button');
        this.cancelButton.type = 'button';
        this.cancelButton.className = 'edge-joinery-menu__cancel';
        this.cancelButton.textContent = 'Cancel';
        this.cancelButton.addEventListener('click', () => this.hide());

        actions.appendChild(this.applyButton);
        actions.appendChild(this.cancelButton);
        this.submenu.appendChild(actions);

        this.root.appendChild(list);
        this.root.appendChild(this.submenu);
    }

    show({ x, y, edge }) {
        this.edge = edge;
        this.activeType = null;
        this.activeAlign = DEFAULT_ALIGN;
        this.setActiveType(null, false);
        this.setActiveAlign(DEFAULT_ALIGN);

        const shapeStore = this.getShapeStore?.();
        const joinery = shapeStore?.getEdgeJoinery?.(edge) || null;

        if (joinery?.type) {
            const mappedType = normalizeJoineryType(joinery.type);
            if (mappedType) {
                this.setActiveType(mappedType, true);
                if (typeof joinery.thicknessMm === 'number') {
                    this.thicknessInput.value = String(joinery.thicknessMm);
                }
                if (typeof joinery.fingerCount === 'number') {
                    this.countInput.value = String(joinery.fingerCount);
                }
                if (joinery.align) {
                    this.setActiveAlign(joinery.align);
                }
            }
        } else {
            this.thicknessInput.value = String(DEFAULT_THICKNESS_MM);
            this.countInput.value = String(DEFAULT_FINGER_COUNT);
            this.closeSubmenu();
        }

        this.positionMenu(x, y);
        this.open();
    }

    hide() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.root.classList.remove('is-open');
        this.root.setAttribute('aria-hidden', 'true');
        document.removeEventListener('mousedown', this.onDocumentMouseDown);
        document.removeEventListener('keydown', this.onDocumentKeyDown);
        // Release the focus trap and return focus to the canvas.
        this.focusTrap?.release();
        this.focusTrap = null;
    }

    open() {
        this.isOpen = true;
        this.root.classList.add('is-open');
        this.root.setAttribute('aria-hidden', 'false');
        // Trap keyboard focus inside the dialog while it is open.
        this.focusTrap = new FocusTrap(this.root);
        this.focusTrap.activate();
        setTimeout(() => {
            document.addEventListener('mousedown', this.onDocumentMouseDown);
            document.addEventListener('keydown', this.onDocumentKeyDown);
        }, 0);
    }

    handleDocumentMouseDown(e) {
        if (!this.root.contains(e.target)) {
            this.hide();
        }
    }

    handleDocumentKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
        }
    }

    setActiveType(type, openSubmenu) {
        this.activeType = type;
        this.typeButtons.forEach((button, id) => {
            button.classList.toggle('is-active', id === type);
        });
        if (type && openSubmenu) {
            const joint = JOINT_TYPES.find((item) => item.id === type);
            this.submenuTitle.textContent = joint?.label || 'Joint';
            if (this.submenuDesc) this.submenuDesc.textContent = joint?.desc || '';
            this.openSubmenu();
            setTimeout(() => {
                this.thicknessInput.focus();
                this.thicknessInput.select();
            }, 0);
        } else if (!openSubmenu) {
            this.closeSubmenu();
        }
    }

    setActiveAlign(align) {
        this.activeAlign = align;
        this.alignButtons.forEach((button, id) => {
            button.classList.toggle('is-active', id === align);
        });
    }

    openSubmenu() {
        this.root.classList.add('has-submenu');
        this.submenu.classList.add('is-open');
    }

    closeSubmenu() {
        this.root.classList.remove('has-submenu');
        this.submenu.classList.remove('is-open');
    }

    applyJoinery() {
        if (!this.activeType || !this.edge) {
            return;
        }
        const thicknessMm = Number(this.thicknessInput.value);
        if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
            this.thicknessInput.focus();
            return;
        }
        const fingerCount = Number(this.countInput.value);
        if (!Number.isFinite(fingerCount) || fingerCount < 2) {
            this.countInput.focus();
            return;
        }

        const shapeStore = this.getShapeStore?.();
        if (shapeStore?.setEdgeJoinery) {
            shapeStore.setEdgeJoinery(this.edge, {
                type: this.activeType,
                thicknessMm,
                fingerCount: Math.floor(fingerCount),
                align: this.activeAlign
            });
        }

        this.hide();
    }

    positionMenu(x, y) {
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        this.root.style.visibility = 'hidden';
        this.root.classList.add('is-open');

        const rect = this.root.getBoundingClientRect();
        const padding = 8;
        let left = x;
        let top = y;

        if (left + rect.width > window.innerWidth - padding) {
            left = Math.max(padding, window.innerWidth - rect.width - padding);
        }

        if (top + rect.height > window.innerHeight - padding) {
            top = Math.max(padding, window.innerHeight - rect.height - padding);
        }

        this.root.style.left = `${left}px`;
        this.root.style.top = `${top}px`;
        this.root.style.visibility = '';
    }
}

export { JOINT_TYPES, ALIGN_OPTIONS };

