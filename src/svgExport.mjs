// svgExport.mjs
const MM_TO_PIXELS = 96 / 25.4;


function mmToPx(mmValue) {
  return typeof mmValue === 'number' ? mmValue * MM_TO_PIXELS : mmValue;
}

function convertPosition(position) {
  if (!Array.isArray(position) || position.length < 2) return [0, 0];
  return [mmToPx(position[0]), mmToPx(position[1])];
}

function convertDimensions(params, dimensionKeys) {
  const converted = { ...params };
  dimensionKeys.forEach(key => {
    if (converted[key] !== undefined) {
      converted[key] = mmToPx(converted[key]);
    }
  });
  return converted;
}

function convertPoints(points) {
  if (!Array.isArray(points)) return points;
  return points.map(point => {
    if (point === null) return null;
    if (Array.isArray(point)) return [mmToPx(point[0]), mmToPx(point[1])];
    if (point && typeof point === 'object' && 'x' in point && 'y' in point) {
      return { x: mmToPx(point.x), y: mmToPx(point.y) };
    }
    return point;
  });
}

function getCanvasDimensions(canvas) {
  try {
    const container = canvas.parentElement;
    const canvasWidth = container.clientWidth;
    const canvasHeight = container.clientHeight;
    const scale = Math.min(canvasWidth, canvasHeight) / container.clientWidth;;
    
    return {
      width: canvasWidth,
      height: canvasHeight,
      offsetX: canvasWidth / 2,
      offsetY: canvasHeight / 2,
      scale: scale,
      widthMM: canvasWidth / MM_TO_PIXELS,
      heightMM: canvasHeight / MM_TO_PIXELS
    };
  } catch (error) {
    console.warn('Could not get container dimensions, using fallback');
    return {
      width: 800,
      height: 600,
      offsetX: 400,
      offsetY: 300,
      scale: 1,
      widthMM: 800 / MM_TO_PIXELS,
      heightMM: 600 / MM_TO_PIXELS
    };
  }
}

export function exportToSVG(interpreter, canvas, filename = "aqui_drawing.svg") {
    try {
      if (!interpreter?.env?.shapes) {
        throw new Error('No shapes to export');
      }

      const canvasDims = getCanvasDimensions(canvas);
      
      console.log(`🎨 Exporting ${interpreter.env.shapes.size} shapes to SVG with dynamic canvas sizing...`);
      console.log(`📐 Canvas: ${canvasDims.width}×${canvasDims.height}px (${canvasDims.widthMM.toFixed(1)}×${canvasDims.heightMM.toFixed(1)}mm)`);
      
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      
      svg.setAttribute("xmlns", svgNS);
      svg.setAttribute("width", `${canvasDims.width.toFixed(2)}px`);
      svg.setAttribute("height", `${canvasDims.height.toFixed(2)}px`);
      svg.setAttribute("viewBox", `0 0 ${canvasDims.width.toFixed(2)} ${canvasDims.height.toFixed(2)}`);
      svg.setAttribute("style", "background-color: white;");
      

      const comment = document.createComment(` 
        Canvas: ${canvasDims.width}×${canvasDims.height}px (${canvasDims.widthMM.toFixed(1)}×${canvasDims.heightMM.toFixed(1)}mm)
        Scale: ${canvasDims.scale.toFixed(4)}
        MM to pixels: ${MM_TO_PIXELS.toFixed(4)} px/mm 
      `);
      svg.appendChild(comment);
      

      const defs = document.createElementNS(svgNS, "defs");
      addGradientDefinitions(defs, svgNS);
      svg.appendChild(defs);

      
      const mainGroup = document.createElementNS(svgNS, "g");
      mainGroup.setAttribute("id", "aqui-shapes");
      mainGroup.setAttribute("transform", `translate(${canvasDims.offsetX}, ${canvasDims.offsetY})`);
      svg.appendChild(mainGroup);
      
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
            console.log(` Skipping consumed shape: ${shapeName}`);
            return;
          }
          

          if (!isShapeInAnyLayer(shapeName, interpreter.env.layers)) {
            const shapeElement = createSVGShapeWithMMConversion(shape, shapeName, svgNS, canvasTransform);
            if (shapeElement) {
              mainGroup.appendChild(shapeElement);
              exportedShapes++;
            }
          }
        } catch (error) {
          console.warn(`Failed to export shape ${shapeName}:`, error.message);
        }
      });

      // Process layers with proper grouping
      if (interpreter.env.layers && interpreter.env.layers.size > 0) {
        interpreter.env.layers.forEach((layer, layerName) => {
          try {
            const layerGroup = createLayerGroupWithMMConversion(layer, layerName, interpreter.env.shapes, svgNS, canvasTransform);
            if (layerGroup) {
              mainGroup.appendChild(layerGroup);
              exportedLayers++;
            }
          } catch (error) {
            console.warn(`⚠️ Failed to export layer ${layerName}:`, error.message);
          }
        });
      }

      // Create and trigger download
      const serializer = new XMLSerializer();
      const svgString = formatSVGString(serializer.serializeToString(svg), canvasDims);
      
      downloadSVG(svgString, filename, canvasDims);
      
      console.log(`SVG export completed: ${exportedShapes} shapes, ${exportedLayers} layers`);
      
      return { success: true, shapes: exportedShapes, layers: exportedLayers, canvasDims };
      
    } catch (error) {
      console.error('SVG Export failed:', error);
      return { success: false, error: error.message };
    }
  }

