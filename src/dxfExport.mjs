// dxfExport.mjs

const MM_TO_PIXELS = 3.7795275591;
const PIXELS_TO_MM = 1 / MM_TO_PIXELS;

function pxToMm(pxValue) {
  return typeof pxValue === 'number' ? pxValue * PIXELS_TO_MM : pxValue;
}

function mmToPx(mmValue) {
  return typeof mmValue === 'number' ? mmValue * MM_TO_PIXELS : mmValue;
}

function convertPositionToDXF(position) {
  if (!Array.isArray(position) || position.length < 2) return [0, 0];
  return [pxToMm(position[0]), pxToMm(position[1])];
}

function convertDimensionsToDXF(params, dimensionKeys) {
  const converted = { ...params };
  dimensionKeys.forEach(key => {
    if (converted[key] !== undefined) {
      converted[key] = pxToMm(converted[key]);
    }
  });
  return converted;
}

function convertPointsToDXF(points) {
  if (!Array.isArray(points)) return points;
  return points.map(point => {
    if (point === null) return null;
    if (Array.isArray(point)) return [pxToMm(point[0]), pxToMm(point[1])];
    if (point && typeof point === 'object' && 'x' in point && 'y' in point) {
      return { x: pxToMm(point.x), y: pxToMm(point.y) };
    }
    return point;
  });
}

function getCanvasDimensions(canvas) {
  try {
    const container = canvas.parentElement;
    const canvasWidth = container.clientWidth;
    const canvasHeight = container.clientHeight;
    const scale = Math.min(canvasWidth, canvasHeight) / container.clientWidth;
    
    return {
      width: canvasWidth,
      height: canvasHeight,
      offsetX: canvasWidth / 2,
      offsetY: canvasHeight / 2,
      scale: scale,
      widthMM: canvasWidth * PIXELS_TO_MM,
      heightMM: canvasHeight * PIXELS_TO_MM
    };
  } catch (error) {
    console.warn('Could not get container dimensions, using fallback');
    return {
      width: 800,
      height: 600,
      offsetX: 400,
      offsetY: 300,
      scale: 1,
      widthMM: 800 * PIXELS_TO_MM,
      heightMM: 600 * PIXELS_TO_MM
    };
  }
}

export function exportToDXF(interpreter, canvas, filename = "aqui_drawing.dxf") {
  try {
    if (!interpreter?.env?.shapes) {
      throw new Error('No shapes to export');
    }

    const canvasDims = getCanvasDimensions(canvas);
    
    console.log(`Exporting ${interpreter.env.shapes.size} shapes to DXF with MM units...`);
    console.log(`Canvas: ${canvasDims.width}×${canvasDims.height}px (${canvasDims.widthMM.toFixed(1)}×${canvasDims.heightMM.toFixed(1)}mm)`);
    
    const dxfContent = new DXFBuilder();
    
    dxfContent.addHeader(canvasDims);
    
    dxfContent.addTables();
    
    dxfContent.startEntities();
    
    const canvasTransform = {
      offsetX: canvasDims.offsetX,
      offsetY: canvasDims.offsetY,
      scale: canvasDims.scale,
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
      canvasWidth: canvasDims.width,
      canvasHeight: canvasDims.height
    };
    
    let exportedShapes = 0;
    let exportedLayers = 0;

    interpreter.env.shapes.forEach((shape, shapeName) => {
      try {
        if (shape._consumedByBoolean) {
          console.log(`Skipping consumed shape: ${shapeName}`);
          return;
        }
        
        if (!isShapeInAnyLayer(shapeName, interpreter.env.layers)) {
          const dxfEntity = createDXFShapeWithMMConversion(shape, shapeName, canvasTransform);
          if (dxfEntity) {
            dxfContent.addEntity(dxfEntity);
            exportedShapes++;
          }
        }
      } catch (error) {
        console.warn(`Failed to export shape ${shapeName}:`, error.message);
      }
    });

    if (interpreter.env.layers && interpreter.env.layers.size > 0) {
      interpreter.env.layers.forEach((layer, layerName) => {
        try {
          const layerEntities = createLayerEntitiesWithMMConversion(layer, layerName, interpreter.env.shapes, canvasTransform);
          if (layerEntities && layerEntities.length > 0) {
            layerEntities.forEach(entity => dxfContent.addEntity(entity));
            exportedLayers++;
          }
        } catch (error) {
          console.warn(`Failed to export layer ${layerName}:`, error.message);
        }
      });
    }
    
    dxfContent.endEntities();
    
    const dxfString = dxfContent.build();
    
    downloadDXF(dxfString, filename, canvasDims);
    
    console.log(`DXF export completed: ${exportedShapes} shapes, ${exportedLayers} layers`);
    
    return { success: true, shapes: exportedShapes, layers: exportedLayers, canvasDims };
    
  } catch (error) {
    console.error('DXF Export failed:', error);
    return { success: false, error: error.message };
  }
}

