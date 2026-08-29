/**
 * Snap Strategy using Strategy Pattern
 * Handles different snapping behaviors for shapes
 */

/**
 * Base snap strategy interface
 */
export class SnapStrategy {
    /**
     * Snap coordinates
     * @param {number} x 
     * @param {number} y 
     * @param {Object} context - Additional context (grid size, shapes, etc.)
     * @returns {Object} {x, y} - Snapped coordinates
     */
    snap(x, y, context = {}) {
        return { x, y };
    }
}

/**
 * No snapping - returns coordinates as-is
 */
export class NoSnap extends SnapStrategy {
    snap(x, y, context = {}) {
        return { x, y };
    }
}

/**
 * Snap to grid
 */
export class GridSnap extends SnapStrategy {
    /**
     * @param {number} gridSize - Grid cell size
     */
    constructor(gridSize = 20) {
        super();
        this.gridSize = gridSize;
    }
    
    snap(x, y, context = {}) {
        const size = context.gridSize || this.gridSize;
        return {
            x: Math.round(x / size) * size,
            y: Math.round(y / size) * size
        };
    }
}

/**
 * Snap to other shapes (snaps to nearest shape vertex or center)
 */
export class ShapeSnap extends SnapStrategy {
    /**
     * @param {number} snapDistance - Maximum distance to snap
     */
    constructor(snapDistance = 10) {
        super();
        this.snapDistance = snapDistance;
    }
    
    snap(x, y, context = {}) {
        const shapes = context.shapes || [];
        const snapDist = context.snapDistance || this.snapDistance;
        
        if (shapes.length === 0) {
            return { x, y };
        }
        
        let nearestX = x;
        let nearestY = y;
        let minDist = snapDist;
        
        // Check snap points from all shapes
        shapes.forEach(shape => {
            const bounds = shape.getBounds ? shape.getBounds() : null;
            if (!bounds) return;
            
            // Snap points: corners, center, edge midpoints
            const snapPoints = [
                { x: bounds.x, y: bounds.y }, // Top-left
                { x: bounds.x + bounds.width, y: bounds.y }, // Top-right
                { x: bounds.x, y: bounds.y + bounds.height }, // Bottom-left
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, // Bottom-right
                { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, // Center
                { x: bounds.x + bounds.width / 2, y: bounds.y }, // Top-center
                { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, // Bottom-center
                { x: bounds.x, y: bounds.y + bounds.height / 2 }, // Left-center
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 } // Right-center
            ];
            
            snapPoints.forEach(point => {
                const dist = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
                if (dist < minDist) {
                    minDist = dist;
                    nearestX = point.x;
                    nearestY = point.y;
                }
            });
        });
        
        return { x: nearestX, y: nearestY };
    }
}