// Helper function to check if shape is in any layer
function isShapeInAnyLayer(shapeName, layers) {
  if (!layers) return false;
  for (const layer of layers.values()) {
    if (layer.addedShapes && layer.addedShapes.has(shapeName)) {
      return true;
    }
  }
  return false;
}

// Create layer group with MM conversion
function createLayerGroupWithMMConversion(layer, layerName, shapes, svgNS, canvasTransform) {
  const layerGroup = document.createElementNS(svgNS, "g");
  layerGroup.setAttribute("id", `layer-${layerName}`);
  layerGroup.setAttribute("data-layer-name", layerName);
  
  let shapeCount = 0;
  
  // Add all shapes from this layer
  if (layer.addedShapes) {
    layer.addedShapes.forEach(shapeName => {
      if (shapes.has(shapeName)) {
        const shape = shapes.get(shapeName);
        // Skip consumed shapes
        if (shape._consumedByBoolean) return;
        
        const shapeElement = createSVGShapeWithMMConversion(shape, shapeName, svgNS, canvasTransform);
        if (shapeElement) {
          layerGroup.appendChild(shapeElement);
          shapeCount++;
        }
      }
    });
  }
  
  return shapeCount > 0 ? layerGroup : null;
}

// Enhanced shape creation with MM to pixels conversion and renderer.mjs coordinate system
function createSVGShapeWithMMConversion(shape, shapeName, svgNS, canvasTransform) {
  if (!shape || !shape.type || !shape.params) {
    console.warn(`Invalid shape data for ${shapeName}`);
    return null;
  }
  
  const { type, params, transform } = shape;
  
  // Convert shape parameters from MM to pixels
  const convertedParams = convertShapeParams(type, params);
  
  let element = null;
  
  try {
    switch (type) {
      case 'path':
        element = createSVGPathMM(convertedParams, svgNS);
        break;
      case 'bspline':
        element = createSVGPathMM(convertedParams, svgNS);
        break;
      case 'circle':
        element = createSVGCircleMM(convertedParams, svgNS);
        break;
      case 'rectangle':
        element = createSVGRectangleMM(convertedParams, svgNS);
        break;
      case 'ellipse':
        element = createSVGEllipseMM(convertedParams, svgNS);
        break;
      case 'polygon':
        element = createSVGPolygonMM(convertedParams, svgNS);
        break;
      case 'star':
        element = createSVGStarMM(convertedParams, svgNS);
        break;
      case 'triangle':
        element = createSVGTriangleMM(convertedParams, svgNS);
        break;
      case 'text':
        element = createSVGTextMM(convertedParams, svgNS);
        break;
      case 'arc':
        element = createSVGArcMM(convertedParams, svgNS);
        break;
      case 'roundedRectangle':
        element = createSVGRoundedRectangleMM(convertedParams, svgNS);
        break;
      case 'donut':
        element = createSVGDonutMM(convertedParams, svgNS);
        break;
      case 'gear':
        element = createSVGGearMM(convertedParams, svgNS);
        break;
      case 'arrow':
        element = createSVGArrowMM(convertedParams, svgNS);
        break;
      case 'spiral':
        element = createSVGSpiralMM(convertedParams, svgNS);
        break;
      case 'cross':
        element = createSVGCrossMM(convertedParams, svgNS);
        break;
      case 'wave':
        element = createSVGWaveMM(convertedParams, svgNS);
        break;
      case 'slot':
        element = createSVGSlotMM(convertedParams, svgNS);
        break;
      case 'chamferRectangle':
        element = createSVGChamferRectangleMM(convertedParams, svgNS);
        break;
      default:
        console.warn(`SVG export: Using generic export for shape type: ${type}`);
        element = createSVGGenericShapeMM(type, convertedParams, svgNS);
    }
    
    if (element) {
      // Add shape metadata
      element.setAttribute("data-shape-name", shapeName);
      element.setAttribute("data-shape-type", type);
      element.setAttribute("data-original-mm-params", JSON.stringify(params));
      
      // Apply styling with converted parameters
      applyShapeStyleMM(element, convertedParams);
      
      // Apply transform with renderer.mjs coordinate system
      applyRendererTransformToSVG(element, transform, canvasTransform);
    }
    
    return element;
    
  } catch (error) {
    console.error(`Error creating SVG element for ${type}:`, error);
    return createSVGGenericShapeMM(type, convertedParams, svgNS);
  }
}

