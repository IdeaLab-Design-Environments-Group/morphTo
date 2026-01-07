// Base Shape class with common functionality
class Shape {
  constructor() {
    this.position = { x: 0, y: 0 };
    this.rotation = 0;
    this.scale = { x: 1, y: 1 };
  }

  translate(dx, dy) {
    this.position.x += dx;
    this.position.y += dy;
    return this;
  }

  rotate(angle) {
    this.rotation = (this.rotation + angle) % 360;
    return this;
  }

  setScale(sx, sy) {
    this.scale.x = sx;
    this.scale.y = sy;
    return this;
  }

  getBoundingBox() {
    // To be implemented by subclasses
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Helper method to transform points
  transformPoint(point) {
    const rad = (this.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Apply scale
    const scaledX = point.x * this.scale.x;
    const scaledY = point.y * this.scale.y;

    // Apply rotation
    const rotatedX = scaledX * cos - scaledY * sin;
    const rotatedY = scaledX * sin + scaledY * cos;

    // Apply translation
    return {
      x: rotatedX + this.position.x,
      y: rotatedY + this.position.y,
    };
  }
}

// 1. Rectangle
class Rectangle extends Shape {
  constructor(width, height) {
    super();
    this.width = width;
    this.height = height;
  }

  getPoints() {
    const points = [
      { x: -this.width / 2, y: -this.height / 2 },
      { x: this.width / 2, y: -this.height / 2 },
      { x: this.width / 2, y: this.height / 2 },
      { x: -this.width / 2, y: this.height / 2 },
    ];
    return points.map((p) => this.transformPoint(p));
  }
}

// 2. Circle
class Circle extends Shape {
  constructor(radius) {
    super();
    this.radius = radius;
  }

  getPoints(segments = 32) {
    const points = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * this.radius,
        y: Math.sin(angle) * this.radius,
      });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 3. Triangle
class Triangle extends Shape {
  constructor(base, height) {
    super();
    this.base = base;
    this.height = height;
  }

  getPoints() {
    const points = [
      { x: -this.base / 2, y: -this.height / 2 },
      { x: this.base / 2, y: -this.height / 2 },
      { x: 0, y: this.height / 2 },
    ];
    return points.map((p) => this.transformPoint(p));
  }
}

// 4. Ellipse
class Ellipse extends Shape {
  constructor(radiusX, radiusY) {
    super();
    this.radiusX = radiusX;
    this.radiusY = radiusY;
  }

  getPoints(segments = 32) {
    const points = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * this.radiusX,
        y: Math.sin(angle) * this.radiusY,
      });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 5. Regular Polygon
class RegularPolygon extends Shape {
  constructor(radius, sides) {
    super();
    this.radius = radius;
    this.sides = sides;
  }

  getPoints() {
    const points = [];
    for (let i = 0; i < this.sides; i++) {
      const angle = (i / this.sides) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * this.radius,
        y: Math.sin(angle) * this.radius,
      });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 6. Star
class Star extends Shape {
  constructor(outerRadius, innerRadius, points) {
    super();
    this.outerRadius = outerRadius;
    this.innerRadius = innerRadius;
    this.points = points;
  }

  getPoints() {
    const points = [];
    for (let i = 0; i < this.points * 2; i++) {
      const angle = (i / (this.points * 2)) * Math.PI * 2;
      const radius = i % 2 === 0 ? this.outerRadius : this.innerRadius;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 7. Arc
class Arc extends Shape {
  constructor(radius, startAngle, endAngle) {
    super();
    this.radius = radius;
    this.startAngle = startAngle;
    this.endAngle = endAngle;
  }

  getPoints(segments = 32) {
    const points = [];
    const angleSpan = this.endAngle - this.startAngle;
    for (let i = 0; i <= segments; i++) {
      const angle = this.startAngle + (i / segments) * angleSpan;
      const rad = (angle * Math.PI) / 180;
      points.push({
        x: Math.cos(rad) * this.radius,
        y: Math.sin(rad) * this.radius,
      });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 8. RoundedRectangle
class RoundedRectangle extends Shape {
  constructor(width, height, radius) {
    super();
    this.width = width;
    this.height = height;
    this.radius = Math.min(radius, width / 2, height / 2);
  }

  getPoints(segmentsPerCorner = 8) {
    const points = [];
    const w = this.width / 2;
    const h = this.height / 2;
    const r = this.radius;

    // If radius is 0, return regular rectangle
    if (r <= 0) {
      return [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ].map((p) => this.transformPoint(p));
    }

    // Start from top-left corner and go clockwise

    // Top edge (left to right)
    points.push({ x: -w + r, y: -h });
    points.push({ x: w - r, y: -h });

    // Top-right corner arc
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const angle = -Math.PI / 2 + (i / segmentsPerCorner) * (Math.PI / 2);
      points.push({
        x: w - r + Math.cos(angle) * r,
        y: -h + r + Math.sin(angle) * r,
      });
    }

    // Right edge (top to bottom)
    points.push({ x: w, y: -h + r });
    points.push({ x: w, y: h - r });

    // Bottom-right corner arc
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const angle = 0 + (i / segmentsPerCorner) * (Math.PI / 2);
      points.push({
        x: w - r + Math.cos(angle) * r,
        y: h - r + Math.sin(angle) * r,
      });
    }

    // Bottom edge (right to left)
    points.push({ x: w - r, y: h });
    points.push({ x: -w + r, y: h });

    // Bottom-left corner arc
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const angle = Math.PI / 2 + (i / segmentsPerCorner) * (Math.PI / 2);
      points.push({
        x: -w + r + Math.cos(angle) * r,
        y: h - r + Math.sin(angle) * r,
      });
    }

    // Left edge (bottom to top)
    points.push({ x: -w, y: h - r });
    points.push({ x: -w, y: -h + r });

    // Top-left corner arc
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const angle = Math.PI + (i / segmentsPerCorner) * (Math.PI / 2);
      points.push({
        x: -w + r + Math.cos(angle) * r,
        y: -h + r + Math.sin(angle) * r,
      });
    }

    return points.map((p) => this.transformPoint(p));
  }
}

// 9. Path
class Path extends Shape {
  constructor() {
    super();
    this.points = [];
    this.closed = false;
  }

  addPoint(x, y) {
    this.points.push({ x, y });
    return this;
  }

  close() {
    this.closed = true;
    return this;
  }

  getPoints() {
    return this.points.map((p) => this.transformPoint(p));
  }
}

// 10. Arrow
class Arrow extends Shape {
  constructor(length, headWidth, headLength) {
    super();
    this.length = length;
    this.headWidth = headWidth;
    this.headLength = headLength;
  }

  getPoints() {
    const points = [
      { x: 0, y: 0 },
      { x: this.length - this.headLength, y: 0 },
      { x: this.length - this.headLength, y: -this.headWidth / 2 },
      { x: this.length, y: 0 },
      { x: this.length - this.headLength, y: this.headWidth / 2 },
      { x: this.length - this.headLength, y: 0 },
    ];
    return points.map((p) => this.transformPoint(p));
  }
}

// 11. Text (Bounding box for text)
class Text extends Shape {
  constructor(text, fontSize = 12, fontFamily = "Arial") {
    super();
    this.text = text;
    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    // Rough estimation of text dimensions
    this.width = this.fontSize * 0.6 * this.text.length;
    this.height = this.fontSize;
  }

  getBoundingBox() {
    return {
      x: this.position.x,
      y: this.position.y,
      width: this.width,
      height: this.height,
    };
  }
}

class BezierCurve extends Shape {
  constructor(startPoint, controlPoint1, controlPoint2, endPoint) {
    super();
    this.start = startPoint;
    this.cp1 = controlPoint1;
    this.cp2 = controlPoint2;
    this.end = endPoint;
  }

  getPoints(segments = 100) {
    const points = [];

    // Calculate points along the curve using Bézier formula
    for (let t = 0; t <= 1; t += 1 / segments) {
      const point = this.getPointAtT(t);
      points.push(point);
    }

    return points.map((p) => this.transformPoint(p));
  }

  getPointAtT(t) {
    // Cubic Bézier formula: B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    return {
      x:
        mt3 * this.start[0] +
        3 * mt2 * t * this.cp1[0] +
        3 * mt * t2 * this.cp2[0] +
        t3 * this.end[0],
      y:
        mt3 * this.start[1] +
        3 * mt2 * t * this.cp1[1] +
        3 * mt * t2 * this.cp2[1] +
        t3 * this.end[1],
    };
  }

  draw(ctx) {
    ctx.save();
    this.transform(ctx);

    ctx.beginPath();
    ctx.moveTo(this.start[0], this.start[1]);
    ctx.bezierCurveTo(
      this.cp1[0],
      this.cp1[1],
      this.cp2[0],
      this.cp2[1],
      this.end[0],
      this.end[1],
    );

    // Set line style
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.restore();
  }
}

// 13. Donut (Annulus)
class Donut extends Shape {
  constructor(outerRadius, innerRadius, startAngle = undefined, endAngle = undefined) {
    super();
    this.outerRadius = outerRadius;
    this.innerRadius = innerRadius;
    this.startAngle = startAngle;
    this.endAngle = endAngle;
    console.log('[Donut constructor]', {
      outerRadius,
      innerRadius,
      startAngle,
      endAngle,
      startAngleType: typeof startAngle,
      endAngleType: typeof endAngle,
      startAngleIsNaN: isNaN(startAngle),
      endAngleIsNaN: isNaN(endAngle)
    });
  }

  getPoints(segments = 64) {
    const points = [];
    
    // If startAngle and endAngle are provided, create a partial donut (arc segment)
    // Check if they are numbers (not undefined, null, or NaN)
    const hasStartAngle = typeof this.startAngle === 'number' && !isNaN(this.startAngle);
    const hasEndAngle = typeof this.endAngle === 'number' && !isNaN(this.endAngle);
    
    console.log('[Donut getPoints]', {
      hasStartAngle,
      hasEndAngle,
      startAngle: this.startAngle,
      endAngle: this.endAngle,
      startAngleType: typeof this.startAngle,
      endAngleType: typeof this.endAngle
    });
    
    if (hasStartAngle && hasEndAngle) {
      const startRad = (this.startAngle * Math.PI) / 180;
      const endRad = (this.endAngle * Math.PI) / 180;
      let angleSpan = endRad - startRad;
      
      // Normalize angle span to be in the range [0, 2π]
      if (angleSpan < 0) angleSpan += 2 * Math.PI;
      if (angleSpan > 2 * Math.PI) angleSpan -= 2 * Math.PI;
      
      // Outer arc
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = startRad + t * angleSpan;
        points.push({
          x: Math.cos(angle) * this.outerRadius,
          y: Math.sin(angle) * this.outerRadius,
        });
      }
      
      // Connect to inner arc at end angle
      points.push({
        x: Math.cos(endRad) * this.innerRadius,
        y: Math.sin(endRad) * this.innerRadius,
      });
      
      // Inner arc (in reverse to create hole)
      for (let i = segments; i >= 0; i--) {
        const t = i / segments;
        const angle = startRad + t * angleSpan;
        points.push({
          x: Math.cos(angle) * this.innerRadius,
          y: Math.sin(angle) * this.innerRadius,
        });
      }
      
      // Close the path by connecting back to the start of outer circle
      points.push({
        x: Math.cos(startRad) * this.outerRadius,
        y: Math.sin(startRad) * this.outerRadius,
      });
    } else {
      // Full donut (original behavior)
      // Outer circle
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push({
          x: Math.cos(angle) * this.outerRadius,
          y: Math.sin(angle) * this.outerRadius,
        });
      }

      // Add a line to the inner circle start
      points.push({
        x: Math.cos(0) * this.innerRadius,
        y: Math.sin(0) * this.innerRadius,
      });

      // Inner circle (in reverse to create hole)
      for (let i = segments; i >= 0; i--) {
        const angle = (i / segments) * Math.PI * 2;
        points.push({
          x: Math.cos(angle) * this.innerRadius,
          y: Math.sin(angle) * this.innerRadius,
        });
      }

      // Close the path by connecting back to the start of outer circle
      points.push({
        x: Math.cos(0) * this.outerRadius,
        y: Math.sin(0) * this.outerRadius,
      });
    }

    return points.map((p) => this.transformPoint(p));
  }
}

// 14. Spiral
class Spiral extends Shape {
  constructor(startRadius, endRadius, turns) {
    super();
    this.startRadius = startRadius;
    this.endRadius = endRadius;
    this.turns = turns;
  }

  getPoints(segments = 100) {
    const points = [];
    const totalAngle = this.turns * Math.PI * 2;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * totalAngle;
      const radius = this.startRadius + (this.endRadius - this.startRadius) * t;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 15. Cross

class Cross extends Shape {
  constructor(width, thickness) {
    super();
    this.width = width;
    this.thickness = thickness;
  }

  getPoints() {
    const w = this.width / 2;
    const t = this.thickness / 2;

    // Simple cross outline points - like rectangle but for cross shape
    const points = [
      { x: -t, y: -w }, // Top-left of vertical
      { x: t, y: -w }, // Top-right of vertical
      { x: t, y: -t }, // Inner corner
      { x: w, y: -t }, // Top-right of horizontal
      { x: w, y: t }, // Bottom-right of horizontal
      { x: t, y: t }, // Inner corner
      { x: t, y: w }, // Bottom-right of vertical
      { x: -t, y: w }, // Bottom-left of vertical
      { x: -t, y: t }, // Inner corner
      { x: -w, y: t }, // Bottom-left of horizontal
      { x: -w, y: -t }, // Top-left of horizontal
      { x: -t, y: -t }, // Inner corner (back to start)
    ];

    return points.map((p) => this.transformPoint(p));
  }
}

// 16. Gear
class Gear extends Shape {
  constructor(pitch_diameter, teeth, pressure_angle = 20) {
    super();
    this.pitch_diameter = pitch_diameter;
    this.teeth = teeth;
    this.pressure_angle = (pressure_angle * Math.PI) / 180;
    this.addendum = this.pitch_diameter / this.teeth;
    this.dedendum = 1.25 * this.addendum;
  }

  getPoints(points_per_tooth = 4) {
    const points = [];
    const pitch_point = this.pitch_diameter / 2;
    const base_radius = pitch_point * Math.cos(this.pressure_angle);
    const outer_radius = pitch_point + this.addendum;
    const root_radius = pitch_point - this.dedendum;

    for (let i = 0; i < this.teeth; i++) {
      const angle = (i / this.teeth) * Math.PI * 2;
      for (let j = 0; j < points_per_tooth; j++) {
        const t = j / points_per_tooth;
        const tooth_angle = (Math.PI * 2) / (this.teeth * 2);
        const current_angle = angle + tooth_angle * t;

        // Generate tooth profile
        const radius = t < 0.5 ? outer_radius : root_radius;
        points.push({
          x: Math.cos(current_angle) * radius,
          y: Math.sin(current_angle) * radius,
        });
      }
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 17. Wave
class Wave extends Shape {
  constructor(width, amplitude, frequency) {
    super();
    this.width = width;
    this.amplitude = amplitude;
    this.frequency = frequency;
  }

  getPoints(segments = 50) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * this.width - this.width / 2;
      const y =
        Math.sin((x * this.frequency * Math.PI * 2) / this.width) *
        this.amplitude;
      points.push({ x, y });
    }
    return points.map((p) => this.transformPoint(p));
  }
}

// 18. Slot
class Slot extends Shape {
  constructor(length, width) {
    super();
    this.length = length;
    this.width = width;
    this.radius = width / 2;
  }

  getPoints(segments = 32) {
    const points = [];
    const centerDist = (this.length - this.width) / 2;

    // Add right semicircle
    for (let i = 0; i <= segments / 2; i++) {
      const angle = -Math.PI / 2 + (i / (segments / 2)) * Math.PI;
      points.push({
        x: centerDist + Math.cos(angle) * this.radius,
        y: Math.sin(angle) * this.radius,
      });
    }

    // Add left semicircle
    for (let i = 0; i <= segments / 2; i++) {
      const angle = Math.PI / 2 + (i / (segments / 2)) * Math.PI;
      points.push({
        x: -centerDist + Math.cos(angle) * this.radius,
        y: Math.sin(angle) * this.radius,
      });
    }

    return points.map((p) => this.transformPoint(p));
  }
}

// 19. Chamfer Rectangle
class ChamferRectangle extends Shape {
  constructor(width, height, chamfer) {
    super();
    this.width = width;
    this.height = height;
    this.chamfer = Math.min(chamfer, width / 2, height / 2);
  }

  getPoints() {
    const w = this.width / 2;
    const h = this.height / 2;
    const c = this.chamfer;

    const points = [
      { x: -w + c, y: -h },
      { x: w - c, y: -h },
      { x: w, y: -h + c },
      { x: w, y: h - c },
      { x: w - c, y: h },
      { x: -w + c, y: h },
      { x: -w, y: h - c },
      { x: -w, y: -h + c },
    ];

    return points.map((p) => this.transformPoint(p));
  }
}

// 20. Polygon with Holes
class PolygonWithHoles extends Shape {
  constructor(outerPath, holes = []) {
    super();
    this.outerPath = outerPath;
    this.holes = holes;
  }

  draw(ctx) {
    ctx.save();
    this.transform(ctx);

    // Draw outer path
    ctx.beginPath();
    this.drawPath(ctx, this.outerPath);

    // Draw holes using counter-clockwise winding
    for (const hole of this.holes) {
      this.drawPath(ctx, this.reversePath(hole));
    }

    // Fill with even-odd rule
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    ctx.fill("evenodd");

    // Stroke both outer shape and holes
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  drawPath(ctx, points) {
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
  }

  reversePath(points) {
    return [...points].reverse();
  }

  getPoints() {
    const points = [...this.outerPath];

    // Add holes with bridges to maintain single path
    for (const hole of this.holes) {
      // Add bridge to hole
      points.push(points[0]); // Move to start of outer path
      points.push(hole[0]); // Bridge to hole

      // Add hole points in reverse order
      points.push(...this.reversePath(hole));

      // Close hole and bridge back
      points.push(hole[0]);
      points.push(points[0]);
    }

    return points.map((p) => this.transformPoint(p));
  }
}

// 21. Dovetail Pin
class DovetailPin extends Shape {
  constructor(width, jointCount, depth, angle, thickness = 20) {
    super();
    this.width = width;
    this.jointCount = jointCount;
    this.depth = depth;
    this.angle = angle;
    this.thickness = thickness; // Board thickness
  }

  getPoints() {
    const spacing = this.width / this.jointCount;
    const pinRatio = 0.6;
    const pinBaseWidth = spacing * pinRatio;
    const angleRad = (this.angle * Math.PI) / 180;
    const taper = Math.tan(angleRad) * this.depth;
    const pinTopWidth = pinBaseWidth + 2 * taper;

    const points = [];
    const startX = -this.width / 2;
    const startY = -this.depth / 2;

    // Start at bottom left
    points.push({ x: startX, y: startY });

    // Draw bottom edge with pins
    for (let i = 0; i < this.jointCount; i++) {
      const centerX = startX + (i + 0.5) * spacing;

      if (i % 2 === 0) {
        // Pin - dovetail shape
        const baseHalf = pinBaseWidth / 2;
        const topHalf = pinTopWidth / 2;

        // Go to start of pin
        points.push({ x: centerX - baseHalf, y: startY });
        // Pin bottom to top progression
        points.push({ x: centerX - topHalf, y: startY + this.depth });
        points.push({ x: centerX + topHalf, y: startY + this.depth });
        points.push({ x: centerX + baseHalf, y: startY });
      }
      // For gaps (i % 2 === 1), just continue along the bottom line
      if (i < this.jointCount - 1 || i % 2 === 1) {
        points.push({ x: startX + (i + 1) * spacing, y: startY });
      }
    }

    // Complete the rectangular profile
    points.push({ x: startX + this.width, y: startY }); // Bottom right
    points.push({ x: startX + this.width, y: startY - this.thickness }); // Top right
    points.push({ x: startX, y: startY - this.thickness }); // Top left

    return points.map((p) => this.transformPoint(p));
  }
}

// 22. Dovetail Tail
class DovetailTail extends Shape {
  constructor(width, jointCount, depth, angle, thickness = 20) {
    super();
    this.width = width;
    this.jointCount = jointCount;
    this.depth = depth;
    this.angle = angle;
    this.thickness = thickness; // Board thickness
  }

  getPoints() {
    const spacing = this.width / this.jointCount;
    const pinRatio = 0.6;
    const pinBaseWidth = spacing * pinRatio;
    const angleRad = (this.angle * Math.PI) / 180;
    const taper = Math.tan(angleRad) * this.depth;
    const pinTopWidth = pinBaseWidth + 2 * taper;

    const points = [];
    const startX = -this.width / 2;
    const startY = -this.depth / 2;

    // Outer rectangle first
    points.push({ x: startX, y: startY - this.thickness }); // Top left
    points.push({ x: startX + this.width, y: startY - this.thickness }); // Top right
    points.push({ x: startX + this.width, y: startY + this.depth }); // Bottom right
    points.push({ x: startX, y: startY + this.depth }); // Bottom left
    points.push({ x: startX, y: startY - this.thickness }); // Close outer

    // Now add the dovetail socket cutouts (as interior paths)
    for (let i = 0; i < this.jointCount; i++) {
      if (i % 2 === 0) {
        // Only cut sockets where pins would go
        const centerX = startX + (i + 0.5) * spacing;
        const baseHalf = pinBaseWidth / 2;
        const topHalf = pinTopWidth / 2;

        // Move to start of socket cutout
        points.push({ x: centerX - baseHalf, y: startY });
        // Trace socket outline (reverse direction for hole)
        points.push({ x: centerX + baseHalf, y: startY });
        points.push({ x: centerX + topHalf, y: startY + this.depth });
        points.push({ x: centerX - topHalf, y: startY + this.depth });
        points.push({ x: centerX - baseHalf, y: startY }); // Close socket
      }
    }

    return points.map((p) => this.transformPoint(p));
  }
}

class FingerJointPin extends Shape {
  constructor(width, fingerCount, fingerWidth, depth, thickness = 20) {
    super();
    this.width = width;
    this.fingerCount = fingerCount;
    this.fingerWidth = fingerWidth || width / fingerCount;
    this.depth = depth;
    this.thickness = thickness;
  }

  getPoints() {
    const fingerWidth = this.fingerWidth;
    const totalFingers = this.fingerCount;

    const points = [];
    const startX = -this.width / 2;
    const startY = -this.depth / 2;

    // Start at top-left of the board
    points.push({ x: startX, y: startY - this.thickness });

    // Top edge (straight line)
    points.push({ x: startX + this.width, y: startY - this.thickness });

    // Right edge down to where fingers start
    points.push({ x: startX + this.width, y: startY });

    // Draw the finger pattern from right to left along bottom edge
    for (let i = totalFingers - 1; i >= 0; i--) {
      const fingerLeft = startX + i * fingerWidth;
      const fingerRight = fingerLeft + fingerWidth;

      if (i % 2 === 0) {
        // This is a finger (extends outward)
        points.push({ x: fingerRight, y: startY });
        points.push({ x: fingerRight, y: startY + this.depth });
        points.push({ x: fingerLeft, y: startY + this.depth });
        points.push({ x: fingerLeft, y: startY });
      } else {
        // This is a gap (stays at base level)
        points.push({ x: fingerRight, y: startY });
        // No extension for gaps - continue at base level
      }
    }

    // Complete the outline back to start
    points.push({ x: startX, y: startY });
    points.push({ x: startX, y: startY - this.thickness });

    return points.map((p) => this.transformPoint(p));
  }
}

// 24. Finger Joint Socket (Female) - COMPLETE REWRITE
class FingerJointSocket extends Shape {
  constructor(width, fingerCount, fingerWidth, depth, thickness = 20) {
    super();
    this.width = width;
    this.fingerCount = fingerCount;
    this.fingerWidth = fingerWidth || width / fingerCount;
    this.depth = depth;
    this.thickness = thickness;
  }

  getPoints() {
    const fingerWidth = this.fingerWidth;
    const totalFingers = this.fingerCount;

    const points = [];
    const startX = -this.width / 2;
    const startY = -this.depth / 2;

    // Outer rectangle perimeter
    points.push({ x: startX, y: startY - this.thickness });
    points.push({ x: startX + this.width, y: startY - this.thickness });
    points.push({ x: startX + this.width, y: startY + this.depth });
    points.push({ x: startX, y: startY + this.depth });
    points.push({ x: startX, y: startY - this.thickness }); // Close outer rectangle

    // Add rectangular socket cutouts
    for (let i = 0; i < totalFingers; i++) {
      if (i % 2 === 0) {
        // Cut sockets where pins would go
        const fingerLeft = startX + i * fingerWidth;
        const fingerRight = fingerLeft + fingerWidth;

        // Rectangular cutout
        points.push({ x: fingerLeft, y: startY });
        points.push({ x: fingerRight, y: startY });
        points.push({ x: fingerRight, y: startY + this.depth });
        points.push({ x: fingerLeft, y: startY + this.depth });
        points.push({ x: fingerLeft, y: startY }); // Close rectangle
      }
    }

    return points.map((p) => this.transformPoint(p));
  }
}

// 25. Half-Lap Male (Bottom Half Removed) - DEBUG VERSION
class HalfLapMale extends Shape {
  constructor(width, height, lapLength, lapDepth) {
    super();
    this.width = width;
    this.height = height;
    this.lapLength = lapLength;
    this.lapDepth = lapDepth || height / 2;
  }

  getPoints() {
    const points = [];
    const w = this.width;
    const h = this.height;
    const lapL = this.lapLength;
    const lapD = this.lapDepth;

    // Create L-shape by removing bottom-right corner
    // Full rectangle minus bottom-right notch

    // Top edge (full width)
    points.push({ x: -w / 2, y: -h / 2 }); // Top-left
    points.push({ x: w / 2, y: -h / 2 }); // Top-right

    // Right edge down to notch
    points.push({ x: w / 2, y: h / 2 - lapD }); // Right edge to notch level

    // Notch horizontal cut
    points.push({ x: w / 2 - lapL, y: h / 2 - lapD }); // Across notch

    // Notch vertical cut
    points.push({ x: w / 2 - lapL, y: h / 2 }); // Down to bottom

    // Bottom edge
    points.push({ x: -w / 2, y: h / 2 }); // Bottom-left

    // Left edge back up
    points.push({ x: -w / 2, y: -h / 2 }); // Back to start

    return points.map((p) => this.transformPoint(p));
  }
}

// 26. Half-Lap Female (Top Half Removed) - DEBUG VERSION
class HalfLapFemale extends Shape {
  constructor(width, height, lapLength, lapDepth) {
    super();
    this.width = width;
    this.height = height;
    this.lapLength = lapLength;
    this.lapDepth = lapDepth || height / 2;
  }

  getPoints() {
    const points = [];
    const w = this.width;
    const h = this.height;
    const lapL = this.lapLength;
    const lapD = this.lapDepth;

    // Create L-shape by removing top-right corner
    // Full rectangle minus top-right notch

    // Top edge (partial)
    points.push({ x: -w / 2, y: -h / 2 }); // Top-left
    points.push({ x: w / 2 - lapL, y: -h / 2 }); // Top edge to notch

    // Notch vertical cut
    points.push({ x: w / 2 - lapL, y: -h / 2 + lapD }); // Down into notch

    // Notch horizontal cut
    points.push({ x: w / 2, y: -h / 2 + lapD }); // Across notch

    // Right edge down
    points.push({ x: w / 2, y: h / 2 }); // Right edge to bottom

    // Bottom edge
    points.push({ x: -w / 2, y: h / 2 }); // Bottom edge

    // Left edge back up
    points.push({ x: -w / 2, y: -h / 2 }); // Back to start

    return points.map((p) => this.transformPoint(p));
  }
}

// 27. Cross-Lap Vertical (Vertical board with horizontal slot)
class CrossLapVertical extends Shape {
  constructor(width, height, slotWidth, slotDepth, slotPosition) {
    super();
    this.width = width;
    this.height = height;
    this.slotWidth = slotWidth;
    this.slotDepth = slotDepth || width / 2; // Default to half width
    this.slotPosition = slotPosition || height / 2; // Default to center
  }

  getPoints() {
    const points = [];
    const width = this.width;
    const height = this.height;
    const slotWidth = this.slotWidth;
    const slotDepth = this.slotDepth;
    const slotPosition = this.slotPosition;

    // Center the shape around (0,0)
    const x = -width / 2;
    const y = -height / 2;

    const slotTop = y + slotPosition - slotWidth / 2;
    const slotBottom = y + slotPosition + slotWidth / 2;
    const slotLeft = x + width - slotDepth;

    // Start at top-left
    points.push({ x: x, y: y });

    // Top edge to slot
    points.push({ x: x + width, y: y });

    // Right edge down to slot top
    points.push({ x: x + width, y: slotTop });

    // Slot top edge
    points.push({ x: slotLeft, y: slotTop });

    // Slot left edge
    points.push({ x: slotLeft, y: slotBottom });

    // Slot bottom edge
    points.push({ x: x + width, y: slotBottom });

    // Right edge down to bottom
    points.push({ x: x + width, y: y + height });

    // Bottom edge
    points.push({ x: x, y: y + height });

    // Left edge back to start
    points.push({ x: x, y: y });

    return points.map((p) => this.transformPoint(p));
  }
}

// 28. Cross-Lap Horizontal (Horizontal board with vertical slot)
class CrossLapHorizontal extends Shape {
  constructor(width, height, slotWidth, slotDepth, slotPosition) {
    super();
    this.width = width;
    this.height = height;
    this.slotWidth = slotWidth;
    this.slotDepth = slotDepth || height / 2; // Default to half height
    this.slotPosition = slotPosition || width / 2; // Default to center
  }

  getPoints() {
    const points = [];
    const width = this.width;
    const height = this.height;
    const slotWidth = this.slotWidth;
    const slotDepth = this.slotDepth;
    const slotPosition = this.slotPosition;

    // Center the shape around (0,0)
    const x = -width / 2;
    const y = -height / 2;

    const slotLeft = x + slotPosition - slotWidth / 2;
    const slotRight = x + slotPosition + slotWidth / 2;
    const slotTop = y;
    const slotBottom = y + slotDepth;

    // Start at top-left
    points.push({ x: x, y: y });

    // Top edge to slot left
    points.push({ x: slotLeft, y: y });

    // Slot left edge down
    points.push({ x: slotLeft, y: slotBottom });

    // Slot bottom edge
    points.push({ x: slotRight, y: slotBottom });

    // Slot right edge up
    points.push({ x: slotRight, y: y });

    // Top edge continues
    points.push({ x: x + width, y: y });

    // Right edge down
    points.push({ x: x + width, y: y + height });

    // Bottom edge
    points.push({ x: x, y: y + height });

    // Left edge back to start
    points.push({ x: x, y: y });

    return points.map((p) => this.transformPoint(p));
  }
}

// 29. Slot Board
class SlotBoard extends Shape {
    constructor(width, height, slotCount, slotWidth, slotDepth, slotPosition) {
        super();
        this.width = width;
        this.height = height;
        this.slotCount = slotCount || 3;
        this.slotWidth = slotWidth || 20;
        this.slotDepth = slotDepth || 15;
        this.slotPosition = slotPosition || 0.0;
    }

    getPoints() {
        const points = [];
        const w = this.width;
        const h = this.height;
        const count = this.slotCount;
        const slotW = this.slotWidth;
        const slotD = this.slotDepth;
        const pos = this.slotPosition;
        
        // Center around (0,0)
        const x = -w / 2;
        const y = -h / 2;
        
        // Calculate slot spacing
        const spacing = (w - (count * slotW)) / (count + 1);

        // Outer rectangle perimeter
        points.push({ x: x, y: y });                    // Top-left
        points.push({ x: x + w, y: y });                // Top-right  
        points.push({ x: x + w, y: y + h });            // Bottom-right
        points.push({ x: x, y: y + h });                // Bottom-left
        points.push({ x: x, y: y });                    // Close outer

        // Add slot cutouts at the specified position
        for (let i = 0; i < count; i++) {
            const slotLeft = x + spacing + (i * (slotW + spacing));
            const slotRight = slotLeft + slotW;
            
            // Calculate slot vertical position based on slotPosition
            // pos: 0 = top edge, 0.5 = middle, 1 = bottom edge  
            const slotTop = y + (pos * (h - slotD));
            const slotBottom = slotTop + slotD;
            
            // Add rectangular slot cutout
            points.push({ x: slotLeft, y: slotTop });
            points.push({ x: slotRight, y: slotTop });
            points.push({ x: slotRight, y: slotBottom });
            points.push({ x: slotLeft, y: slotBottom });
            points.push({ x: slotLeft, y: slotTop }); // Close slot
        }

        return points.map(p => this.transformPoint(p));
    }
}
// 30. Tab Board (Board with rectangular tabs)
class TabBoard extends Shape {
  constructor(width, height, tabCount, tabWidth, tabDepth) {
    super();
    this.width = width;
    this.height = height;
    this.tabCount = tabCount;
    this.tabWidth = tabWidth;
    this.tabDepth = tabDepth || height / 2; // Default to half height
  }

  getPoints() {
    const points = [];
    const width = this.width;
    const height = this.height;
    const tabCount = this.tabCount;
    const tabWidth = this.tabWidth;
    const tabDepth = this.tabDepth;

    // Center the shape around (0,0)
    const x = -width / 2;
    const y = -height / 2;

    // Calculate tab spacing
    const totalTabWidth = tabCount * tabWidth;
    const spacing = (width - totalTabWidth) / (tabCount + 1);

    // Start at top-left
    points.push({ x: x, y: y });

    // Top edge with tabs
    for (let i = 0; i < tabCount; i++) {
      const tabLeft = x + spacing + i * (tabWidth + spacing);
      const tabRight = tabLeft + tabWidth;

      // Edge before tab
      if (i === 0) {
        points.push({ x: tabLeft, y: y });
      } else {
        const prevTabRight =
          x + spacing + (i - 1) * (tabWidth + spacing) + tabWidth;
        points.push({ x: prevTabRight, y: y });
        points.push({ x: tabLeft, y: y });
      }

      // Tab outline
      points.push({ x: tabLeft, y: y - tabDepth }); // Up to tab top
      points.push({ x: tabRight, y: y - tabDepth }); // Across tab top
      points.push({ x: tabRight, y: y }); // Down to base
    }

    // Complete top edge
    const lastTabRight =
      x + spacing + (tabCount - 1) * (tabWidth + spacing) + tabWidth;
    points.push({ x: lastTabRight, y: y });
    points.push({ x: x + width, y: y });

    // Right edge
    points.push({ x: x + width, y: y + height });

    // Bottom edge
    points.push({ x: x, y: y + height });

    // Left edge back to start
    points.push({ x: x, y: y });

    return points.map((p) => this.transformPoint(p));
  }
}
// 31. Finger Comb Male 
class FingerCombMale extends Shape {
    constructor(width, height, toothCount, toothDepth) {
        super();
        this.width = width;
        this.height = height;
        this.toothCount = toothCount || 8;  // Total segments
        this.toothDepth = toothDepth || 10;
    }
    
    getPoints() {
        const points = [];
        const width = this.width;
        const height = this.height;
        const segments = this.toothCount;
        const toothDepth = this.toothDepth;
        
        
        const x = -width / 2;
        const y = -height / 2;
        
       
        points.push({ x: x, y: y });
        
       
        points.push({ x: x + width, y: y });
        
       
        const segmentHeight = height / segments;
        
        for (let i = 0; i < segments; i++) {
            const segmentY = y + (i * segmentHeight);
            const nextY = y + ((i + 1) * segmentHeight);
            
            if (i % 2 === 0) {
          
                points.push({ x: x + width - toothDepth, y: segmentY + segmentHeight/2 });
                points.push({ x: x + width, y: nextY });
            } else {
             
                points.push({ x: x + width + toothDepth, y: segmentY + segmentHeight/2 });
                points.push({ x: x + width, y: nextY });
            }
        }
        
      
        points.push({ x: x, y: y + height });
        
      
        return points.map(p => this.transformPoint(p));
    }
}

// 32. Finger Comb Female
class FingerCombFemale extends Shape {
    constructor(width, height, toothCount, toothDepth) {
        super();
        this.width = width;
        this.height = height;
        this.toothCount = toothCount || 8; 
        this.toothDepth = toothDepth || 10;
    }
    
    getPoints() {
        const points = [];
        const width = this.width;
        const height = this.height;
        const segments = this.toothCount;
        const toothDepth = this.toothDepth;
        
        
        const x = -width / 2;
        const y = -height / 2;
        
        
        points.push({ x: x, y: y });
        
        
        points.push({ x: x + width, y: y });
        
   
        const segmentHeight = height / segments;
        
        for (let i = 0; i < segments; i++) {
            const segmentY = y + (i * segmentHeight);
            const nextY = y + ((i + 1) * segmentHeight);
            
            if (i % 2 === 1) {
             
                points.push({ x: x + width - toothDepth, y: segmentY + segmentHeight/2 });
                points.push({ x: x + width, y: nextY });
            } else {
                points.push({ x: x + width + toothDepth, y: segmentY + segmentHeight/2 });
                points.push({ x: x + width, y: nextY });
            }
        }
        
        
        points.push({ x: x, y: y + height });
        
        
        return points.map(p => this.transformPoint(p));
    }
}


class RabbetJoint extends Shape {
    constructor(width, height, slotWidth, slotDepth) {
        super();
        this.width = width;         // Width of vertical board
        this.height = height;       // Height of vertical board
        this.slotWidth = slotWidth || (width * 0.4);     // Width of slot cut from bottom
        this.slotDepth = slotDepth || (height * 0.2);    // Depth of slot into the board
    }
    
    getPoints() {
        const points = [];
        const width = this.width;
        const height = this.height;
        const slotWidth = this.slotWidth;
        const slotDepth = this.slotDepth;
        
        // Center around (0,0)
        const x = -width / 2;
        const y = -height / 2;
        
        // Calculate slot position (centered at bottom)
        const slotStart = (width - slotWidth) / 2;
        
        // Create vertical board with centered slot cut from bottom
        // Start at top-left
        points.push({ x: x, y: y });
        
        // Top edge to top-right
        points.push({ x: x + width, y: y });
        
        // Right edge down to bottom
        points.push({ x: x + width, y: y + height });
        
        // Bottom edge to where slot starts
        points.push({ x: x + slotStart + slotWidth, y: y + height });
        
        // Up into the slot
        points.push({ x: x + slotStart + slotWidth, y: y + height - slotDepth });
        
        // Left across the slot
        points.push({ x: x + slotStart, y: y + height - slotDepth });
        
        // Down to bottom
        points.push({ x: x + slotStart, y: y + height });
        
        // Bottom edge to left corner
        points.push({ x: x, y: y + height });
        
        // Up the left edge back to start
        points.push({ x: x, y: y });
        
        return points.map(p => this.transformPoint(p));
    }
}

// 34. Rabbet Plain - Horizontal piece with tab/extension on end (Male piece)
class RabbetPlain extends Shape {
    constructor(width, height, tabWidth, tabLength) {
        super();
        this.width = width;          // Main length of horizontal board
        this.height = height;        // Full height of horizontal board
        this.tabWidth = tabWidth || (height * 0.5);     // Width of tab (thickness)
        this.tabLength = tabLength || (width * 0.15);   // How far tab extends
    }
    
    getPoints() {
        const points = [];
        const width = this.width;
        const height = this.height;
        const tabWidth = this.tabWidth;
        const tabLength = this.tabLength;
        
        // Center around (0,0)
        const x = -width / 2;
        const y = -height / 2;
        
        // Calculate tab position (centered on end)
        const tabStart = (height - tabWidth) / 2;
        
        // Create horizontal board with protruding tab on right end
        // Start at top-left
        points.push({ x: x, y: y });
        
        // Top edge to where main board ends
        points.push({ x: x + width, y: y });
        
        // Down to where tab starts
        points.push({ x: x + width, y: y + tabStart });
        
        // Extend out for the tab
        points.push({ x: x + width + tabLength, y: y + tabStart });
        
        // Down the tab
        points.push({ x: x + width + tabLength, y: y + tabStart + tabWidth });
        
        // Back to main board
        points.push({ x: x + width, y: y + tabStart + tabWidth });
        
        // Down to bottom
        points.push({ x: x + width, y: y + height });
        
        // Bottom edge back to left
        points.push({ x: x, y: y + height });
        
        // Up the left edge back to start
        points.push({ x: x, y: y });
        
        return points.map(p => this.transformPoint(p));
    }
}



class FlexureMesh extends Shape {
  constructor(totalWidth, totalHeight, slotLength, slotWidth, bridgeWidth, rowSpacing, staggerOffset = 0.5, cornerRadius = 0, pattern = 'staggered') {
    super();
    this.totalWidth = totalWidth;
    this.totalHeight = totalHeight;
    this.slotLength = slotLength;
    this.slotWidth = slotWidth;
    this.bridgeWidth = bridgeWidth;
    this.rowSpacing = rowSpacing;
    this.staggerOffset = staggerOffset;
    this.cornerRadius = cornerRadius;
    this.pattern = pattern;
  }

  getPoints() {
    const points = [];
    
    // Start with outer perimeter
    const hw = this.totalWidth / 2;
    const hh = this.totalHeight / 2;
    
    // Outer rectangle
    points.push({ x: -hw, y: -hh });
    points.push({ x: hw, y: -hh });
    points.push({ x: hw, y: hh });
    points.push({ x: -hw, y: hh });
    points.push({ x: -hw, y: -hh }); // Close outer
    
    // Generate slot cutouts
    const slotSpacing = this.slotLength + this.bridgeWidth;
    const rows = Math.floor(this.totalHeight / this.rowSpacing);
    
    for (let row = 0; row < rows; row++) {
      const y = -hh + (row + 0.5) * this.rowSpacing;
      
      // Calculate stagger offset for this row
      const offsetX = this.pattern === 'staggered' ? 
        (row % 2) * slotSpacing * this.staggerOffset : 0;
      
      // Calculate how many slots fit in this row
      const effectiveWidth = this.totalWidth - (this.pattern === 'staggered' ? 
        slotSpacing * this.staggerOffset : 0);
      const slotsInRow = Math.floor(effectiveWidth / slotSpacing);
      
      for (let col = 0; col < slotsInRow; col++) {
        const x = -hw + offsetX + (col + 0.5) * slotSpacing;
        
        // Skip if slot is outside bounds
        if (x - this.slotLength/2 < -hw || x + this.slotLength/2 > hw) {
          continue;
        }
        
        // Add slot as separate path for cutout
        const slotPoints = this.generateSlotPoints(x, y);
        points.push(...slotPoints);
      }
    }
    
    return points.map(p => this.transformPoint(p));
  }
  
  generateSlotPoints(centerX, centerY) {
    const points = [];
    const hw = this.slotLength / 2;
    const hh = this.slotWidth / 2;
    
    if (this.cornerRadius <= 0) {
      // Simple rectangle
      points.push({ x: centerX - hw, y: centerY - hh });
      points.push({ x: centerX + hw, y: centerY - hh });
      points.push({ x: centerX + hw, y: centerY + hh });
      points.push({ x: centerX - hw, y: centerY + hh });
      points.push({ x: centerX - hw, y: centerY - hh }); // Close
    } else {
      // Rounded rectangle (simplified for now)
      const r = Math.min(this.cornerRadius, hw, hh);
      
      // Top edge
      points.push({ x: centerX - hw + r, y: centerY - hh });
      points.push({ x: centerX + hw - r, y: centerY - hh });
      
      // Top-right corner (simplified)
      points.push({ x: centerX + hw, y: centerY - hh + r });
      
      // Right edge  
      points.push({ x: centerX + hw, y: centerY + hh - r });
      
      // Bottom-right corner
      points.push({ x: centerX + hw - r, y: centerY + hh });
      
      // Bottom edge
      points.push({ x: centerX - hw + r, y: centerY + hh });
      
      // Bottom-left corner
      points.push({ x: centerX - hw, y: centerY + hh - r });
      
      // Left edge
      points.push({ x: centerX - hw, y: centerY - hh + r });
      
      // Top-left corner
      points.push({ x: centerX - hw + r, y: centerY - hh }); // Close
    }
    
    return points;
  }
}


class Bspline extends Shape {
  constructor(points = [], closed = false, degree = 3) {
    super();
    this.points = points;
    this.closed = closed;
    this.degree = degree;
  }

  getPoints(segments = 100) {
    if (!this.points || this.points.length < 2) {
      return [];
    }

    if (this.points.length < 4) {
      return this.points
        .map(point => ({
          x: point?.[0] ?? 0,
          y: point?.[1] ?? 0
        }))
        .map(p => this.transformPoint(p));
    }

    const result = [];
    const numSegments = this.closed ? this.points.length : Math.max(1, this.points.length - 3);
    const pointsPerSegment = Math.max(1, Math.floor(segments / numSegments));

    for (let i = 0; i < numSegments; i++) {
      const p0 = this.points[i % this.points.length];
      const p1 = this.points[(i + 1) % this.points.length];
      const p2 = this.points[(i + 2) % this.points.length];
      const p3 = this.points[(i + 3) % this.points.length];

      for (let t = 0; t <= pointsPerSegment; t++) {
        const tNorm = t / pointsPerSegment;
        const point = this.cubicBSplinePoint(tNorm, p0, p1, p2, p3);
        result.push(point);
      }
    }

    const cleaned = [];
    for (let i = 0; i < result.length; i++) {
      if (
        i === 0 ||
        Math.abs(result[i].x - result[i - 1].x) > 0.001 ||
        Math.abs(result[i].y - result[i - 1].y) > 0.001
      ) {
        cleaned.push(result[i]);
      }
    }

    return cleaned.map(p => this.transformPoint(p));
  }

  cubicBSplinePoint(t, p0, p1, p2, p3) {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    const b0 = mt3 / 6;
    const b1 = (3 * t3 - 6 * t2 + 4) / 6;
    const b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    const b3 = t3 / 6;

    return {
      x: b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
      y: b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]
    };
  }

  getBoundingBox() {
    if (!this.points || this.points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const point of this.points) {
      if (!point || !Array.isArray(point) || point.length < 2) continue;
      const x = point[0];
      const y = point[1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (minX !== Infinity && maxX !== -Infinity && minY !== Infinity && maxY !== -Infinity) {
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };
    }

    return { x: 0, y: 0, width: 0, height: 0 };
  }
}


const ShapeUtils = {
  // Boolean operations
  union(shape1, shape2) {
    // Implementation would require complex polygon clipping library
    throw new Error("Boolean operations require additional geometry library");
  },

  // Distance between shapes
  distance(shape1, shape2) {
    const bb1 = shape1.getBoundingBox();
    const bb2 = shape2.getBoundingBox();

    return Math.sqrt(Math.pow(bb1.x - bb2.x, 2) + Math.pow(bb1.y - bb2.y, 2));
  },

  // Check if point is inside shape
  pointInShape(point, shape) {
    const points = shape.getPoints();
    let inside = false;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x,
        yi = points[i].y;
      const xj = points[j].x,
        yj = points[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  },

  // Convert shape to SVG path
  toSVGPath(shape) {
    const points = shape.getPoints();
    if (points.length === 0) return "";

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    path += " Z";

    return path;
  },
};

export {
  Shape,
  Rectangle,
  Circle,
  Triangle,
  Ellipse,
  RegularPolygon,
  Star,
  Arc,
  RoundedRectangle,
  Path,
  Arrow,
  Text,
  BezierCurve,
  Donut,
  Spiral,
  Cross,
  Gear,
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
  ShapeUtils,
};


