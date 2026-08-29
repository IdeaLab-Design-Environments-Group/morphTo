import {
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
    Wave,
    Slot,
    ChamferRectangle,
    PolygonWithHoles,
    Gear,
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
    Bspline
} from './Shapes.js';

class BooleanNaming {
    constructor() {
      this.operationSymbols = { union: 'U', difference: 'D', intersection: 'I', xor: 'X' };
      this.counter = new Map();
    }
    reset() {
      this.counter.clear();
    }
    getNextCount(op) {
      const c = this.counter.get(op) || 0;
      this.counter.set(op, c + 1);
      return c + 1;
    }
    generateName(op, shapes) {
      const sym = this.operationSymbols[op];
      const cnt = this.getNextCount(op);
      const base = shapes[0] && typeof shapes[0] === 'string' ? shapes[0] : 'shape';
      return `${base}_${sym}${cnt}`;
    }
  }

  export class BooleanOperator {
    constructor() {
      this.naming = new BooleanNaming();
    // Use Clipper with Y-down expectation: flip entering, not exiting.
    this.CLIPPER_Y_FLIP = true;
      this.polygonClipping = null; // disabled
      this.debugMode = false;
      this.ClipperLib = null;
      this.isLibraryAvailable = this._initializeClipper();
      this.operationColors = {
        union: '#4CAF50',
        difference: '#FF5722',
        intersection: '#2196F3',
        xor: '#9C27B0'
      };
      if (this.isLibraryAvailable) {
        console.log(`BooleanOperator (Vatti Clipping) initialized`);
      } else {
        console.log(`BooleanOperator (Vatti Clipping) couldn't be initialized`);
      }
    }
  
    _initializeClipper() {
      if (typeof window !== 'undefined' && window.ClipperLib) {
        this.ClipperLib = window.ClipperLib;
        return true;
      }
      try {
        this.ClipperLib = require('clipper-lib');
        return true;
      } catch {
        console.error(
          'ClipperLib not found! Add to HTML:\n' +
          '<script src="https://cdn.jsdelivr.net/gh/junmer/clipper-lib@master/clipper.js"></script>'
        );
        return false;
      }
    }
  
    setDebugMode(on) {
      this.debugMode = !!on;
    }
    log(...args) {
      if (this.debugMode) console.log('[BooleanOp]', ...args);
    }
  
    performUnion(shapes) {
      return this._clipAndMake(shapes, 'union', this.ClipperLib.ClipType.ctUnion);
    }
    
    /**
     * Perform difference operation: subject - clips
     * Handles multiple clips by chaining: (((subject - clip1) - clip2) - clip3) ...
     */
    performDifference(shapes) {
    // Supports multiple shapes: first shape is the base, all others are cuts
    // Example: performDifference([base, cut1, cut2, cut3]) = ((base - cut1) - cut2) - cut3
    if (!shapes || shapes.length < 2) {
      throw new Error('Difference requires at least 2 shapes');
    }

    // Clipper-only path: send Y-up to Clipper, flip Y when reading back
    this._ensureLib();

    const scale = 10000;

    const toClipper = (pts) => {
      const out = [];
      let current = [];
      for (const p of pts) {
        if (p === null) {
          if (current.length >= 3) out.push(current);
          current = [];
        } else if (Array.isArray(p) && p.length >= 2) {
          current.push({
            X: Math.round(p[0] * scale),
            Y: Math.round(p[1] * scale)
          });
        }
      }
      if (current.length >= 3) out.push(current);
      return out;
    };

    const fromClipper = (paths) => {
      const pts = [];
      paths.forEach((path, idx) => {
        if (idx > 0) pts.push(null);
        if (path && path.length >= 3) {
          path.forEach(pt => pts.push([
            pt.X / scale,
            pt.Y / scale
          ]));
        }
      });
      return pts;
    };

    // extractShapePoints already applies transforms; no double-transform here.
    // Returns both points and a flag indicating if shape is from a boolean operation
    const extract = (shape) => {
      const pts = this.extractShapePoints(shape);
      // Check if this is a path from a boolean operation
      const isBooleanPath = shape.type === 'path' && shape.params?.operation;
      return { points: pts, isBooleanPath: !!isBooleanPath };
    };

    let currentResult = extract(shapes[0]);
    let currentPts = currentResult.points;
    let currentIsBoolean = currentResult.isBooleanPath;
    this.log(`Subject shape: ${shapes[0].name || shapes[0].type || 'shape'}${currentIsBoolean ? ' (boolean path)' : ''}`);
    this.log(`Processing ${shapes.length - 1} cut(s) from base shape`);
    if (this.debugMode && currentPts && currentPts.length > 0) {
      const samplePt = currentPts.find(p => p !== null);
      if (samplePt) {
        this.log(`  Sample point: [${samplePt[0].toFixed(2)}, ${samplePt[1].toFixed(2)}]`);
      }
    }

    // Process each cut sequentially: ((base - cut1) - cut2) - cut3 ...
    for (let i = 1; i < shapes.length; i++) {
      const clipResult = extract(shapes[i]);
      const clipPts = clipResult.points;
      const clipIsBoolean = clipResult.isBooleanPath;
      this.log(`Subtracting clip ${i}: ${shapes[i].name || shapes[i].type || 'shape'}${clipIsBoolean ? ' (boolean path)' : ''}`);
      if (this.debugMode && clipPts && clipPts.length > 0) {
        const samplePt = clipPts.find(p => p !== null);
        if (samplePt) {
          this.log(`  Sample point: [${samplePt[0].toFixed(2)}, ${samplePt[1].toFixed(2)}]`);
        }
      }
      
      if (!currentPts || currentPts.length === 0 || !clipPts || clipPts.length === 0) {
        throw new Error(`Invalid shape in difference at step ${i} (shape: ${shapes[i].name || shapes[i].type || 'unknown'})`);
      }

      let subjPaths = toClipper(currentPts);
      const clipPaths = toClipper(clipPts);
      if (this.debugMode && subjPaths.length > 0 && subjPaths[0].length > 0) {
        const sampleClipperPt = subjPaths[0][0];
        this.log(`  Subject to Clipper: [${sampleClipperPt.X}, ${sampleClipperPt.Y}]`);
      }
      if (subjPaths.length === 0 || clipPaths.length === 0) {
        throw new Error(`Failed to convert shape to paths at step ${i}`);
      }

      // Store original paths before any modifications
      const originalSubjPaths = subjPaths.map(path => path.map(pt => ({ X: pt.X, Y: pt.Y })));

      const c = new this.ClipperLib.Clipper();
      c.AddPaths(subjPaths, this.ClipperLib.PolyType.ptSubject, true);
      c.AddPaths(clipPaths, this.ClipperLib.PolyType.ptClip, true);

      const sol = new this.ClipperLib.Paths();
      let ok = c.Execute(
        this.ClipperLib.ClipType.ctDifference,
        sol,
        this.ClipperLib.PolyFillType.pftNonZero,
        this.ClipperLib.PolyFillType.pftNonZero
      );
      
      // Solution 1: If operation fails or returns empty, try with pftEvenOdd
      if (!ok || sol.length === 0) {
        if (currentIsBoolean) {
          this.log('⚠️ First attempt failed, trying with pftEvenOdd fill type');
          const sol2 = new this.ClipperLib.Paths();
          const c2 = new this.ClipperLib.Clipper();
          c2.AddPaths(subjPaths, this.ClipperLib.PolyType.ptSubject, true);
          c2.AddPaths(clipPaths, this.ClipperLib.PolyType.ptClip, true);
          ok = c2.Execute(
            this.ClipperLib.ClipType.ctDifference,
            sol2,
            this.ClipperLib.PolyFillType.pftEvenOdd,
            this.ClipperLib.PolyFillType.pftEvenOdd
          );
          if (ok && sol2.length > 0) {
            // Copy results from sol2 to sol
            sol.length = 0;
            sol2.forEach(path => sol.push(path));
            this.log('✓ pftEvenOdd succeeded');
          }
        }
      }
      
      if (!ok) {
        throw new Error(`Difference operation failed at step ${i}: Clipper Execute returned false`);
      }
      
      // Solution 1: Detect and handle empty results for boolean path subjects
      // When coordinate mismatch occurs, Clipper might return empty even though clip is inside subject
      if (sol.length === 0) {
        if (currentIsBoolean) {
          // This might be a coordinate mismatch issue
          // Check if clip is actually inside subject by comparing bounding boxes
          this.log('⚠️ Empty result detected for boolean path subject - checking for coordinate mismatch');
          
          const getBounds = (paths) => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            paths.forEach(path => {
              path.forEach(pt => {
                minX = Math.min(minX, pt.X);
                maxX = Math.max(maxX, pt.X);
                minY = Math.min(minY, pt.Y);
                maxY = Math.max(maxY, pt.Y);
              });
            });
            return { minX, maxX, minY, maxY };
          };
          
          const subjBounds = getBounds(subjPaths);
          const clipBounds = getBounds(clipPaths);
          
          // If clip is inside subject bounds, it should create a hole
          const clipInsideSubject = clipBounds.minX > subjBounds.minX && 
                                   clipBounds.maxX < subjBounds.maxX &&
                                   clipBounds.minY > subjBounds.minY && 
                                   clipBounds.maxY < subjBounds.maxY;
          
          if (clipInsideSubject) {
            // Clip is inside subject - manually combine them
            // Use original paths to preserve all existing holes
            // Preserve ALL subject paths (outer + ALL existing holes) and add clip as new hole
            this.log(`Manually combining: subject has ${originalSubjPaths.length} paths (outer + ${originalSubjPaths.length - 1} existing holes), adding ${clipPaths.length} new hole(s)`);
            
            // Deep copy all original subject paths (outer + all existing holes)
            originalSubjPaths.forEach(origPath => {
              const copiedPath = origPath.map(pt => ({ X: pt.X, Y: pt.Y }));
              sol.push(copiedPath);
            });
            
            // Add clip paths as new holes (ensure they're clockwise for holes)
            clipPaths.forEach(clipPath => {
              // Deep copy and ensure clockwise winding for holes
              const copiedClipPath = clipPath.map(pt => ({ X: pt.X, Y: pt.Y }));
              if (copiedClipPath.length >= 3 && this._isCounterClockwiseClipper(copiedClipPath)) {
                copiedClipPath.reverse();
              }
              sol.push(copiedClipPath);
            });
            
            this.log(`✓ Manually combined: result now has ${sol.length} paths (1 outer + ${sol.length - 1} holes)`);
          } else {
            // Geometry was completely subtracted
            this.log(`⚠️ Warning: Difference step ${i} resulted in empty geometry (${shapes[i].name || shapes[i].type || 'shape'} completely removed remaining shape)`);
            throw new Error(`Difference operation at step ${i} resulted in empty geometry (shape completely subtracted)`);
          }
        } else {
          // Normal empty result handling for regular shapes
          this.log(`⚠️ Warning: Difference step ${i} resulted in empty geometry (${shapes[i].name || shapes[i].type || 'shape'} completely removed remaining shape)`);
          throw new Error(`Difference operation at step ${i} resulted in empty geometry (shape completely subtracted)`);
        }
      }

      // Track if we manually combined paths (skip SimplifyPolygons to preserve structure)
      const wasManuallyCombined = sol.length > 0 && currentIsBoolean && 
        (originalSubjPaths.length + clipPaths.length === sol.length);
      
      let cleaned = sol;
      // Skip SimplifyPolygons if we manually combined paths to preserve hole structure
      if (!wasManuallyCombined) {
        try {
          if (this.ClipperLib.Clipper?.SimplifyPolygons) {
            cleaned = this.ClipperLib.Clipper.SimplifyPolygons(
              sol,
              this.ClipperLib.PolyFillType.pftNonZero
            );
          }
        } catch (e) {
          this.log('SimplifyPolygons not available, using original solution');
        }
      } else {
        this.log('Skipping SimplifyPolygons for manually combined paths to preserve hole structure');
      }

      // Result is always a boolean path (from difference operation)
      currentPts = fromClipper(cleaned);
      if (this.debugMode && currentPts && currentPts.length > 0) {
        const samplePt = currentPts.find(p => p !== null);
        if (samplePt) {
          this.log(`  Result point: [${samplePt[0].toFixed(2)}, ${samplePt[1].toFixed(2)}] (not flipped)`);
        }
        if (cleaned.length > 0 && cleaned[0].length > 0) {
          const sampleClipperResult = cleaned[0][0];
          this.log(`  Clipper result: [${sampleClipperResult.X}, ${sampleClipperResult.Y}]`);
        }
      }
      currentIsBoolean = true;
    }

    const subjectName = shapes[0].name || shapes[0].type || 'shape';
    const name = this.naming.generateName('difference', [subjectName]);
    const style = this.extractStyling(shapes[0], 'difference');

    return {
      type: 'path',
      name,
      params: {
        points: currentPts,
        closed: true,
        operation: 'difference',
        hasHoles: currentPts.includes(null),
        ...style
      },
      transform: { position: [0, 0], rotation: 0, scale: [1, 1] }
    };
  }

  /**
   * Difference using polygon-clipping (Y-up, no flips)
   */
  _performDifferencePolygonClipping(shapes) {
    if (!shapes || shapes.length < 2) {
      throw new Error('Difference requires at least 2 shapes');
    }

    const extract = (shape) => this.extractShapePoints(shape); // already transformed to world
    let current = this._pointsToMultiPolygon(extract(shapes[0]));

    for (let i = 1; i < shapes.length; i++) {
      const clip = this._pointsToMultiPolygon(extract(shapes[i]));
      const res = this.polygonClipping.difference(current, clip);
      if (!res || res.length === 0) {
        throw new Error(`Difference operation failed at step ${i}`);
      }
      current = res;
    }

    const pts = this._multiPolygonToPoints(current);
    const subjectName = shapes[0].name || shapes[0].type || 'shape';
    const name = this.naming.generateName('difference', [subjectName]);
    const style = this.extractStyling(shapes[0], 'difference');

    return {
      type: 'path',
      name,
      params: {
        points: pts,
        closed: true,
        operation: 'difference',
        hasHoles: pts.includes(null),
        ...style
      },
      transform: { position: [0, 0], rotation: 0, scale: [1, 1] }
    };
  }
    
    /**
     * Convert point array to Clipper paths
     * Handles null separators for holes
     */
    _pointsToClipperPaths(points, scale) {
      const paths = [];
      let currentPath = [];
      
      for (const p of points) {
        if (p === null) {
          if (currentPath.length >= 3) {
            paths.push(currentPath);
          }
          currentPath = [];
        } else if (Array.isArray(p) && p.length >= 2) {
          currentPath.push({
            X: Math.round(p[0] * scale),
            Y: Math.round((this.CLIPPER_Y_FLIP ? -p[1] : p[1]) * scale)
          });
        }
      }
      
      if (currentPath.length >= 3) {
        paths.push(currentPath);
      }
      
      return paths;
    }
    
    /**
     * Convert Clipper paths to point array format
     * Adds null separators between paths
     */
    _clipperPathsToPoints(paths, scale) {
      const points = [];
      
      for (let i = 0; i < paths.length; i++) {
        if (i > 0) points.push(null);
        
        const path = paths[i];
        if (path && path.length >= 3) {
          for (const pt of path) {
            // Flip back only if we flipped entering Clipper
            points.push([pt.X / scale, (this.CLIPPER_Y_FLIP ? -pt.Y : pt.Y) / scale]);
          }
        }
      }
      
      return points;
    }

    /**
     * Convert points (with null separators) to MultiPolygon for polygon-clipping.
     * Groups CCW outer with subsequent CW holes until next CCW.
     */
    _pointsToMultiPolygon(points) {
      const contours = [];
      let current = [];
      for (const p of points) {
        if (p === null) {
          if (current.length >= 3) contours.push(current);
          current = [];
        } else if (Array.isArray(p) && p.length >= 2) {
          current.push([p[0], p[1]]);
        }
      }
      if (current.length >= 3) contours.push(current);

      const polygons = [];
      let active = null;
      for (const c of contours) {
        const outer = this._signedArea(c) < 0; // CCW in Y-up gives negative shoelace
        if (outer) {
          // start new polygon with this outer ring
          active = [c];
          polygons.push(active);
        } else if (active) {
          // hole
          active.push(c);
        } else {
          // hole without outer, treat as standalone outer
          polygons.push([c]);
          active = null;
        }
      }
      return polygons.length > 0 ? polygons : [[]];
    }

    /**
     * Convert MultiPolygon from polygon-clipping back to points with null separators.
     */
    _multiPolygonToPoints(multi) {
      const pts = [];
      multi.forEach((poly, pIdx) => {
        poly.forEach((ring, rIdx) => {
          if (pIdx > 0 || rIdx > 0) pts.push(null);
          ring.forEach(([x, y]) => pts.push([x, y]));
        });
      });
      return pts;
    }

    _signedArea(ring) {
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        a += (xj - xi) * (yj + yi);
      }
      return a;
    }
    
    performIntersection(shapes) {
      return this._clipAndMake(shapes, 'intersection', this.ClipperLib.ClipType.ctIntersection);
    }
    performXor(shapes) {
      return this._clipAndMake(shapes, 'xor', this.ClipperLib.ClipType.ctXor);
    }
  
    _clipAndMake(shapes, op, clipType) {
      this._ensureLib();
      // Keep the low‑level boolean engine strict and handle chaining at interpreter level
      if (op === 'union') this._ensureCount(shapes, 1);
      else if (op === 'difference' || op === 'xor') this._ensureCount(shapes, 2, 2);
      else this._ensureCount(shapes, 2);

      // Use a larger scale to preserve more precision when converting to integers
      const scale = 10000;
      const subj = [], clip = [];
      shapes.forEach((s, i) => {
        const pts = this.extractShapePoints(s);
        if (!pts || pts.length === 0) {
          console.warn(`⚠️ Shape ${i} (${s.name || s.type}) produced no points`);
          return;
        }
        
        // Split points by null to handle multiple separate contours (e.g., from union of separate shapes)
        const contours = [];
        let currentContour = [];
        for (const p of pts) {
          if (p === null) {
            if (currentContour.length >= 3) {  // Valid polygon needs at least 3 points
              contours.push(currentContour);
            }
            currentContour = [];
          } else {
            if (Array.isArray(p) && p.length >= 2) {
              currentContour.push(p);
            }
          }
        }
        if (currentContour.length >= 3) {
          contours.push(currentContour);
        }
        
        if (contours.length === 0) {
          console.warn(`⚠️ Shape ${i} (${s.name || s.type}) produced no valid contours`);
          return;
        }
        
        // If this is a path shape with holes from a previous boolean operation,
        // Clipper already has them with correct winding (outer CCW, holes CW).
        // We need to preserve this structure. Use CleanPolygons to ensure
        // proper containment relationships if available.
        if (s.type === 'path' && s.params && s.params.hasHoles && contours.length > 1) {
          this.log(`Path ${s.name || s.type} has ${contours.length} contours (1 outer + ${contours.length - 1} holes)`);
          // Clipper should have already set correct winding, but verify
          // First contour should be outer (CCW), subsequent are holes (CW)
          const outerWinding = this._isCounterClockwise(contours[0]) ? 'CCW' : 'CW';
          this.log(`Outer contour winding: ${outerWinding} (should be CCW)`);
          for (let j = 1; j < contours.length; j++) {
            const holeWinding = this._isCounterClockwise(contours[j]) ? 'CCW' : 'CW';
            this.log(`Hole ${j} winding: ${holeWinding} (should be CW)`);
          }
          
          // Only correct if definitely wrong - Clipper usually returns correct winding
          if (!this._isCounterClockwise(contours[0])) {
            contours[0].reverse();
            this.log(`⚠️ Corrected: Reversed outer contour to CCW for ${s.name || s.type}`);
          }
          for (let j = 1; j < contours.length; j++) {
            if (this._isCounterClockwise(contours[j])) {
              contours[j].reverse();
              this.log(`⚠️ Corrected: Reversed hole ${j} to CW for ${s.name || s.type}`);
            }
          }
        }
        
        this.log(`Shape ${i} (${s.name || s.type}): ${contours.length} contour(s)`);
        
        // Convert each contour to Clipper format
        const paths = contours.map(contour => 
          contour.map(p => ({
            X: Math.round(p[0] * scale),
            Y: Math.round(p[1] * scale)  // NO Y negation - send Y-up coordinates as-is
          }))
        );
        
        // For union, ALL shapes' contours are subject paths. For other ops, first is subject, rest are clips.
        if (op === 'union') {
          subj.push(...paths);
        } else {
          if (i === 0) {
            subj.push(...paths);
          } else {
            clip.push(...paths);
          }
        }
      });
  
      const c = new this.ClipperLib.Clipper();
      c.AddPaths(subj, this.ClipperLib.PolyType.ptSubject, true);
      if (clip.length > 0) {
      c.AddPaths(clip, this.ClipperLib.PolyType.ptClip, true);
      }
  
      const sol = new this.ClipperLib.Paths();
      c.Execute(
        clipType,
        sol,
        this.ClipperLib.PolyFillType.pftNonZero,
        this.ClipperLib.PolyFillType.pftNonZero
      );

      // Clean up the solution if SimplifyPolygons is available
      // This removes degenerate edges and self-intersections, important for chained operations
      let cleaned = sol;
      try {
        if (this.ClipperLib.Clipper && typeof this.ClipperLib.Clipper.SimplifyPolygons === 'function') {
          cleaned = this.ClipperLib.Clipper.SimplifyPolygons(
            sol,
            this.ClipperLib.PolyFillType.pftNonZero
          );
        }
      } catch (e) {
        // SimplifyPolygons not available, use original solution
        this.log('SimplifyPolygons not available, using original solution');
        cleaned = sol;
      }

      const ptsOut = [];
      cleaned.forEach((path, idx) => {
        if (idx > 0) ptsOut.push(null);
        // Ensure path has at least 3 points (valid polygon)
        if (path.length >= 3) {
        path.forEach(pt => ptsOut.push([pt.X / scale, pt.Y / scale]));
        }
      });
  
      const name = this.naming.generateName(op, shapes.map(s => s.name || 'shape'));
      const style = this.extractStyling(shapes[0], op);
      return {
        type: 'path',
        name,
        params: {
          points: ptsOut,
          closed: true,
          operation: op,
          hasHoles: ptsOut.includes(null),
          ...style
        },
        transform: { position: [0, 0], rotation: 0, scale: [1, 1] }
      };
    }
  
    _ensureLib() {
      if (!this.isLibraryAvailable) throw new Error('ClipperLib not available');
    }
    _ensureCount(arr, min, max = Infinity) {
      if (!Array.isArray(arr) || arr.length < min || arr.length > max) {
        throw new Error(`Need between ${min} and ${max} shapes, got ${arr.length}`);
      }
    }
    
    extractShapePoints(shape) {
      if (!shape || !shape.type) throw new Error('Invalid shape object');
      this.log(`Extracting points from ${shape.type}`);
      if (shape.type === 'path' && shape.params && shape.params.points) {
        return this._handlePathShape(shape);
      }
      return this._handleRegularShape(shape);
    }
  
    _handlePathShape(shape) {
      let pts = shape.params.points;
      if (shape.params.isTurtlePath && Array.isArray(shape.params.subPaths)) {
        const all = [];
        for (const sp of shape.params.subPaths) {
          all.push(...sp.map(p => (Array.isArray(p) ? p : [p.x || 0, p.y || 0])));
        }
        pts = all;
      } else {
        pts = pts.map(p => (p === null ? null : Array.isArray(p) ? p : [p.x || 0, p.y || 0]));
      }
      return this.applyTransform(pts, shape.transform);
    }
  
    _handleRegularShape(shape) {
      const inst = this._createShapeInstance(shape);
      const res = this._getShapeResolution(shape.type);
      const pts = inst.getPoints(res);
      const arr = pts.map(p => [p.x || 0, p.y || 0]);
      const transform = this._mergeTransformWithParams(shape);
      return this.applyTransform(arr, transform);
    }

    _mergeTransformWithParams(shape) {
      const baseTransform = shape?.transform || {};
      const rotation = Number(baseTransform.rotation || 0);
      const scale = Array.isArray(baseTransform.scale) ? baseTransform.scale : [1, 1];
      const baseOffset = this._getParamOffset(shape);
      const position = baseOffset || (Array.isArray(baseTransform.position) ? baseTransform.position : [0, 0]);
      return { position, rotation, scale };
    }

    _getParamOffset(shape) {
      if (!shape || !shape.params) return null;
      const p = shape.params;
      const hasCenter = Number.isFinite(p.centerX) || Number.isFinite(p.centerY);
      if (hasCenter) {
        return [Number(p.centerX || 0), Number(p.centerY || 0)];
      }
      const hasXY = Number.isFinite(p.x) || Number.isFinite(p.y);
      if (!hasXY) return null;
      const x = Number(p.x || 0);
      const y = Number(p.y || 0);
      const type = String(shape.type || '').toLowerCase();
      if (this._isTopLeftPositioned(type)) {
        const width = Number(p.width ?? p.length ?? 0);
        const height = Number(p.height ?? p.width ?? 0);
        return [x + width / 2, y + height / 2];
      }
      return [x, y];
    }

    _isTopLeftPositioned(type) {
      return type === 'rectangle' ||
        type === 'roundedrectangle' ||
        type === 'chamferrectangle';
    }
  
    _createShapeInstance(shape) {
      const p = shape.params || {};
      switch (shape.type) {
        case 'rectangle': return new Rectangle(p.width || 50, p.height || 50);
        case 'circle': return new Circle(p.radius || 25);
        case 'triangle': return new Triangle(p.base || 30, p.height || 40);
        case 'ellipse': return new Ellipse(p.radiusX || 30, p.radiusY || 20);
        case 'polygon': return new RegularPolygon(p.radius || 25, p.sides || 6);
        case 'star': return new Star(p.outerRadius || 25, p.innerRadius || 10, p.points || 5);
        case 'arc': return new Arc(p.radius || 25, p.startAngle || 0, p.endAngle || 90);
        case 'roundedRectangle': return new RoundedRectangle(p.width || 50, p.height || 50, p.radius || 5);
        case 'arrow': return new Arrow(p.length || 50, p.headWidth || 15, p.headLength || 12.5);
        case 'beziercurve': return new BezierCurve(p.startX, p.startY, p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.endX, p.endY);
        case 'bspline': return new Bspline(p.points || [[0, 0], [50, 50], [100, 0]], p.closed === true, p.degree || 3);
        case 'donut': 
          const boolStartAngle = p.startAngle != null ? Number(p.startAngle) : undefined;
          const boolEndAngle = p.endAngle != null ? Number(p.endAngle) : undefined;
          console.log('[BooleanOperators _createShapeInstance donut]', {
            p,
            boolStartAngle,
            boolEndAngle,
            startAngleType: typeof boolStartAngle,
            endAngleType: typeof boolEndAngle
          });
          return new Donut(
            p.outerRadius || 25, 
            p.innerRadius || 10, 
            boolStartAngle,
            boolEndAngle
          );
        case 'spiral': return new Spiral(p.startRadius || 5, p.endRadius || 25, p.turns || 3);
        case 'cross': return new Cross(p.width || 50, p.thickness || 10);
        case 'gear': return new Gear(p.pitch_diameter || 25, p.teeth || 10, p.pressure_angle || 20);
        case 'wave': return new Wave(p.width || 50, p.amplitude || 10, p.frequency || 2);
        case 'slot': return new Slot(p.length || 50, p.width || 10);
        case 'chamferRectangle': return new ChamferRectangle(p.width || 50, p.height || 50, p.chamfer || 5);
        case 'polygonWithHoles': return new PolygonWithHoles(p.outerPath || [], p.holes || []);
        case 'dovetailpin': return new DovetailPin(p.width, p.jointCount, p.depth, p.angle, p.thickness);
        case 'dovetailtail': return new DovetailTail(p.width, p.jointCount, p.depth, p.angle, p.thickness);
        case 'fingerjointpin': return new FingerJointPin(p.width, p.fingerCount, p.fingerWidth, p.depth, p.thickness);
        case 'fingerjointsocket': return new FingerJointSocket(p.width, p.fingerCount, p.fingerWidth, p.depth, p.thickness);
        case 'halflapmale': return new HalfLapMale(p.width, p.height, p.lapLength, p.lapDepth);
        case 'halflapfemale': return new HalfLapFemale(p.width, p.height, p.lapLength, p.lapDepth);
        case 'crosslapvertical': return new CrossLapVertical(p.width, p.height, p.slotWidth, p.slotDepth, p.slotPosition);
        case 'crosslaphorizontal': return new CrossLapHorizontal(p.width, p.height, p.slotWidth, p.slotDepth, p.slotPosition);
        case 'slotboard': return new SlotBoard(p.width, p.height, p.slotCount, p.slotWidth, p.slotDepth, p.slotPosition);
        case 'tabboard': return new TabBoard(p.width, p.height, p.tabCount, p.tabWidth, p.tabDepth);
        case 'fingercombmale': return new FingerCombMale(p.width, p.height, p.toothCount, p.toothDepth);
        case 'fingercombfemale': return new FingerCombFemale(p.width, p.height, p.toothCount, p.toothDepth);
        default:
          console.warn(`Unknown shape type: ${shape.type}, using default Rectangle`);
          return new Rectangle(50, 50);
      }
    }
  
    _getShapeResolution(type) {
      const curved = ['circle','ellipse','arc','roundedrectangle','spiral','donut','wave','bspline'];
      // Increase sampling resolution to reduce boolean artifacts on curved edges
      return curved.includes(type.toLowerCase()) ? 128 : 64;
    }
  
    applyTransform(points, transform) {
      if (!Array.isArray(points)) return [];
      const { position=[0,0], rotation=0, scale=[1,1] } = transform || {};
      const rad = rotation * Math.PI/180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      return points.map(p => {
        if (p === null) return null;
        let [x,y] = p;
        x *= scale[0]; y *= scale[1];
        const rx = x*cos - y*sin, ry = x*sin + y*cos;
        return [rx + position[0], ry + position[1]];
      });
    }
  
    /**
     * Check if a contour is wound counter-clockwise
     * Uses the shoelace formula: negative sum = CCW, positive = CW
     * @param {Array<Array<number>>} contour - Array of [x, y] points
     * @returns {boolean} true if counter-clockwise, false if clockwise
     */
    _isCounterClockwise(contour) {
      if (!contour || contour.length < 3) return true;
      let sum = 0;
      for (let i = 0; i < contour.length; i++) {
        const p1 = contour[i];
        const p2 = contour[(i + 1) % contour.length];
        sum += (p2[0] - p1[0]) * (p2[1] + p1[1]);
      }
      return sum < 0; // Negative = CCW, Positive = CW
    }
    
    /**
     * Check if a Clipper path is wound counter-clockwise in Clipper coordinate space
     * Uses the shoelace formula: negative sum = CCW, positive = CW
     * @param {Array} clipperPath - Array of {X, Y} Clipper points
     * @returns {boolean} true if counter-clockwise, false if clockwise
     */
    _isCounterClockwiseClipper(clipperPath) {
      if (!clipperPath || clipperPath.length < 3) return true;
      let sum = 0;
      for (let i = 0; i < clipperPath.length; i++) {
        const p1 = clipperPath[i];
        const p2 = clipperPath[(i + 1) % clipperPath.length];
        sum += (p2.X - p1.X) * (p2.Y + p1.Y);
      }
      return sum < 0; // Negative = CCW, Positive = CW
    }
  
    extractStyling(base, op) {
      const defaults = {
        fill: true,
        fillColor: this.operationColors[op],
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 0.8
      };
      if (!base || !base.params) return defaults;
      const p = base.params, out = { ...defaults };
      if (p.fill !== undefined) out.fill = p.fill;
      if (p.fillColor) out.fillColor = p.fillColor;
      if (p.color && !p.fillColor) out.fillColor = p.color;
      if (p.strokeColor) out.strokeColor = p.strokeColor;
      if (p.strokeWidth !== undefined) out.strokeWidth = p.strokeWidth;
      if (p.opacity !== undefined) out.opacity = p.opacity;
      return out;
    }
  
    calculatePolygonArea(pts) {
      if (!Array.isArray(pts) || pts.length < 3) return 0;
      let a = 0;
      for (let i=0,j=pts.length-1;i<pts.length;j=i++){
        a += pts[j][0]*pts[i][1] - pts[i][0]*pts[j][1];
      }
      return Math.abs(a/2);
    }
  
    resetNaming() {
      this.naming.reset();
    }
  
    getStatus() {
      return {
        library: this.ClipperLib ? 'ClipperLib' : 'none',
        libraryAvailable: this.isLibraryAvailable,
        debugMode: this.debugMode
      };
    }
  }
  
  export const booleanOperator = new BooleanOperator();