// Convert shape parameters based on shape type
function convertShapeParams(type, params) {
  switch (type) {
    case 'circle':
      return convertDimensions(params, ['radius']);
    
    case 'rectangle':
    case 'roundedRectangle':
    case 'chamferRectangle':
      return convertDimensions(params, ['width', 'height', 'radius', 'chamfer']);
    
    case 'ellipse':
      return convertDimensions(params, ['radiusX', 'radiusY']);
    
    case 'polygon':
    case 'arc':
      return convertDimensions(params, ['radius']);
    
    case 'star':
      return convertDimensions(params, ['outerRadius', 'innerRadius']);
    
    case 'triangle':
      return convertDimensions(params, ['base', 'height']);
    
    case 'text':
      return convertDimensions(params, ['fontSize']);
    
    case 'donut':
      return convertDimensions(params, ['outerRadius', 'innerRadius']);
    
    case 'gear':
      return convertDimensions(params, ['diameter']);
    
    case 'arrow':
      return convertDimensions(params, ['length', 'headWidth', 'headLength', 'bodyWidth']);
    
    case 'spiral':
      return convertDimensions(params, ['startRadius', 'endRadius']);
    
    case 'cross':
      return convertDimensions(params, ['width', 'thickness']);
    
    case 'wave':
      return convertDimensions(params, ['width', 'amplitude']);
    
    case 'slot':
      return convertDimensions(params, ['length', 'width']);
    
    case 'path':
      const converted = { ...params };
      if (converted.points) {
        converted.points = convertPoints(converted.points);
      }
      if (converted.subPaths) {
        converted.subPaths = converted.subPaths.map(path => convertPoints(path));
      }
      return convertDimensions(converted, ['strokeWidth', 'thickness']);
    
    case 'bspline':
      const bsplineConverted = { ...params };
      if (bsplineConverted.points) {
        bsplineConverted.points = convertPoints(bsplineConverted.points);
      }
      return convertDimensions(bsplineConverted, ['strokeWidth', 'thickness']);
    
    default:
      // For unknown types, convert common dimension properties
      return convertDimensions(params, ['width', 'height', 'radius', 'strokeWidth', 'thickness']);
  }
}

// Apply transform matching renderer.mjs coordinate system
function applyRendererTransformToSVG(element, transform, canvasTransform) {
  if (!transform) return;
  
  // Get world coordinates (same as renderer.mjs)
  const worldX = transform.position?.[0] || 0;
  const worldY = transform.position?.[1] || 0;
  const rotation = transform.rotation || 0;
  const scale = transform.scale || [1, 1];
  
  // Transform to screen coordinates (matching renderer.mjs transformX/transformY)
  const screenX = worldX * canvasTransform.scale * canvasTransform.zoomLevel + canvasTransform.panOffset.x;
  const screenY = -worldY * canvasTransform.scale * canvasTransform.zoomLevel + canvasTransform.panOffset.y;
  
  // Apply canvas scaling to the shape itself
  const finalScaleX = scale[0];
  const finalScaleY = scale[1];
  
  let transformStr = '';
  
  // Translate to screen position (relative to center because mainGroup already translates to center)
  if (screenX !== 0 || screenY !== 0) {
    transformStr += `translate(${screenX.toFixed(3)}, ${screenY.toFixed(3)}) `;
  }
  
  // Apply rotation (negative because canvas Y is flipped)
  if (rotation !== 0) {
    transformStr += `rotate(${(-rotation).toFixed(3)}) `;
  }
  
  // Apply final scaling (matching renderer scale calculation)
  if (finalScaleX !== canvasTransform.scale * canvasTransform.zoomLevel || 
      finalScaleY !== canvasTransform.scale * canvasTransform.zoomLevel) {
    transformStr += `scale(${finalScaleX.toFixed(6)}, ${finalScaleY.toFixed(6)}) `;
  } else if (canvasTransform.scale !== 1) {
    // Apply default canvas scaling
    transformStr += `scale(${(canvasTransform.scale * canvasTransform.zoomLevel).toFixed(6)}) `;
  }
  
  if (transformStr.trim()) {
    element.setAttribute("transform", transformStr.trim());
  }
}