class DXFBuilder {
  constructor() {
    this.content = [];
    this.entityHandle = 100;
  }
  
  add(code, value) {
    this.content.push(`${code}\n${value}\n`);
  }
  
  addHeader(canvasDims) {
    this.add(0, 'SECTION');
    this.add(2, 'HEADER');
    
    this.add(9, '$ACADVER');
    this.add(1, 'AC1021');
    
    this.add(9, '$INSUNITS');
    this.add(70, 4);
    
    this.add(9, '$LIMMIN');
    this.add(10, -canvasDims.widthMM / 2);
    this.add(20, -canvasDims.heightMM / 2);
    
    this.add(9, '$LIMMAX');
    this.add(10, canvasDims.widthMM / 2);
    this.add(20, canvasDims.heightMM / 2);
    
    this.add(9, '$CLAYER');
    this.add(8, '0');
    
    this.add(0, 'ENDSEC');
  }
  
  addTables() {
    this.add(0, 'SECTION');
    this.add(2, 'TABLES');
    
    this.add(0, 'TABLE');
    this.add(2, 'LAYER');
    this.add(70, 2);
    
    this.add(0, 'LAYER');
    this.add(2, '0');
    this.add(70, 0);
    this.add(62, 7);
    this.add(6, 'CONTINUOUS');
    
    this.add(0, 'LAYER');
    this.add(2, 'AQUI_SHAPES');
    this.add(70, 0);
    this.add(62, 1);
    this.add(6, 'CONTINUOUS');
    
    this.add(0, 'ENDTAB');
    this.add(0, 'ENDSEC');
  }
  
  startEntities() {
    this.add(0, 'SECTION');
    this.add(2, 'ENTITIES');
  }
  
  addEntity(entity) {
    if (entity) {
      this.content.push(entity);
    }
  }
  
  endEntities() {
    this.add(0, 'ENDSEC');
    this.add(0, 'EOF');
  }
  
  build() {
    return this.content.join('');
  }
  
  getNextHandle() {
    return (this.entityHandle++).toString(16).toUpperCase();
  }
}

function isShapeInAnyLayer(shapeName, layers) {
  if (!layers) return false;
  for (const layer of layers.values()) {
    if (layer.addedShapes && layer.addedShapes.has(shapeName)) {
      return true;
    }
  }
  return false;
}

function createLayerEntitiesWithMMConversion(layer, layerName, shapes, canvasTransform) {
  const entities = [];
  
  if (layer.addedShapes) {
    layer.addedShapes.forEach(shapeName => {
      if (shapes.has(shapeName)) {
        const shape = shapes.get(shapeName);
        if (shape._consumedByBoolean) return;
        
        const entity = createDXFShapeWithMMConversion(shape, shapeName, canvasTransform, layerName);
        if (entity) {
          entities.push(entity);
        }
      }
    });
  }
  
  return entities;
}

