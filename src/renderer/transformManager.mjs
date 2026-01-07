// transformManager.mjs - Transform calculations and shape manipulation

export class TransformManager {
  constructor() {
    this.defaultTransform = { position: [0, 0], rotation: 0, scale: [1, 1] };
  }

  createContext(transform, screenX, screenY, scale) {
    return {
      screenX: screenX,
      screenY: screenY,
      rotation: (transform.rotation || 0) * Math.PI / 180,
      scale: scale
    };
  }

  calculateBounds(shape) {
    if (!shape || !shape.type || !shape.params) {
      return { x: -25, y: -25, width: 50, height: 50 };
    }

    const { type, params } = shape;

    switch (type) {
      case 'rectangle':
      case 'roundedRectangle':
      case 'chamferRectangle':
        return {
          x: -(params.width || 100) / 2,
          y: -(params.height || 100) / 2,
          width: params.width || 100,
          height: params.height || 100
        };
        
      case 'circle':
        const radius = params.radius || 50;
        return {
          x: -radius, y: -radius,
          width: radius * 2, height: radius * 2
        };
        
      case 'triangle':
        return {
          x: -(params.base || 60) / 2,
          y: -(params.height || 80) / 2,
          width: params.base || 60,
          height: params.height || 80
        };
        
      case 'ellipse':
        return {
          x: -(params.radiusX || 60),
          y: -(params.radiusY || 40),
          width: (params.radiusX || 60) * 2,
          height: (params.radiusY || 40) * 2
        };
        
      case 'polygon':
      case 'arc':
        const polyRadius = params.radius || 50;
        return {
          x: -polyRadius, y: -polyRadius,
          width: polyRadius * 2, height: polyRadius * 2
        };
        
      case 'star':
        const outerRadius = params.outerRadius || 50;
        return {
          x: -outerRadius, y: -outerRadius,
          width: outerRadius * 2, height: outerRadius * 2
        };
        
      case 'donut':
        const donutRadius = params.outerRadius || 50;
        return {
          x: -donutRadius, y: -donutRadius,
          width: donutRadius * 2, height: donutRadius * 2
        };
        
      case 'spiral':
        const spiralRadius = Math.max(params.startRadius || 10, params.endRadius || 50);
        return {
          x: -spiralRadius, y: -spiralRadius,
          width: spiralRadius * 2, height: spiralRadius * 2
        };
        
      case 'cross':
        const crossWidth = params.width || 100;
        return {
          x: -crossWidth / 2, y: -crossWidth / 2,
          width: crossWidth, height: crossWidth
        };
        
      case 'gear':
        const gearRadius = (params.diameter || 100) / 2;
        return {
          x: -gearRadius, y: -gearRadius,
          width: gearRadius * 2, height: gearRadius * 2
        };
        
      case 'arrow':
        const arrowLength = params.length || 100;
        const arrowHeight = Math.max(params.headWidth || 30, params.bodyWidth || 10);
        return {
          x: -(params.bodyWidth || 10) / 2,
          y: -arrowHeight / 2,
          width: arrowLength,
          height: arrowHeight
        };
        
      case 'text':
        const fontSize = params.fontSize || 12;
        const textLength = (params.text || '').length;
        const estimatedWidth = fontSize * 0.6 * textLength;
        return {
          x: -estimatedWidth / 2, y: -fontSize / 2,
          width: estimatedWidth, height: fontSize
        };
        
      case 'wave':
        const waveWidth = params.width || 100;
        const waveHeight = (params.amplitude || 20) * 2;
        return {
          x: -waveWidth / 2, y: -waveHeight / 2,
          width: waveWidth, height: waveHeight
        };
        
      case 'slot':
        const slotLength = params.length || 100;
        const slotWidth = params.width || 20;
        return {
          x: -slotLength / 2, y: -slotWidth / 2,
          width: slotLength, height: slotWidth
        };

      case 'bspline':
        if (params.points && params.points.length > 0) {
          return this.calculatePathBounds(params.points);
        }
        return { x: -25, y: -25, width: 50, height: 50 };
        
      case 'path':
        if (params.points && params.points.length > 0) {
          return this.calculatePathBounds(params.points);
        }
        return { x: -25, y: -25, width: 50, height: 50 };
        
      default:
        return { x: -25, y: -25, width: 50, height: 50 };
    }
  }

