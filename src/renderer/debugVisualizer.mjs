// debugVisualizer.mjs - Fixed debug overlays and development tools

export class DebugVisualizer {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = false;
    this.showPerformance = true;
    this.showShapeInfo = true;
    this.showCoordinates = true;
    this.showBounds = true;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  visualizeShape(shape, transformContext, shapeName) {
    if (!this.enabled || !shape) return;

    if (this.showBounds) {
      this.drawShapeBounds(shape, transformContext);
    }

    if (this.showShapeInfo) {
      this.drawShapeInfo(shape, transformContext, shapeName);
    }

    if (shape.params.operation) {
      this.visualizeBooleanOperation(shape, transformContext);
    }
  }

  drawShapeBounds(shape, transformContext) {
    this.ctx.save();
    this.ctx.setLineDash([2, 2]);
    this.ctx.strokeStyle = '#00FF00';
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.5;

    this.ctx.translate(transformContext.screenX, transformContext.screenY);
    this.ctx.rotate(-transformContext.rotation);

    const bounds = this.calculateShapeDebugBounds(shape);
    this.ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    this.ctx.restore();
  }

  drawShapeInfo(shape, transformContext, shapeName) {
    const infoX = transformContext.screenX + 10;
    const infoY = transformContext.screenY - 10;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(infoX, infoY - 40, 150, 35);

    this.ctx.fillStyle = '#00FF00';
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    const info = [
      `${shapeName || 'unnamed'} (${shape.type})`,
      `pos: ${shape.transform.position[0].toFixed(1)}, ${shape.transform.position[1].toFixed(1)}`,
      `rot: ${shape.transform.rotation.toFixed(1)}°`
    ];

    info.forEach((line, i) => {
      this.ctx.fillText(line, infoX + 3, infoY - 35 + i * 12);
    });

    this.ctx.restore();
  }

  visualizeBooleanOperation(shape, transformContext) {
    const infoX = transformContext.screenX - 5;
    const infoY = transformContext.screenY - 5;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    this.ctx.fillRect(infoX - 5, infoY - 5, 10, 10);

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillRect(infoX + 15, infoY - 15, 80, 20);

    this.ctx.fillStyle = 'red';
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`BOOL: ${shape.params.operation}`, infoX + 18, infoY - 5);

    if (shape.params.hasHoles) {
      this.ctx.fillText('HOLES', infoX + 18, infoY + 8);
    }