function createDXFShapeWithMMConversion(shape, shapeName, canvasTransform, layerName = 'AQUI_SHAPES') {
  if (!shape || !shape.type || !shape.params) {
    console.warn(`Invalid shape data for ${shapeName}`);
    return null;
  }
  
  const { type, params, transform } = shape;
  
  const convertedParams = convertShapeParamsToDXF(type, params);
  
  const dxfTransform = calculateDXFTransform(transform, canvasTransform);
  
  try {
    let entity = null;
    
    switch (type) {
      case 'circle':
        entity = createDXFCircle(convertedParams, dxfTransform, layerName);
        break;
      case 'rectangle':
      case 'roundedRectangle':
      case 'chamferRectangle':
        entity = createDXFRectangle(convertedParams, dxfTransform, layerName, type);
        break;
      case 'ellipse':
        entity = createDXFEllipse(convertedParams, dxfTransform, layerName);
        break;
      case 'polygon':
        entity = createDXFPolygon(convertedParams, dxfTransform, layerName);
        break;
      case 'star':
        entity = createDXFStar(convertedParams, dxfTransform, layerName);
        break;
      case 'triangle':
        entity = createDXFTriangle(convertedParams, dxfTransform, layerName);
        break;
      case 'arc':
        entity = createDXFArc(convertedParams, dxfTransform, layerName);
        break;
      case 'path':
        entity = createDXFPath(convertedParams, dxfTransform, layerName);
        break;
      case 'bspline':
        entity = createDXFPath(convertedParams, dxfTransform, layerName);
        break;
      case 'text':
        entity = createDXFText(convertedParams, dxfTransform, layerName);
        break;
      case 'donut':
        entity = createDXFDonut(convertedParams, dxfTransform, layerName);
        break;
      case 'arrow':
        entity = createDXFArrow(convertedParams, dxfTransform, layerName);
        break;
      case 'spiral':
        entity = createDXFSpiral(convertedParams, dxfTransform, layerName);
        break;
      case 'cross':
        entity = createDXFCross(convertedParams, dxfTransform, layerName);
        break;
      case 'wave':
        entity = createDXFWave(convertedParams, dxfTransform, layerName);
        break;
      case 'slot':
        entity = createDXFSlot(convertedParams, dxfTransform, layerName);
        break;
      default:
        console.warn(`DXF export: Using generic export for shape type: ${type}`);
        entity = createDXFGenericShape(type, convertedParams, dxfTransform, layerName);
    }
    
    return entity;
    
  } catch (error) {
    console.error(`Error creating DXF entity for ${type}:`, error);
    return createDXFGenericShape(type, convertedParams, dxfTransform, layerName);
  }
}

function convertShapeParamsToDXF(type, params) {
  switch (type) {
    case 'circle':
      return convertDimensionsToDXF(params, ['radius']);
    
    case 'rectangle':
    case 'roundedRectangle':
    case 'chamferRectangle':
      return convertDimensionsToDXF(params, ['width', 'height', 'radius', 'chamfer']);
    
    case 'ellipse':
      return convertDimensionsToDXF(params, ['radiusX', 'radiusY']);
    
    case 'polygon':
    case 'arc':
      return convertDimensionsToDXF(params, ['radius']);
    
    case 'star':
      return convertDimensionsToDXF(params, ['outerRadius', 'innerRadius']);
    
    case 'triangle':
      return convertDimensionsToDXF(params, ['base', 'height']);
    
    case 'text':
      return convertDimensionsToDXF(params, ['fontSize']);
    
    case 'donut':
      return convertDimensionsToDXF(params, ['outerRadius', 'innerRadius']);
    
    case 'arrow':
      return convertDimensionsToDXF(params, ['length', 'headWidth', 'headLength', 'bodyWidth']);
    
    case 'spiral':
      return convertDimensionsToDXF(params, ['startRadius', 'endRadius']);
    
    case 'cross':
      return convertDimensionsToDXF(params, ['width', 'thickness']);
    
    case 'wave':
      return convertDimensionsToDXF(params, ['width', 'amplitude']);
    
    case 'slot':
      return convertDimensionsToDXF(params, ['length', 'width']);
    
    case 'path':
      const converted = { ...params };
      if (converted.points) {
        converted.points = convertPointsToDXF(converted.points);
      }
      if (converted.subPaths) {
        converted.subPaths = converted.subPaths.map(path => convertPointsToDXF(path));
      }
      return convertDimensionsToDXF(converted, ['strokeWidth', 'thickness']);
    
    case 'bspline':
      const bsplineConverted = { ...params };
      if (bsplineConverted.points) {
        bsplineConverted.points = convertPointsToDXF(bsplineConverted.points);
      }
      return convertDimensionsToDXF(bsplineConverted, ['strokeWidth', 'thickness']);
    
    default:
      return convertDimensionsToDXF(params, ['width', 'height', 'radius', 'strokeWidth', 'thickness']);
  }
}

