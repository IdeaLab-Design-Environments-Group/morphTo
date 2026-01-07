// renderer.mjs - Simple integration without edge system

import { CoordinateSystem } from "./renderer/coordinateSystem.mjs";
import { ShapeStyleManager } from "./renderer/styleManager.mjs";
import { ShapeRenderer } from "./renderer/shapeRenderer.mjs";
import { PathRenderer } from "./renderer/pathRenderer.mjs";
import { BooleanOperationRenderer } from "./renderer/booleanRenderer.mjs";
import { SelectionSystem } from "./renderer/selectionSystem.mjs";
import { HandleSystem } from "./renderer/handleSystem.mjs";
import { DebugVisualizer } from "./renderer/debugVisualizer.mjs";
import { TransformManager } from "./renderer/transformManager.mjs";
import { InteractionHandler } from "./renderer/interactionHandler.mjs";
import { shapeManager } from "./shapeManager.mjs";

export class Renderer {
  constructor(canvas) {
    try {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");

      this._overlayDrawers = [];

      this.initializeComponents();
      this.initializeState();
      this.setupCanvas();
      this.setupInteractivity();
      this.enableInteractiveMode();

      shapeManager.registerRenderer(this);
    } catch (error) {
      console.error("Error initializing renderer:", error);
      this.setupFallbackCanvas();
    }
  }

  initializeComponents() {
    this.coordinateSystem = new CoordinateSystem(this.canvas);
    this.styleManager = new ShapeStyleManager();
    this.shapeRenderer = new ShapeRenderer(this.ctx);
    this.pathRenderer = new PathRenderer(this.ctx);
    this.booleanRenderer = new BooleanOperationRenderer(this.ctx);
    this.selectionSystem = new SelectionSystem(this);
    this.handleSystem = new HandleSystem(this);
    this.debugVisualizer = new DebugVisualizer(this.ctx);
    this.transformManager = new TransformManager();

    // Use the full interaction handler module (keeps hit-testing/handles consistent, esp. for paths)
    this.interactionHandler = new InteractionHandler(this);
    this.renderingEngine = new ModularRenderingEngine(this);
  }

  initializeState() {
    this.shapes = new Map();
    this.selectedShape = null;
    this.hoveredShape = null;
    this.debugMode = false;
    this.updateCodeCallback = null;
    this.shapeManager = shapeManager;
    this.zoomControls = null;
  }

  addOverlayDrawer(drawFn) {
    if (typeof drawFn === 'function' && !this._overlayDrawers.includes(drawFn)) {
      this._overlayDrawers.push(drawFn);
      this.redraw();
    }
  }

  removeOverlayDrawer(drawFn) {
    const i = this._overlayDrawers.indexOf(drawFn);
    if (i >= 0) this._overlayDrawers.splice(i, 1);
    this.redraw();
  }

  setShapes(shapes) {
    try {
      if (!shapes) {
        this.shapes = new Map();
      } else {
        this.shapes = shapes;
        shapeManager.registerInterpreter({ env: { shapes } });
      }
      
      this.selectedShape = null;
      this.hoveredShape = null;
      this.selectionSystem.clearSelection();
      this.handleSystem.clearHandleState();
      this.redraw();
    } catch (error) {
      console.error("Error setting shapes:", error);
      this.shapes = new Map();
    }
  }

  redraw() {
    try {
      this.clear();

      if (!this.shapes) return;

      const renderableShapes = this.filterRenderableShapes();
      const sortedShapes = this.sortShapesByRenderOrder(renderableShapes);

      // Render shapes
      for (const { name, shape } of sortedShapes) {
        const isSelected = shape === this.selectedShape || 
                          shape === this.interactionHandler.selectedShape;
        const isHovered = name === this.hoveredShape && !isSelected;

        this.drawShape(shape, isSelected, isHovered, name);
      }

      if (this.debugMode) {
        this.debugVisualizer.drawOverlay(this.shapes, this.coordinateSystem);
      }
    } catch (error) {
      console.error("Error in redraw:", error);
      this.fallbackRedraw();
    }

    if (this._overlayDrawers && this._overlayDrawers.length) {
      const ctx = this.ctx; 
      const cs  = this.coordinateSystem; 
      this._overlayDrawers.forEach(fn => {
        try { fn(ctx, cs); } catch(e) { }
      });
    }
  }

  notifyShapeChanged(shape, action = "update") {
    try {
      if (!this.updateCodeCallback || !shape) return;

      let shapeName = null;
      if (this.shapes) {
        for (const [name, s] of this.shapes.entries()) {
          if (s === shape) {
            shapeName = name;
            break;
          }
        }
      }

      if (shape.transform && shape.transform.position && shape.transform.position.length > 2) {
        shape.transform.position.length = 2;
      }

      if (shapeName) {
        this.updateCodeCallback({
          action: action,
          name: shapeName,
          shape: shape,
        });
      }
    } catch (error) {
      console.error("Error in notifyShapeChanged:", error);
    }
  }

  setupCanvas() {
    this.coordinateSystem.setupCanvas();
    this.createGridToggleButton();
    this.createZoomControls();
    this.redraw();
  }

  setupFallbackCanvas() {
    this.coordinateSystem = {
      transformX: (x) => x + 400,
      transformY: (y) => 300 - y,
      clear: () => this.ctx.clearRect(0, 0, 800, 600),
      isGridEnabled: true,
      toggleGrid: () => { },
    };
    this.styleManager = {
      createStyleContext: () => ({}),
      applyStyle: () => { },
    };
    this.transformManager = {
      calculateBounds: () => ({ x: -25, y: -25, width: 50, height: 50 }),
    };
  }

