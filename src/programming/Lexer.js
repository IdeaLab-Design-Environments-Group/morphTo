import { resolveColorName } from './colorPalette.js';
// lexer.js - Updated with enhanced fill support
export class Token {
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }
}

export class Lexer {
  constructor(input) {
    this.input = input;
    this.position = 0;
    this.line = 1;
    this.column = 1;
    this.currentChar = this.input[0] || null;
  }

  error(message) {
    throw new Error(`Lexer error at line ${this.line}, col ${this.column}: ${message}`);
  }

  advance() {
    this.position++;
    if (this.position >= this.input.length) {
      this.currentChar = null;
    } else {
      this.currentChar = this.input[this.position];
      this.column++;
    }
  }

  skipComment() {
    this.advance();
    this.advance();
    while (this.currentChar !== null && this.currentChar !== '\n') {
      this.advance();
    }
  }

  skipWhitespace() {
    while (this.currentChar && /\s/.test(this.currentChar)) {
      if (this.currentChar === '\n') {
        this.line++;
        this.column = 1;
      }
      this.advance();
    }
  }

  number() {
    let result = '';
    while (this.currentChar && /\d/.test(this.currentChar)) {
      result += this.currentChar;
      this.advance();
    }
    if (this.currentChar === '.') {
      result += '.';
      this.advance();
      while (this.currentChar && /\d/.test(this.currentChar)) {
        result += this.currentChar;
        this.advance();
      }
    }
    return new Token('NUMBER', parseFloat(result), this.line, this.column);
  }

  identifier() {
    let result = '';
    while (this.currentChar && /[a-zA-Z0-9_]/.test(this.currentChar)) {
      result += this.currentChar;
      this.advance();
    }
    
    // Extended keywords with enhanced fill support
    const keywords = {
      // Core language keywords
      'param': 'PARAM',
      'shape': 'SHAPE',
      'layer': 'LAYER',
      'transform': 'TRANSFORM',
      'add': 'ADD',
      'subtract': 'SUBTRACT',
      'rotate': 'ROTATE',
      'scale': 'SCALE',
      'position': 'POSITION',
      'if': 'IF',
      'else': 'ELSE',
      'endif': 'ENDIF',
      'true': 'TRUE',
      'false': 'FALSE',
      'and': 'AND',
      'or': 'OR',
      'not': 'NOT',
      'for': 'FOR',
      'from': 'FROM',
      'to': 'TO',
      'step': 'STEP',
      'in': 'IN',
      'def': 'DEF',
      'return': 'RETURN',
      
      // Boolean operations
      'union': 'UNION',
      'difference': 'DIFFERENCE',
      'intersection': 'INTERSECTION',
      
      // Drawing commands
      'draw': 'DRAW',
      'forward': 'FORWARD',
      'backward': 'BACKWARD',
      'right': 'RIGHT',
      'left': 'LEFT',
      'goto': 'GOTO',
      'penup': 'PENUP',
      'pendown': 'PENDOWN',

      // Constraints
      'constraints': 'CONSTRAINTS',
      'coincident': 'COINCIDENT',
      'distance': 'DISTANCE',
      'horizontal': 'HORIZONTAL',
      'vertical': 'VERTICAL',
      
      // Enhanced fill and styling keywords
      'fill': 'FILL',
      'filled': 'FILLED',
      'fillColor': 'FILLCOLOR',
      'fillcolor': 'FILLCOLOR',
      'color': 'COLOR',
      'stroke': 'STROKE',
      'strokeColor': 'STROKECOLOR',
      'strokecolor': 'STROKECOLOR',
      'strokeWidth': 'STROKEWIDTH',
      'strokewidth': 'STROKEWIDTH',
      'opacity': 'OPACITY',
      'alpha': 'OPACITY',
      'transparent': 'TRANSPARENT',
      'visible': 'VISIBLE',
      'hidden': 'HIDDEN',
      
      // Additional styling keywords
      'style': 'STYLE',
      'thickness': 'STROKEWIDTH',
      'border': 'STROKECOLOR',
      'background': 'FILLCOLOR',
      
      // Common color names (including gray variants)
      'red': 'COLORNAME',
      'green': 'COLORNAME',
      'blue': 'COLORNAME',
      'yellow': 'COLORNAME',
      'orange': 'COLORNAME',
      'purple': 'COLORNAME',
      'pink': 'COLORNAME',
      'brown': 'COLORNAME',
      'black': 'COLORNAME',
      'white': 'COLORNAME',
      'gray': 'COLORNAME',
      'grey': 'COLORNAME',
      'lightgray': 'COLORNAME',
      'lightgrey': 'COLORNAME',
      'darkgray': 'COLORNAME',
      'darkgrey': 'COLORNAME',
      'cyan': 'COLORNAME',
      'magenta': 'COLORNAME',
      'lime': 'COLORNAME',
      'navy': 'COLORNAME',
      'teal': 'COLORNAME',
      'silver': 'COLORNAME',
      'gold': 'COLORNAME'
    };
    
    const type = keywords[result.toLowerCase()] || 'IDENTIFIER';
    return new Token(type, result, this.line, this.column);
  }