function calculateDXFTransform(transform, canvasTransform) {
  if (!transform) {
    return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  }
  
  const worldX = transform.position?.[0] || 0;
  const worldY = transform.position?.[1] || 0;
  const rotation = transform.rotation || 0;
  const scale = transform.scale || [1, 1];
  
  const screenX = worldX * canvasTransform.scale + canvasTransform.panOffset.x;
  const screenY = -worldY * canvasTransform.scale + canvasTransform.panOffset.y;
  
  const mmX = pxToMm(screenX);
  const mmY = pxToMm(screenY);
  
  return {
    x: mmX,
    y: mmY,
    rotation: -rotation,
    scaleX: scale[0],
    scaleY: scale[1]
  };
}

function createDXFCircle(params, transform, layerName) {
  const radius = params.radius || 25;
  
  return `0
CIRCLE
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${radius.toFixed(6)}
`;
}

function createDXFRectangle(params, transform, layerName, type) {
  const width = params.width || 50;
  const height = params.height || 50;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  
  const vertices = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
    [-halfWidth, -halfHeight]
  ];
  
  let polyline = `0
POLYLINE
8
${layerName}
66
1
10
0.0
20
0.0
30
0.0
70
1
`;

  vertices.forEach(vertex => {
    const x = transform.x + vertex[0] * Math.cos(transform.rotation * Math.PI / 180) - vertex[1] * Math.sin(transform.rotation * Math.PI / 180);
    const y = transform.y + vertex[0] * Math.sin(transform.rotation * Math.PI / 180) + vertex[1] * Math.cos(transform.rotation * Math.PI / 180);
    
    polyline += `0
VERTEX
8
${layerName}
10
${x.toFixed(6)}
20
${y.toFixed(6)}
30
0.0
`;
  });
  
  polyline += `0
SEQEND
8
${layerName}
`;
  
  return polyline;
}

function createDXFEllipse(params, transform, layerName) {
  const radiusX = params.radiusX || 25;
  const radiusY = params.radiusY || 15;
  
  return `0
ELLIPSE
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
11
${radiusX.toFixed(6)}
21
0.0
31
0.0
40
${(radiusY / radiusX).toFixed(6)}
41
0.0
42
6.283185307179586
`;
}

function createDXFPolygon(params, transform, layerName) {
  const sides = params.sides || 6;
  const radius = params.radius || 25;
  
  const vertices = [];
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    vertices.push([x, y]);
  }
  
  let polyline = `0
POLYLINE
8
${layerName}
66
1
10
0.0
20
0.0
30
0.0
70
1
`;

  vertices.forEach(vertex => {
    const x = transform.x + vertex[0] * Math.cos(transform.rotation * Math.PI / 180) - vertex[1] * Math.sin(transform.rotation * Math.PI / 180);
    const y = transform.y + vertex[0] * Math.sin(transform.rotation * Math.PI / 180) + vertex[1] * Math.cos(transform.rotation * Math.PI / 180);
    
    polyline += `0
VERTEX
8
${layerName}
10
${x.toFixed(6)}
20
${y.toFixed(6)}
30
0.0
`;
  });
  
  polyline += `0
SEQEND
8
${layerName}
`;
  
  return polyline;
}