  calculatePathBounds(points) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    points.forEach(point => {
      if (point === null) return;
      const x = Array.isArray(point) ? point[0] : point.x;
      const y = Array.isArray(point) ? point[1] : point.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  handleParameterScaling(shape, activeHandle, dx, dy, scaleFactor, shapeName, shapeManager) {
    const worldDX = dx * (1 / scaleFactor);
    const worldDY = dy * (1 / scaleFactor);

    const circularShapes = ['circle', 'donut', 'spiral', 'polygon', 'arc', 'star', 'gear'];
    const rectangularShapes = ['rectangle', 'roundedRectangle', 'chamferRectangle', 'triangle', 'ellipse', 'slot', 'cross'];
    const customShapes = ['arrow', 'text', 'wave'];

    if (circularShapes.includes(shape.type)) {
      this.handleCircularScaling(shape, activeHandle, worldDX, worldDY, shapeName, shapeManager);
    } else if (rectangularShapes.includes(shape.type)) {
      this.handleRectangularScaling(shape, activeHandle, worldDX, worldDY, shapeName, shapeManager);
    } else if (customShapes.includes(shape.type)) {
      this.handleCustomScaling(shape, activeHandle, worldDX, worldDY, shapeName, shapeManager);
    }
  }

  handleCircularScaling(shape, handle, worldDX, worldDY, shapeName, shapeManager) {
    const bounds = this.calculateBounds(shape);
    let handleX, handleY;

    switch (handle) {
      case 'tl': handleX = -bounds.width / 2; handleY = -bounds.height / 2; break;
      case 'tr': handleX = bounds.width / 2; handleY = -bounds.height / 2; break;
      case 'br': handleX = bounds.width / 2; handleY = bounds.height / 2; break;
      case 'bl': handleX = -bounds.width / 2; handleY = bounds.height / 2; break;
    }

    const currentDistance = Math.sqrt(handleX * handleX + handleY * handleY);
    const newHandleX = handleX + worldDX;
    const newHandleY = handleY + worldDY;
    const newDistance = Math.sqrt(newHandleX * newHandleX + newHandleY * newHandleY);
    const radiusChange = newDistance - currentDistance;

    switch (shape.type) {
      case 'circle':
        const newRadius = Math.max(5, shape.params.radius + radiusChange);
        shapeManager.onCanvasShapeChange(shapeName, 'radius', newRadius);
        break;
        
      case 'polygon':
      case 'arc':
        const newPolyRadius = Math.max(5, shape.params.radius + radiusChange);
        shapeManager.onCanvasShapeChange(shapeName, 'radius', newPolyRadius);
        break;
        
      case 'donut':
        const outerRadius = Math.max(10, shape.params.outerRadius + radiusChange);
        const innerRadius = Math.max(2, Math.min(outerRadius - 5, shape.params.innerRadius + radiusChange * 0.5));
        shapeManager.onCanvasShapeChange(shapeName, 'outerRadius', outerRadius);
        shapeManager.onCanvasShapeChange(shapeName, 'innerRadius', innerRadius);
        break;
        
      case 'spiral':
        const newStartRadius = Math.max(1, shape.params.startRadius + radiusChange * 0.3);
        const newEndRadius = Math.max(newStartRadius + 5, shape.params.endRadius + radiusChange);
        shapeManager.onCanvasShapeChange(shapeName, 'startRadius', newStartRadius);
        shapeManager.onCanvasShapeChange(shapeName, 'endRadius', newEndRadius);
        break;
        
      case 'star':
        const newOuterRadius = Math.max(10, shape.params.outerRadius + radiusChange);
        const newInnerRadius = Math.max(2, Math.min(newOuterRadius - 5, shape.params.innerRadius + radiusChange * 0.6));
        shapeManager.onCanvasShapeChange(shapeName, 'outerRadius', newOuterRadius);
        shapeManager.onCanvasShapeChange(shapeName, 'innerRadius', newInnerRadius);
        break;
        
      case 'gear':
        const newDiameter = Math.max(20, shape.params.diameter + radiusChange * 2);
        shapeManager.onCanvasShapeChange(shapeName, 'diameter', newDiameter);
        break;
    }
  }

  handleRectangularScaling(shape, handle, worldDX, worldDY, shapeName, shapeManager) {
    const scaleX = (handle === 'tr' || handle === 'br') ? 1 : -1;
    const scaleY = (handle === 'bl' || handle === 'br') ? 1 : -1;

    const deltaX = worldDX * scaleX * 2;
    const deltaY = worldDY * scaleY * 2;

    switch (shape.type) {
      case 'rectangle':
      case 'roundedRectangle':
      case 'chamferRectangle':
        const newWidth = Math.max(5, shape.params.width + deltaX);
        const newHeight = Math.max(5, shape.params.height + deltaY);
        shapeManager.onCanvasShapeChange(shapeName, 'width', newWidth);
        shapeManager.onCanvasShapeChange(shapeName, 'height', newHeight);
        break;
        
      case 'triangle':
        const newBase = Math.max(5, shape.params.base + deltaX);
        const newTriangleHeight = Math.max(5, shape.params.height + deltaY);
        shapeManager.onCanvasShapeChange(shapeName, 'base', newBase);
        shapeManager.onCanvasShapeChange(shapeName, 'height', newTriangleHeight);
        break;
        
      case 'ellipse':
        const newRadiusX = Math.max(2, shape.params.radiusX + deltaX / 2);
        const newRadiusY = Math.max(2, shape.params.radiusY + deltaY / 2);
        shapeManager.onCanvasShapeChange(shapeName, 'radiusX', newRadiusX);
        shapeManager.onCanvasShapeChange(shapeName, 'radiusY', newRadiusY);
        break;
        
      case 'slot':
        const newSlotLength = Math.max(10, shape.params.length + deltaX);
        const newSlotWidth = Math.max(5, shape.params.width + deltaY);
        shapeManager.onCanvasShapeChange(shapeName, 'length', newSlotLength);
        shapeManager.onCanvasShapeChange(shapeName, 'width', newSlotWidth);
        break;
        
      case 'cross':
        const newCrossWidth = Math.max(10, shape.params.width + deltaX);
        const newThickness = Math.max(2, shape.params.thickness + deltaY);
        shapeManager.onCanvasShapeChange(shapeName, 'width', newCrossWidth);
        shapeManager.onCanvasShapeChange(shapeName, 'thickness', newThickness);
        break;
    }
  }

  handleCustomScaling(shape, handle, worldDX, worldDY, shapeName, shapeManager) {
    const scaleX = (handle === 'tr' || handle === 'br') ? 1 : -1;
    const scaleY = (handle === 'bl' || handle === 'br') ? 1 : -1;

    const deltaX = worldDX * scaleX * 2;
    const deltaY = worldDY * scaleY * 2;

    switch (shape.type) {
      case 'arrow':
        const newLength = Math.max(20, shape.params.length + deltaX);
        const newHeadWidth = Math.max(5, shape.params.headWidth + deltaY);
        const newHeadLength = Math.max(5, Math.min(newLength * 0.8, shape.params.headLength + deltaX * 0.3));
        const newBodyWidth = Math.max(2, shape.params.bodyWidth + deltaY * 0.3);
        shapeManager.onCanvasShapeChange(shapeName, 'length', newLength);
        shapeManager.onCanvasShapeChange(shapeName, 'headWidth', newHeadWidth);
        shapeManager.onCanvasShapeChange(shapeName, 'headLength', newHeadLength);
        shapeManager.onCanvasShapeChange(shapeName, 'bodyWidth', newBodyWidth);
        break;
        
      case 'text':
        const scaleFactor = Math.max(0.5, 1 + (deltaX + deltaY) / 200);
        const newFontSize = Math.max(6, shape.params.fontSize * scaleFactor);
        shapeManager.onCanvasShapeChange(shapeName, 'fontSize', newFontSize);
        break;
        
      case 'wave':
        const newWaveWidth = Math.max(20, shape.params.width + deltaX);
        const newAmplitude = Math.max(2, shape.params.amplitude + deltaY / 2);
        shapeManager.onCanvasShapeChange(shapeName, 'width', newWaveWidth);
        shapeManager.onCanvasShapeChange(shapeName, 'amplitude', newAmplitude);
        break;
    }
  }

  applyTransform(transform, point) {
    const { position = [0, 0], rotation = 0, scale = [1, 1] } = transform;
    
    let x = point.x * scale[0];
    let y = point.y * scale[1];
    
    if (rotation !== 0) {
      const rad = rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotatedX = x * cos - y * sin;
      const rotatedY = x * sin + y * cos;
      x = rotatedX;
      y = rotatedY;
    }
    
    x += position[0];
    y += position[1];
    
    return { x, y };
  }

  applyInverseTransform(transform, point) {
    const { position = [0, 0], rotation = 0, scale = [1, 1] } = transform;
    
    let x = point.x - position[0];
    let y = point.y - position[1];
    
    if (rotation !== 0) {
      const rad = -rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotatedX = x * cos - y * sin;
      const rotatedY = x * sin + y * cos;
      x = rotatedX;
      y = rotatedY;
    }
    
    x /= scale[0];
    y /= scale[1];
    
    return { x, y };
  }

  combineTransforms(transform1, transform2) {
    return {
      position: [
        transform1.position[0] + transform2.position[0],
        transform1.position[1] + transform2.position[1]
      ],
      rotation: transform1.rotation + transform2.rotation,
      scale: [
        transform1.scale[0] * transform2.scale[0],
        transform1.scale[1] * transform2.scale[1]
      ]
    };
  }

  decomposeTransform(transform) {
    return {
      translation: { x: transform.position[0], y: transform.position[1] },
      rotation: transform.rotation,
      scale: { x: transform.scale[0], y: transform.scale[1] }
    };
  }

  interpolateTransforms(transform1, transform2, t) {
    t = Math.max(0, Math.min(1, t));
    
    return {
      position: [
        transform1.position[0] + (transform2.position[0] - transform1.position[0]) * t,
        transform1.position[1] + (transform2.position[1] - transform1.position[1]) * t
      ],
      rotation: transform1.rotation + (transform2.rotation - transform1.rotation) * t,
      scale: [
        transform1.scale[0] + (transform2.scale[0] - transform1.scale[0]) * t,
        transform1.scale[1] + (transform2.scale[1] - transform1.scale[1]) * t
      ]
    };
  }

  getTransformMatrix(transform) {
    const { position = [0, 0], rotation = 0, scale = [1, 1] } = transform;
    
    const rad = rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    return [
      scale[0] * cos, scale[0] * sin, position[0],
      -scale[1] * sin, scale[1] * cos, position[1],
      0, 0, 1
    ];
  }

  transformBounds(bounds, transform) {
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height }
    ];
    
    const transformedCorners = corners.map(corner => this.applyTransform(transform, corner));
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    transformedCorners.forEach(corner => {
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    });
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  isTransformValid(transform) {
    if (!transform || typeof transform !== 'object') return false;
    
    if (!Array.isArray(transform.position) || transform.position.length !== 2) return false;
    if (typeof transform.rotation !== 'number') return false;
    if (!Array.isArray(transform.scale) || transform.scale.length !== 2) return false;
    
    if (transform.scale[0] <= 0 || transform.scale[1] <= 0) return false;
    if (!isFinite(transform.position[0]) || !isFinite(transform.position[1])) return false;
    if (!isFinite(transform.rotation)) return false;
    
    return true;
  }

  normalizeTransform(transform) {
    const normalized = { ...this.defaultTransform };
    
    if (transform.position && Array.isArray(transform.position) && transform.position.length >= 2) {
      normalized.position = [transform.position[0], transform.position[1]];
    }
    
    if (typeof transform.rotation === 'number' && isFinite(transform.rotation)) {
      normalized.rotation = transform.rotation % 360;
      if (normalized.rotation < 0) normalized.rotation += 360;
    }
    
    if (transform.scale && Array.isArray(transform.scale) && transform.scale.length >= 2) {
      normalized.scale = [
        Math.max(0.01, transform.scale[0]),
        Math.max(0.01, transform.scale[1])
      ];
    }
    
    return normalized;
  }

  getTransformHash(transform) {
    const normalized = this.normalizeTransform(transform);
    return `${normalized.position[0].toFixed(3)},${normalized.position[1].toFixed(3)},${normalized.rotation.toFixed(3)},${normalized.scale[0].toFixed(3)},${normalized.scale[1].toFixed(3)}`;
  }
}