  // Enhanced string parsing to handle color values
  parseString() {
    let result = '';
    this.advance(); // Skip opening quote
    
    while (this.currentChar !== null && this.currentChar !== '"') {
      if (this.currentChar === '\\') {
        // Handle escape sequences
        this.advance();
        if (this.currentChar === 'n') {
          result += '\n';
        } else if (this.currentChar === 't') {
          result += '\t';
        } else if (this.currentChar === 'r') {
          result += '\r';
        } else if (this.currentChar === '\\') {
          result += '\\';
        } else if (this.currentChar === '"') {
          result += '"';
        } else {
          result += this.currentChar;
        }
        this.advance();
      } else {
        result += this.currentChar;
        this.advance();
      }
    }
    
    if (this.currentChar === '"') {
      this.advance(); // Skip closing quote
    } else {
      this.error('Unterminated string literal');
    }
    
    return new Token('STRING', result, this.line, this.column);
  }

  // Parse hex color values
  parseHexColor() {
    let result = '#';
    this.advance(); // Skip the #
    
    while (this.currentChar && /[0-9a-fA-F]/.test(this.currentChar)) {
      result += this.currentChar;
      this.advance();
    }
    
    // Validate hex color length (3, 4, 6, or 8 characters after #)
    const hexLength = result.length - 1;
    if (hexLength === 3 || hexLength === 4 || hexLength === 6 || hexLength === 8) {
      return new Token('HEXCOLOR', result, this.line, this.column);
    } else {
      this.error(`Invalid hex color format: ${result}`);
    }
  }