// Enhanced styling with MM conversion for stroke width
function applyShapeStyleMM(element, convertedParams) {
  // Stroke styling
  const strokeColor = convertedParams.strokeColor || convertedParams.color || "#000000";
  const strokeWidth = convertedParams.strokeWidth || convertedParams.thickness || mmToPx(0.5); // Default 0.5mm stroke
  element.setAttribute("stroke", strokeColor);
  element.setAttribute("stroke-width", strokeWidth.toFixed(3));
  
  // Fill styling with boolean operation support
  let fill = "none";
  
  // Handle boolean operation results
  if (convertedParams.operation) {
    switch (convertedParams.operation) {
      case 'difference': 
        fill = convertedParams.fillColor || '#FF572280';
        break;
      case 'union': 
        fill = convertedParams.fillColor || '#4CAF5080';
        break;
      case 'intersection': 
        fill = convertedParams.fillColor || '#2196F380';
        break;
      default: 
        fill = convertedParams.fillColor || '#808080';
    }
  } else if (convertedParams.fill === true || convertedParams.filled === true) {
    fill = convertedParams.fillColor || convertedParams.color || "rgba(0, 0, 0, 0.1)";
  } else if (convertedParams.fill === false || convertedParams.filled === false) {
    fill = "none";
  } else if (convertedParams.fillColor) {
    fill = convertedParams.fillColor;
  } else if (convertedParams.color && !convertedParams.strokeColor) {
    fill = addAlphaToColor(convertedParams.color, 0.1);
  }
  
  element.setAttribute("fill", fill);
  
  // Special handling for boolean operations with holes
  if (convertedParams.hasHoles || (convertedParams.points && convertedParams.points.includes(null))) {
    element.setAttribute("fill-rule", "evenodd");
  }
  
  // Additional styling options
  if (convertedParams.opacity !== undefined) {
    element.setAttribute("opacity", convertedParams.opacity);
  }
  
  if (convertedParams.strokeDashArray) {
    element.setAttribute("stroke-dasharray", convertedParams.strokeDashArray);
  }
  
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
}

// MM-converted shape creators
function createSVGCircleMM(params, svgNS) {
  const circle = document.createElementNS(svgNS, "circle");
  circle.setAttribute("cx", 0);
  circle.setAttribute("cy", 0);
  circle.setAttribute("r", (params.radius || mmToPx(25)).toFixed(3)); // Default 25mm radius
  return circle;
}

function createSVGRectangleMM(params, svgNS) {
  const rect = document.createElementNS(svgNS, "rect");
  const width = params.width || mmToPx(50);
  const height = params.height || mmToPx(50);
  rect.setAttribute("x", (-width/2).toFixed(3));
  rect.setAttribute("y", (-height/2).toFixed(3));
  rect.setAttribute("width", width.toFixed(3));
  rect.setAttribute("height", height.toFixed(3));
  return rect;
}

function createSVGRoundedRectangleMM(params, svgNS) {
  const rect = document.createElementNS(svgNS, "rect");
  const width = params.width || mmToPx(50);
  const height = params.height || mmToPx(50);
  const radius = params.radius || mmToPx(5);
  
  rect.setAttribute("x", (-width/2).toFixed(3));
  rect.setAttribute("y", (-height/2).toFixed(3));
  rect.setAttribute("width", width.toFixed(3));
  rect.setAttribute("height", height.toFixed(3));
  rect.setAttribute("rx", radius.toFixed(3));
  rect.setAttribute("ry", radius.toFixed(3));
  return rect;
}

function createSVGEllipseMM(params, svgNS) {
  const ellipse = document.createElementNS(svgNS, "ellipse");
  ellipse.setAttribute("cx", 0);
  ellipse.setAttribute("cy", 0);
  ellipse.setAttribute("rx", (params.radiusX || mmToPx(25)).toFixed(3));
  ellipse.setAttribute("ry", (params.radiusY || mmToPx(15)).toFixed(3));
  return ellipse;
}

function createSVGPolygonMM(params, svgNS) {
  const polygon = document.createElementNS(svgNS, "polygon");
  const sides = params.sides || 6;
  const radius = params.radius || mmToPx(25);
  let points = "";
  
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    points += `${x.toFixed(3)},${y.toFixed(3)} `;
  }
  
  polygon.setAttribute("points", points.trim());
  return polygon;
}

