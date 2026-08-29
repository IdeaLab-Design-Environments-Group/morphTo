/**
 * PanelResizer - Handles resizing of panels
 * Allows users to adjust the width of left and right panels
 */
export class PanelResizer {
    constructor() {
        this.leftPanel = document.getElementById('left-panel');
        this.rightPanel = document.getElementById('right-panel');
        this.canvasContainer = document.getElementById('canvas-container');
        this.leftResizeHandle = document.querySelector('[data-resize="left"]');
        this.rightResizeHandle = document.querySelector('[data-resize="right"]');
        
        this.isResizing = false;
        this.currentHandle = null;
        this.startX = 0;
        this.startLeftWidth = 0;
        this.startRightWidth = 0;
        
        // Callback for when panels are resized
        this.onResizeCallback = null;
        
        this.init();
    }
    
    /**
     * Set callback to be called when panels are resized
     * @param {Function} callback
     */
    setOnResizeCallback(callback) {
        this.onResizeCallback = callback;
    }
    
    init() {
        // Load saved panel widths from localStorage
        this.loadPanelSizes();
        
        // Setup resize handles
        if (this.leftResizeHandle) {
            this.setupResizeHandle(this.leftResizeHandle, 'left');
        }
        
        if (this.rightResizeHandle) {
            this.setupResizeHandle(this.rightResizeHandle, 'right');
        }
    }
    
    setupResizeHandle(handle, side) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.startResize(e, side);
        });
        
        // Prevent text selection while resizing
        handle.addEventListener('selectstart', (e) => {
            e.preventDefault();
        });
    }
    
    startResize(e, side) {
        this.isResizing = true;
        this.currentHandle = side;
        this.startX = e.clientX;
        
        if (side === 'left') {
            this.startLeftWidth = this.leftPanel.offsetWidth;
        } else {
            this.startRightWidth = this.rightPanel.offsetWidth;
        }
        
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        
        // Add active class for visual feedback
        const handle = side === 'left' ? this.leftResizeHandle : this.rightResizeHandle;
        if (handle) {
            handle.classList.add('active');
        }
        
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }
    
    handleMouseMove = (e) => {
        if (!this.isResizing) return;
        
        const deltaX = e.clientX - this.startX;
        
        if (this.currentHandle === 'left') {
            const newWidth = Math.max(120, Math.min(window.innerWidth * 0.5, this.startLeftWidth + deltaX));
            this.leftPanel.style.width = `${newWidth}px`;
        } else if (this.currentHandle === 'right') {
            const newWidth = Math.max(150, Math.min(window.innerWidth * 0.5, this.startRightWidth - deltaX));
            this.rightPanel.style.width = `${newWidth}px`;
        }
        
        // Notify callback that panels are being resized
        if (this.onResizeCallback) {
            this.onResizeCallback();
        }
        
        // Save sizes
        this.savePanelSizes();
    }
    
    handleMouseUp = () => {
        if (!this.isResizing) return;
        
        this.isResizing = false;
        
        // Remove active class
        if (this.leftResizeHandle) {
            this.leftResizeHandle.classList.remove('active');
        }
        if (this.rightResizeHandle) {
            this.rightResizeHandle.classList.remove('active');
        }
        
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Notify callback that resize is complete
        if (this.onResizeCallback) {
            this.onResizeCallback();
        }
        
        this.currentHandle = null;
    }
    
    savePanelSizes() {
        if (this.leftPanel && this.rightPanel) {
            localStorage.setItem('otto-left-panel-width', this.leftPanel.style.width || '180px');
            localStorage.setItem('otto-right-panel-width', this.rightPanel.style.width || '260px');
        }
    }
    
    loadPanelSizes() {
        if (this.leftPanel) {
            const savedWidth = localStorage.getItem('otto-left-panel-width');
            if (savedWidth) {
                this.leftPanel.style.width = savedWidth;
            }
        }
        
        if (this.rightPanel) {
            const savedWidth = localStorage.getItem('otto-right-panel-width');
            if (savedWidth) {
                this.rightPanel.style.width = savedWidth;
            }
        }
    }
}