  setupInteractivity() {
    this.interactionHandler.setupEventListeners();
  }

  enableInteractiveMode() {
    this.canvas.className = "";
    this.redraw();
  }

  createGridToggleButton() {
    try {
      const existingButton = document.getElementById("grid-toggle-btn");
      if (existingButton) {
        existingButton.remove();
      }

      const gridButton = document.createElement("button");
      gridButton.id = "grid-toggle-btn";
      gridButton.className = "grid-toggle-button";
      gridButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="5" cy="5" r="1" fill="currentColor"/>
          <circle cx="12" cy="5" r="1" fill="currentColor"/>
          <circle cx="19" cy="5" r="1" fill="currentColor"/>
          <circle cx="5" cy="12" r="1" fill="currentColor"/>
          <circle cx="12" cy="12" r="1" fill="currentColor"/>
          <circle cx="19" cy="12" r="1" fill="currentColor"/>
          <circle cx="5" cy="19" r="1" fill="currentColor"/>
          <circle cx="12" cy="19" r="1" fill="currentColor"/>
          <circle cx="19" cy="19" r="1" fill="currentColor"/>
        </svg>
      `;

      gridButton.addEventListener("click", () => {
        this.coordinateSystem.toggleGrid();
        this.updateGridButtonState();
        this.redraw();
      });

      this.canvas.parentElement.appendChild(gridButton);
      this.updateGridButtonState();
    } catch (error) {
      console.error("Error creating grid toggle button:", error);
    }
  }

  createZoomControls() {
    try {
      const container = this.canvas.parentElement;
      if (!container) return;

      const existing = container.querySelector('.canvas-zoom-controls');
      if (existing) existing.remove();

      const controls = document.createElement('div');
      controls.className = 'canvas-zoom-controls';

      const zoomInBtn = document.createElement('button');
      zoomInBtn.type = 'button';
      zoomInBtn.className = 'zoom-button';
      zoomInBtn.textContent = '+';

      const zoomLevelEl = document.createElement('div');
      zoomLevelEl.className = 'zoom-level';
      zoomLevelEl.id = 'canvas-zoom-level';

      const zoomOutBtn = document.createElement('button');
      zoomOutBtn.type = 'button';
      zoomOutBtn.className = 'zoom-button';
      zoomOutBtn.textContent = '-';

      zoomInBtn.addEventListener('click', () => {
        const changed = this.coordinateSystem.zoomIn(this.canvas.width / 2, this.canvas.height / 2);
        if (changed) {
          this.updateZoomDisplay();
          this.redraw();
        }
      });

      zoomOutBtn.addEventListener('click', () => {
        const changed = this.coordinateSystem.zoomOut(this.canvas.width / 2, this.canvas.height / 2);
        if (changed) {
          this.updateZoomDisplay();
          this.redraw();
        }
      });

      controls.appendChild(zoomInBtn);
      controls.appendChild(zoomLevelEl);
      controls.appendChild(zoomOutBtn);

      container.appendChild(controls);
      this.zoomControls = {
        container: controls,
        zoomLevelEl,
        zoomInBtn,
        zoomOutBtn
      };

      this.updateZoomDisplay();
    } catch (error) {
      console.error("Error creating zoom controls:", error);
    }
  }

  updateZoomDisplay() {
    if (!this.zoomControls || !this.zoomControls.zoomLevelEl) return;

    const zoomPercent = Math.round(this.coordinateSystem.zoomLevel * 100);
    this.zoomControls.zoomLevelEl.textContent = `${zoomPercent}%`;

    if (this.zoomControls.zoomInBtn) {
      this.zoomControls.zoomInBtn.disabled =
        this.coordinateSystem.zoomLevel >= this.coordinateSystem.maxZoom - 0.0001;
    }

    if (this.zoomControls.zoomOutBtn) {
      this.zoomControls.zoomOutBtn.disabled =
        this.coordinateSystem.zoomLevel <= this.coordinateSystem.minZoom + 0.0001;
    }
  }

  updateGridButtonState() {
    try {
      const gridButton = document.getElementById("grid-toggle-btn");
      if (gridButton) {
        if (this.coordinateSystem.isGridEnabled) {
          gridButton.classList.add("active");
          gridButton.style.backgroundColor = "#FF5722";
          gridButton.style.color = "white";
        } else {
          gridButton.classList.remove("active");
          gridButton.style.backgroundColor = "rgba(255, 255, 255, 0.9)";
          gridButton.style.color = "#6B7280";
        }
      }
    } catch (error) {
      console.error("Error updating grid button state:", error);
    }
  }

  clear() {
    this.coordinateSystem.clear();
  }

  filterRenderableShapes() {
    const renderable = [];

    for (const [name, shape] of this.shapes.entries()) {
      if (!shape) continue;

      if (shape._consumedByBoolean) {
        if (this.debugMode) {
          console.log(`Skipping consumed shape: ${name}`);
        }
        continue;
      }

      renderable.push({ name, shape });
    }

    return renderable;
  }

  sortShapesByRenderOrder(shapes) {
    return shapes.sort((a, b) => {
      const aIsBool = a.shape.params?.operation ? 1 : 0;
      const bIsBool = b.shape.params?.operation ? 1 : 0;

      if (aIsBool !== bIsBool) {
        return aIsBool - bIsBool;
      }

      return 0;
    });
  }

  fallbackRedraw() {
    try {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "#FAFAFA";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } catch (e) {
      console.error("Failed to recover from redraw error:", e);
    }
  }

  drawShape(shape, isSelected = false, isHovered = false, shapeName = "") {
    try {
      if (!shape || !shape.type || !shape.transform) {
        return;
      }

      const scaleFactor = this.coordinateSystem.getScaleFactor();
      const transformContext = this.transformManager.createContext(
        shape.transform,
        this.coordinateSystem.transformX(shape.transform.position[0]),
        this.coordinateSystem.transformY(shape.transform.position[1]),
        scaleFactor,
      );

      this.ctx.save();
      this.ctx.translate(transformContext.screenX, transformContext.screenY);
      this.ctx.rotate(-transformContext.rotation);
      this.ctx.scale(scaleFactor, scaleFactor);

      const styleContext = this.styleManager.createStyleContext(
        shape,
        isSelected,
        isHovered,
      );
      this.styleManager.applyStyle(this.ctx, styleContext);

      this.renderingEngine.renderShape(
        shape,
        styleContext,
        isSelected,
        isHovered,
      );

      if (isSelected) {
        this.drawSelectionUIInContext(shape, shapeName);
      }

      if (isHovered && !isSelected) {
        this.drawHoverUIInContext(shape);
      }

      this.ctx.restore();

      if (
        isSelected &&
        shape.params.operation &&
        this.selectionSystem.showOperationLabels
      ) {
        this.selectionSystem.drawOperationLabel(shape, shape.params.operation);
      }

      if (this.debugMode) {
        this.debugVisualizer.visualizeShape(shape, transformContext, shapeName);
      }
    } catch (error) {
      console.error("Error drawing shape:", error);
    }
  }

  drawSelectionUIInContext(shape, shapeName) {
    const bounds = this.transformManager.calculateBounds(shape);
    const padding = 16;
    const outlineX = bounds.x - padding;
    const outlineY = bounds.y - padding;
    const outlineWidth = bounds.width + padding * 2;
    const outlineHeight = bounds.height + padding * 2;

    this.ctx.save();
    
    this.ctx.strokeStyle = '#FF5722';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.roundRect(outlineX, outlineY, outlineWidth, outlineHeight, 10);
    
    this.ctx.shadowColor = 'rgba(255, 87, 34, 0.2)';
    this.ctx.shadowBlur = 15;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.stroke();

    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = 'rgba(255, 87, 34, 0.1)';
    this.ctx.fill();

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.roundRect(outlineX + 1, outlineY + 1, outlineWidth - 2, outlineHeight - 2, 9);
    this.ctx.stroke();

    this.ctx.restore();

    this.drawOrangeCornerHandles(bounds);
    this.drawOrangeRotationHandle(bounds);
  }

  drawHoverUIInContext(shape) {
    const bounds = this.transformManager.calculateBounds(shape);
    const hoverPadding = 12;
    const hoverX = bounds.x - hoverPadding;
    const hoverY = bounds.y - hoverPadding;
    const hoverWidth = bounds.width + hoverPadding * 2;
    const hoverHeight = bounds.height + hoverPadding * 2;

    this.ctx.save();
    
    this.ctx.shadowColor = 'rgba(255, 87, 34, 0.4)';
    this.ctx.shadowBlur = 15;
    
    this.ctx.strokeStyle = '#FF5722';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 3]);
    this.ctx.beginPath();
    this.ctx.roundRect(hoverX, hoverY, hoverWidth, hoverHeight, 8);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = 'rgba(255, 87, 34, 0.12)';
    this.ctx.fill();

    this.ctx.restore();
  }

  drawOrangeCornerHandles(bounds) {
    const handlePositions = [
      { x: bounds.x, y: bounds.y, handle: "tl" },
      { x: bounds.x + bounds.width, y: bounds.y, handle: "tr" },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height, handle: "br" },
      { x: bounds.x, y: bounds.y + bounds.height, handle: "bl" }
    ];

    handlePositions.forEach((pos) => {
      const isHovered = this.interactionHandler.hoveredHandle === pos.handle;
      const isActive = this.interactionHandler.activeHandle === pos.handle;
      
      this.ctx.save();
      this.ctx.translate(pos.x, pos.y);

      const handleSize = 14;
      const scaledSize = isHovered ? handleSize * 1.3 : isActive ? handleSize * 1.1 : handleSize;

      this.ctx.shadowColor = 'rgba(255, 87, 34, 0.4)';
      this.ctx.shadowBlur = isHovered ? 12 : 6;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = isHovered ? 4 : 2;

      this.ctx.beginPath();
      this.ctx.roundRect(-scaledSize/2, -scaledSize/2, scaledSize, scaledSize, 3);
      
      const gradient = this.ctx.createLinearGradient(
        -scaledSize/2, -scaledSize/2, 
        scaledSize/2, scaledSize/2
      );
      
      if (isHovered) {
        gradient.addColorStop(0, '#FF7043');
        gradient.addColorStop(1, '#E64A19');
      } else {
        gradient.addColorStop(0, '#FF5722');
        gradient.addColorStop(1, '#E64A19');
      }
      
      this.ctx.fillStyle = gradient;
      this.ctx.fill();

      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = 'white';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.roundRect(-scaledSize/2 + 1.5, -scaledSize/2 + 1.5, scaledSize - 3, scaledSize - 3, 2);
      this.ctx.stroke();

      this.ctx.restore();
    });
  }

  drawOrangeRotationHandle(bounds) {
    const rotationDistance = 45;
    const topY = bounds.y;
    const centerX = bounds.x + bounds.width / 2;
    const rotationY = topY - rotationDistance;
    const isHovered = this.interactionHandler.hoveredHandle === "rotate";
    const isActive = this.interactionHandler.activeHandle === "rotate";

    this.ctx.save();

    const lineWidth = 3;
    const lineGradient = this.ctx.createLinearGradient(
      centerX, topY, 
      centerX, rotationY + 12
    );
    lineGradient.addColorStop(0, 'rgba(255, 87, 34, 0.9)');
    lineGradient.addColorStop(0.6, 'rgba(255, 87, 34, 0.6)');
    lineGradient.addColorStop(1, 'rgba(255, 87, 34, 0.3)');
    
    this.ctx.shadowColor = 'rgba(255, 87, 34, 0.5)';
    this.ctx.shadowBlur = 4;
    this.ctx.strokeStyle = lineGradient;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, topY);
    this.ctx.lineTo(centerX, rotationY + 12);
    this.ctx.stroke();

    this.ctx.shadowBlur = 0;

    if (isHovered || isActive) {
      this.ctx.save();
      this.ctx.translate(centerX, rotationY);
      
      this.ctx.strokeStyle = 'rgba(255, 87, 34, 0.6)';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([4, 4]);
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 22, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      
      this.ctx.restore();
    }

    this.ctx.save();
    this.ctx.translate(centerX, rotationY);
    
    const handleSize = 18;
    const scaledHandleSize = isActive ? handleSize * 1.05 : isHovered ? handleSize * 1.15 : handleSize;

    this.ctx.shadowColor = 'rgba(255, 87, 34, 0.5)';
    this.ctx.shadowBlur = isHovered ? 15 : 8;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 3;

    this.ctx.beginPath();
    this.ctx.arc(0, 0, scaledHandleSize/2, 0, Math.PI * 2);
    
    const handleGradient = this.ctx.createRadialGradient(
      -scaledHandleSize/5, -scaledHandleSize/5, 0, 
      0, 0, scaledHandleSize/2
    );
    
    if (isHovered) {
      handleGradient.addColorStop(0, '#FF9800');
      handleGradient.addColorStop(0.4, '#FF5722');
      handleGradient.addColorStop(1, '#D84315');
    } else {
      handleGradient.addColorStop(0, '#FF7043');
      handleGradient.addColorStop(0.4, '#FF5722');
      handleGradient.addColorStop(1, '#E64A19');
    }
    
    this.ctx.fillStyle = handleGradient;
    this.ctx.fill();

    this.ctx.shadowBlur = 0;
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 2.5;
    this.ctx.stroke();

    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';
    
    this.ctx.beginPath();
    this.ctx.arc(0, 0, scaledHandleSize/3.2, -Math.PI/3, Math.PI * 1.3);
    this.ctx.stroke();
    
    const arrowX = (scaledHandleSize/3.2) * Math.cos(Math.PI * 1.3);
    const arrowY = (scaledHandleSize/3.2) * Math.sin(Math.PI * 1.3);
    
    this.ctx.beginPath();
    this.ctx.moveTo(arrowX, arrowY);
    this.ctx.lineTo(arrowX - 3, arrowY - 2);
    this.ctx.moveTo(arrowX, arrowY);
    this.ctx.lineTo(arrowX - 2, arrowY + 3);
    this.ctx.stroke();

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(-scaledHandleSize/5, -scaledHandleSize/5, scaledHandleSize/4, 0, Math.PI * 0.7);
    this.ctx.stroke();

    this.ctx.restore();
    this.ctx.restore();
  }

  setUpdateCodeCallback(callback) {
    this.updateCodeCallback = callback;
  }

  findShapeName(shapeObject) {
    for (const [name, shape] of this.shapes.entries()) {
      if (shape === shapeObject) {
        return name;
      }
    }
    return null;
  }

  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.debugVisualizer.setEnabled(enabled);
    this.booleanRenderer.setDebugMode(enabled);
    this.redraw();
  }

  getSelectedShape() {
    return this.interactionHandler.selectedShape || this.selectedShape;
  }

  setSelectedShape(shape) {
    this.interactionHandler.selectedShape = shape;
    this.selectedShape = shape;
    this.selectionSystem.setSelectedShape(shape);
    this.redraw();
  }

  getHoveredShape() {
    return this.interactionHandler.hoveredShape;
  }

  setHoveredShape(shapeName) {
    this.interactionHandler.hoveredShape = shapeName;
    this.hoveredShape = shapeName;
    this.selectionSystem.setHoveredShape(shapeName);
    this.redraw();
  }

  selectShapeAtPoint(x, y) {
    return this.interactionHandler.selectShapeAtPoint(x, y);
  }

  isPointInShape(x, y, shape) {
    return this.interactionHandler.isPointInShape(x, y, shape);
  }

  getHandleAtPoint(x, y) {
    return this.handleSystem.getHandleAtPoint(
      x,
      y,
      this.selectedShape || this.interactionHandler.selectedShape,
    );
  }

  toggleFillForSelectedShape() {
    try {
      const selected = this.selectedShape || this.interactionHandler.selectedShape;
      if (!selected) return;

      const shapeName = this.findShapeName(selected);
      if (!shapeName) return;

      const shape = selected;
      const currentFill = shape.params.fill || false;

      this.shapeManager.onCanvasShapeChange(shapeName, "fill", !currentFill);

      if (!currentFill && !shape.params.fillColor) {
        this.shapeManager.onCanvasShapeChange(
          shapeName,
          "fillColor",
          "#808080",
        );
      }

      this.notifyShapeChanged(selected);
    } catch (error) {
      console.error("Error toggling fill:", error);
    }
  }

  setFillColorForSelectedShape(color) {
    try {
      const selected = this.selectedShape || this.interactionHandler.selectedShape;
      if (!selected) return;

      const shapeName = this.findShapeName(selected);
      if (!shapeName) return;

      this.shapeManager.onCanvasShapeChange(shapeName, "fill", true);
      this.shapeManager.onCanvasShapeChange(shapeName, "fillColor", color);

      this.notifyShapeChanged(selected);
    } catch (error) {
      console.error("Error setting fill color:", error);
    }
  }

  resetView() {
    this.coordinateSystem.setPanOffset(0, 0);
    this.coordinateSystem.resetZoom();
    this.updateZoomDisplay();
    this.redraw();
  }

  fitToView() {
    if (!this.shapes || this.shapes.size === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const [name, shape] of this.shapes.entries()) {
      if (shape._consumedByBoolean) continue;

      const bounds = this.transformManager.calculateBounds(shape);
      const x = shape.transform.position[0];
      const y = shape.transform.position[1];

      minX = Math.min(minX, x + bounds.x);
      maxX = Math.max(maxX, x + bounds.x + bounds.width);
      minY = Math.min(minY, y + bounds.y);
      maxY = Math.max(maxY, y + bounds.y + bounds.height);
    }

    if (minX === Infinity) return;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scaleFactor = this.coordinateSystem.getScaleFactor();
    this.coordinateSystem.setPanOffset(-centerX * scaleFactor, centerY * scaleFactor);
    this.updateZoomDisplay();
    this.redraw();
  }

  exportCanvasAsImage(format = "png") {
    try {
      const dataURL = this.canvas.toDataURL(`image/${format}`);

      const link = document.createElement("a");
      link.download = `aqui_canvas.${format}`;
      link.href = dataURL;
      link.click();

      return dataURL;
    } catch (error) {
      console.error("Error exporting canvas:", error);
      return null;
    }
  }

  getCanvasInfo() {
    const bounds = this.coordinateSystem.getCanvasBounds();
    const viewport = this.coordinateSystem.getViewportBounds();

    return {
      canvas: bounds,
      viewport: viewport,
      scale: this.coordinateSystem.scale,
      zoom: this.coordinateSystem.zoomLevel,
      pan: this.coordinateSystem.panOffset,
      shapeCount: this.shapes.size,
      selectedShape: this.selectedShape ? this.findShapeName(this.selectedShape) : null,
      debugMode: this.debugMode,
      pixelsToMm: this.coordinateSystem.pixelsToMm
    };
  }

  destroy() {
    try {
      const gridButton = document.getElementById("grid-toggle-btn");
      if (gridButton) {
        gridButton.remove();
      }

      if (this.zoomControls?.container) {
        this.zoomControls.container.remove();
      }
      this.zoomControls = null;

      this.shapes.clear();
      this.selectedShape = null;
      this.hoveredShape = null;
      this.updateCodeCallback = null;

      if (this.debugVisualizer) {
        this.debugVisualizer.reset();
      }

      if (this.selectionSystem) {
        this.selectionSystem.clearSelection();
      }

      if (this.handleSystem) {
        this.handleSystem.clearHandleState();
      }
    } catch (error) {
      console.error("Error destroying renderer:", error);
    }
  }
}

// Simple interaction handler - without edge functionality
class SimpleInteractionHandler {
  constructor(renderer) {
    this.renderer = renderer;
    this.canvas = renderer.canvas;
    this.coordinateSystem = renderer.coordinateSystem;
    
    this.selectedShape = null;
    this.hoveredShape = null;
    this.dragging = false;
    this.scaling = false;
    this.rotating = false;
    this.panning = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.activeHandle = null;
    this.hoveredHandle = null;
    
    this.handleRadius = 6;
    this.handleHoverRadius = 7;
    this.rotationHandleDistance = 35;
  }
  
  setupEventListeners() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  handleMouseDown(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    this.lastMousePos = { x, y };
    
    if (event.shiftKey) {
      this.panning = true;
      this.canvas.className = 'cursor-grabbing';
      return;
    }
    
    if (this.selectedShape) {
      const handleInfo = this.getHandleAtPoint(x, y);
      if (handleInfo) {
        if (handleInfo.type === 'scale') {
          this.scaling = true;
          this.activeHandle = handleInfo.handle;
          this.canvas.className = 'cursor-resize-' + this.getResizeCursorClass(handleInfo.handle);
        } else if (handleInfo.type === 'rotate') {
          this.rotating = true;
          this.canvas.className = 'cursor-grabbing';
        }
        return;
      }
    }
    
    this.selectShapeAtPoint(x, y);
    this.renderer.redraw();
  }
  
  handleMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const dx = x - this.lastMousePos.x;
    const dy = y - this.lastMousePos.y;
    
    if (this.panning) {
      this.coordinateSystem.pan(dx, dy);
      this.renderer.redraw();
    } else if (this.scaling && this.selectedShape) {
      this.handleParameterScaling(dx, dy);
    } else if (this.rotating && this.selectedShape) {
      this.handleRotation(x, y);
    } else if (this.dragging && this.selectedShape) {
      this.handleDragging(dx, dy);
    } else {
      this.updateCursor(x, y);
      this.updateHoverState(x, y);
    }
    
    this.lastMousePos = { x, y };
  }
  
  handleMouseUp(event) {
    // If a boolean was being dragged/rotated, regenerate it from moved operands
    if (this._booleanDragInProgress) {
      this._booleanDragInProgress = false;
      // Delay slightly to let code updates settle, then regenerate
      setTimeout(() => {
        if (typeof window.runCode === 'function') {
          window.runCode();
        }
      }, 50);
    }

    this.dragging = false;
    this.scaling = false;
    this.rotating = false;
    this.panning = false;
    this.activeHandle = null;
    
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.updateCursor(x, y);
  }
  
  handleWheel(event) {
    event.preventDefault();
    
    if (event.ctrlKey) {
      const panSensitivity = 2;
      
      if (event.deltaY !== 0) {
        this.coordinateSystem.pan(0, -event.deltaY * panSensitivity);
      }
      
      if (event.deltaX !== 0) {
        this.coordinateSystem.pan(-event.deltaX * panSensitivity, 0);
      }
      
      if (event.deltaX === 0 && event.shiftKey) {
        this.coordinateSystem.pan(-event.deltaY * panSensitivity, 0);
      }
      
      this.renderer.redraw();
    }
  }
  
  handleKeyDown(event) {
    if (event.key === ';' && !event.ctrlKey && !event.metaKey) {
      if (document.activeElement !== this.renderer.editor?.getWrapperElement()?.querySelector('textarea')) {
        event.preventDefault();
        this.coordinateSystem.toggleGrid();
        this.renderer.updateGridButtonState();
        this.renderer.redraw();
      }
    }
    
    if (event.key.toLowerCase() === 'd' && event.ctrlKey) {
      event.preventDefault();
      this.renderer.setDebugMode(!this.renderer.debugMode);
      return;
    }

    if (!this.selectedShape) return;

    const shapeName = this.renderer.findShapeName(this.selectedShape);
    if (!shapeName) return;
    
    const shape = this.selectedShape;
    
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.deleteSelectedShape();
        break;
      
      case 'r':
      case 'R':
        event.preventDefault();
        const newRotation = (shape.transform.rotation + 15) % 360;
        this.renderer.shapeManager.onCanvasRotationChange(shapeName, newRotation);
        this.renderer.notifyShapeChanged(shape);
        break;
        
      case 'ArrowUp':
        event.preventDefault();
        const upAmount = event.shiftKey ? 20 : 5;
        const newPosUp = [shape.transform.position[0], shape.transform.position[1] + upAmount];
        this.renderer.shapeManager.onCanvasPositionChange(shapeName, newPosUp);
        this.renderer.notifyShapeChanged(shape);
        break;
        
      case 'ArrowDown':
        event.preventDefault();
        const downAmount = event.shiftKey ? 20 : 5;
        const newPosDown = [shape.transform.position[0], shape.transform.position[1] - downAmount];
        this.renderer.shapeManager.onCanvasPositionChange(shapeName, newPosDown);
        this.renderer.notifyShapeChanged(shape);
        break;
        
      case 'ArrowLeft':
        event.preventDefault();
        const leftAmount = event.shiftKey ? 20 : 5;
        const newPosLeft = [shape.transform.position[0] - leftAmount, shape.transform.position[1]];
        this.renderer.shapeManager.onCanvasPositionChange(shapeName, newPosLeft);
        this.renderer.notifyShapeChanged(shape);
        break;
        
      case 'ArrowRight':
        event.preventDefault();
        const rightAmount = event.shiftKey ? 20 : 5;
        const newPosRight = [shape.transform.position[0] + rightAmount, shape.transform.position[1]];
        this.renderer.shapeManager.onCanvasPositionChange(shapeName, newPosRight);
        this.renderer.notifyShapeChanged(shape);
        break;
    }
  }
  
  handleMouseLeave() {
    this.hoveredShape = null;
    this.hoveredHandle = null;
    this.renderer.redraw();
  }
  
  selectShapeAtPoint(x, y) {
    let selectedShapeName = null;
    
    if (!this.renderer.shapes) {
      this.renderer.shapes = new Map();
      return;
    }
    
    for (const [name, shape] of [...this.renderer.shapes.entries()].reverse()) {
      if (shape._consumedByBoolean) continue;
      
      if (this.isPointInShape(x, y, shape)) {
        selectedShapeName = name;
        break;
      }
    }
    
    if (selectedShapeName) {
      this.selectedShape = this.renderer.shapes.get(selectedShapeName);
      this.dragging = true;
      this.canvas.className = 'cursor-move';
    } else {
      this.selectedShape = null;
      this.canvas.className = '';
    }
  }
  
  isPointInShape(x, y, shape) {
    if (!shape || !shape.transform) return false;
    
    const shapeX = this.coordinateSystem.transformX(shape.transform.position[0]);
    const shapeY = this.coordinateSystem.transformY(shape.transform.position[1]);
    
    const dx = x - shapeX;
    const dy = y - shapeY;
    
    const angle = shape.transform.rotation * Math.PI / 180;
    const rotatedX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const rotatedY = dy * Math.cos(angle) - dx * Math.sin(angle);
    
    const bounds = this.renderer.transformManager.calculateBounds(shape);
    const scaledWidth = bounds.width;
    const scaledHeight = bounds.height;
    
    return (
      Math.abs(rotatedX) <= scaledWidth / 2 &&
      Math.abs(rotatedY) <= scaledHeight / 2
    );
  }
  
  getHandleAtPoint(x, y) {
    if (!this.selectedShape) return null;
    
    const shape = this.selectedShape;
    const shapeX = this.coordinateSystem.transformX(shape.transform.position[0]);
    const shapeY = this.coordinateSystem.transformY(shape.transform.position[1]);
    
    const bounds = this.renderer.transformManager.calculateBounds(shape);
    const scaledWidth = bounds.width;
    const scaledHeight = bounds.height;
    const halfWidth = scaledWidth / 2;
    const halfHeight = scaledHeight / 2;
    
    const angle = -shape.transform.rotation * Math.PI / 180;
    const rotate = (px, py) => {
      const s = Math.sin(angle);
      const c = Math.cos(angle);
      const dx = px - shapeX;
      const dy = py - shapeY;
      return {
        x: shapeX + (dx * c - dy * s),
        y: shapeY + (dx * s + dy * c)
      };
    };
    
    const handlePositions = [
      { handle: 'tl', pos: rotate(shapeX - halfWidth, shapeY - halfHeight) },
      { handle: 'tr', pos: rotate(shapeX + halfWidth, shapeY - halfHeight) },
      { handle: 'br', pos: rotate(shapeX + halfWidth, shapeY + halfHeight) },
      { handle: 'bl', pos: rotate(shapeX - halfWidth, shapeY + halfHeight) }
    ];
    
    for (const handleInfo of handlePositions) {
      const dx = x - handleInfo.pos.x;
      const dy = y - handleInfo.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= this.handleRadius + 3) {
        return { type: 'scale', handle: handleInfo.handle };
      }
    }
    
    const rotHandlePos = rotate(shapeX, shapeY - halfHeight - this.rotationHandleDistance);
    const rotDx = x - rotHandlePos.x;
    const rotDy = y - rotHandlePos.y;
    const rotDist = Math.sqrt(rotDx * rotDx + rotDy * rotDy);
    
    if (rotDist <= this.handleRadius + 3) {
      return { type: 'rotate' };
    }
    
    return null;
  }
  
  updateCursor(x, y) {
    if (this.selectedShape) {
      const handleInfo = this.getHandleAtPoint(x, y);
      
      if (handleInfo) {
        if (handleInfo.type === 'scale') {
          this.canvas.className = 'cursor-resize-' + this.getResizeCursorClass(handleInfo.handle);
        } else if (handleInfo.type === 'rotate') {
          this.canvas.className = 'cursor-rotate';
        }
        return;
      }
    }
    
    let isOverShape = false;
    
    if (this.renderer.shapes) {
      for (const [name, shape] of [...this.renderer.shapes.entries()].reverse()) {
        if (shape._consumedByBoolean) continue;
        
        if (this.isPointInShape(x, y, shape)) {
          this.canvas.className = 'cursor-move';
          isOverShape = true;
          break;
        }
      }
    }
    
    if (!isOverShape) {
      this.canvas.className = '';
    }
  }
  
  updateHoverState(x, y) {
    let newHoveredShape = null;
    let newHoveredHandle = null;
    
    if (this.selectedShape) {
      const handleInfo = this.getHandleAtPoint(x, y);
      if (handleInfo) {
        newHoveredHandle = handleInfo.handle || 'rotate';
      }
    }
    
    if (!newHoveredHandle && this.renderer.shapes) {
      for (const [name, shape] of [...this.renderer.shapes.entries()].reverse()) {
        if (shape._consumedByBoolean) continue;
        
        if (this.isPointInShape(x, y, shape)) {
          newHoveredShape = name;
          break;
        }
      }
    }
    
    if (newHoveredShape !== this.hoveredShape || newHoveredHandle !== this.hoveredHandle) {
      this.hoveredShape = newHoveredShape;
      this.hoveredHandle = newHoveredHandle;
      this.renderer.redraw();
    }
  }
  
  getResizeCursorClass(handle) {
    switch (handle) {
      case 'tl':
      case 'br':
        return 'nwse';
      case 'tr':
      case 'bl':
        return 'nesw';
      default:
        return '';
    }
  }
  
  handleParameterScaling(dx, dy) {
    if (!this.selectedShape) return;
    
    const shapeName = this.renderer.findShapeName(this.selectedShape);
    if (!shapeName) return;
    
    this.renderer.transformManager.handleParameterScaling(
      this.selectedShape, 
      this.activeHandle, 
      dx, 
      dy, 
      1,
      shapeName,
      this.renderer.shapeManager
    );
    
    this.renderer.notifyShapeChanged(this.selectedShape);
  }
  
  handleRotation(x, y) {
    if (!this.selectedShape) return;
    
    const shapeName = this.renderer.findShapeName(this.selectedShape);
    if (!shapeName) return;
    
    const shape = this.selectedShape;
    const centerX = this.coordinateSystem.transformX(shape.transform.position[0]);
    const centerY = this.coordinateSystem.transformY(shape.transform.position[1]);
    
    const angle = -Math.atan2(y - centerY, x - centerX) * 180 / Math.PI;
    
    let newRotation = angle;
    if (event.altKey) {
      newRotation = Math.round(angle / 15) * 15;
    }

    // Check if this is a boolean result with operands - rotate them as a group
    const operandNames = shape.params?.operands;
    const isBoolean = !!shape.params?.operation && Array.isArray(operandNames);

    if (isBoolean && operandNames.length > 0) {
      const oldRotation = shape.transform.rotation || 0;
      const deltaRotation = newRotation - oldRotation;
      const deltaRadians = deltaRotation * Math.PI / 180;

      // Rotate around the boolean's current transform.position (matches the UI rotation handle)
      const boolCenterX = shape.transform.position[0];
      const boolCenterY = shape.transform.position[1];

      // 1) Update operand transforms in-memory
      // 2) Write operand code immediately via updateCodeCallback (no debounced timer)
      const cos = Math.cos(deltaRadians);
      const sin = Math.sin(deltaRadians);

      for (const opName of operandNames) {
        const opShape = this.renderer.shapes.get(opName);
        if (!opShape?.transform?.position) continue;

        const opX = opShape.transform.position[0];
        const opY = opShape.transform.position[1];
        const relX = opX - boolCenterX;
        const relY = opY - boolCenterY;

        const newRelX = relX * cos - relY * sin;
        const newRelY = relX * sin + relY * cos;

        opShape.transform.position = [boolCenterX + newRelX, boolCenterY + newRelY];
        opShape.transform.rotation = (opShape.transform.rotation || 0) + deltaRotation;

        if (typeof this.renderer.updateCodeCallback === 'function') {
          this.renderer.updateCodeCallback({ action: 'update', name: opName, shape: opShape });
        }
      }

      // Rotate path points directly for visual feedback so selection bounds stay aligned
      shape.transform.rotation = newRotation;
      this._booleanDragInProgress = true;
      this.renderer.redraw();
      return;
    }
    
    this.renderer.shapeManager.onCanvasRotationChange(shapeName, newRotation);
    this.renderer.notifyShapeChanged(this.selectedShape);
  }
  
  handleDragging(dx, dy) {
    if (!this.selectedShape) return;
    
    const shapeName = this.renderer.findShapeName(this.selectedShape);
    if (!shapeName) return;
    
    const shape = this.selectedShape;
    
    const worldDX = dx;
    const worldDY = -dy;
    
    const oldX = shape.transform.position[0];
    const oldY = shape.transform.position[1];
    
    let newX = oldX + worldDX;
    let newY = oldY + worldDY;

    if (this.coordinateSystem.isGridEnabled && event.ctrlKey) {
      const snapped = this.coordinateSystem.snapToGrid(newX, newY);
      newX = snapped.x;
      newY = snapped.y;
    }

    // Calculate final delta (accounts for grid snapping)
    const finalDX = newX - oldX;
    const finalDY = newY - oldY;

    // Check if this is a boolean result with operands - move them as a group
    const operandNames = shape.params?.operands;
    const isBoolean = !!shape.params?.operation && Array.isArray(operandNames);

    if (isBoolean && operandNames.length > 0) {
      // Move all operands by the same delta (in-memory) and write operand code immediately.
      for (const opName of operandNames) {
        const opShape = this.renderer.shapes.get(opName);
        if (!opShape?.transform?.position) continue;

        opShape.transform.position = [
          opShape.transform.position[0] + finalDX,
          opShape.transform.position[1] + finalDY
        ];

        if (typeof this.renderer.updateCodeCallback === 'function') {
          this.renderer.updateCodeCallback({ action: 'update', name: opName, shape: opShape });
        }
      }
      
      // Adjust boolean path points directly for live feedback so bounds stay accurate
      shape.transform.position = [newX, newY];
      this._booleanDragInProgress = true;
      this.renderer.redraw();
      return;
    }

    this.renderer.shapeManager.onCanvasPositionChange(shapeName, [newX, newY]);
    this.renderer.notifyShapeChanged(this.selectedShape);
  }
  
  deleteSelectedShape() {
    if (!this.selectedShape) return;
    
    let selectedName = null;
    
    if (this.renderer.shapes) {
      for (const [name, shape] of this.renderer.shapes.entries()) {
        if (shape === this.selectedShape) {
          selectedName = name;
          break;
        }
      }
    }

    if (this.renderer.constraintEngine && selectedName) {
      this.renderer.constraintEngine.pruneConstraintsForShapes([selectedName]);
    }
    
    if (selectedName) {
      this.renderer.shapes.delete(selectedName);
      this.selectedShape = null;
      
      if (this.renderer.updateCodeCallback) {
        this.renderer.updateCodeCallback({ action: 'delete', name: selectedName });
      }
      
      this.renderer.redraw();
    }
  }
}

// ModularRenderingEngine unchanged
class ModularRenderingEngine {
  constructor(renderer) {
    this.renderer = renderer;
    this.ctx = renderer.ctx;
    this.shapeRenderer = renderer.shapeRenderer;
    this.pathRenderer = renderer.pathRenderer;
    this.booleanRenderer = renderer.booleanRenderer;
  }

  createShapeInstance(type, params) {
    return this.shapeRenderer.createShapeInstance(type, params);
  }

  renderShape(shape, styleContext, isSelected, isHovered) {
    try {
      const { type, params } = shape;

      if (params.operation) {
        return this.booleanRenderer.renderBooleanResult(
          shape,
          styleContext,
          isSelected,
          isHovered,
        );
      }

      switch (type) {
        case "path":
          return this.pathRenderer.renderPath(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "slotBoard":
          return this.shapeRenderer.renderSlotBoard(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "bspline":
          return this.shapeRenderer.renderBspline(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "tabBoard":
          return this.shapeRenderer.renderTabBoard(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "text":
          return this.shapeRenderer.renderText(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "gear":
          return this.shapeRenderer.renderGear(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "bezier":
          return this.shapeRenderer.renderBezier(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "dovetailPin":
          return this.shapeRenderer.renderDovetailPin(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "dovetailTail":
          return this.shapeRenderer.renderDovetailTail(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "fingerJointPin":
          return this.shapeRenderer.renderFingerJointPin(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "fingerJointSocket":
          return this.shapeRenderer.renderFingerJointSocket(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "halfLapMale":
          return this.shapeRenderer.renderHalfLapMale(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "halfLapFemale":
          return this.shapeRenderer.renderHalfLapFemale(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "crossLapVertical":
          return this.shapeRenderer.renderCrossLapVertical(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "flexureMesh":
          return this.shapeRenderer.renderFlexureMesh(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "crossLapHorizontal":
          return this.shapeRenderer.renderCrossLapHorizontal(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "rabbetJoint":
          return this.shapeRenderer.renderRabbetJoint(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "rabbetPlain":
          return this.shapeRenderer.renderRabbetPlain(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "fingerCombMale":
          return this.shapeRenderer.renderFingerCombMale(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        case "fingerCombFemale":
          return this.shapeRenderer.renderFingerCombFemale(
            params,
            styleContext,
            isSelected,
            isHovered,
          );
        default:
          return this.shapeRenderer.renderGenericShape(
            type,
            params,
            styleContext,
            isSelected,
            isHovered,
          );
      }
    } catch (error) {
      console.error("Error in renderShape:", error);
      return false;
    }
  }
}
