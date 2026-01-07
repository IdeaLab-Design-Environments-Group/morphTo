// coordinateSystem.mjs - Optimized TRUE 1:1 scale coordinate system

export class CoordinateSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // TRUE 1:1 base scale - zoom multiplies this
    this.scale = 1;
    this.zoomLevel = 1;
    this.minZoom = 0.2;
    this.maxZoom = 6;
    this.zoomStep = 0.15;
    this.panOffset = { x: 0, y: 0 };
    this.offsetX = 0;
    this.offsetY = 0;
    
    // Grid and visual properties
    this.isGridEnabled = true;
    this.gridSize = 10; // 10mm grid
    this.gridOpacity = 0.12;
    this.backgroundColor = '#FAFAFA';
    this.gridColor = '#D1D5DB';
    
    // Ruler properties - TRUE 1:1 scale
    this.rulerHeight = 30;
    this.rulerWidth = 30;
    this.rulerColor = '#666666';
    this.rulerBackgroundColor = '#f8f8f8';
    this.rulerTextColor = '#333333';
    
    // Cartesian plane properties
    this.showAxes = true;
    this.axisColor = '#2196F3';
    this.axisWidth = 2;
    
    this.setupCanvas();
  }
  
  setupCanvas() {
    try {
      const container = this.canvas.parentElement;
      
      // Set canvas size to exact pixel dimensions
      this.canvas.width = container.clientWidth;
      this.canvas.height = container.clientHeight;
      
      // Ensure no CSS scaling
      this.canvas.style.width = container.clientWidth + 'px';
      this.canvas.style.height = container.clientHeight + 'px';
      
      // Center coordinate system
      this.offsetX = this.canvas.width / 2;
      this.offsetY = this.canvas.height / 2;
      
      // Optimize context for performance
      this.ctx.imageSmoothingEnabled = false;
      
    } catch (error) {
      this.offsetX = 400;
      this.offsetY = 300;
    }
  }
  
  // TRUE 1:1 transform methods - NO SCALING
  transformX(x) {
    return x * this.getScaleFactor() + this.offsetX + this.panOffset.x;
  }

  transformY(y) {
    return -y * this.getScaleFactor() + this.offsetY + this.panOffset.y;
  }
  
  screenToWorld(x, y) {
    const scale = this.getScaleFactor();
    return {
      x: (x - this.offsetX - this.panOffset.x) / scale,
      y: -(y - this.offsetY - this.panOffset.y) / scale
    };
  }
  
  worldToScreen(x, y) {
    return {
      x: this.transformX(x),
      y: this.transformY(y)
    };
  }
  
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground();
    this.drawRulers();
    if (this.isGridEnabled) {
      this.drawCartesianGrid();
    }
    if (this.showAxes) {
      this.drawAxes();
    }
  }
  
  drawBackground() {
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  
  drawRulers() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Draw ruler backgrounds
    ctx.fillStyle = this.rulerBackgroundColor;
    ctx.fillRect(this.rulerWidth, 0, width - this.rulerWidth, this.rulerHeight);
    ctx.fillRect(0, this.rulerHeight, this.rulerWidth, height - this.rulerHeight);
    ctx.fillRect(0, 0, this.rulerWidth, this.rulerHeight);
    
    // Draw ruler borders
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.rulerWidth, this.rulerHeight - 0.5);
    ctx.lineTo(width, this.rulerHeight - 0.5);
    ctx.moveTo(this.rulerWidth - 0.5, this.rulerHeight);
    ctx.lineTo(this.rulerWidth - 0.5, height);
    ctx.stroke();
    
    this.drawHorizontalRuler();
    this.drawVerticalRuler();
  }
  
  drawHorizontalRuler() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const centerX = this.offsetX + this.panOffset.x;
    const scale = this.getScaleFactor();
    
    // Optimized ruler intervals - TRUE 1:1 (every pixel = 1mm)
    const majorTick = 50;  // Major ticks every 50mm
    const minorTick = 10;  // Minor ticks every 10mm
    
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Calculate visible range efficiently
    const leftEdge = this.rulerWidth;
    const rightEdge = width;
    const visibleLeftWorld = (leftEdge - centerX) / scale;
    const visibleRightWorld = (rightEdge - centerX) / scale;
    const startMM = Math.floor(visibleLeftWorld / minorTick) * minorTick;
    const endMM = Math.ceil(visibleRightWorld / minorTick) * minorTick;
    
    // Draw minor ticks (10mm) - optimized
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let mm = startMM; mm <= endMM; mm += minorTick) {
      if (mm % majorTick === 0) continue;
      const x = centerX + mm * scale;
      if (x >= leftEdge && x <= rightEdge) {
        ctx.moveTo(x, this.rulerHeight - 4);
        ctx.lineTo(x, this.rulerHeight);
      }
    }
    ctx.stroke();
    
    // Draw major ticks and labels (50mm)
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#333333';
    
    for (let mm = Math.floor(visibleLeftWorld / majorTick) * majorTick; mm <= Math.ceil(visibleRightWorld / majorTick) * majorTick; mm += majorTick) {
      const x = centerX + mm * scale;
      if (x >= leftEdge && x <= rightEdge) {
        // Draw major tick
        ctx.beginPath();
        ctx.moveTo(x, this.rulerHeight - 8);
        ctx.lineTo(x, this.rulerHeight);
        ctx.stroke();
        
        // Draw label - simplified
        if (x > leftEdge + 20 && x < rightEdge - 20) {
          const mmValue = Math.round(mm);
          const displayValue = mmValue === 0 ? '0' : Math.abs(mmValue).toString();
          ctx.fillText(displayValue, x, 2);
          
          // Add "mm" for non-zero values
          if (mmValue !== 0) {
            ctx.font = '7px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = '#888888';
            ctx.fillText('mm', x, 12);
            ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = '#333333';
          }
        }
      }
    }
    
    // Draw center line
    if (centerX >= leftEdge && centerX <= rightEdge) {
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, this.rulerHeight);
      ctx.stroke();
    }
  }
  
  drawVerticalRuler() {
    const ctx = this.ctx;
    const height = this.canvas.height;
    const centerY = this.offsetY + this.panOffset.y;
    const scale = this.getScaleFactor();
    
    // Optimized ruler intervals - TRUE 1:1
    const majorTick = 50;  // Major ticks every 50mm
    const minorTick = 10;  // Minor ticks every 10mm
    
    ctx.font = '8px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Calculate visible range efficiently
    const topEdge = this.rulerHeight;
    const bottomEdge = height;
    const visibleTopWorld = (topEdge - centerY) / scale;
    const visibleBottomWorld = (bottomEdge - centerY) / scale;
    const startMM = Math.floor(visibleTopWorld / minorTick) * minorTick;
    const endMM = Math.ceil(visibleBottomWorld / minorTick) * minorTick;
    
    // Draw minor ticks (10mm) - optimized
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let mm = startMM; mm <= endMM; mm += minorTick) {
      if (mm % majorTick === 0) continue;
      const y = centerY - mm * scale;
      if (y >= topEdge && y <= bottomEdge) {
        ctx.moveTo(this.rulerWidth - 4, y);
        ctx.lineTo(this.rulerWidth, y);
      }
    }
    ctx.stroke();
    
    // Draw major ticks and labels (50mm)
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#333333';
    
    for (let mm = Math.floor(visibleTopWorld / majorTick) * majorTick; mm <= Math.ceil(visibleBottomWorld / majorTick) * majorTick; mm += majorTick) {
      const y = centerY - mm * scale;
      if (y >= topEdge && y <= bottomEdge) {
        // Draw major tick
        ctx.beginPath();
        ctx.moveTo(this.rulerWidth - 8, y);
        ctx.lineTo(this.rulerWidth, y);
        ctx.stroke();
        
        if (y > topEdge + 20 && y < bottomEdge - 20) {
          const mmValue = Math.round(mm);
          const displayValue = mmValue === 0 ? '0' : Math.abs(mmValue).toString();
          
          ctx.save();
          ctx.translate(15, y);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(displayValue, 0, 0);
          ctx.restore();
        }
      }
    }
    
    // Draw center line
    if (centerY >= topEdge && centerY <= bottomEdge) {
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(this.rulerWidth, centerY);
      ctx.stroke();
    }
  }
  
  drawCartesianGrid() {
    const gridSize = this.gridSize; // TRUE 10mm grid
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = this.offsetX + this.panOffset.x;
    const centerY = this.offsetY + this.panOffset.y;
    const scale = this.getScaleFactor();
    
    const opacity = this.gridOpacity;
    
    // Calculate visible grid bounds for performance
    const startX = this.rulerWidth;
    const startY = this.rulerHeight;
    const gridLeft = Math.floor(((startX - centerX) / scale) / gridSize) * gridSize;
    const gridRight = Math.ceil(((width - centerX) / scale) / gridSize) * gridSize;
    const gridTop = Math.floor(((startY - centerY) / scale) / gridSize) * gridSize;
    const gridBottom = Math.ceil(((height - centerY) / scale) / gridSize) * gridSize;
    
    // Draw grid dots - optimized for performance
    this.ctx.fillStyle = `rgba(153, 153, 153, ${opacity})`;
    this.ctx.beginPath();
    
    for (let offsetX = gridLeft; offsetX <= gridRight; offsetX += gridSize) {
      for (let offsetY = gridTop; offsetY <= gridBottom; offsetY += gridSize) {
        const x = centerX + offsetX * scale;
        const y = centerY - offsetY * scale;
        
        if (x >= startX && x <= width && y >= startY && y <= height) {
          this.ctx.moveTo(x + 1.2, y);
          this.ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        }
      }
    }
    this.ctx.fill();
    
    // Draw major grid lines every 50mm - optimized
    const majorGrid = 50;
    this.ctx.strokeStyle = `rgba(0, 0, 0, ${opacity * 0.5})`;
    this.ctx.lineWidth = 0.5;
    this.ctx.beginPath();
    
    // Vertical major lines
    const majorLeft = Math.floor(gridLeft / majorGrid) * majorGrid;
    const majorRight = Math.ceil(gridRight / majorGrid) * majorGrid;
    for (let offsetX = majorLeft; offsetX <= majorRight; offsetX += majorGrid) {
      if (offsetX === 0) continue; // Skip center line
      const x = centerX + offsetX * scale;
      if (x >= startX && x <= width) {
        this.ctx.moveTo(x, startY);
        this.ctx.lineTo(x, height);
      }
    }
    
    // Horizontal major lines
    const majorTop = Math.floor(gridTop / majorGrid) * majorGrid;
    const majorBottom = Math.ceil(gridBottom / majorGrid) * majorGrid;
    for (let offsetY = majorTop; offsetY <= majorBottom; offsetY += majorGrid) {
      if (offsetY === 0) continue; // Skip center line
      const y = centerY - offsetY * scale;
      if (y >= startY && y <= height) {
        this.ctx.moveTo(startX, y);
        this.ctx.lineTo(width, y);
      }
    }
    
    this.ctx.stroke();
  }
  
  drawAxes() {
    const centerX = this.offsetX + this.panOffset.x;
    const centerY = this.offsetY + this.panOffset.y;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    this.ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    
    // Draw X-axis (horizontal)
    if (centerY >= this.rulerHeight && centerY <= height) {
      this.ctx.moveTo(this.rulerWidth, centerY);
      this.ctx.lineTo(width, centerY);
    }
    
    // Draw Y-axis (vertical)
    if (centerX >= this.rulerWidth && centerX <= width) {
      this.ctx.moveTo(centerX, this.rulerHeight);
      this.ctx.lineTo(centerX, height);
    }
    
    this.ctx.stroke();
  }
  
  pan(dx, dy) {
    this.panOffset.x += dx;
    this.panOffset.y += dy;
  }
  
  toggleGrid() {
    this.isGridEnabled = !this.isGridEnabled;
  }
  
  toggleAxes() {
    this.showAxes = !this.showAxes;
  }
  
  setPanOffset(x, y) {
    this.panOffset.x = x;
    this.panOffset.y = y;
  }
  
  getCanvasBounds() {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
      centerX: this.offsetX,
      centerY: this.offsetY,
      rulerHeight: this.rulerHeight,
      rulerWidth: this.rulerWidth,
      scale: this.getScaleFactor(),
      interactiveArea: {
        top: this.rulerHeight,
        left: this.rulerWidth,
        width: this.canvas.width - this.rulerWidth,
        height: this.canvas.height - this.rulerHeight
      }
    };
  }
  
  getViewportBounds() {
    const topLeft = this.screenToWorld(this.rulerWidth, this.rulerHeight);
    const bottomRight = this.screenToWorld(this.canvas.width, this.canvas.height);
    
    return {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
      width: bottomRight.x - topLeft.x,
      height: topLeft.y - bottomRight.y
    };
  }
  
  isPointInViewport(x, y) {
    const bounds = this.getViewportBounds();
    return x >= bounds.left && x <= bounds.right && 
           y >= bounds.bottom && y <= bounds.top;
  }
  
  isInInteractiveArea(canvasX, canvasY) {
    return canvasY >= this.rulerHeight && 
           canvasX >= this.rulerWidth && 
           canvasX <= this.canvas.width && 
           canvasY <= this.canvas.height;
  }
  
  snapToGrid(x, y) {
    if (!this.isGridEnabled) return { x, y };
    
    const gridWorldSize = this.gridSize; // 10mm
    return {
      x: Math.round(x / gridWorldSize) * gridWorldSize,
      y: Math.round(y / gridWorldSize) * gridWorldSize
    };
  }
  
  getMousePositionInfo(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    const scale = this.getScaleFactor();
    
    // Convert to world coordinates (TRUE 1:1)
    const worldPos = this.screenToWorld(canvasX, canvasY);
    
    // Calculate center-relative position
    const centerX = this.offsetX + this.panOffset.x;
    const centerY = this.offsetY + this.panOffset.y;
    
    const pixelFromCenterX = canvasX - centerX;
    const pixelFromCenterY = centerY - canvasY; // Flip Y for cartesian
    
    // TRUE 1:1: pixels = mm exactly
    return {
      canvas: { x: canvasX, y: canvasY },
      world: worldPos,
      centerRelative: {
        pixels: { x: pixelFromCenterX, y: pixelFromCenterY },
        mm: { x: pixelFromCenterX / scale, y: pixelFromCenterY / scale }
      },
      ruler: {
        displayX: Math.round(pixelFromCenterX / scale),
        displayY: Math.round(pixelFromCenterY / scale)
      }
    };
  }
  
  // TRUE 1:1 utility methods
  pixelsToMillimeters(pixels) {
    return pixels / this.getScaleFactor();
  }
  
  millimetersToPixels(mm) {
    return mm * this.getScaleFactor();
  }
  
  getScaleFactor() {
    return this.scale * this.zoomLevel;
  }

  clampZoom(value) {
    return Math.min(this.maxZoom, Math.max(this.minZoom, value));
  }

  setZoom(level, anchorX = this.canvas.width / 2, anchorY = this.canvas.height / 2) {
    const targetZoom = this.clampZoom(level);
    if (Math.abs(targetZoom - this.zoomLevel) < 0.0001) return false;

    const anchorWorld = this.screenToWorld(anchorX, anchorY);
    this.zoomLevel = targetZoom;

    const newScreen = this.worldToScreen(anchorWorld.x, anchorWorld.y);
    this.panOffset.x += anchorX - newScreen.x;
    this.panOffset.y += anchorY - newScreen.y;
    return true;
  }

  zoomByFactor(factor, anchorX = this.canvas.width / 2, anchorY = this.canvas.height / 2) {
    return this.setZoom(this.zoomLevel * factor, anchorX, anchorY);
  }

  zoomIn(anchorX, anchorY) {
    return this.zoomByFactor(1 + this.zoomStep, anchorX, anchorY);
  }

  zoomOut(anchorX, anchorY) {
    return this.zoomByFactor(1 / (1 + this.zoomStep), anchorX, anchorY);
  }

  resetZoom(anchorX = this.canvas.width / 2, anchorY = this.canvas.height / 2) {
    return this.setZoom(1, anchorX, anchorY);
  }
}