function createDXFStar(params, transform, layerName) {
  const outerRadius = params.outerRadius || 25;
  const innerRadius = params.innerRadius || 10;
  const points = params.points || 5;
  
  const vertices = [];
  for (let i = 0; i <= points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    vertices.push([x, y]);
  }
  
  let polyline = `0
POLYLINE
8
${layerName}
66
1
10
0.0
20
0.0
30
0.0
70
1
`;

  vertices.forEach(vertex => {
    const x = transform.x + vertex[0] * Math.cos(transform.rotation * Math.PI / 180) - vertex[1] * Math.sin(transform.rotation * Math.PI / 180);
    const y = transform.y + vertex[0] * Math.sin(transform.rotation * Math.PI / 180) + vertex[1] * Math.cos(transform.rotation * Math.PI / 180);
    
    polyline += `0
VERTEX
8
${layerName}
10
${x.toFixed(6)}
20
${y.toFixed(6)}
30
0.0
`;
  });
  
  polyline += `0
SEQEND
8
${layerName}
`;
  
  return polyline;
}

function createDXFTriangle(params, transform, layerName) {
  const base = params.base || 30;
  const height = params.height || 40;
  
  const vertices = [
    [-base/2, -height/2],
    [base/2, -height/2],
    [0, height/2],
    [-base/2, -height/2]
  ];
  
  let polyline = `0
POLYLINE
8
${layerName}
66
1
10
0.0
20
0.0
30
0.0
70
1
`;

  vertices.forEach(vertex => {
    const x = transform.x + vertex[0] * Math.cos(transform.rotation * Math.PI / 180) - vertex[1] * Math.sin(transform.rotation * Math.PI / 180);
    const y = transform.y + vertex[0] * Math.sin(transform.rotation * Math.PI / 180) + vertex[1] * Math.cos(transform.rotation * Math.PI / 180);
    
    polyline += `0
VERTEX
8
${layerName}
10
${x.toFixed(6)}
20
${y.toFixed(6)}
30
0.0
`;
  });
  
  polyline += `0
SEQEND
8
${layerName}
`;
  
  return polyline;
}

function createDXFArc(params, transform, layerName) {
  const radius = params.radius || 25;
  const startAngle = params.startAngle || 0;
  const endAngle = params.endAngle || 90;
  
  return `0
ARC
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${radius.toFixed(6)}
50
${startAngle.toFixed(6)}
51
${endAngle.toFixed(6)}
`;
}

function createDXFPath(params, transform, layerName) {
  if (params.isTurtlePath && params.subPaths) {
    let result = '';
    params.subPaths.forEach(subPath => {
      if (subPath.length >= 2) {
        result += createPolylineFromPoints(subPath, transform, layerName, false);
      }
    });
    return result;
  } else if (params.points && params.points.length >= 2) {
    const points = params.points;
    
    if (params.hasHoles || points.includes(null)) {
      return createBooleanPathDXF(points, transform, layerName);
    } else {
      const closed = params.closed !== false;
      return createPolylineFromPoints(points, transform, layerName, closed);
    }
  }
  
  return null;
}

function createDXFText(params, transform, layerName) {
  const text = params.text || '';
  const fontSize = params.fontSize || 8;
  
  return `0
TEXT
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${fontSize.toFixed(6)}
1
${text}
50
${transform.rotation.toFixed(6)}
7
STANDARD
11
${transform.x.toFixed(6)}
21
${transform.y.toFixed(6)}
31
0.0
`;
}