function createSVGStarMM(params, svgNS) {
  const star = document.createElementNS(svgNS, "polygon");
  const outerRadius = params.outerRadius || mmToPx(25);
  const innerRadius = params.innerRadius || mmToPx(10);
  const points = params.points || 5;
  let pointsStr = "";
  
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    pointsStr += `${x.toFixed(3)},${y.toFixed(3)} `;
  }
  
  star.setAttribute("points", pointsStr.trim());
  return star;
}

function createSVGTriangleMM(params, svgNS) {
  const triangle = document.createElementNS(svgNS, "polygon");
  const base = params.base || mmToPx(30);
  const height = params.height || mmToPx(40);
  const points = `${(-base/2).toFixed(3)},${(-height/2).toFixed(3)} ${(base/2).toFixed(3)},${(-height/2).toFixed(3)} 0,${(height/2).toFixed(3)}`;
  
  triangle.setAttribute("points", points);
  return triangle;
}

function createSVGTextMM(params, svgNS) {
  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", 0);
  text.setAttribute("y", 0);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("font-family", params.fontFamily || "Arial, sans-serif");
  text.setAttribute("font-size", (params.fontSize || mmToPx(8)).toFixed(1)); // Default 8mm font
  
  if (params.fontWeight) {
    text.setAttribute("font-weight", params.fontWeight);
  }
  
  text.textContent = params.text || "";
  return text;
}

function createSVGArrowMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const length = params.length || mmToPx(50);
  const headWidth = params.headWidth || mmToPx(10);
  const headLength = params.headLength || mmToPx(15);
  const bodyWidth = params.bodyWidth || mmToPx(5);
  
  const pathData = `M 0,${(-bodyWidth/2).toFixed(3)} L ${(length - headLength).toFixed(3)},${(-bodyWidth/2).toFixed(3)} L ${(length - headLength).toFixed(3)},${(-headWidth/2).toFixed(3)} L ${length.toFixed(3)},0 L ${(length - headLength).toFixed(3)},${(headWidth/2).toFixed(3)} L ${(length - headLength).toFixed(3)},${(bodyWidth/2).toFixed(3)} L 0,${(bodyWidth/2).toFixed(3)} Z`;
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGSpiralMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const startRadius = params.startRadius || mmToPx(5);
  const endRadius = params.endRadius || mmToPx(25);
  const turns = params.turns || 3;
  const segments = 100;
  
  let pathData = "";
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * turns * Math.PI * 2;
    const radius = startRadius + (endRadius - startRadius) * t;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    if (i === 0) {
      pathData += `M ${x.toFixed(3)} ${y.toFixed(3)}`;
    } else {
      pathData += ` L ${x.toFixed(3)} ${y.toFixed(3)}`;
    }
  }
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGCrossMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const width = params.width || mmToPx(50);
  const thickness = params.thickness || mmToPx(10);
  const w = width / 2;
  const t = thickness / 2;
  
  const pathData = `M ${(-t).toFixed(3)},${(-w).toFixed(3)} L ${t.toFixed(3)},${(-w).toFixed(3)} L ${t.toFixed(3)},${(-t).toFixed(3)} L ${w.toFixed(3)},${(-t).toFixed(3)} L ${w.toFixed(3)},${t.toFixed(3)} L ${t.toFixed(3)},${t.toFixed(3)} L ${t.toFixed(3)},${w.toFixed(3)} L ${(-t).toFixed(3)},${w.toFixed(3)} L ${(-t).toFixed(3)},${t.toFixed(3)} L ${(-w).toFixed(3)},${t.toFixed(3)} L ${(-w).toFixed(3)},${(-t).toFixed(3)} L ${(-t).toFixed(3)},${(-t).toFixed(3)} Z`;
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGWaveMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const width = params.width || mmToPx(50);
  const amplitude = params.amplitude || mmToPx(10);
  const frequency = params.frequency || 2;
  const segments = 50;
  
  let pathData = "";
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments) * width - width / 2;
    const y = Math.sin((x / width) * frequency * Math.PI * 2) * amplitude;
    
    if (i === 0) {
      pathData += `M ${x.toFixed(3)} ${y.toFixed(3)}`;
    } else {
      pathData += ` L ${x.toFixed(3)} ${y.toFixed(3)}`;
    }
  }
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGSlotMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const length = params.length || mmToPx(50);
  const width = params.width || mmToPx(10);
  const radius = width / 2;
  const centerDist = (length - width) / 2;
  
  const pathData = `M ${(-centerDist).toFixed(3)},${(-radius).toFixed(3)} A ${radius.toFixed(3)},${radius.toFixed(3)} 0 0,1 ${(-centerDist).toFixed(3)},${radius.toFixed(3)} L ${centerDist.toFixed(3)},${radius.toFixed(3)} A ${radius.toFixed(3)},${radius.toFixed(3)} 0 0,1 ${centerDist.toFixed(3)},${(-radius).toFixed(3)} Z`;
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGChamferRectangleMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const width = params.width || mmToPx(50);
  const height = params.height || mmToPx(50);
  const chamfer = params.chamfer || mmToPx(5);
  const w = width / 2;
  const h = height / 2;
  const c = Math.min(chamfer, width / 2, height / 2);
  
  const pathData = `M ${(-w + c).toFixed(3)},${(-h).toFixed(3)} L ${(w - c).toFixed(3)},${(-h).toFixed(3)} L ${w.toFixed(3)},${(-h + c).toFixed(3)} L ${w.toFixed(3)},${(h - c).toFixed(3)} L ${(w - c).toFixed(3)},${h.toFixed(3)} L ${(-w + c).toFixed(3)},${h.toFixed(3)} L ${(-w).toFixed(3)},${(h - c).toFixed(3)} L ${(-w).toFixed(3)},${(-h + c).toFixed(3)} Z`;
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGArcMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const radius = params.radius || mmToPx(25);
  const startAngle = (params.startAngle || 0) * Math.PI / 180;
  const endAngle = (params.endAngle || 90) * Math.PI / 180;
  
  const startX = Math.cos(startAngle) * radius;
  const startY = Math.sin(startAngle) * radius;
  const endX = Math.cos(endAngle) * radius;
  const endY = Math.sin(endAngle) * radius;
  
  const largeArcFlag = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
  const pathData = `M ${startX.toFixed(3)} ${startY.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArcFlag} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`;
  
  path.setAttribute("d", pathData);
  return path;
}

function createSVGDonutMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const outerRadius = params.outerRadius || mmToPx(25);
  const innerRadius = params.innerRadius || mmToPx(10);
  const startAngle = params.startAngle !== undefined ? params.startAngle * Math.PI / 180 : 0;
  const endAngle = params.endAngle !== undefined ? params.endAngle * Math.PI / 180 : 2 * Math.PI;
  
  let pathData = '';
  
  if (params.startAngle !== undefined && params.endAngle !== undefined) {
    // Partial donut (arc segment)
    const startRad = startAngle;
    const endRad = endAngle;
    let angleSpan = endRad - startRad;
    
    // Normalize angle span
    if (angleSpan < 0) angleSpan += 2 * Math.PI;
    if (angleSpan > 2 * Math.PI) angleSpan -= 2 * Math.PI;
    
    const largeArcFlag = angleSpan > Math.PI ? 1 : 0;
    
    // Outer arc
    const outerStartX = Math.cos(startRad) * outerRadius;
    const outerStartY = Math.sin(startRad) * outerRadius;
    const outerEndX = Math.cos(endRad) * outerRadius;
    const outerEndY = Math.sin(endRad) * outerRadius;
    
    // Inner arc (reverse direction)
    const innerStartX = Math.cos(endRad) * innerRadius;
    const innerStartY = Math.sin(endRad) * innerRadius;
    const innerEndX = Math.cos(startRad) * innerRadius;
    const innerEndY = Math.sin(startRad) * innerRadius;
    
    pathData = `M ${outerStartX.toFixed(3)},${outerStartY.toFixed(3)} A ${outerRadius.toFixed(3)},${outerRadius.toFixed(3)} 0 ${largeArcFlag},1 ${outerEndX.toFixed(3)},${outerEndY.toFixed(3)} L ${innerStartX.toFixed(3)},${innerStartY.toFixed(3)} A ${innerRadius.toFixed(3)},${innerRadius.toFixed(3)} 0 ${largeArcFlag},0 ${innerEndX.toFixed(3)},${innerEndY.toFixed(3)} Z`;
  } else {
    // Full donut (original behavior)
    pathData = `M ${outerRadius.toFixed(3)},0 A ${outerRadius.toFixed(3)},${outerRadius.toFixed(3)} 0 1,0 ${(-outerRadius).toFixed(3)},0 A ${outerRadius.toFixed(3)},${outerRadius.toFixed(3)} 0 1,0 ${outerRadius.toFixed(3)},0 M ${innerRadius.toFixed(3)},0 A ${innerRadius.toFixed(3)},${innerRadius.toFixed(3)} 0 1,1 ${(-innerRadius).toFixed(3)},0 A ${innerRadius.toFixed(3)},${innerRadius.toFixed(3)} 0 1,1 ${innerRadius.toFixed(3)},0`;
  }
  
  path.setAttribute("d", pathData);
  path.setAttribute("fill-rule", "evenodd");
  return path;
}

function createSVGGearMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  const teeth = params.teeth || 12;
  const diameter = params.diameter || mmToPx(50);
  const r = diameter / 2;
  const toothHeight = r * 0.2;
  
  let pathData = "";
  
  for (let i = 0; i < teeth; i++) {
    const angle1 = (i / teeth) * Math.PI * 2;
    const angle2 = ((i + 0.3) / teeth) * Math.PI * 2;
    const angle3 = ((i + 0.7) / teeth) * Math.PI * 2;
    const angle4 = ((i + 1) / teeth) * Math.PI * 2;
    
    const x1 = Math.cos(angle1) * r;
    const y1 = Math.sin(angle1) * r;
    const x2 = Math.cos(angle2) * r;
    const y2 = Math.sin(angle2) * r;
    const x3 = Math.cos(angle2) * (r + toothHeight);
    const y3 = Math.sin(angle2) * (r + toothHeight);
    const x4 = Math.cos(angle3) * (r + toothHeight);
    const y4 = Math.sin(angle3) * (r + toothHeight);
    const x5 = Math.cos(angle3) * r;
    const y5 = Math.sin(angle3) * r;
    const x6 = Math.cos(angle4) * r;
    const y6 = Math.sin(angle4) * r;
    
    if (i === 0) {
      pathData += `M ${x1.toFixed(3)},${y1.toFixed(3)}`;
    }
    
    pathData += ` L ${x2.toFixed(3)},${y2.toFixed(3)} L ${x3.toFixed(3)},${y3.toFixed(3)} L ${x4.toFixed(3)},${y4.toFixed(3)} L ${x5.toFixed(3)},${y5.toFixed(3)} L ${x6.toFixed(3)},${y6.toFixed(3)}`;
  }
  
  pathData += " Z";
  path.setAttribute("d", pathData);
  return path;
}

function createSVGPathMM(params, svgNS) {
  const path = document.createElementNS(svgNS, "path");
  let pathData = "";

  if (params.isTurtlePath && params.subPaths) {
    // For turtle paths, draw each subpath
    pathData = params.subPaths.map(subPath => {
      if (subPath.length < 2) return "";
      
      let subPathData = `M ${subPath[0][0].toFixed(3)} ${subPath[0][1].toFixed(3)}`;
      for (let i = 1; i < subPath.length; i++) {
        subPathData += ` L ${subPath[i][0].toFixed(3)} ${subPath[i][1].toFixed(3)}`;
      }
      return subPathData;
    }).join(" ");
    
  } else if (params.isBezier && params.points) {
    const pts = params.points;
    if (pts.length >= 4) {
      pathData = `M ${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)} C ${pts[1][0].toFixed(3)} ${pts[1][1].toFixed(3)}, ${pts[2][0].toFixed(3)} ${pts[2][1].toFixed(3)}, ${pts[3][0].toFixed(3)} ${pts[3][1].toFixed(3)}`;
    }
    
  } else if (params.points && params.points.length >= 2) {
    const pts = params.points;
    

    if (params.hasHoles || pts.includes(null)) {
      pathData = createBooleanPathData(pts);
    } else {
      // Regular path
      pathData = `M ${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)}`;
      
      for (let i = 1; i < pts.length; i++) {
        if (pts[i] === null) continue; // Skip null separators
        pathData += ` L ${pts[i][0].toFixed(3)} ${pts[i][1].toFixed(3)}`;
      }
      
      if (params.closed !== false && pts.length > 2) {
        pathData += " Z";
      }
    }
  }

  if (pathData) {
    path.setAttribute("d", pathData);
    return path;
  }
  
  return null;
}

