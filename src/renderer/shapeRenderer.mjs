import {
  Rectangle,
  Circle,
  Triangle,
  Ellipse,
  RegularPolygon,
  Star,
  Arc,
  RoundedRectangle,
  Arrow,
  Text,
  BezierCurve,
  Donut,
  Spiral,
  Cross,
  Wave,
  Slot,
  ChamferRectangle,
  PolygonWithHoles,
  DovetailPin,
  DovetailTail,
  FingerJointPin,
  FingerJointSocket,
  HalfLapMale,
  HalfLapFemale,
  CrossLapVertical,
  CrossLapHorizontal,
  SlotBoard,
  TabBoard,
  FingerCombMale,
  FingerCombFemale,
  RabbetJoint,
  RabbetPlain,
  FlexureMesh,
  Bspline,
} from "../Shapes.mjs";

export class ShapeRenderer {
  constructor(ctx) {
    this.ctx = ctx;
  }

  renderText(params, styleContext, isSelected, isHovered) {
    if (!params.text) return false;

    const {
      text,
      fontSize = 12,
      fontFamily = "Inter, Arial, sans-serif",
    } = params;
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    if (styleContext.shouldFill) {
      this.ctx.fillText(text, 0, 0);
    }

    if (params.strokeText || isSelected) {
      this.ctx.strokeText(text, 0, 0);
    }

    return true;
  }

  renderGear(params, styleContext, isSelected, isHovered) {
    const teeth = params.teeth || 12;
    const diameter = params.diameter || 50;
    const shaftType = params.shaft || "round";
    const shaftSize = params.shaftSize || 10;

    const r = diameter / 2;
    const toothHeight = r * 0.2;

    this.ctx.beginPath();

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
        this.ctx.moveTo(x1, y1);
      }