function createDXFDonut(params, transform, layerName) {
  const outerRadius = params.outerRadius || 25;
  const innerRadius = params.innerRadius || 10;
  const startAngle = params.startAngle !== undefined ? params.startAngle : 0;
  const endAngle = params.endAngle !== undefined ? params.endAngle : 360;
  
  let result = '';
  
  if (params.startAngle !== undefined && params.endAngle !== undefined) {
    // Partial donut - use arcs
    const startRad = startAngle * Math.PI / 180;
    const endRad = endAngle * Math.PI / 180;
    
    // Outer arc
    const outerStartX = transform.x + Math.cos(startRad) * outerRadius;
    const outerStartY = transform.y + Math.sin(startRad) * outerRadius;
    const outerEndX = transform.x + Math.cos(endRad) * outerRadius;
    const outerEndY = transform.y + Math.sin(endRad) * outerRadius;
    
    // Inner arc (reverse)
    const innerStartX = transform.x + Math.cos(endRad) * innerRadius;
    const innerStartY = transform.y + Math.sin(endRad) * innerRadius;
    const innerEndX = transform.x + Math.cos(startRad) * innerRadius;
    const innerEndY = transform.y + Math.sin(startRad) * innerRadius;
    
    // Outer arc
    result += `0
ARC
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${outerRadius.toFixed(6)}
50
${startAngle.toFixed(6)}
51
${endAngle.toFixed(6)}
`;
    
    // Inner arc (reverse direction)
    const innerStartAngle = endAngle > startAngle ? endAngle : endAngle + 360;
    const innerEndAngle = startAngle > endAngle ? startAngle : startAngle + 360;
    
    result += `0
ARC
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${innerRadius.toFixed(6)}
50
${innerStartAngle.toFixed(6)}
51
${innerEndAngle.toFixed(6)}
`;
    
    // Add lines to close the path
    result += `0
LINE
8
${layerName}
10
${outerEndX.toFixed(6)}
20
${outerEndY.toFixed(6)}
30
0.0
11
${innerStartX.toFixed(6)}
21
${innerStartY.toFixed(6)}
31
0.0
`;
    
    result += `0
LINE
8
${layerName}
10
${innerEndX.toFixed(6)}
20
${innerEndY.toFixed(6)}
30
0.0
11
${outerStartX.toFixed(6)}
21
${outerStartY.toFixed(6)}
31
0.0
`;
  } else {
    // Full donut - use circles (original behavior)
    result = `0
CIRCLE
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${outerRadius.toFixed(6)}
`;

    result += `0
CIRCLE
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
${innerRadius.toFixed(6)}
`;
  }

  return result;
}

function createDXFArrow(params, transform, layerName) {
  const length = params.length || 50;
  const headWidth = params.headWidth || 10;
  const headLength = params.headLength || 15;
  const bodyWidth = params.bodyWidth || 5;
  
  const vertices = [
    [0, -bodyWidth/2],
    [length - headLength, -bodyWidth/2],
    [length - headLength, -headWidth/2],
    [length, 0],
    [length - headLength, headWidth/2],
    [length - headLength, bodyWidth/2],
    [0, bodyWidth/2],
    [0, -bodyWidth/2]
  ];
  
  return createPolylineFromVertices(vertices, transform, layerName, true);
}

function createDXFSpiral(params, transform, layerName) {
  const startRadius = params.startRadius || 5;
  const endRadius = params.endRadius || 25;
  const turns = params.turns || 3;
  const segments = 100;
  
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * turns * Math.PI * 2;
    const radius = startRadius + (endRadius - startRadius) * t;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    points.push([x, y]);
  }
  
  return createPolylineFromPoints(points, transform, layerName, false);
}

function createDXFCross(params, transform, layerName) {
  const width = params.width || 50;
  const thickness = params.thickness || 10;
  const w = width / 2;
  const t = thickness / 2;
  
  const vertices = [
    [-t, -w], [t, -w], [t, -t], [w, -t],
    [w, t], [t, t], [t, w], [-t, w],
    [-t, t], [-w, t], [-w, -t], [-t, -t],
    [-t, -w]
  ];
  
  return createPolylineFromVertices(vertices, transform, layerName, true);
}

function createDXFWave(params, transform, layerName) {
  const width = params.width || 50;
  const amplitude = params.amplitude || 10;
  const frequency = params.frequency || 2;
  const segments = 50;
  
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments) * width - width / 2;
    const y = Math.sin((x / width) * frequency * Math.PI * 2) * amplitude;
    points.push([x, y]);
  }
  
  return createPolylineFromPoints(points, transform, layerName, false);
}