// Handle boolean operation paths with holes
function createBooleanPathData(points) {
  if (!points || points.length === 0) return "";
  
  const nullIndex = points.findIndex(p => p === null);
  
  if (nullIndex === -1) {
    // No holes, simple path
    let pathData = `M ${points[0][0].toFixed(3)} ${points[0][1].toFixed(3)}`;
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i][0].toFixed(3)} ${points[i][1].toFixed(3)}`;
    }
    return pathData + " Z";
  }
  
  // Has holes - outer path + inner path(s)
  let pathData = "";
  
  // Outer path
  const outerPath = points.slice(0, nullIndex);
  if (outerPath.length >= 3) {
    pathData += `M ${outerPath[0][0].toFixed(3)} ${outerPath[0][1].toFixed(3)}`;
    for (let i = 1; i < outerPath.length; i++) {
      pathData += ` L ${outerPath[i][0].toFixed(3)} ${outerPath[i][1].toFixed(3)}`;
    }
    pathData += " Z";
  }
  
  // Inner path(s) - holes
  let currentIndex = nullIndex + 1;
  while (currentIndex < points.length) {
    const nextNullIndex = points.findIndex((p, i) => i > currentIndex && p === null);
    const endIndex = nextNullIndex !== -1 ? nextNullIndex : points.length;
    
    const innerPath = points.slice(currentIndex, endIndex);
    if (innerPath.length >= 3) {
      pathData += ` M ${innerPath[0][0].toFixed(3)} ${innerPath[0][1].toFixed(3)}`;
      for (let i = 1; i < innerPath.length; i++) {
        pathData += ` L ${innerPath[i][0].toFixed(3)} ${innerPath[i][1].toFixed(3)}`;
      }
      pathData += " Z";
    }
    
    currentIndex = endIndex + 1;
  }
  
  return pathData;
}
function createSVGGenericShapeMM(type, params, svgNS) {
  const group = document.createElementNS(svgNS, "g");
  

  const size = mmToPx(30);
  const rect = document.createElementNS(svgNS, "rect");
  rect.setAttribute("x", (-size/2).toFixed(3));
  rect.setAttribute("y", (-size/2).toFixed(3));
  rect.setAttribute("width", size.toFixed(3));
  rect.setAttribute("height", size.toFixed(3));
  rect.setAttribute("fill", "rgba(255, 0, 0, 0.1)");
  rect.setAttribute("stroke", "red");
  rect.setAttribute("stroke-width", mmToPx(0.5).toFixed(3));
  rect.setAttribute("stroke-dasharray", "5,5");
  
  group.appendChild(rect);
  

  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", 0);
  text.setAttribute("y", 0);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("font-family", "Arial, sans-serif");
  text.setAttribute("font-size", mmToPx(6).toFixed(1))
  text.setAttribute("fill", "red");
  text.textContent = type.toUpperCase();
  
  group.appendChild(text);
  
  return group;
}


function addAlphaToColor(color, alpha) {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } else if (color.startsWith('rgb')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}


function addGradientDefinitions(defs, svgNS) {
  const gradient = document.createElementNS(svgNS, "linearGradient");
  gradient.setAttribute("id", "defaultGradient");
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "100%");
  gradient.setAttribute("y2", "100%");
  
  const stop1 = document.createElementNS(svgNS, "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", "#FF5722");
  stop1.setAttribute("stop-opacity", "0.8");
  
  const stop2 = document.createElementNS(svgNS, "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("stop-color", "#FF9800");
  stop2.setAttribute("stop-opacity", "0.4");
  
  gradient.appendChild(stop1);
  gradient.appendChild(stop2);
  defs.appendChild(gradient);
}

function formatSVGString(svgString, canvasDims) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by Aqui Design Tool -->
<!-- Canvas: ${canvasDims.width}×${canvasDims.height}px (${canvasDims.widthMM.toFixed(1)}×${canvasDims.heightMM.toFixed(1)}mm) -->
<!-- Scale: ${canvasDims.scale.toFixed(4)} -->
<!-- MM to pixels: ${MM_TO_PIXELS.toFixed(4)} px/mm -->
${svgString}`;
}

function downloadSVG(svgString, filename, canvasDims) {
  try {
    const blob = new Blob([svgString], { 
      type: 'image/svg+xml;charset=utf-8' 
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
    
    console.log(`SVG downloaded as: ${filename}`);
    console.log(`Canvas: ${canvasDims.width}×${canvasDims.height}px (${canvasDims.widthMM.toFixed(1)}×${canvasDims.heightMM.toFixed(1)}mm)`);
    console.log(` Conversion: 1mm = ${MM_TO_PIXELS.toFixed(4)}px, Scale: ${canvasDims.scale.toFixed(4)}`);
    
  } catch (error) {
    console.error(' Download failed:', error);
    throw new Error(`Failed to download SVG: ${error.message}`);
  }
}

export { createSVGShapeWithMMConversion, applyShapeStyleMM, addAlphaToColor, applyRendererTransformToSVG, mmToPx, getCanvasDimensions };
