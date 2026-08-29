// turtleDrawer.js
export class TurtleDrawer {
    constructor() {
      this.reset();
    }
    
    reset() {
      this.position = [0, 0];
      this.angle = 0;         // in degrees
      this.penDown = true;
      this.paths = [];
      this.currentPath = [[0, 0]];
    }
    
    forward(distance) {
      const radians = this.angle * Math.PI / 180;
      const newX = this.position[0] + distance * Math.cos(radians);
      const newY = this.position[1] + distance * Math.sin(radians);
      this.goto([newX, newY]);
    }
    
    backward(distance) {
      this.forward(-distance);
    }
    
    right(angle) {
      this.angle = (this.angle + angle) % 360;
    }
    
    left(angle) {
      this.angle = (this.angle - angle) % 360;
      if (this.angle < 0) {
        this.angle += 360;
      }
    }
    
    goto(position) {
      if (this.penDown) {
        this.currentPath.push(position);
      } else {
        if (this.currentPath.length > 1) {
          this.paths.push([...this.currentPath]);
        }
        this.currentPath = [position];
      }
      this.position = position;
    }
    
    penup() {
      if (this.penDown) {
        if (this.currentPath.length > 1) {
          this.paths.push([...this.currentPath]);
        }
        this.currentPath = [this.position];
        this.penDown = false;
      }
    }
    
    pendown() {
      if (!this.penDown) {
        this.penDown = true;
        this.currentPath = [this.position];
      }
    }
    
    getDrawingPaths() {
      const allPaths = [...this.paths];
      if (this.currentPath.length > 1) {
        allPaths.push([...this.currentPath]);
      }
      return allPaths;
    }
  }