function createDXFSlot(params, transform, layerName) {
  const length = params.length || 50;
  const width = params.width || 10;
  const radius = width / 2;
  const centerDist = (length - width) / 2;
  
  const segments = 16;
  const vertices = [];
  
  for (let i = segments/2; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = -centerDist + Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    vertices.push([x, y]);
  }
  
  for (let i = 0; i <= segments/2; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = centerDist + Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    vertices.push([x, y]);
  }
  
  return createPolylineFromVertices(vertices, transform, layerName, true);
}

function createDXFGenericShape(type, params, transform, layerName) {
  const size = 30;
  const vertices = [
    [-size/2, -size/2],
    [size/2, -size/2],
    [size/2, size/2],
    [-size/2, size/2],
    [-size/2, -size/2]
  ];
  
  let result = createPolylineFromVertices(vertices, transform, layerName, true);
  
  result += `0
TEXT
8
${layerName}
10
${transform.x.toFixed(6)}
20
${transform.y.toFixed(6)}
30
0.0
40
3.0
1
${type.toUpperCase()}
50
0.0
7
STANDARD
72
1
`;
  
  return result;
}

function createPolylineFromPoints(points, transform, layerName, closed) {
  const vertices = points.filter(p => p !== null).map(p => Array.isArray(p) ? p : [p.x, p.y]);
  if (closed && vertices.length > 0) {
    vertices.push([...vertices[0]]);
  }
  return createPolylineFromVertices(vertices, transform, layerName, closed);
}

function createPolylineFromVertices(vertices, transform, layerName, closed) {
  if (vertices.length < 2) return '';
  
  let polyline = `0
POLYLINE
8
${layerName}
66
1
10
0.0
20
0.0
30
0.0
70
${closed ? 1 : 0}
`;

  vertices.forEach(vertex => {
    const x = transform.x + vertex[0] * Math.cos(transform.rotation * Math.PI / 180) - vertex[1] * Math.sin(transform.rotation * Math.PI / 180);
    const y = transform.y + vertex[0] * Math.sin(transform.rotation * Math.PI / 180) + vertex[1] * Math.cos(transform.rotation * Math.PI / 180);
    
    polyline += `0
VERTEX
8
${layerName}
10
${x.toFixed(6)}
20
${y.toFixed(6)}
30
0.0
`;
  });
  
  polyline += `0
SEQEND
8
${layerName}
`;
  
  return polyline;
}

function createBooleanPathDXF(points, transform, layerName) {
  const nullIndex = points.findIndex(p => p === null);
  
  if (nullIndex === -1) {
    return createPolylineFromPoints(points, transform, layerName, true);
  }
  
  let result = '';
  
  const outerPath = points.slice(0, nullIndex);
  if (outerPath.length >= 3) {
    result += createPolylineFromPoints(outerPath, transform, layerName, true);
  }
  
  let currentIndex = nullIndex + 1;
  while (currentIndex < points.length) {
    const nextNullIndex = points.findIndex((p, i) => i > currentIndex && p === null);
    const endIndex = nextNullIndex !== -1 ? nextNullIndex : points.length;
    
    const innerPath = points.slice(currentIndex, endIndex);
    if (innerPath.length >= 3) {
      result += createPolylineFromPoints(innerPath, transform, layerName, true);
    }
    
    currentIndex = endIndex + 1;
  }
  
  return result;
}

function downloadDXF(dxfString, filename, canvasDims) {
  try {
    const blob = new Blob([dxfString], { 
      type: 'application/dxf;charset=utf-8' 
    });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => URL.revokeObjectURL(url), 100);
    
    console.log(`DXF downloaded as: ${filename}`);
    console.log(`Canvas: ${canvasDims.width}×${canvasDims.height}px (${canvasDims.widthMM.toFixed(1)}×${canvasDims.heightMM.toFixed(1)}mm)`);
    console.log(`Conversion: 1px = ${PIXELS_TO_MM.toFixed(6)}mm`);
    
  } catch (error) {
    console.error('Download failed:', error);
    throw new Error(`Failed to download DXF: ${error.message}`);
  }
}

export { 
  pxToMm, 
  mmToPx, 
  convertDimensionsToDXF, 
  getCanvasDimensions,
  createDXFShapeWithMMConversion 
};