      this.ctx.lineTo(x2, y2);
      this.ctx.lineTo(x3, y3);
      this.ctx.lineTo(x4, y4);
      this.ctx.lineTo(x5, y5);
      this.ctx.lineTo(x6, y6);
    }

    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();

    this.ctx.beginPath();
    if (shaftType === "square") {
      const halfSize = shaftSize / 2;
      this.ctx.rect(-halfSize, -halfSize, shaftSize, shaftSize);
    } else {
      this.ctx.arc(0, 0, shaftSize / 2, 0, Math.PI * 2);
    }
    this.ctx.fillStyle = styleContext.fillColor;
    this.ctx.fill();
    this.ctx.stroke();

    return true;
  }

  renderBezier(params, styleContext, isSelected, isHovered) {
    if (!params.controlPoints || params.controlPoints.length < 4) return false;

    const points = params.controlPoints;

    this.ctx.beginPath();
    this.ctx.moveTo(points[0][0], points[0][1]);
    this.ctx.bezierCurveTo(
      points[1][0],
      points[1][1],
      points[2][0],
      points[2][1],
      points[3][0],
      points[3][1],
    );

    this.ctx.stroke();

    if (isSelected || params.showControlPoints) {
      this.ctx.save();
      this.ctx.setLineDash([3, 3]);
      this.ctx.strokeStyle = "#999999";
      this.ctx.lineWidth = 1;

      this.ctx.beginPath();
      this.ctx.moveTo(points[0][0], points[0][1]);
      this.ctx.lineTo(points[1][0], points[1][1]);
      this.ctx.moveTo(points[2][0], points[2][1]);
      this.ctx.lineTo(points[3][0], points[3][1]);
      this.ctx.stroke();

      for (let i = 0; i < 4; i++) {
        this.ctx.beginPath();
        this.ctx.arc(points[i][0], points[i][1], 3, 0, Math.PI * 2);
        this.ctx.fillStyle = i === 0 || i === 3 ? "#FF5722" : "#2196F3";
        this.ctx.fill();
      }

      this.ctx.restore();
    }

    return true;
  }

  renderBspline(params, styleContext, isSelected, isHovered) {
    if (!params.points || params.points.length < 2) return false;
    
    const splineInstance = this.createShapeInstance("bspline", params);
    if (!splineInstance) return false;
    
    const numControlPoints = params.points.length;
    const baseSegments = Math.max(200, numControlPoints * 30);
    const points = splineInstance.getPoints(baseSegments);
    if (!points || points.length === 0) return false;
    
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    
    if (params.closed === true) {
      this.ctx.closePath();
      if (styleContext.shouldFill) {
        this.ctx.fill();
      }
    }
    
    this.ctx.stroke();
    
    if (isSelected && params.showControlPoints !== false) {
      this.renderBsplineControlPoints(params.points);
    }
    
    return true;
  }

  renderBsplineControlPoints(controlPoints = []) {
    if (controlPoints.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = "#999999";
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);

    this.ctx.beginPath();
    this.ctx.moveTo(controlPoints[0][0], controlPoints[0][1]);
    for (let i = 1; i < controlPoints.length; i++) {
      this.ctx.lineTo(controlPoints[i][0], controlPoints[i][1]);
    }
    this.ctx.stroke();

    this.ctx.setLineDash([]);
    for (let i = 0; i < controlPoints.length; i++) {
      this.ctx.beginPath();
      this.ctx.arc(controlPoints[i][0], controlPoints[i][1], 4, 0, Math.PI * 2);
      this.ctx.fillStyle = "#2196F3";
      this.ctx.fill();
      this.ctx.strokeStyle = "#000000";
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  renderGenericShape(type, params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance(type, params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }

    // Close the path for all shapes except open paths
    // Donut should always close (even partial donuts form closed shapes)
    if (!["arc", "path", "wave"].includes(type) || type === "donut") {
      this.ctx.closePath();

      // Only fill if explicitly requested (this respects fill: false)
      if (styleContext.shouldFill) {
        this.ctx.fill();
      }
    }

    // Always stroke the outline
    this.ctx.stroke();
    return true;
  }
  createShapeInstance(type, params) {
    try {
      switch (type) {
        case "rectangle":
          return new Rectangle(params.width || 100, params.height || 100);
        case "circle":
          return new Circle(params.radius || 50);
        case "triangle":
          return new Triangle(params.base || 60, params.height || 80);
        case "ellipse":
          return new Ellipse(params.radiusX || 60, params.radiusY || 40);
        case "polygon":
          return new RegularPolygon(params.radius || 50, params.sides || 6);
        case "star":
          return new Star(
            params.outerRadius || 50,
            params.innerRadius || 20,
            params.points || 5,
          );
        case "rabbetJoint":
          return new RabbetJoint(
            params.width || 120,
            params.height || 80,
            params.rabbetWidth || 30,
            params.rabbetDepth || 40,
          );
        case "rabbetPlain":
          return new RabbetPlain(
            params.width || 120,
            params.height || 80,
            params.rabbetWidth || 30,
            params.rabbetDepth || 40,
          );

        case "crossLapVertical":
          return new CrossLapVertical(
            params.width || 100,
            params.height || 100,
            params.slotWidth || 40,
            params.slotDepth || 50,
            params.slotPosition || 50,
          );
        case "crossLapHorizontal":
          return new CrossLapHorizontal(
            params.width || 100,
            params.height || 100,
            params.slotWidth || 40,
            params.slotDepth || 50,
            params.slotPosition || 50,
          );
        case "arc":
          return new Arc(
            params.radius || 50,
            params.startAngle || 0,
            params.endAngle || 90,
          );
        case "roundedRectangle":
          return new RoundedRectangle(
            params.width || 100,
            params.height || 100,
            params.radius || 10,
          );
        case "arrow":
          return new Arrow(
            params.length || 100,
            params.headWidth || 30,
            params.headLength || 25,
          );
        case "slotBoard":
          return new SlotBoard(
            params.width || 120,
            params.height || 40,
            params.slotCount || 3,
            params.slotWidth || 20,
            params.slotDepth || 20,
            params.slotPosition !== undefined ? params.slotPosition : 0,
          );
        case "tabBoard":
          return new TabBoard(
            params.width || 120,
            params.height || 40,
            params.tabCount || 3,
            params.tabWidth || 20,
            params.tabDepth || 20,
          );
        case "donut":
          const startAngle = params.startAngle != null ? Number(params.startAngle) : undefined;
          const endAngle = params.endAngle != null ? Number(params.endAngle) : undefined;
          console.log('[shapeRenderer createShapeInstance donut]', {
            params,
            startAngle,
            endAngle,
            startAngleType: typeof startAngle,
            endAngleType: typeof endAngle,
            startAngleRaw: params.startAngle,
            endAngleRaw: params.endAngle
          });
          return new Donut(
            params.outerRadius || 50, 
            params.innerRadius || 20,
            startAngle,
            endAngle
          );
        case "spiral":
          return new Spiral(
            params.startRadius || 10,
            params.endRadius || 50,
            params.turns || 3,
          );
        case "cross":
          return new Cross(params.width || 100, params.thickness || 20);
        case "wave":
          return new Wave(
            params.width || 100,
            params.amplitude || 20,
            params.frequency || 2,
          );
        case "slot":
          return new Slot(params.length || 100, params.width || 20);
        case "chamferRectangle":
          return new ChamferRectangle(
            params.width || 100,
            params.height || 100,
            params.chamfer || 10,
          );
        case "dovetailPin":
          return new DovetailPin(
            params.width || 200,
            params.jointCount || 5,
            params.depth || 50,
            params.angle || 12,
            params.thickness || 20,
          );
        case "dovetailTail":
          return new DovetailTail(
            params.width || 200,
            params.jointCount || 5,
            params.depth || 50,
            params.angle || 12,
            params.thickness || 20,
          );
        case "fingerJointPin":
          return new FingerJointPin(
            params.width || 200,
            params.fingerCount || 6,
            params.fingerWidth || null,
            params.depth || 50,
            params.thickness || 20,
          );
        case "fingerJointSocket":
          return new FingerJointSocket(
            params.width || 200,
            params.fingerCount || 6,
            params.fingerWidth || null,
            params.depth || 50,
            params.thickness || 20,
          );
        case "fingerCombMale":
          return new FingerCombMale(
            params.width || 200,
            params.height || 80,
            params.toothCount || 8,
            params.toothDepth || 15,
          );
        case "fingerCombFemale":
          return new FingerCombFemale(
            params.width || 200,
            params.height || 80,
            params.toothCount || 8,
            params.toothDepth || 15,
          );
        case "halfLapMale":
          return new HalfLapMale(
            params.width || 100,
            params.height || 50,
            params.lapLength || 40,
            params.lapDepth || 25,
          );
        case "halfLapFemale":
          return new HalfLapFemale(
            params.width || 100,
            params.height || 50,
            params.lapLength || 40,
            params.lapDepth || 25,
          );
        case "flexureMesh":
          return new FlexureMesh(
            params.totalWidth || 200,
            params.totalHeight || 100,
            params.slotLength || 30,
            params.slotWidth || 6,
            params.bridgeWidth || 6,
            params.rowSpacing || 15,
            params.staggerOffset !== undefined ? params.staggerOffset : 0.5,
            params.cornerRadius || 3,
            params.pattern || "staggered",
          );
        case "polygonWithHoles":
          return new PolygonWithHoles(
            params.outerPoints || [],
            params.holes || [],
          );
      case "bspline":
        return new Bspline(
          params.points || [[0, 0], [50, 50], [100, 0]],
          params.closed === true,
          params.degree || 3
        );
        default:
          return new Rectangle(100, 100);
      }
    } catch (error) {
      return new Rectangle(100, 100);
    }
  }

  calculateShapeBounds(type, params) {
    switch (type) {
      case "rectangle":
      case "roundedRectangle":
      case "chamferRectangle":
        return {
          x: -(params.width || 100) / 2,
          y: -(params.height || 100) / 2,
          width: params.width || 100,
          height: params.height || 100,
        };

      case "rabbetJoint":
      case "rabbetPlain":
        const rabbetWidth = params.width || 120;
        const rabbetHeight = params.height || 80;
        return {
          x: -rabbetWidth / 2,
          y: -rabbetHeight / 2,
          width: rabbetWidth,
          height: rabbetHeight,
        };

      case "circle":
        const radius = params.radius || 50;
        return {
          x: -radius,
          y: -radius,
          width: radius * 2,
          height: radius * 2,
        };

      case "flexureMesh":
        const meshWidth = params.totalWidth || 200;
        const meshHeight = params.totalHeight || 100;
        return {
          x: -meshWidth / 2,
          y: -meshHeight / 2,
          width: meshWidth,
          height: meshHeight,
        };

      case "slotBoard":
        return new SlotBoard(
          params.width || 120,
          params.height || 40,
          params.slotCount || 3,
          params.slotWidth || 20,
          params.slotDepth || 20,
          params.slotPosition !== undefined ? params.slotPosition : 0, // FIXED: Check for undefined
        );
      case "tabBoard":
        const slotTabWidth = params.width || 120;
        const slotTabHeight = params.height || 40;
        const tabDepth = params.tabDepth || 20;
        return {
          x: -slotTabWidth / 2,
          y: -(slotTabHeight + tabDepth) / 2,
          width: slotTabWidth,
          height: slotTabHeight + tabDepth,
        };

      case "triangle":
        return {
          x: -(params.base || 60) / 2,
          y: -(params.height || 80) / 2,
          width: params.base || 60,
          height: params.height || 80,
        };

      case "ellipse":
        return {
          x: -(params.radiusX || 60),
          y: -(params.radiusY || 40),
          width: (params.radiusX || 60) * 2,
          height: (params.radiusY || 40) * 2,
        };

      case "polygon":
      case "arc":
        const polyRadius = params.radius || 50;
        return {
          x: -polyRadius,
          y: -polyRadius,
          width: polyRadius * 2,
          height: polyRadius * 2,
        };

      case "star":
        const starRadius = params.outerRadius || 50;
        return {
          x: -starRadius,
          y: -starRadius,
          width: starRadius * 2,
          height: starRadius * 2,
        };
      case "dovetailPin":
      case "dovetailTail":
        const dovetailWidth = params.width || 200;
        const dovetailDepth = params.depth || 50;
        const dovetailThickness = params.thickness || 20;
        return {
          x: -dovetailWidth / 2,
          y: -(dovetailDepth + dovetailThickness) / 2,
          width: dovetailWidth,
          height: dovetailDepth + dovetailThickness,
        };

      case "halfLapMale":
      case "halfLapFemale":
        const lapWidth = params.width || 100;
        const lapHeight = params.height || 50;
        return {
          x: -lapWidth / 2,
          y: -lapHeight / 2,
          width: lapWidth,
          height: lapHeight,
        };

      case "donut":
        const donutRadius = params.outerRadius || 50;
        // For partial donuts (with startAngle/endAngle), calculate tighter bounds
        if (params.startAngle != null && params.endAngle != null) {
          const startRad = (Number(params.startAngle) * Math.PI) / 180;
          const endRad = (Number(params.endAngle) * Math.PI) / 180;
          let angleSpan = endRad - startRad;
          if (angleSpan < 0) angleSpan += 2 * Math.PI;
          
          // Calculate bounding box for the arc segment
          const angles = [];
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            angles.push(startRad + t * angleSpan);
          }
          // Include start and end points of both outer and inner arcs
          angles.push(startRad, endRad);
          
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          angles.forEach(angle => {
            const outerX = Math.cos(angle) * donutRadius;
            const outerY = Math.sin(angle) * donutRadius;
            const innerX = Math.cos(angle) * (params.innerRadius || 20);
            const innerY = Math.sin(angle) * (params.innerRadius || 20);
            minX = Math.min(minX, outerX, innerX);
            maxX = Math.max(maxX, outerX, innerX);
            minY = Math.min(minY, outerY, innerY);
            maxY = Math.max(maxY, outerY, innerY);
          });
          
          return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          };
        }
        // Full donut - use circular bounds
        return {
          x: -donutRadius,
          y: -donutRadius,
          width: donutRadius * 2,
          height: donutRadius * 2,
        };

      case "spiral":
        const spiralRadius = Math.max(
          params.startRadius || 10,
          params.endRadius || 50,
        );
        return {
          x: -spiralRadius,
          y: -spiralRadius,
          width: spiralRadius * 2,
          height: spiralRadius * 2,
        };

      case "cross":
        const crossWidth = params.width || 100;
        return {
          x: -crossWidth / 2,
          y: -crossWidth / 2,
          width: crossWidth,
          height: crossWidth,
        };

      case "gear":
        const gearRadius = (params.diameter || 50) / 2;
        return {
          x: -gearRadius,
          y: -gearRadius,
          width: gearRadius * 2,
          height: gearRadius * 2,
        };

      case "arrow":
        const arrowLength = params.length || 100;
        const arrowHeight = Math.max(
          params.headWidth || 30,
          params.bodyWidth || 10,
        );
        return {
          x: -(params.bodyWidth || 10) / 2,
          y: -arrowHeight / 2,
          width: arrowLength,
          height: arrowHeight,
        };

      case "text":
        const fontSize = params.fontSize || 12;
        const textLength = (params.text || "").length;
        const estimatedWidth = fontSize * 0.6 * textLength;
        return {
          x: -estimatedWidth / 2,
          y: -fontSize / 2,
          width: estimatedWidth,
          height: fontSize,
        };

      case "fingerJointPin":
      case "fingerJointSocket":
        const fingerWidth = params.width || 200;
        const fingerDepth = params.depth || 50;
        const fingerThickness = params.thickness || 20;
        return {
          x: -fingerWidth / 2,
          y: -(fingerDepth + fingerThickness) / 2,
          width: fingerWidth,
          height: fingerDepth + fingerThickness,
        };
      case "crossLapVertical":
      case "crossLapHorizontal":
        const cWidth = params.width || 100;
        const crossHeight = params.height || 100;
        return {
          x: -cWidth / 2,
          y: -crossHeight / 2,
          width: crossWidth,
          height: crossHeight,
        };

      case "wave":
        const waveWidth = params.width || 100;
        const waveHeight = (params.amplitude || 20) * 2;
        return {
          x: -waveWidth / 2,
          y: -waveHeight / 2,
          width: waveWidth,
          height: waveHeight,
        };

      case "fingerCombMale":
      case "fingerCombFemale":
        const combWidth = params.width || 200;
        const combDepth = params.depth || 50;
        const combThickness = params.thickness || 20;
        return {
          x: -combWidth / 2,
          y: -(combDepth + combThickness) / 2,
          width: combWidth,
          height: combDepth + combThickness,
        };

      case "slot":
        const slotLength = params.length || 100;
        const slotWidth = params.width || 20;
        return {
          x: -slotLength / 2,
          y: -slotWidth / 2,
          width: slotLength,
          height: slotWidth,
        };

      default:
        return { x: -50, y: -50, width: 100, height: 100 };
    }
  }

  getShapeComplexity(type) {
    const curvedShapes = [
      "circle",
      "ellipse",
      "arc",
      "roundedRectangle",
      "spiral",
      "donut",
      "wave",
    ];
    const complexShapes = ["star", "gear", "bezier"];

    if (complexShapes.includes(type)) return "complex";
    if (curvedShapes.includes(type)) return "curved";
    return "simple";
  }

  getOptimalResolution(type, params) {
    const complexity = this.getShapeComplexity(type);

    switch (complexity) {
      case "complex":
        return 128;
      case "curved":
        return 64;
      default:
        return 32;
    }
  }

  renderDovetailPin(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("dovetailPin", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    // Save current stroke settings
    this.ctx.save();

    // Force thin, clean stroke for dovetail outlines
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000"; // Always black outline

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }

    this.ctx.closePath();

    // Only fill if explicitly requested
    if (styleContext.shouldFill) {
      this.ctx.fill();
    }

    // Always stroke with thin line
    this.ctx.stroke();

    // Restore context
    this.ctx.restore();

    return true;
  }

  renderFlexureMesh(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("flexureMesh", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 0.5;
    this.ctx.strokeStyle = "#000000";

    // Draw main material body first (like the red acrylic)
    this.ctx.fillStyle = styleContext.fillColor || "#dc2626"; // Red acrylic color

    // Find outer perimeter (first 5 points)
    const outerPoints = points.slice(0, 5);
    this.ctx.beginPath();
    this.ctx.moveTo(outerPoints[0].x, outerPoints[0].y);
    for (let i = 1; i < outerPoints.length; i++) {
      this.ctx.lineTo(outerPoints[i].x, outerPoints[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();

    // Cut out slots using destination-out compositing (like laser cutting)
    this.ctx.globalCompositeOperation = "destination-out";
    this.ctx.fillStyle = "black"; // Color doesn't matter for destination-out

    // Draw slot cutouts (remaining points after the outer boundary)
    if (points.length > 5) {
      let currentIndex = 5;
      while (currentIndex < points.length) {
        // Find next complete slot path
        const slotStart = currentIndex;
        let slotEnd = currentIndex;

        // Find the end of this slot (look for return to start point or significant jump)
        for (let i = currentIndex + 1; i < points.length; i++) {
          const dist = Math.sqrt(
            Math.pow(points[i].x - points[slotStart].x, 2) +
            Math.pow(points[i].y - points[slotStart].y, 2),
          );
          if (dist < 1) {
            // Found closure point
            slotEnd = i;
            break;
          }
          if (i === points.length - 1) {
            // End of array
            slotEnd = i;
            break;
          }
        }

        // Draw this slot cutout
        if (slotEnd > slotStart) {
          this.ctx.beginPath();
          this.ctx.moveTo(points[slotStart].x, points[slotStart].y);
          for (let i = slotStart + 1; i <= slotEnd; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
          }
          this.ctx.closePath();
          this.ctx.fill();
        }

        currentIndex = slotEnd + 1;
      }
    }

    this.ctx.globalCompositeOperation = "source-over"; // Reset blend mode
    this.ctx.restore();
    return true;
  }

  renderDovetailTail(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("dovetailTail", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    // Save current stroke settings
    this.ctx.save();

    // Force thin, clean stroke for dovetail outlines
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000"; // Always black outline

    // For dovetail tail, we need to render the outer shape and cut out the sockets
    // The points array contains both outer perimeter and socket cutouts

    // Find where the outer rectangle ends (first 5 points form the outer rectangle)
    const outerPoints = points.slice(0, 5);

    this.ctx.beginPath();
    this.ctx.moveTo(outerPoints[0].x, outerPoints[0].y);
    for (let i = 1; i < outerPoints.length; i++) {
      this.ctx.lineTo(outerPoints[i].x, outerPoints[i].y);
    }
    this.ctx.closePath();

    // Fill the outer shape first if requested
    if (styleContext.shouldFill) {
      this.ctx.fill();
    }

    // Stroke the outer perimeter
    this.ctx.stroke();

    // Now cut out the dovetail sockets (draw them as separate paths)
    if (points.length > 5) {
      let currentIndex = 5;
      while (currentIndex < points.length) {
        // Each socket cutout should be 5 points (including closure)
        const socketPoints = points.slice(currentIndex, currentIndex + 5);
        if (socketPoints.length >= 4) {
          this.ctx.beginPath();
          this.ctx.moveTo(socketPoints[0].x, socketPoints[0].y);
          for (let i = 1; i < socketPoints.length - 1; i++) {
            this.ctx.lineTo(socketPoints[i].x, socketPoints[i].y);
          }
          this.ctx.closePath();

          // Cut out the socket (use white fill and black stroke)
          this.ctx.fillStyle = styleContext.shouldFill
            ? "#FFFFFF"
            : "transparent";
          this.ctx.fill();
          this.ctx.stroke();
        }
        currentIndex += 5;
      }
    }

    // Restore context
    this.ctx.restore();

    return true;
  }

  renderCross(params, styleContext, isSelected, isHovered) {
    const width = params.width || 100;
    const w = width / 2;

    // Save current stroke settings
    this.ctx.save();

    // Force thin stroke for cross lines (ignore thickness parameter)
    this.ctx.lineWidth = Math.max(styleContext.strokeWidth || 2, 1);

    // Draw vertical line
    this.ctx.beginPath();
    this.ctx.moveTo(0, -w);
    this.ctx.lineTo(0, w);
    this.ctx.stroke();

    // Draw horizontal line
    this.ctx.beginPath();
    this.ctx.moveTo(-w, 0);
    this.ctx.lineTo(w, 0);
    this.ctx.stroke();

    // Restore stroke settings
    this.ctx.restore();

    return true;
  }

  renderFingerJointPin(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("fingerJointPin", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();

    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }

    this.ctx.closePath();

    // Only fill if explicitly requested
    if (styleContext.shouldFill) {
      this.ctx.fill();
    }

    // Always stroke with thin line
    this.ctx.stroke();

    // Restore context
    this.ctx.restore();

    return true;
  }

  renderHalfLapMale(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("halfLapMale", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderHalfLapFemale(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("halfLapFemale", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderFingerCombMale(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("fingerCombMale", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderFingerCombFemale(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("fingerCombMale", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderFingerJointSocket(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("fingerJointSocket", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    // Save current stroke settings
    this.ctx.save();

    // Force thin, clean stroke
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    // Draw outer rectangle (first 5 points)
    const outerPoints = points.slice(0, 5);

    this.ctx.beginPath();
    this.ctx.moveTo(outerPoints[0].x, outerPoints[0].y);
    for (let i = 1; i < outerPoints.length; i++) {
      this.ctx.lineTo(outerPoints[i].x, outerPoints[i].y);
    }
    this.ctx.closePath();

    // Fill and stroke outer shape
    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();

    // Draw socket cutouts (remaining points in groups of 5)
    if (points.length > 5) {
      let currentIndex = 5;
      while (currentIndex + 4 < points.length) {
        const cutoutPoints = points.slice(currentIndex, currentIndex + 5);

        this.ctx.beginPath();
        this.ctx.moveTo(cutoutPoints[0].x, cutoutPoints[0].y);
        for (let i = 1; i < 4; i++) {
          // Only use first 4 points for rectangle
          this.ctx.lineTo(cutoutPoints[i].x, cutoutPoints[i].y);
        }
        this.ctx.closePath();

        // Cut out the socket (white fill)
        this.ctx.fillStyle = "#FFFFFF";
        this.ctx.fill();
        this.ctx.strokeStyle = "#000000";
        this.ctx.stroke();

        currentIndex += 5;
      }
    }

    this.ctx.restore();
    return true;
  }
  renderCrossLapVertical(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("crossLapVertical", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderCrossLapHorizontal(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance(
      "crossLapHorizontal",
      params,
    );
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderSlotBoard(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("slotBoard", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    // Draw outer rectangle (first 5 points)
    const outerPoints = points.slice(0, 5);

    this.ctx.beginPath();
    this.ctx.moveTo(outerPoints[0].x, outerPoints[0].y);
    for (let i = 1; i < outerPoints.length; i++) {
      this.ctx.lineTo(outerPoints[i].x, outerPoints[i].y);
    }
    this.ctx.closePath();

    // Fill and stroke outer shape first
    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();

    // Draw slot cutouts (remaining points in groups of 5)
    if (points.length > 5) {
      let currentIndex = 5;
      while (currentIndex + 4 < points.length) {
        const slotPoints = points.slice(currentIndex, currentIndex + 5);

        this.ctx.beginPath();
        this.ctx.moveTo(slotPoints[0].x, slotPoints[0].y);
        for (let i = 1; i < 4; i++) {
          // Only use first 4 points for rectangle
          this.ctx.lineTo(slotPoints[i].x, slotPoints[i].y);
        }
        this.ctx.closePath();

        // Cut out the slot with white fill and black outline
        this.ctx.fillStyle = "#FFFFFF"; // Force white fill for cutouts
        this.ctx.fill();
        this.ctx.strokeStyle = "#000000";
        this.ctx.stroke();

        currentIndex += 5;
      }
    }

    this.ctx.restore();
    return true;
  }

  renderRabbetJoint(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("rabbetJoint", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderRabbetPlain(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("rabbetPlain", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }

  renderTabBoard(params, styleContext, isSelected, isHovered) {
    const shapeInstance = this.createShapeInstance("tabBoard", params);
    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints();
    if (!points || points.length === 0) return false;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = "#000000";

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.closePath();

    if (styleContext.shouldFill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
    this.ctx.restore();
    return true;
  }
  renderShapeWithOptimization(
    type,
    params,
    styleContext,
    isSelected,
    isHovered,
  ) {
    // Special handling for cross - always use simple line rendering
    if (type === "cross") {
      return this.renderCross(params, styleContext, isSelected, isHovered);
    }

    if (type === "dovetailPin") {
      return this.renderDovetailPin(
        params,
        styleContext,
        isSelected,
        isHovered,
      );
    }

    if (type === "dovetailTail") {
      return this.renderDovetailTail(
        params,
        styleContext,
        isSelected,
        isHovered,
      );
    }

    const complexity = this.getShapeComplexity(type);

    if (complexity === "simple") {
      return this.renderGenericShape(
        type,
        params,
        styleContext,
        isSelected,
        isHovered,
      );
    }

    const resolution = this.getOptimalResolution(type, params);
    const shapeInstance = this.createShapeInstance(type, params);

    if (!shapeInstance) return false;

    const points = shapeInstance.getPoints(resolution);
    if (!points || points.length === 0) return false;

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }

    if (complexity !== "curved" || type === "donut") {
      this.ctx.closePath();
      if (styleContext.shouldFill) {
        this.ctx.fill();
      }
    }

    this.ctx.stroke();
    return true;
  }
}