  getNextToken() {
    while (this.currentChar !== null) {
      // Skip comments
      if (this.currentChar === '/' && this.input[this.position + 1] === '/') {
        this.skipComment();
        continue;
      }
      
      // Skip whitespace
      if (/\s/.test(this.currentChar)) {
        this.skipWhitespace();
        continue;
      }
      
      // Numbers
      if (/\d/.test(this.currentChar)) {
        return this.number();
      }
      
      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(this.currentChar)) {
        return this.identifier();
      }

      // Hex colors
      if (this.currentChar === '#') {
        return this.parseHexColor();
      }

      // Strings
      if (this.currentChar === '"') {
        return this.parseString();
      }

      // Comparison operators
      if (this.currentChar === '=' && this.input[this.position + 1] === '=') {
        this.advance();
        this.advance();
        return new Token('EQUALS', '==', this.line, this.column - 1);
      }

      if (this.currentChar === '!' && this.input[this.position + 1] === '=') {
        this.advance();
        this.advance();
        return new Token('NOT_EQUALS', '!=', this.line, this.column - 1);
      }

      if (this.currentChar === '<') {
        this.advance();
        if (this.currentChar === '=') {
          this.advance();
          return new Token('LESS_EQUALS', '<=', this.line, this.column - 1);
        }
        return new Token('LESS', '<', this.line, this.column);
      }

      if (this.currentChar === '>') {
        this.advance();
        if (this.currentChar === '=') {
          this.advance();
          return new Token('GREATER_EQUALS', '>=', this.line, this.column - 1);
        }
        return new Token('GREATER', '>', this.line, this.column);
      }

      // Single character tokens
      switch (this.currentChar) {
        case '{':
          this.advance();
          return new Token('LBRACE', '{', this.line, this.column);
        case '}':
          this.advance();
          return new Token('RBRACE', '}', this.line, this.column);
        case '[':
          this.advance();
          return new Token('LBRACKET', '[', this.line, this.column);
        case ']':
          this.advance();
          return new Token('RBRACKET', ']', this.line, this.column);
        case '(':
          this.advance();
          return new Token('LPAREN', '(', this.line, this.column);
        case ')':
          this.advance();
          return new Token('RPAREN', ')', this.line, this.column);
        case ':':
          this.advance();
          return new Token('COLON', ':', this.line, this.column);
        case ',':
          this.advance();
          return new Token('COMMA', ',', this.line, this.column);
        case ';':
          this.advance();
          return new Token('SEMICOLON', ';', this.line, this.column);
        case '*':
          this.advance();
          return new Token('MULTIPLY', '*', this.line, this.column);
        case '/':
          this.advance();
          return new Token('DIVIDE', '/', this.line, this.column);
        case '+':
          this.advance();
          return new Token('PLUS', '+', this.line, this.column);
        case '-':
          this.advance();
          return new Token('MINUS', '-', this.line, this.column);
        case '.':
          this.advance();
          return new Token('DOT', '.', this.line, this.column);
        case '=':
          this.advance();
          return new Token('ASSIGN', '=', this.line, this.column);
        case '%':
          this.advance();
          return new Token('PERCENT', '%', this.line, this.column);
        case '&':
          this.advance();
          return new Token('AMPERSAND', '&', this.line, this.column);
        case '|':
          this.advance();
          return new Token('PIPE', '|', this.line, this.column);
        case '^':
          this.advance();
          return new Token('CARET', '^', this.line, this.column);
        case '~':
          this.advance();
          return new Token('TILDE', '~', this.line, this.column);
        case '?':
          this.advance();
          return new Token('QUESTION', '?', this.line, this.column);
        case '@':
          this.advance();
          return new Token('AT', '@', this.line, this.column);
        case '$':
          this.advance();
          return new Token('DOLLAR', '$', this.line, this.column);
        default:
          this.error(`Unknown character: ${this.currentChar}`);
      }
    }
    
    return new Token('EOF', null, this.line, this.column);
  }

  // Utility method to peek at the next token without consuming it
  peekToken() {
    const savedPosition = this.position;
    const savedLine = this.line;
    const savedColumn = this.column;
    const savedCurrentChar = this.currentChar;
    
    const token = this.getNextToken();
    
    // Restore state
    this.position = savedPosition;
    this.line = savedLine;
    this.column = savedColumn;
    this.currentChar = savedCurrentChar;
    
    return token;
  }

  // Method to tokenize entire input (useful for debugging)
  tokenize() {
    const tokens = [];
    let token = this.getNextToken();
    
    while (token.type !== 'EOF') {
      tokens.push(token);
      token = this.getNextToken();
    }
    
    tokens.push(token); // Add EOF token
    return tokens;
  }

  // Method to reset lexer to beginning
  reset() {
    this.position = 0;
    this.line = 1;
    this.column = 1;
    this.currentChar = this.input[0] || null;
  }

  // Method to check if a string is a valid color
  static isValidColor(colorString) {
    if (!colorString || typeof colorString !== 'string') {
      return false;
    }
    
    // Check hex colors
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(colorString)) {
      return true;
    }
    
    // Check rgb/rgba colors
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(colorString)) {
      return true;
    }
    
    // Check hsl/hsla colors
    if (/^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+\s*)?\)$/.test(colorString)) {
      return true;
    }
    
    // Check named colors (including gray variants)
    const namedColors = [
      'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'brown',
      'black', 'white', 'gray', 'grey', 'lightgray', 'lightgrey', 'darkgray', 'darkgrey',
      'cyan', 'magenta', 'lime', 'navy', 'teal', 'silver', 'gold', 'transparent'
    ];
    
    return namedColors.includes(colorString.toLowerCase());
  }

  // Helper method to resolve color names to hex values
  static resolveColorName(colorName) {
    // Delegates to the shared AQUI color palette.
    return resolveColorName(colorName);
  }
}