    this.ctx.restore();
  }

  drawOverlay(shapes, coordinateSystem) {
    if (!this.enabled) return;

    this.updatePerformanceMetrics();

    if (this.showPerformance) {
      this.drawPerformanceOverlay();
    }

    if (shapes && this.showShapeInfo) {
      this.drawShapeStatsOverlay(shapes);
    }

    if (coordinateSystem && this.showCoordinates) {
      this.drawCoordinateOverlay(coordinateSystem);
    }
  }

  updatePerformanceMetrics() {
    const currentTime = performance.now();
    this.frameCount++;

    if (currentTime - this.lastFrameTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFrameTime));
      this.frameCount = 0;
      this.lastFrameTime = currentTime;
    }
  }

  drawPerformanceOverlay() {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(10, 10, 200, 80);

    this.ctx.fillStyle = '#00FF00';
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    const perfInfo = [
      `FPS: ${this.fps}`,
      `Frame: ${this.frameCount}`,
      `Memory: ${this.getMemoryUsage()}`,
      `Timestamp: ${Date.now()}`
    ];

    perfInfo.forEach((line, i) => {
      this.ctx.fillText(line, 15, 15 + i * 15);
    });

    this.ctx.restore();
  }

  drawShapeStatsOverlay(shapes) {
    let consumedCount = 0;
    let booleanCount = 0;
    let pathCount = 0;

    shapes.forEach(shape => {
      if (shape._consumedByBoolean) consumedCount++;
      if (shape.params.operation) booleanCount++;
      if (shape.type === 'path') pathCount++;
    });

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(10, 100, 200, 100);

    this.ctx.fillStyle = '#00FF00';
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    const shapeInfo = [
      `Total Shapes: ${shapes.size}`,
      `Consumed: ${consumedCount}`,
      `Boolean Ops: ${booleanCount}`,
      `Paths: ${pathCount}`,
      `Visible: ${shapes.size - consumedCount}`
    ];

    shapeInfo.forEach((line, i) => {
      this.ctx.fillText(line, 15, 105 + i * 15);
    });

    this.ctx.restore();
  }

  drawCoordinateOverlay(coordinateSystem) {
    const viewport = coordinateSystem.getViewportBounds();
    
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(10, 210, 200, 100);

    this.ctx.fillStyle = '#00FF00';
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    const coordInfo = [
      `Zoom: ${coordinateSystem.zoomLevel.toFixed(2)}x`,
      `Pan: ${coordinateSystem.panOffset.x.toFixed(1)}, ${coordinateSystem.panOffset.y.toFixed(1)}`,
      `Scale: ${coordinateSystem.getScaleFactor().toFixed(3)}`,
      `Grid: ${coordinateSystem.isGridEnabled ? 'ON' : 'OFF'}`,
      `Viewport: ${viewport.width.toFixed(0)} × ${viewport.height.toFixed(0)}`
    ];

    coordInfo.forEach((line, i) => {
      this.ctx.fillText(line, 15, 215 + i * 15);
    });

    this.ctx.restore();
  }

  drawCrossHairs(x, y, size = 20, color = '#FF0000') {
    if (!this.enabled) return;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 2]);

    this.ctx.beginPath();
    this.ctx.moveTo(x - size, y);
    this.ctx.lineTo(x + size, y);
    this.ctx.moveTo(x, y - size);
    this.ctx.lineTo(x, y + size);
    this.ctx.stroke();

    this.ctx.restore();
  }

  drawDebugPoint(x, y, label = '', color = '#FF0000') {
    if (!this.enabled) return;

    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, 3, 0, Math.PI * 2);
    this.ctx.fill();

    if (label) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      this.ctx.fillRect(x + 5, y - 8, label.length * 6 + 4, 16);
      
      this.ctx.fillStyle = color;
      this.ctx.font = '10px monospace';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(label, x + 7, y);
    }

    this.ctx.restore();
  }

  drawDebugPath(points, color = '#00FF00', label = '') {
    if (!this.enabled || !points || points.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([3, 3]);

    this.ctx.beginPath();
    this.ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i < points.length; i++) {
      if (points[i] !== null) {
        this.ctx.lineTo(points[i][0], points[i][1]);
      }
    }

    this.ctx.stroke();

    if (label) {
      const midPoint = points[Math.floor(points.length / 2)];
      if (midPoint && midPoint !== null) {
        this.drawDebugPoint(midPoint[0], midPoint[1], label, color);
      }
    }

    this.ctx.restore();
  }

  calculateShapeDebugBounds(shape) {
    // Use the renderer's transform manager for consistent bounds calculation
    if (shape.renderer && shape.renderer.transformManager) {
      return shape.renderer.transformManager.calculateBounds(shape);
    }

    // Fallback calculation
    switch (shape.type) {
      case 'rectangle':
      case 'roundedRectangle':
      case 'chamferRectangle':
        return {
          x: -(shape.params.width || 100) / 2,
          y: -(shape.params.height || 100) / 2,
          width: shape.params.width || 100,
          height: shape.params.height || 100
        };
      case 'circle':
        const radius = shape.params.radius || 50;
        return { x: -radius, y: -radius, width: radius * 2, height: radius * 2 };
      default:
        return { x: -50, y: -50, width: 100, height: 100 };
    }
  }

  getMemoryUsage() {
    if (performance.memory) {
      return `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB`;
    }
    return 'N/A';
  }

  setShowPerformance(show) {
    this.showPerformance = show;
  }

  setShowShapeInfo(show) {
    this.showShapeInfo = show;
  }

  setShowCoordinates(show) {
    this.showCoordinates = show;
  }

  setShowBounds(show) {
    this.showBounds = show;
  }

  getDebugSettings() {
    return {
      enabled: this.enabled,
      showPerformance: this.showPerformance,
      showShapeInfo: this.showShapeInfo,
      showCoordinates: this.showCoordinates,
      showBounds: this.showBounds
    };
  }

  setDebugSettings(settings) {
    if (settings.enabled !== undefined) this.enabled = settings.enabled;
    if (settings.showPerformance !== undefined) this.showPerformance = settings.showPerformance;
    if (settings.showShapeInfo !== undefined) this.showShapeInfo = settings.showShapeInfo;
    if (settings.showCoordinates !== undefined) this.showCoordinates = settings.showCoordinates;
    if (settings.showBounds !== undefined) this.showBounds = settings.showBounds;
  }

  reset() {
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
  }
}
