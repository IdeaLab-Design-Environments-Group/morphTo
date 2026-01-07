// interactionHandler.mjs - TRUE 1:1 interaction handler

export class InteractionHandler {
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
    
    this.setupEventListeners();
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
    
    // Only handle panning with Ctrl+wheel (NO ZOOM)
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
    // Regular wheel scrolling is ignored (no zoom)
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
    
    return (
      rotatedX >= bounds.x &&
      rotatedX <= bounds.x + bounds.width &&
      rotatedY >= bounds.y &&
      rotatedY <= bounds.y + bounds.height
    );
  }
  
  getHandleAtPoint(x, y) {
    if (!this.selectedShape) return null;
    
    const shape = this.selectedShape;
    const shapeX = this.coordinateSystem.transformX(shape.transform.position[0]);
    const shapeY = this.coordinateSystem.transformY(shape.transform.position[1]);
    
    const bounds = this.renderer.transformManager.calculateBounds(shape);
    const angle = -shape.transform.rotation * Math.PI / 180;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    const localToScreen = (localX, localY) => ({
      x: shapeX + (localX * cosA - localY * sinA),
      y: shapeY + (localX * sinA + localY * cosA)
    });

    const handlePositions = [
      { handle: 'tl', pos: localToScreen(bounds.x, bounds.y) },
      { handle: 'tr', pos: localToScreen(bounds.x + bounds.width, bounds.y) },
      { handle: 'br', pos: localToScreen(bounds.x + bounds.width, bounds.y + bounds.height) },
      { handle: 'bl', pos: localToScreen(bounds.x, bounds.y + bounds.height) }
    ];
    
    for (const handleInfo of handlePositions) {
      const dx = x - handleInfo.pos.x;
      const dy = y - handleInfo.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= this.handleRadius + 3) {
        return { type: 'scale', handle: handleInfo.handle };
      }
    }
    
    const centerX = bounds.x + bounds.width / 2;
    const rotHandlePos = localToScreen(centerX, bounds.y - this.rotationHandleDistance);
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
    
    const operandNames = this.selectedShape.params?.operands;
    const isBoolean = !!this.selectedShape.params?.operation && Array.isArray(operandNames) && operandNames.length > 0;
    
    if (isBoolean) {
      this.handleBooleanScaling(dx, dy, operandNames);
      return;
    }
    
    this.renderer.transformManager.handleParameterScaling(
      this.selectedShape, 
      this.activeHandle, 
      dx, 
      dy, 
      1, // TRUE 1:1 scale
      shapeName,
      this.renderer.shapeManager
    );
    
    this.renderer.notifyShapeChanged(this.selectedShape);
  }

  handleBooleanScaling(dx, dy, operandNames) {
    if (!operandNames || operandNames.length === 0) return;

    const shape = this.selectedShape;
    const bounds = this.renderer.transformManager.calculateBounds(shape);
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);

    if (width === 0 || height === 0) return;

    const worldDX = dx;
    const worldDY = -dy;
    const rotation = (shape.transform?.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    const localDX = worldDX * cos + worldDY * sin;
    const localDY = -worldDX * sin + worldDY * cos;

    const handle = this.activeHandle || 'br';
    const horizontalSign = (handle === 'tr' || handle === 'br') ? 1 : -1;
    const verticalSign = (handle === 'tl' || handle === 'tr') ? 1 : -1;

    const deltaWidth = localDX * horizontalSign * 2;
    const deltaHeight = localDY * verticalSign * 2;

    const newWidth = Math.max(5, width + deltaWidth);
    const newHeight = Math.max(5, height + deltaHeight);

    const scaleX = newWidth / width;
    const scaleY = newHeight / height;

    if (!isFinite(scaleX) || !isFinite(scaleY)) return;

    this.scaleBooleanOperands(scaleX, scaleY, operandNames);
  }

  scaleBooleanOperands(scaleX, scaleY, operandNames) {
    const shape = this.selectedShape;
    const centerX = shape.transform?.position?.[0] || 0;
    const centerY = shape.transform?.position?.[1] || 0;
    const rotation = (shape.transform?.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const minScale = 0.05;
    const safeScaleX = Math.max(minScale, scaleX);
    const safeScaleY = Math.max(minScale, scaleY);

    for (const opName of operandNames) {
      const opShape = this.renderer.shapes.get(opName);
      if (!opShape) continue;

      if (opShape.transform?.position) {
        const relX = opShape.transform.position[0] - centerX;
        const relY = opShape.transform.position[1] - centerY;

        const localX = relX * cos + relY * sin;
        const localY = -relX * sin + relY * cos;

        const scaledLocalX = localX * safeScaleX;
        const scaledLocalY = localY * safeScaleY;

        const newRelX = scaledLocalX * cos - scaledLocalY * sin;
        const newRelY = scaledLocalX * sin + scaledLocalY * cos;

        opShape.transform.position = [centerX + newRelX, centerY + newRelY];
      }

      this.renderer.transformManager.scaleShapeParameters(opShape, safeScaleX, safeScaleY);

      if (typeof this.renderer.updateCodeCallback === 'function') {
        this.renderer.updateCodeCallback({ action: 'update', name: opName, shape: opShape });
      }
    }

    if (Array.isArray(shape.params?.points)) {
      shape.params.points = shape.params.points.map(point => {
        if (point === null) return null;

        if (Array.isArray(point)) {
          return [point[0] * safeScaleX, point[1] * safeScaleY];
        }

        if (typeof point === 'object' && point !== null) {
          return {
            x: (point.x || 0) * safeScaleX,
            y: (point.y || 0) * safeScaleY
          };
        }

        return point;
      });
    }

    this._booleanDragInProgress = true;
    this.renderer.redraw();
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

      const boolCenterX = shape.transform.position[0];
      const boolCenterY = shape.transform.position[1];

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

      this._booleanDragInProgress = true;
      shape.transform.rotation = newRotation;
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
    
    // TRUE 1:1 scale - direct pixel to mm conversion
    const worldDX = dx;  // No scaling needed - 1 pixel = 1 mm
    const worldDY = -dy; // Just flip Y axis
    
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
      // Move all operands by the same delta
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
      
      // Mark that we need to regenerate the boolean on mouseup
      this._booleanDragInProgress = true;
      shape.transform.position = [newX, newY];
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
