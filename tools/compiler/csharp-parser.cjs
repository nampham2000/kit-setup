'use strict';

/**
 * High-Precision C# Tokenizer & AST Parser for Unity C# Codebases
 *
 * Parses Unity C# source code into a detailed Abstract Syntax Tree (AST)
 * preserving full semantic structure, types, modifiers, attributes,
 * comments (trivia), line/column positions, and expressions.
 */

// ── Token Types ─────────────────────────────────────────────────────────────
const TokenType = {
  KEYWORD: 'KEYWORD',
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  CHAR: 'CHAR',
  PUNCTUATION: 'PUNCTUATION',
  OPERATOR: 'OPERATOR',
  COMMENT_LINE: 'COMMENT_LINE',
  COMMENT_BLOCK: 'COMMENT_BLOCK',
  PREPROCESSOR: 'PREPROCESSOR',
  EOF: 'EOF',
};

const CSHARP_KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char',
  'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate',
  'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false',
  'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit',
  'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace',
  'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private',
  'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed',
  'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked',
  'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while',
  'yield', 'async', 'await', 'var', 'record', 'get', 'set', 'value', 'add', 'remove',
  'nameof', 'when', 'init', 'not', 'global'
]);

const CONTEXTUAL_IDENTIFIER_KEYWORDS = new Set([
  'value', 'get', 'set', 'add', 'remove', 'init', 'when', 'var', 'nameof',
  'not', 'yield', 'record', 'unmanaged', 'ascending', 'descending', 'by',
  'from', 'group', 'into', 'join', 'let', 'on', 'orderby', 'select', 'where', 'global'
]);

function isIdentifierToken(tok) {
  if (!tok) return false;
  return tok.type === TokenType.IDENTIFIER || (tok.type === TokenType.KEYWORD && CONTEXTUAL_IDENTIFIER_KEYWORDS.has(tok.value));
}

// ── Tokenizer ───────────────────────────────────────────────────────────────
class Lexer {
  constructor(source, filename = '') {
    this.source = source;
    this.filename = filename;
    this.pos = 0;
    this.len = source.length;
    this.line = 1;
    this.column = 1;
  }

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.len ? this.source[idx] : '\0';
  }

  advance() {
    if (this.pos >= this.len) return '\0';
    const ch = this.source[this.pos++];
    // Unity assets occasionally contain Unicode line/paragraph separators
    // (notably files exported by older Asset Store packages). Treat them as
    // real newlines so that line comments do not consume the rest of a file.
    if (ch === '\n' || ch === '\u2028' || ch === '\u2029') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  tokenize() {
    const tokens = [];
    while (this.pos < this.len) {
      const ch = this.peek();

      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\u2028' || ch === '\u2029') {
        this.advance();
        continue;
      }

      const startLine = this.line;
      const startCol = this.column;

      // Line Comment
      if (ch === '/' && this.peek(1) === '/') {
        this.advance(); this.advance();
        let comment = '';
        while (this.pos < this.len && this.peek() !== '\n' && this.peek() !== '\u2028' && this.peek() !== '\u2029') {
          comment += this.advance();
        }
        tokens.push({
          type: TokenType.COMMENT_LINE,
          value: comment.trim(),
          raw: '//' + comment,
          line: startLine,
          column: startCol,
        });
        continue;
      }

      // Block Comment
      if (ch === '/' && this.peek(1) === '*') {
        this.advance(); this.advance();
        let comment = '';
        while (this.pos < this.len && !(this.peek() === '*' && this.peek(1) === '/')) {
          comment += this.advance();
        }
        if (this.pos < this.len) { this.advance(); this.advance(); }
        tokens.push({
          type: TokenType.COMMENT_BLOCK,
          value: comment.trim(),
          raw: '/*' + comment + '*/',
          line: startLine,
          column: startCol,
        });
        continue;
      }

      // Preprocessor
      if (ch === '#') {
        let directive = '';
        while (this.pos < this.len && this.peek() !== '\n') {
          directive += this.advance();
        }
        tokens.push({
          type: TokenType.PREPROCESSOR,
          value: directive.trim(),
          line: startLine,
          column: startCol,
        });
        continue;
      }

      // String literals (regular, verbatim, interpolated)
      if (ch === '"' || (ch === '@' && this.peek(1) === '"') || (ch === '$' && this.peek(1) === '"') ||
          (ch === '$' && this.peek(1) === '@' && this.peek(2) === '"') ||
          (ch === '@' && this.peek(1) === '$' && this.peek(2) === '"')) {
        const isVerbatim = ch === '@' || (ch === '$' && this.peek(1) === '@') || (ch === '@' && this.peek(1) === '$');
        const isInterpolated = ch === '$' || (ch === '@' && this.peek(1) === '$') || (ch === '$' && this.peek(1) === '@');
        
        while (this.peek() !== '"' && this.pos < this.len) this.advance();
        this.advance();
        
        let strVal = '';
        let braceDepth = 0;

        while (this.pos < this.len) {
          const c = this.advance();
          if (isInterpolated && c === '{') {
            braceDepth++;
            strVal += c;
          } else if (isInterpolated && c === '}' && braceDepth > 0) {
            braceDepth--;
            strVal += c;
          } else if (c === '"') {
            if (isVerbatim && this.peek() === '"') {
              strVal += '"';
              this.advance();
            } else if (braceDepth > 0) {
              strVal += c;
            } else {
              break;
            }
          } else if (c === '\\' && !isVerbatim) {
            const next = this.advance();
            strVal += '\\' + next;
          } else {
            strVal += c;
          }
        }
        tokens.push({
          type: TokenType.STRING,
          value: strVal,
          isVerbatim,
          isInterpolated,
          line: startLine,
          column: startCol,
        });
        continue;
      }

      // Char literal
      if (ch === '\'') {
        this.advance();
        let charVal = '';
        while (this.pos < this.len && this.peek() !== '\'') {
          if (this.peek() === '\\') {
            charVal += this.advance();
          }
          charVal += this.advance();
        }
        if (this.peek() === '\'') this.advance();
        tokens.push({
          type: TokenType.CHAR,
          value: charVal,
          line: startLine,
          column: startCol,
        });
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.peek(1)))) {
        let numStr = '';
        if (ch === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
          numStr += this.advance();
          numStr += this.advance();
          while (/[0-9a-fA-F_]/.test(this.peek())) numStr += this.advance();
        } else if (ch === '0' && (this.peek(1) === 'b' || this.peek(1) === 'B')) {
          numStr += this.advance();
          numStr += this.advance();
          while (/[01_]/.test(this.peek())) numStr += this.advance();
        } else {
          while (/[0-9_]/.test(this.peek())) numStr += this.advance();
          if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
            numStr += this.advance();
            while (/[0-9_]/.test(this.peek())) numStr += this.advance();
          }
          if (this.peek() === 'e' || this.peek() === 'E') {
            numStr += this.advance();
            if (this.peek() === '+' || this.peek() === '-') numStr += this.advance();
            while (/[0-9_]/.test(this.peek())) numStr += this.advance();
          }
        }
        while (/[fFdDmMuUlL]/.test(this.peek())) {
          numStr += this.advance();
        }
        tokens.push({
          type: TokenType.NUMBER,
          value: numStr,
          line: startLine,
          column: startCol,
        });
        continue;
      }

      // Multi-character operators
      const twoChar = ch + this.peek(1);
      const threeChar = twoChar + this.peek(2);
      
      if (['<<=', '>>=', '??='].includes(threeChar)) {
        this.advance(); this.advance(); this.advance();
        tokens.push({ type: TokenType.OPERATOR, value: threeChar, line: startLine, column: startCol });
        continue;
      }

      if (['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '??', '=>', '::', '<<', '>>', '?.', '->', '..'].includes(twoChar)) {
        this.advance(); this.advance();
        tokens.push({ type: TokenType.OPERATOR, value: twoChar, line: startLine, column: startCol });
        continue;
      }

      // Single character punctuation / operators
      if ('{}[]();,'.includes(ch)) {
        this.advance();
        tokens.push({ type: TokenType.PUNCTUATION, value: ch, line: startLine, column: startCol });
        continue;
      }

      if ('+-*/%<>=!&|^~?:.'.includes(ch)) {
        this.advance();
        tokens.push({ type: TokenType.OPERATOR, value: ch, line: startLine, column: startCol });
        continue;
      }

      // Identifiers / Keywords
      let isVerbatimId = false;
      if (ch === '@' && /[a-zA-Z_]/.test(this.peek(1))) {
        this.advance();
        isVerbatimId = true;
      }

      if (/[a-zA-Z_]/.test(this.peek())) {
        let id = '';
        while (/[a-zA-Z0-9_]/.test(this.peek())) {
          id += this.advance();
        }
        const isKw = !isVerbatimId && CSHARP_KEYWORDS.has(id);
        tokens.push({
          type: isKw ? TokenType.KEYWORD : TokenType.IDENTIFIER,
          value: id,
          isVerbatim: isVerbatimId,
          line: startLine,
          column: startCol,
        });
        continue;
      }

      this.advance();
    }

    tokens.push({
      type: TokenType.EOF,
      value: '',
      line: this.line,
      column: this.column,
    });

    return tokens;
  }
}

// ── Recursive Descent AST Parser ────────────────────────────────────────────
class Parser {
  constructor(tokens, filename = '') {
    this.tokens = tokens;
    this.filename = filename;
    this.pos = 0;
    this.comments = [];
    this.inSwitchArmPattern = false;
    this.filteredTokens = [];
    for (const t of tokens) {
      if (t.type === TokenType.COMMENT_LINE || t.type === TokenType.COMMENT_BLOCK) {
        this.comments.push(t);
      } else if (t.type !== TokenType.PREPROCESSOR) {
        this.filteredTokens.push(t);
      }
    }
    this.tokens = this.filteredTokens;
    this.len = this.tokens.length;
  }

  match(val) {
    if (this.current().type === TokenType.CHAR || this.current().type === TokenType.STRING) return false;
    if (this.current().value === val) {
      this.advance();
      return true;
    }
    return false;
  }

  expect(val) {
    if (this.current().type === TokenType.CHAR || this.current().type === TokenType.STRING || this.current().value !== val) {
      throw new Error(
        `[C# Parser] Expected '${val}' at ${this.filename}:${this.current().line}:${this.current().column}, got '${this.current().value}' (${this.current().type})`
      );
    }
    return this.advance();
  }

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.len ? this.tokens[idx] : this.tokens[this.len - 1];
  }

  current() {
    return this.peek(0);
  }

  advance() {
    const token = this.current();
    if (this.pos < this.len - 1) this.pos++;
    return token;
  }

  matchOp(value) {
    if (this.current().type === TokenType.OPERATOR && this.current().value === value) {
      return this.advance();
    }
    return null;
  }

  isTernaryColonAhead() {
    let depth = 0;
    let idx = 1;
    while (idx < 50) {
      const t = this.peek(idx);
      if (t.type === TokenType.EOF || t.value === ';' || t.value === ',' || t.value === ')' || t.value === ']' || t.value === '}' || t.value === '{' || t.value === '=>' || t.value === '>') {
        if (depth === 0) break;
      }
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        depth--;
        if (depth < 0) break;
      }
      else if (t.value === '?' && depth === 0) depth++;
      else if (t.value === ':' && depth === 0) {
        return true;
      }
      idx++;
    }
    return false;
  }

  expectClosingGenericBracket() {
    if (this.current().value === '>') {
      this.advance();
      return;
    }
    if (this.current().value === '>>') {
      this.current().value = '>';
      return;
    }
    this.expect('>');
  }

  // ── Top Level Parsing ───────────────────────────────────────────────────────
  parseCompilationUnit() {
    const unit = {
      kind: 'CompilationUnit',
      filename: this.filename,
      usings: [],
      namespaces: [],
      classes: [],
      structs: [],
      enums: [],
      interfaces: [],
      delegates: [],
      comments: this.comments,
    };

    while (this.current().type !== TokenType.EOF) {
      if (this.current().value === 'using' && this.peek(1).value !== '(') {
        unit.usings.push(this.parseUsingDirective());
      } else if (this.current().value === 'namespace') {
        unit.namespaces.push(this.parseNamespace());
      } else {
        const typeDecl = this.parseTypeDeclaration();
        if (typeDecl) {
          if (typeDecl.kind === 'ClassDeclaration') unit.classes.push(typeDecl);
          else if (typeDecl.kind === 'StructDeclaration') unit.structs.push(typeDecl);
          else if (typeDecl.kind === 'EnumDeclaration') unit.enums.push(typeDecl);
          else if (typeDecl.kind === 'InterfaceDeclaration') unit.interfaces.push(typeDecl);
          else if (typeDecl.kind === 'DelegateDeclaration') unit.delegates.push(typeDecl);
        } else {
          this.advance();
        }
      }
    }

    return unit;
  }

  parseUsingDirective() {
    const start = this.expect('using');
    let alias = null;
    let name = '';
    
    let isStatic = false;
    if (this.current().value === 'static') {
      this.advance();
      isStatic = true;
    }

    name = this.parseQualifiedName();
    if (this.match('=')) {
      alias = name;
      name = this.parseQualifiedName();
    }
    this.match(';');

    return {
      kind: 'UsingDirective',
      name,
      alias,
      isStatic,
      line: start.line,
    };
  }

  parseNamespace() {
    const start = this.expect('namespace');
    const name = this.parseQualifiedName();
    const isFileScoped = this.match(';');
    
    const ns = {
      kind: 'NamespaceDeclaration',
      name,
      isFileScoped: !!isFileScoped,
      usings: [],
      classes: [],
      structs: [],
      enums: [],
      interfaces: [],
      delegates: [],
      line: start.line,
    };

    const targetClasses = ns.classes;
    const targetStructs = ns.structs;
    const targetEnums = ns.enums;
    const targetInterfaces = ns.interfaces;
    const targetDelegates = ns.delegates;

    const parseInside = (closeOnBrace) => {
      while (this.current().type !== TokenType.EOF) {
        if (closeOnBrace && this.match('}')) break;
        if (this.current().value === 'using' && this.peek(1).value !== '(') {
          ns.usings.push(this.parseUsingDirective());
        } else {
          const typeDecl = this.parseTypeDeclaration();
          if (typeDecl) {
            if (typeDecl.kind === 'ClassDeclaration') targetClasses.push(typeDecl);
            else if (typeDecl.kind === 'StructDeclaration') targetStructs.push(typeDecl);
            else if (typeDecl.kind === 'EnumDeclaration') targetEnums.push(typeDecl);
            else if (typeDecl.kind === 'InterfaceDeclaration') targetInterfaces.push(typeDecl);
            else if (typeDecl.kind === 'DelegateDeclaration') targetDelegates.push(typeDecl);
          } else {
            this.advance();
          }
        }
      }
    };

    if (isFileScoped) {
      parseInside(false);
    } else if (this.match('{')) {
      parseInside(true);
    }

    return ns;
  }

  parseQualifiedName() {
    let parts = [];
    while (isIdentifierToken(this.current()) || this.current().type === TokenType.KEYWORD) {
      parts.push(this.advance().value);
      if (this.current().value === '.' || this.current().value === '::') {
        this.advance();
      } else {
        break;
      }
    }
    return parts.join('.');
  }

  // ── Type Declarations ───────────────────────────────────────────────────────
  parseAttributes() {
    const attributes = [];
    while (this.current().type === TokenType.PUNCTUATION && this.current().value === '[') {
      this.advance();
      let target = null;
      if (this.peek(1).value === ':') {
        target = this.advance().value;
        this.advance();
      }
      
      while (this.current().type !== TokenType.EOF) {
        const name = this.parseQualifiedName();
        let args = [];
        if (this.match('(')) {
          args = this.parseArgumentList();
          this.match(')');
        }
        attributes.push({ name, args, target });
        if (!this.match(',')) break;
      }
      this.expect(']');
    }
    return attributes;
  }

  parseModifiers() {
    const modifiers = [];
    const MODIFIER_SET = new Set([
      'public', 'private', 'protected', 'internal', 'static', 'readonly',
      'volatile', 'virtual', 'override', 'abstract', 'sealed', 'extern',
      'unsafe', 'async', 'new', 'partial', 'event', 'ref', 'const', 'required',
      'fixed'
    ]);
    while (MODIFIER_SET.has(this.current().value)) {
      modifiers.push(this.advance().value);
    }
    return modifiers;
  }

  parseTypeDeclaration() {
    const savePos = this.pos;
    const attributes = this.parseAttributes();
    const modifiers = this.parseModifiers();
    const curVal = this.current().value;

    if (curVal === 'class' || curVal === 'struct' || curVal === 'interface') {
      const typeKind = this.advance().value;
      const name = this.current().value;
      this.advance();

      let genericParams = [];
      if (this.match('<')) {
        genericParams = this.parseGenericParameters();
      }

      const baseTypes = [];
      if (this.match(':')) {
        do {
          baseTypes.push(this.parseTypeReference());
        } while (this.match(','));
      }

      const constraints = this.parseGenericConstraints();

      const members = [];
      if (this.match('{')) {
        while (!(this.current().value === '}' && this.current().type === TokenType.PUNCTUATION) && this.current().type !== TokenType.EOF) {
          const member = this.parseMemberDeclaration(name);
          if (member) {
            members.push(member);
          } else {
            this.advance();
          }
        }
        this.expect('}');
      }

      const kindName = typeKind === 'class' ? 'ClassDeclaration' : (typeKind === 'struct' ? 'StructDeclaration' : 'InterfaceDeclaration');
      return {
        kind: kindName,
        name,
        attributes,
        modifiers,
        genericParams,
        baseTypes,
        constraints,
        members,
        line: this.current().line,
      };
    }

    if (curVal === 'enum') {
      this.advance();
      const name = this.advance().value;
      let underlyingType = 'int';
      if (this.match(':')) {
        underlyingType = this.parseTypeReference().name;
      }
      const members = [];
      if (this.match('{')) {
        while (!this.match('}') && this.current().type !== TokenType.EOF) {
          const mAttrs = this.parseAttributes();
          const mName = this.advance().value;
          let mValue = null;
          if (this.match('=')) {
            mValue = this.parseExpression();
          }
          members.push({ name: mName, value: mValue, attributes: mAttrs });
          this.match(',');
        }
      }
      return {
        kind: 'EnumDeclaration',
        name,
        underlyingType,
        attributes,
        modifiers,
        members,
      };
    }

    if (curVal === 'delegate') {
      this.advance();
      const returnType = this.parseTypeReference();
      const name = this.advance().value;
      let genericParams = [];
      if (this.match('<')) {
        genericParams = this.parseGenericParameters();
      }
      this.expect('(');
      const params = this.parseParameterList();
      this.expect(')');
      this.match(';');
      return {
        kind: 'DelegateDeclaration',
        name,
        returnType,
        attributes,
        modifiers,
        genericParams,
        parameters: params,
      };
    }

    this.pos = savePos;
    return null;
  }

  parseGenericParameters() {
    const params = [];
    do {
      let variance = null;
      if (this.current().value === 'out' || this.current().value === 'in') {
        variance = this.advance().value;
      }
      const pName = this.advance().value;
      params.push({ name: pName, variance });
    } while (this.match(','));
    this.expectClosingGenericBracket();
    return params;
  }

  parseGenericConstraints() {
    const constraints = [];
    while (this.current().value === 'where') {
      this.advance();
      const typeParam = this.advance().value;
      this.expect(':');
      const rules = [];
      do {
        if (this.current().value === 'new' && this.peek(1).value === '(') {
          this.advance(); this.expect('('); this.expect(')');
          rules.push('new()');
        } else {
          rules.push(this.parseTypeReference().name);
        }
      } while (this.match(','));
      constraints.push({ typeParam, rules });
    }
    return constraints;
  }

  parseTypeReference() {
    if (this.current().value === '(') {
      this.advance(); // '('
      const tupleElements = [];
      do {
        let elemLabel = null;
        if (isIdentifierToken(this.current()) && this.peek(1).value === ':') {
          elemLabel = this.advance().value;
          this.advance();
        }
        const elemType = this.parseTypeReference();
        let elemName = null;
        if (isIdentifierToken(this.current()) && !['struct', 'class', 'enum', ',', ')'].includes(this.current().value)) {
          elemName = this.advance().value;
        }
        tupleElements.push({ type: elemType, name: elemName || elemLabel });
      } while (this.match(','));
      this.expect(')');
      let isNullable = false;
      if (this.current().value === '?' && !this.isTernaryColonAhead()) {
        this.advance();
        isNullable = true;
      }
      let isArray = false;
      let arrayRank = 0;
      while (this.match('[')) {
        isArray = true;
        let rank = 1;
        while (this.match(',')) rank++;
        this.expect(']');
        arrayRank = rank;
      }
      const tupleName = '(' + tupleElements.map(e => (e.type && e.type.name) || 'any').join(', ') + ')' + (isNullable ? '?' : '') + (isArray ? '[]' : '');
      return { kind: 'TupleTypeReference', name: tupleName, elements: tupleElements, isNullable, isArray, arrayRank };
    }

    let name = '';
    if (isIdentifierToken(this.current()) || this.current().type === TokenType.KEYWORD) {
      name = this.advance().value;
      while (this.current().value === '.' || this.current().value === '::') {
        name += this.advance().value + this.advance().value;
      }
    }

    let typeArgs = [];
    if (this.current().type === TokenType.OPERATOR && this.match('<')) {
      do {
        typeArgs.push(this.parseTypeReference());
      } while (this.match(','));
      this.expectClosingGenericBracket();
    }

    while (this.match('.')) {
      name += '.' + this.advance().value;
      if (this.current().type === TokenType.OPERATOR && this.match('<')) {
        do {
          typeArgs.push(this.parseTypeReference());
        } while (this.match(','));
        this.expectClosingGenericBracket();
      }
    }

    let isPointer = false;
    while (this.matchOp('*')) {
      isPointer = true;
    }

    let isNullable = false;
    let isArray = false;
    let arrayRank = 1;

    while (true) {
      if (this.current().value === '?' && !this.isTernaryColonAhead()) {
        this.advance();
        isNullable = true;
      } else if (this.current().type === TokenType.PUNCTUATION && this.current().value === '[') {
        if (this.peek(1).value !== ']' && this.peek(1).value !== ',') {
          break;
        }
        this.advance();
        let rank = 1;
        while (this.match(',')) {
          rank++;
        }
        this.expect(']');
        isArray = true;
        arrayRank = rank;
      } else {
        break;
      }
    }

    return {
      kind: 'TypeReference',
      name,
      typeArgs,
      isPointer,
      isNullable,
      isArray,
      arrayRank,
    };
  }


  isGenericTypeOrInvocationAhead() {
    if (this.current().type !== TokenType.OPERATOR || this.current().value !== '<') return false;
    let depth = 0;
    let idx = 0;
    // Do not cap this lookahead to a small token count. Dependency-injection
    // frameworks such as Zenject routinely emit generic invocations with
    // dozens of nested type arguments. The terminating-token checks below
    // keep relational expressions bounded without rejecting valid C#.
    while (this.pos + idx < this.len) {
      const tok = this.peek(idx);
      if (tok.type === TokenType.EOF || tok.value === ';' || tok.value === '}' || tok.value === '{' ||
          tok.value === '=>' || tok.value === ',' && depth <= 1 && this.peek(idx + 1).value === '=>' ||
          tok.value === '||' || tok.value === '&&' || tok.value === '==' || tok.value === '!=' ||
          tok.value === '+' || tok.value === '-' || tok.value === '*' || tok.value === '/' || tok.value === '%') {
        return false;
      }
      if (tok.value === '<') depth++;
      else if (tok.value === '>') {
        depth--;
        if (depth === 0) {
          const next = this.peek(idx + 1);
          return next.value === '(' || next.value === '.' || next.value === '[' || next.value === '?' ||
                 next.value === ')' || next.value === ',' || next.value === ';' || next.value === '}' ||
                 next.value === '=' || next.value === 'in' || isIdentifierToken(next);
        }
      } else if (tok.value === '>>') {
        depth -= 2;
        if (depth === 0) {
          const next = this.peek(idx + 1);
          return next.value === '(' || next.value === '.' || next.value === '[' || next.value === '?' ||
                 next.value === ')' || next.value === ',' || next.value === ';' || next.value === '}' ||
                 next.value === '=' || next.value === 'in' || isIdentifierToken(next);
        }
      }
      idx++;
    }
    return false;
  }

  // ── Member Declarations ─────────────────────────────────────────────────────
  parseMemberDeclaration(enclosingClassName) {
    const nestedType = this.parseTypeDeclaration();
    if (nestedType) {
      return nestedType;
    }

    const attributes = this.parseAttributes();
    const modifiers = this.parseModifiers();

    const nestedTypeAfterMods = this.parseTypeDeclaration();
    if (nestedTypeAfterMods) {
      return nestedTypeAfterMods;
    }

    // Implicit / explicit conversion operator
    if (this.current().value === 'implicit' || this.current().value === 'explicit') {
      const kind = this.advance().value;
      this.expect('operator');
      const targetType = this.parseTypeReference();
      this.expect('(');
      const params = this.parseParameterList();
      this.expect(')');
      let body = null;
      if (this.match(';')) {
        body = null;
      } else if (this.match('=>')) {
        body = { kind: 'ExpressionBody', expr: this.parseExpression() };
        this.match(';');
      } else {
        body = this.parseBlockStatement();
      }
      return {
        kind: 'ConversionOperatorDeclaration',
        conversionKind: kind,
        targetType,
        attributes,
        modifiers,
        parameters: params,
        body,
        line: this.current().line,
      };
    }

    // Constructor
    if (this.current().value === enclosingClassName && this.peek(1).value === '(') {
      const name = this.advance().value;
      this.expect('(');
      const params = this.parseParameterList();
      this.expect(')');

      let initializer = null;
      if (this.match(':')) {
        const initType = this.advance().value;
        this.expect('(');
        const initArgs = this.parseArgumentList();
        this.expect(')');
        initializer = { type: initType, args: initArgs };
      }

      let body = null;
      if (this.match(';')) {
        body = null;
      } else if (this.match('=>')) {
        body = { kind: 'ExpressionBody', expr: this.parseExpression() };
        this.match(';');
      } else if (this.current().value === '{') {
        body = this.parseBlockStatement();
      } else {
        body = null;
      }

      return {
        kind: 'ConstructorDeclaration',
        name,
        attributes,
        modifiers,
        parameters: params,
        initializer,
        body,
        line: this.current().line,
      };
    }

    // Destructor
    if (this.current().value === '~') {
      this.advance();
      const name = '~' + this.advance().value;
      this.expect('('); this.expect(')');
      const body = this.parseBlockStatement();
      return { kind: 'DestructorDeclaration', name, body };
    }

    let type = this.parseTypeReference();
    if (!type || !type.name) return null;

    // Handle preprocessor #if/#else remnants: e.g. 'TypeA TypeB MethodName('
    while (isIdentifierToken(this.current()) && (isIdentifierToken(this.peek(1)) || this.peek(1).value === '<' || this.peek(1).value === '.')) {
      if (this.peek(1).value === '(' || this.peek(2).value === '(' || this.peek(1).value === '{' || this.peek(1).value === '=') {
        type = this.parseTypeReference();
      } else {
        break;
      }
    }

    // Operator overload
    if (this.current().value === 'operator' && !this.current().isVerbatim) {
      this.advance();
      const op = this.advance().value;
      this.expect('(');
      const params = this.parseParameterList();
      this.expect(')');
      let body = null;
      if (this.match(';')) {
        body = null;
      } else if (this.match('=>')) {
        body = { kind: 'ExpressionBody', expr: this.parseExpression() };
        this.match(';');
      } else {
        body = this.parseBlockStatement();
      }
      return {
        kind: 'OperatorDeclaration',
        operator: op,
        returnType: type,
        parameters: params,
        body,
      };
    }

    // Indexer: public char this[int index] { get { ... } }
    if (this.current().value === 'this' && this.peek(1).value === '[') {
      this.advance();
      this.expect('[');
      const params = this.parseParameterList();
      this.expect(']');

      let accessors = [];
      let expressionBody = null;
      if (this.match('=>')) {
        expressionBody = this.parseExpression();
        this.match(';');
      } else if (this.match('{')) {
        while (!this.match('}') && this.current().type !== TokenType.EOF) {
          const accAttrs = this.parseAttributes();
          const accMods = this.parseModifiers();
          const accName = this.advance().value;
          let accBody = null;
          if (this.match(';')) {
            accBody = null;
          } else if (this.match('=>')) {
            accBody = { kind: 'ExpressionBody', expr: this.parseExpression() };
            this.match(';');
          } else {
            accBody = this.parseBlockStatement();
          }
          accessors.push({ name: accName, modifiers: accMods, attributes: accAttrs, body: accBody });
        }
      }

      return {
        kind: 'IndexerDeclaration',
        type,
        attributes,
        modifiers,
        parameters: params,
        accessors,
        expressionBody,
        line: this.current().line,
      };
    }

    // Member name (can be explicit interface implementation: IInterface.Method or IInterface<T>.Method)
    let memberName = this.advance().value;
    while (this.match('.')) {
      memberName += '.' + this.advance().value;
    }

    let genericParams = [];
    if (this.match('<')) {
      const gParams = this.parseGenericParameters();
      if (this.match('.')) {
        memberName += '<' + gParams.map(p => p.name).join(', ') + '>.' + this.advance().value;
        while (this.match('.')) {
          memberName += '.' + this.advance().value;
        }
      } else {
        genericParams = gParams;
      }
    }

    // Unsafe fixed-size buffer field: `private fixed uint data[128];`.
    // Preserve it as an array field plus its size expression; the migration
    // layer emits a normal JS array and an explicit semantic warning.
    if (modifiers.includes('fixed') && this.match('[')) {
      const fixedSize = this.parseExpression();
      this.expect(']');
      this.match(';');
      return {
        kind: 'FieldDeclaration',
        type: { ...type, isArray: true, arrayRank: 1 },
        attributes,
        modifiers,
        fixedSize,
        declarations: [{ name: memberName, initializer: null }],
        line: this.current().line,
      };
    }

    if (this.match('(')) {
      const params = this.parseParameterList();
      this.expect(')');
      const constraints = this.parseGenericConstraints();

      let body = null;
      if (this.match(';')) {
        body = null;
      } else if (this.match('=>')) {
        body = { kind: 'ExpressionBody', expr: this.parseExpression() };
        this.match(';');
      } else if (this.current().value === '{') {
        body = this.parseBlockStatement();
      } else {
        body = null;
      }

      return {
        kind: 'MethodDeclaration',
        name: memberName,
        returnType: type,
        attributes,
        modifiers,
        genericParams,
        parameters: params,
        constraints,
        body,
        line: this.current().line,
      };
    }

    // Property: Type Name { get; set; } or Type Name => expr;
    if (this.match('{')) {
      const accessors = [];
      while (!this.match('}') && this.current().type !== TokenType.EOF) {
        const accAttrs = this.parseAttributes();
        const accMods = this.parseModifiers();
        const accName = this.advance().value;
        let accBody = null;
        if (this.match(';')) {
          accBody = null;
        } else if (this.match('=>')) {
          accBody = { kind: 'ExpressionBody', expr: this.parseExpression() };
          this.match(';');
        } else {
          accBody = this.parseBlockStatement();
        }
        accessors.push({ name: accName, modifiers: accMods, attributes: accAttrs, body: accBody });
      }

      let initializer = null;
      if (this.match('=')) {
        initializer = this.parseExpression();
        this.match(';');
      }

      return {
        kind: 'PropertyDeclaration',
        name: memberName,
        type,
        attributes,
        modifiers,
        accessors,
        initializer,
        line: this.current().line,
      };
    }

    if (this.match('=>')) {
      const expr = this.parseExpression();
      this.match(';');
      return {
        kind: 'PropertyDeclaration',
        name: memberName,
        type,
        attributes,
        modifiers,
        isExpressionBodied: true,
        expression: expr,
        line: this.current().line,
      };
    }

    // Field: Type Name = value, Name2 = value2;
    const fields = [{ name: memberName, initializer: null }];
    if (this.match('=')) {
      fields[0].initializer = this.parseExpression();
    }
    while (this.match(',')) {
      const nextName = this.advance().value;
      let nextInit = null;
      if (this.match('=')) {
        nextInit = this.parseExpression();
      }
      fields.push({ name: nextName, initializer: nextInit });
    }
    this.match(';');

    return {
      kind: 'FieldDeclaration',
      type,
      attributes,
      modifiers,
      declarations: fields,
      line: this.current().line,
    };
  }

  parseParameterList() {
    const params = [];
    while (!(this.current().value === ')' && this.current().type === TokenType.PUNCTUATION) &&
           !(this.current().value === ']' && this.current().type === TokenType.PUNCTUATION) &&
           this.current().type !== TokenType.EOF) {
      const attrs = this.parseAttributes();
      const modifiers = [];
      while (['ref', 'out', 'in', 'params', 'this'].includes(this.current().value)) {
        modifiers.push(this.advance().value);
      }
      const type = this.parseTypeReference();
      const name = this.advance().value;
      let defaultValue = null;
      if (this.match('=')) {
        defaultValue = this.parseExpression();
      }
      params.push({ name, type, modifiers, attributes: attrs, defaultValue });
      if (!this.match(',')) break;
    }
    return params;
  }

  parseArgumentList() {
    const args = [];
    while (!(this.current().value === ')' && this.current().type === TokenType.PUNCTUATION) &&
           !(this.current().value === ']' && this.current().type === TokenType.PUNCTUATION) &&
           this.current().type !== TokenType.EOF) {
      let name = null;
      let modifier = null;
      if (['ref', 'out', 'in'].includes(this.current().value) && this.current().type === TokenType.KEYWORD) {
        modifier = this.advance().value;
        if (this.current().value === '_') {
          this.advance();
          args.push({ name: null, modifier, expr: { kind: 'DiscardExpression' } });
          if (!this.match(',')) break;
          continue;
        }
        if (modifier === 'out' && this.current().value === 'var') {
          this.advance();
          const outVarName = this.advance().value;
          args.push({ name: null, modifier, expr: { kind: 'OutVariableDeclaration', type: { name: 'var' }, name: outVarName } });
          if (!this.match(',')) break;
          continue;
        }
        if (modifier === 'out') {
          const savePos = this.pos;
          const outType = this.parseTypeReference();
          if (isIdentifierToken(this.current()) && !['struct', 'class', 'enum', ';', ')', ',', '}', ']', ':'].includes(this.current().value)) {
            const outVarName = this.advance().value;
            args.push({
              name: null,
              modifier,
              expr: { kind: 'OutVariableDeclaration', type: outType, name: outVarName }
            });
            if (!this.match(',')) break;
            continue;
          }
          this.pos = savePos;
        }
      }
      if (this.peek(1).value === ':' && isIdentifierToken(this.current()) && this.peek(2).value !== ':') {
        name = this.advance().value;
        this.advance();
      }
      const expr = this.parseExpression();
      args.push({ name, modifier, expr });
      if (!this.match(',')) break;
    }
    return args;
  }

  parseInitializerElement() {
    // C# dictionary/index initializers: { [key] = value }.
    if (this.match('[')) {
      const key = this.parseExpression();
      this.expect(']');
      this.expect('=');
      const value = this.parseExpression();
      return { kind: 'IndexerInitializer', key, value };
    }
    if (isIdentifierToken(this.current()) && this.peek(1).value === '=') {
      const name = this.advance().value;
      this.advance();
      return { kind: 'MemberInitializer', name, value: this.parseExpression() };
    }
    return this.parseExpression();
  }

  // ── Statement Parsing ───────────────────────────────────────────────────────
  parseStatement() {
    const token = this.current();

    if (token.value === '{') return this.parseBlockStatement();
    if (token.value === 'if') return this.parseIfStatement();
    if (token.value === 'for') return this.parseForStatement();
    if (token.value === 'foreach') return this.parseForEachStatement();
    if (token.value === 'while') return this.parseWhileStatement();
    if (token.value === 'do') return this.parseDoWhileStatement();
    if (token.value === 'switch') return this.parseSwitchStatement();
    if (token.value === 'return') return this.parseReturnStatement();
    if (token.value === 'break') { this.advance(); this.match(';'); return { kind: 'BreakStatement' }; }
    if (token.value === 'continue') { this.advance(); this.match(';'); return { kind: 'ContinueStatement' }; }
    if (token.value === 'goto') {
      this.advance();
      if (this.match('default')) {
        this.match(';');
        return { kind: 'GotoStatement', target: 'default' };
      }
      if (this.match('case')) {
        const caseExpr = this.parseExpression();
        this.match(';');
        return { kind: 'GotoStatement', target: 'case', caseExpr };
      }
      const label = this.advance().value;
      this.match(';');
      return { kind: 'GotoStatement', target: label };
    }
    if (token.value === 'yield') return this.parseYieldStatement();
    if (token.value === 'try') return this.parseTryStatement();
    if (token.value === 'using') return this.parseUsingStatement();
    if (token.value === 'fixed') return this.parseFixedStatement();
    if (token.value === 'throw') {
      this.advance();
      const expr = this.current().value !== ';' ? this.parseExpression() : null;
      this.match(';');
      return { kind: 'ThrowStatement', expr };
    }
    if (token.value === 'lock') {
      this.advance(); this.expect('(');
      const lockExpr = this.parseExpression();
      this.expect(')');
      const stmt = this.parseStatement();
      return { kind: 'LockStatement', lockExpr, body: stmt };
    }
    if (token.value === ';') {
      this.advance();
      return { kind: 'EmptyStatement' };
    }

    if (this.isLocalFunctionDeclaration()) {
      const func = this.parseMemberDeclaration('');
      return { kind: 'LocalFunctionStatement', function: func };
    }

    if (this.isLocalVariableDeclaration()) {
      return this.parseLocalVariableDeclaration();
    }

    const expr = this.parseExpression();
    this.match(';');
    return { kind: 'ExpressionStatement', expression: expr, line: token.line };
  }

  isLocalFunctionDeclaration() {
    let idx = 0;
    while (['static', 'async', 'unsafe', 'public', 'private', 'protected', 'internal'].includes(this.peek(idx).value)) idx++;
    // Tuple return type local function: (int, int) LocalFn(...)
    if (this.peek(idx).value === '(') {
      let depth = 1;
      idx++;
      let hasComma = false;
      while (depth > 0 && idx < 40) {
        if (this.peek(idx).value === '(') depth++;
        else if (this.peek(idx).value === ')') depth--;
        else if (this.peek(idx).value === ',' && depth === 1) hasComma = true;
        idx++;
      }
      if (depth === 0 && hasComma && isIdentifierToken(this.peek(idx)) && this.peek(idx + 1).value === '(') {
        return true;
      }
      return false;
    }

    if (isIdentifierToken(this.peek(idx)) || this.peek(idx).type === TokenType.KEYWORD) {
      idx++;
      while (this.peek(idx).value === '.' || this.peek(idx).value === '::') {
        idx += 2;
      }
      if (this.peek(idx).value === '<') {
        let depth = 1;
        idx++;
        while (depth > 0 && idx < 40) {
          if (this.peek(idx).value === '<') depth++;
          else if (this.peek(idx).value === '>') depth--;
          else if (this.peek(idx).value === '>>') depth -= 2;
          idx++;
        }
      }
      while (this.peek(idx).value === '[') {
        idx++;
        while (this.peek(idx).value === ',') idx++;
        if (this.peek(idx).value === ']') idx++;
      }
      if (this.peek(idx).value === '?') idx++;

      if (isIdentifierToken(this.peek(idx))) {
        idx++;
        if (this.peek(idx).value === '<') {
          let gDepth = 1;
          idx++;
          while (gDepth > 0 && idx < 40) {
            if (this.peek(idx).value === '<') gDepth++;
            else if (this.peek(idx).value === '>') gDepth--;
            else if (this.peek(idx).value === '>>') gDepth -= 2;
            idx++;
          }
        }
        if (this.peek(idx).value === '(') {
          let pDepth = 0;
          let pIdx = idx;
          while (pIdx < 60) {
            if (this.peek(pIdx).value === '(') pDepth++;
            else if (this.peek(pIdx).value === ')') {
              pDepth--;
              if (pDepth === 0) {
                const after = this.peek(pIdx + 1).value;
                return after === '{' || after === '=>' || after === 'where';
              }
            }
            pIdx++;
          }
        }
      }
    }
    return false;
  }

  parseBlockStatement() {
    this.expect('{');
    const statements = [];
    while (!this.match('}') && this.current().type !== TokenType.EOF) {
      statements.push(this.parseStatement());
    }
    return { kind: 'BlockStatement', statements };
  }

  parseUsingStatement() {
    this.expect('using');
    if (this.current().value !== '(' && (this.current().value === 'var' || this.isLocalVariableDeclaration())) {
      const decl = this.parseLocalVariableDeclaration();
      return { kind: 'UsingDeclarationStatement', declaration: decl };
    }
    this.expect('(');
    let resource = null;
    if (this.isLocalVariableDeclaration()) {
      resource = this.parseLocalVariableDeclaration();
    } else {
      resource = this.parseExpression();
    }
    this.expect(')');
    const body = this.parseStatement();
    return { kind: 'UsingStatement', resource, body };
  }

  parseFixedStatement() {
    this.expect('fixed');
    this.expect('(');
    const decl = this.parseLocalVariableDeclaration();
    this.expect(')');
    const body = this.parseStatement();
    return { kind: 'FixedStatement', declaration: decl, body };
  }

  isLocalVariableDeclaration() {
    if (['const', 'ref', 'readonly'].includes(this.current().value)) {
      const savePos = this.pos;
      this.advance();
      const result = this.isLocalVariableDeclaration();
      this.pos = savePos;
      return result;
    }
    if (this.current().value === 'var') {
      // `var` is contextual in C#: it can legally be an identifier (for
      // example `Variable var; var.value = 1`). Treat it as an inferred type
      // only when the following tokens actually form a declaration.
      if (this.peek(1).value === '(') return true;
      return isIdentifierToken(this.peek(1)) &&
        ['=', ';', ',', 'in'].includes(this.peek(2).value);
    }
    
    // Tuple declaration: (int x, int y) pt = ... or (int x, int y)? pt = ... or (Rect a, Rect b) = ...
    if (this.current().value === '(') {
      let depth = 1;
      let idx = 1;
      let hasComma = false;
      let hasIndexOrCall = false;
      while (depth > 0 && idx < 40) {
        if (this.peek(idx).value === '(') depth++;
        else if (this.peek(idx).value === ')') depth--;
        else if (this.peek(idx).value === ',' && depth === 1) hasComma = true;
        else if ((this.peek(idx).value === '[' || this.peek(idx).value === '.') && depth === 1) hasIndexOrCall = true;
        idx++;
      }
      if (depth === 0 && hasComma && !hasIndexOrCall) {
        if (this.peek(idx).value === '=') {
          if ((isIdentifierToken(this.peek(1)) || this.peek(1).type === TokenType.KEYWORD) && isIdentifierToken(this.peek(2))) {
            return true;
          }
          return false;
        }
        if (this.peek(idx).value === '?') idx++;
        while (this.peek(idx).value === '[') {
          idx++;
          while (this.peek(idx).value === ',') idx++;
          if (this.peek(idx).value === ']') idx++;
        }
        if (isIdentifierToken(this.peek(idx))) {
          const after = this.peek(idx + 1).value;
          if (['=', ';', ',', 'in', ':'].includes(after)) return true;
        }
      }
    }

    const PRIM_TYPES = new Set(['int', 'float', 'double', 'bool', 'string', 'byte', 'short', 'long', 'char', 'object', 'uint', 'ulong', 'sbyte', 'ushort', 'decimal', 'void']);
    if (PRIM_TYPES.has(this.current().value) && this.current().type === TokenType.KEYWORD) {
      let nextIdx = 1;
      while (this.peek(nextIdx).value === '*') nextIdx++;
      while (this.peek(nextIdx).value === '[' &&
             (this.peek(nextIdx + 1).value === ']' || this.peek(nextIdx + 1).value === ',')) {
        nextIdx++;
        while (this.peek(nextIdx).value === ',') nextIdx++;
        if (this.peek(nextIdx).value === ']') nextIdx++;
      }
      if (this.peek(nextIdx).value === '?') nextIdx++;
      if (isIdentifierToken(this.peek(nextIdx))) return true;
    }

    let idx = 0;
    if (isIdentifierToken(this.peek(idx))) {
      idx++;
      while (this.peek(idx).value === '.' || this.peek(idx).value === '::') {
        idx += 2;
      }
      if (this.peek(idx).value === '<') {
        let depth = 1;
        idx++;
        while (depth > 0 && idx < 30) {
          if (this.peek(idx).value === '<') depth++;
          else if (this.peek(idx).value === '>') depth--;
          else if (this.peek(idx).value === '>>') depth -= 2;
          idx++;
        }
      }
      while (this.peek(idx).value === '[' &&
             (this.peek(idx + 1).value === ']' || this.peek(idx + 1).value === ',')) {
        idx++;
        while (this.peek(idx).value === ',') idx++;
        if (this.peek(idx).value === ']') idx++;
      }
      while (this.peek(idx).value === '*') idx++;
      if (this.peek(idx).value === '?') {
        const afterQ = this.peek(idx + 1);
        const afterAfter = this.peek(idx + 2);
        if (isIdentifierToken(afterQ) && (afterAfter.value === '=' || afterAfter.value === ';' || afterAfter.value === ',' || afterAfter.value === 'in')) {
          idx++;
        } else {
          return false;
        }
      }
      if (isIdentifierToken(this.peek(idx))) {
        const nextNext = this.peek(idx + 1).value;
        if (['=', ';', ',', 'in', ':', 'when'].includes(nextNext) || this.peek(idx + 1).type === TokenType.OPERATOR) return true;
      }
    }

    return false;
  }

  parseLocalVariableDeclaration() {
    const modifiers = [];
    while (['const', 'ref', 'readonly'].includes(this.current().value)) {
      modifiers.push(this.advance().value);
    }
    if (this.current().value === 'var' && this.peek(1).value === '(') {
      this.advance();
      this.expect('(');
      const elements = [];
      do {
        elements.push({ name: this.advance().value, type: { kind: 'TypeReference', name: 'any' } });
      } while (this.match(','));
      this.expect(')');
      this.expect('=');
      const initializer = this.parseExpression();
      this.match(';');
      return {
        kind: 'TupleDeconstructionDeclaration',
        type: { kind: 'TupleTypeReference', elements },
        initializer,
        modifiers,
        line: this.current().line,
      };
    }

    if (this.current().value === '(') {
      const type = this.parseTypeReference();
      if (this.current().value === '=') {
        this.advance(); // '='
        const init = this.parseExpression();
        return {
          kind: 'TupleDeconstructionDeclaration',
          type,
          initializer: init,
          line: this.current().line,
        };
      }
      const decls = [];
      do {
        const name = this.advance().value;
        let init = null;
        if (this.match('=')) {
          init = this.parseExpression();
        }
        decls.push({ name, initializer: init });
      } while (this.match(','));
      this.match(';');
      return { kind: 'LocalVariableDeclaration', type, declarations: decls, modifiers };
    }

    const type = this.parseTypeReference();
    const decls = [];
    do {
      const name = this.advance().value;
      let init = null;
      if (this.match('=')) {
        init = this.parseExpression();
      }
      decls.push({ name, initializer: init });
    } while (this.match(','));
    this.match(';');
    return { kind: 'LocalDeclarationStatement', type, declarations: decls, modifiers, line: this.current().line };
  }

  parseIfStatement() {
    const start = this.expect('if');
    this.expect('(');
    const condition = this.parseExpression();
    this.expect(')');
    const thenStatement = this.parseStatement();
    let elseStatement = null;
    if (this.match('else')) {
      elseStatement = this.parseStatement();
    }
    return {
      kind: 'IfStatement',
      condition,
      thenStatement,
      elseStatement,
      line: start.line,
    };
  }

  parseForStatement() {
    const start = this.expect('for');
    this.expect('(');
    let initializer = null;
    if (this.current().value !== ';') {
      if (this.isLocalVariableDeclaration()) {
        initializer = this.parseLocalVariableDeclaration();
      } else {
        const initExprs = [this.parseExpression()];
        while (this.match(',')) {
          initExprs.push(this.parseExpression());
        }
        initializer = initExprs.length === 1 ? initExprs[0] : { kind: 'SequenceExpression', expressions: initExprs };
        this.match(';');
      }
    } else {
      this.match(';');
    }

    let condition = null;
    if (this.current().value !== ';') {
      condition = this.parseExpression();
    }
    this.match(';');

    const incrementors = [];
    if (this.current().value !== ')') {
      do {
        incrementors.push(this.parseExpression());
      } while (this.match(','));
    }
    this.expect(')');

    const body = this.parseStatement();
    return { kind: 'ForStatement', initializer, condition, incrementors, body, line: start.line };
  }

  parseForEachStatement() {
    this.expect('foreach');
    this.expect('(');
    let type = null;
    let identifier = null;
    let pattern = null;
    if (this.current().value === 'var' && this.peek(1).value === '(') {
      this.advance(); // 'var'
      pattern = this.parseExpression();
    } else if (this.current().value === '(') {
      pattern = this.parseExpression();
    } else {
      type = this.parseTypeReference();
      identifier = this.advance().value;
    }
    this.expect('in');
    const expression = this.parseExpression();
    this.expect(')');
    const body = this.parseStatement();
    return { kind: 'ForEachStatement', type, identifier, pattern, expression, body };
  }

  parseWhileStatement() {
    const start = this.expect('while');
    this.expect('(');
    const condition = this.parseExpression();
    this.expect(')');
    const body = this.parseStatement();
    return { kind: 'WhileStatement', condition, body, line: start.line };
  }

  parseDoWhileStatement() {
    const start = this.expect('do');
    const body = this.parseStatement();
    this.expect('while');
    this.expect('(');
    const condition = this.parseExpression();
    this.expect(')');
    this.match(';');
    return { kind: 'DoWhileStatement', body, condition, line: start.line };
  }

  parseSwitchStatement() {
    const start = this.expect('switch');
    this.expect('(');
    const expr = this.parseExpression();
    this.expect(')');
    this.expect('{');
    const sections = [];
    while (!this.match('}') && this.current().type !== TokenType.EOF) {
      const labels = [];
      while (this.current().value === 'case' || this.current().value === 'default') {
        if (this.match('case')) {
          let caseExpr = null;
          if (this.current().type === TokenType.OPERATOR && ['>', '<', '>=', '<='].includes(this.current().value)) {
            const relOp = this.advance().value;
            const relVal = this.parsePrimary();
            caseExpr = { kind: 'RelationalPattern', operator: relOp, value: relVal };
          } else if (this.isLocalVariableDeclaration()) {
            caseExpr = this.parseLocalVariableDeclaration();
          } else {
            caseExpr = this.parseExpression();
          }
          if (this.match('when')) {
            const whenCond = this.parseExpression();
            caseExpr = { kind: 'CaseWhenExpression', expr: caseExpr, when: whenCond };
          }
          this.expect(':');
          labels.push({ kind: 'CaseLabel', expr: caseExpr });
        } else if (this.match('default')) {
          this.expect(':');
          labels.push({ kind: 'DefaultLabel' });
        }
      }
      const statements = [];
      while (!['case', 'default', '}'].includes(this.current().value) && this.current().type !== TokenType.EOF) {
        statements.push(this.parseStatement());
      }
      sections.push({ labels, statements });
    }
    return { kind: 'SwitchStatement', expression: expr, sections, line: start.line };
  }

  parseReturnStatement() {
    const start = this.expect('return');
    let expr = null;
    if (this.current().value !== ';') {
      expr = this.parseExpression();
    }
    this.match(';');
    return { kind: 'ReturnStatement', expression: expr, line: start.line };
  }

  parseYieldStatement() {
    this.expect('yield');
    if (this.match('return')) {
      const expr = this.parseExpression();
      this.match(';');
      return { kind: 'YieldReturnStatement', expression: expr };
    }
    if (this.match('break')) {
      this.match(';');
      return { kind: 'YieldBreakStatement' };
    }
    return { kind: 'EmptyStatement' };
  }

  parseTryStatement() {
    const start = this.expect('try');
    const block = this.parseBlockStatement();
    const catches = [];
    while (this.match('catch')) {
      let type = null;
      let name = null;
      if (this.match('(')) {
        type = this.parseTypeReference();
        if (isIdentifierToken(this.current())) {
          name = this.advance().value;
        }
        this.expect(')');
      }
      let filter = null;
      if (this.match('when')) {
        this.expect('(');
        filter = this.parseExpression();
        this.expect(')');
      }
      const catchBody = this.parseBlockStatement();
      catches.push({ type, name, filter, body: catchBody });
    }
    let finallyBlock = null;
    if (this.match('finally')) {
      finallyBlock = this.parseBlockStatement();
    }
    return { kind: 'TryStatement', block, catches, finallyBlock, line: start.line };
  }

  // ── Expression Parsing ──────────────────────────────────────────────────────
  parseExpression() {
    if (this.current().value === 'throw') {
      this.advance();
      const expr = this.parseExpression();
      return { kind: 'ThrowExpression', expression: expr };
    }
    return this.parseAssignmentExpression();
  }

  parseAssignmentExpression() {
    const left = this.parseTernaryExpression();
    const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '??=']);
    if (this.current().type === TokenType.OPERATOR && ASSIGN_OPS.has(this.current().value)) {
      const op = this.advance().value;
      const right = this.parseAssignmentExpression();
      return { kind: 'AssignmentExpression', operator: op, left, right };
    }
    return left;
  }

  parseTernaryExpression() {
    const cond = this.parseNullCoalescing();
    if (this.current().type === TokenType.OPERATOR && this.match('?')) {
      const thenExpr = this.parseExpression();
      this.expect(':');
      const elseExpr = this.parseExpression();
      return { kind: 'ConditionalExpression', condition: cond, thenExpr, elseExpr };
    }
    return cond;
  }

  parseNullCoalescing() {
    let left = this.parseLogicalOr();
    while (this.current().type === TokenType.OPERATOR && this.match('??')) {
      const right = this.parseLogicalOr();
      left = { kind: 'BinaryExpression', operator: '??', left, right };
    }
    return left;
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.current().type === TokenType.OPERATOR && this.match('||')) {
      const right = this.parseLogicalAnd();
      left = { kind: 'BinaryExpression', operator: '||', left, right };
    }
    return left;
  }

  parseLogicalAnd() {
    let left = this.parseBitwiseOr();
    while (this.current().type === TokenType.OPERATOR && this.match('&&')) {
      const right = this.parseBitwiseOr();
      left = { kind: 'BinaryExpression', operator: '&&', left, right };
    }
    return left;
  }

  parseBitwiseOr() {
    let left = this.parseBitwiseXor();
    while (this.current().type === TokenType.OPERATOR && this.match('|')) {
      const right = this.parseBitwiseXor();
      left = { kind: 'BinaryExpression', operator: '|', left, right };
    }
    return left;
  }

  parseBitwiseXor() {
    let left = this.parseBitwiseAnd();
    while (this.current().type === TokenType.OPERATOR && this.match('^')) {
      const right = this.parseBitwiseAnd();
      left = { kind: 'BinaryExpression', operator: '^', left, right };
    }
    return left;
  }

  parseBitwiseAnd() {
    let left = this.parseEquality();
    while (this.current().type === TokenType.OPERATOR && this.match('&')) {
      const right = this.parseEquality();
      left = { kind: 'BinaryExpression', operator: '&', left, right };
    }
    return left;
  }

  parseEquality() {
    let left = this.parseRelational();
    while (this.current().type === TokenType.OPERATOR && ['==', '!='].includes(this.current().value)) {
      const op = this.advance().value;
      const right = this.parseRelational();
      left = { kind: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  parseRelational() {
    let left = this.parseShift();
    while (this.current().type === TokenType.OPERATOR || this.current().value === 'is' || this.current().value === 'as') {
      if (['<', '<=', '>', '>=', 'is', 'as'].includes(this.current().value)) {
        const op = this.advance().value;
        if (op === 'is' || op === 'as') {
          if (op === 'is' && this.current().value === 'not') {
            this.advance();
            if (this.current().value === 'null') {
              this.advance();
              left = { kind: 'TypeCheckExpression', operator: 'is not null', expr: left };
              continue;
            }
          }
          if (op === 'is' && this.current().value === 'null') {
            this.advance();
            left = { kind: 'TypeCheckExpression', operator: 'is null', expr: left };
            continue;
          }

          if (op === 'is' && this.current().value === '{') {
            const pattern = this.parsePrimary();
            let varName = null;
            if (isIdentifierToken(this.current()) && !['struct', 'class', 'enum', ';', ')', ',', '}', '&&', '||', 'or', 'and', '?'].includes(this.current().value)) {
              varName = this.advance().value;
            }
            left = { kind: 'PropertyPatternExpression', expr: left, pattern, patternVariable: varName };
            continue;
          }

          const type = this.parseTypeReference();
          let varName = null;
          if (op === 'is' && isIdentifierToken(this.current()) && !['struct', 'class', 'enum', ';', ')', ',', '}', '&&', '||', 'or', 'and', '?'].includes(this.current().value)) {
            varName = this.advance().value;
          }
          left = { kind: 'TypeCheckExpression', operator: op, expr: left, targetType: type, patternVariable: varName };
          
          while (this.current().value === 'or' || this.current().value === 'and') {
            const comb = this.advance().value;
            const rightPat = this.parseShift();
            left = { kind: 'PatternCombinator', operator: comb, left, right: rightPat };
          }
        } else {
          const right = this.parseShift();
          left = { kind: 'BinaryExpression', operator: op, left, right };
        }
      } else {
        break;
      }
    }
    return left;
  }

  parseShift() {
    let left = this.parseAdditive();
    while (this.current().type === TokenType.OPERATOR && ['<<', '>>'].includes(this.current().value)) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      left = { kind: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.current().type === TokenType.OPERATOR && ['+', '-'].includes(this.current().value)) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      left = { kind: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseRange();
    while (this.current().type === TokenType.OPERATOR && ['*', '/', '%'].includes(this.current().value)) {
      const op = this.advance().value;
      const right = this.parseRange();
      left = { kind: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  parseRange() {
    if (this.current().type === TokenType.OPERATOR && this.current().value === '..') {
      this.advance();
      const right = this.current().value !== ']' && this.current().value !== ')' && this.current().value !== ';' ? this.parseUnary() : null;
      return { kind: 'RangeExpression', left: null, right };
    }

    let left = this.parseUnary();
    if (this.current().type === TokenType.OPERATOR && this.current().value === '..') {
      this.advance();
      const right = this.current().value !== ']' && this.current().value !== ')' && this.current().value !== ';' ? this.parseUnary() : null;
      return { kind: 'RangeExpression', left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.current().type === TokenType.OPERATOR && ['+', '-', '!', '~', '++', '--', '&', '*', '^'].includes(this.current().value)) {
      const op = this.advance().value;
      const expr = this.parseUnary();
      return { kind: 'PrefixUnaryExpression', operator: op, operand: expr };
    }
    if (this.current().type === TokenType.KEYWORD && ['ref', 'out', 'in'].includes(this.current().value)) {
      const mod = this.advance().value;
      const expr = this.parseUnary();
      return { kind: 'ArgumentModifierExpression', modifier: mod, operand: expr };
    }
    if (this.current().value === '(' && this.isCastExpression()) {
      this.advance();
      const castType = this.parseTypeReference();
      this.expect(')');
      const expr = this.parseUnary();
      return { kind: 'CastExpression', type: castType, operand: expr };
    }

    return this.parsePostfix();
  }

  isCastExpression() {
    let idx = 1;
    let parenDepth = 1;
    let genericDepth = 0;
    let hasIdentifierOrType = false;

    const firstTok = this.peek(1);
    if (firstTok.type === TokenType.NUMBER || firstTok.type === TokenType.STRING || firstTok.type === TokenType.CHAR ||
        firstTok.value === 'true' || firstTok.value === 'false' || firstTok.value === 'null' || firstTok.value === 'this') {
      return false;
    }

    while (idx < 60) {
      const tok = this.peek(idx);
      if (tok.type === TokenType.EOF || tok.value === ';' || tok.value === '}' || tok.value === '{' || (tok.value === ',' && parenDepth === 1 && genericDepth === 0)) return false;
      
      if (tok.type === TokenType.OPERATOR && !['*', '?', '.', '::', '<', '>', '>>'].includes(tok.value)) {
        return false;
      }

      if (tok.value === '<') {
        genericDepth++;
      } else if (tok.value === '>') {
        genericDepth = Math.max(0, genericDepth - 1);
      } else if (tok.value === '>>') {
        genericDepth = Math.max(0, genericDepth - 2);
      }

      if (tok.value === '*') {
        const afterStar = this.peek(idx + 1);
        if (afterStar.type !== TokenType.OPERATOR && afterStar.value !== ')' && afterStar.value !== ']' && afterStar.value !== '[') {
          return false;
        }
      }

      if (tok.value === '(' && tok.type === TokenType.PUNCTUATION) {
        parenDepth++;
      } else if (tok.value === ')' && tok.type === TokenType.PUNCTUATION) {
        parenDepth--;
        if (parenDepth === 0) {
          if (!hasIdentifierOrType) return false;
          const next = this.peek(idx + 1);
          if (next.type === TokenType.EOF || next.value === ';' || next.value === ',' || next.value === '}' || next.value === ']') return false;
          if (next.value === '=>' || next.value === '.' || next.value === '?.') return false;

          if (next.type === TokenType.OPERATOR && ['*', '/', '%', '+', '-', '==', '!=', '<', '>', '<=', '>=', '&&', '||', '^', '|', '&', '??'].includes(next.value)) {
            if (['!', '~', '++', '--', '&'].includes(next.value)) return true;
            return false;
          }
          if (isIdentifierToken(next) || next.type === TokenType.KEYWORD || next.type === TokenType.NUMBER ||
              next.type === TokenType.STRING || next.type === TokenType.CHAR || next.value === '(' ||
              (next.type === TokenType.OPERATOR && ['&', '*', '~', '!', '+', '-', '++', '--'].includes(next.value))) {
            return true;
          }
          return false;
        }
      } else if (tok.value === '[') {
        idx++;
        while (this.peek(idx).value === ',') idx++;
        if (this.peek(idx).value !== ']') return false;
      } else if (isIdentifierToken(tok) || tok.type === TokenType.KEYWORD) {
        hasIdentifierOrType = true;
      } else if (tok.type === TokenType.NUMBER || tok.type === TokenType.STRING || tok.type === TokenType.CHAR) {
        return false;
      }
      idx++;
    }
    return false;
  }

  parsePostfix() {
    let expr = this.parsePrimary();

    while (true) {
      if (this.current().type === TokenType.OPERATOR && this.match('++')) {
        expr = { kind: 'PostfixUnaryExpression', operator: '++', operand: expr };
      } else if (this.current().type === TokenType.OPERATOR && this.match('--')) {
        expr = { kind: 'PostfixUnaryExpression', operator: '--', operand: expr };
      } else if (this.current().type === TokenType.OPERATOR && this.current().value === '!' && !['!=', '!'].includes(this.peek(1).value)) {
        // Null-forgiving operator: expr!
        this.advance();
        expr = { kind: 'SuppressNullableWarningExpression', operand: expr };
      } else if (this.current().value === 'switch' && this.peek(1).value === '{') {
        // C# 8 Switch Expression: expr switch { pattern => val, ... }
        this.advance(); // 'switch'
        this.expect('{');
        const arms = [];
        while (!this.match('}') && this.current().type !== TokenType.EOF) {
          let pattern = null;
          this.inSwitchArmPattern = true;
          if (this.current().value === '_') {
            this.advance();
            pattern = { kind: 'DiscardExpression' };
          } else if (this.current().value === 'var') {
            this.advance();
            const vName = this.advance().value;
            pattern = { kind: 'VarPattern', name: vName };
          } else if (this.current().type === TokenType.OPERATOR && ['>', '<', '>=', '<='].includes(this.current().value)) {
            const relOp = this.advance().value;
            const relVal = this.parsePrimary();
            pattern = { kind: 'RelationalPattern', operator: relOp, value: relVal };
          } else if (this.current().value === '{') {
            pattern = this.parsePrimary();
          } else if (this.isLocalVariableDeclaration()) {
            const decl = this.parseLocalVariableDeclaration();
            pattern = { kind: 'DeclarationPattern', type: decl.type, name: decl.declarations[0] ? decl.declarations[0].name : null };
          } else {
            pattern = this.parseTernaryExpression();
          }

          while (this.current().value === 'or' || this.current().value === 'and') {
            const comb = this.advance().value;
            const nextP = this.parseTernaryExpression();
            pattern = { kind: 'PatternCombinator', operator: comb, left: pattern, right: nextP };
          }

          let whenClause = null;
          if (this.match('when')) {
            whenClause = this.parseExpression();
          }
          this.inSwitchArmPattern = false;
          this.expect('=>');
          const armExpr = this.parseExpression();
          arms.push({ pattern, when: whenClause, expression: armExpr });
          this.match(',');
        }
        expr = { kind: 'SwitchExpression', expression: expr, arms };
      } else if (this.match('.') || this.match('::')) {
        const member = this.advance().value;
        let typeArgs = [];
        if (this.isGenericTypeOrInvocationAhead()) {
          this.match('<');
          do {
            typeArgs.push(this.parseTypeReference());
          } while (this.match(','));
          this.expectClosingGenericBracket();
        }
        if (this.match('(')) {
          const args = this.parseArgumentList();
          this.expect(')');
          expr = { kind: 'InvocationExpression', target: { kind: 'MemberAccessExpression', expression: expr, member }, typeArgs, arguments: args };
        } else {
          expr = { kind: 'MemberAccessExpression', expression: expr, member };
        }
      } else if (
        this.match('?.') ||
        (this.current().value === '?' && this.peek(1).type === TokenType.OPERATOR && this.peek(1).value === '.') ||
        (this.current().value === '?' && this.peek(1).type === TokenType.PUNCTUATION && this.peek(1).value === '[')
      ) {
        if (this.current().value === '?') {
          this.advance(); // '?'
          if (this.current().value === '.') this.advance(); // '.'
        }
        if (this.match('[')) {
          const indices = [];
          do {
            indices.push(this.parseExpression());
          } while (this.match(','));
          this.expect(']');
          expr = { kind: 'ElementAccessExpression', expression: expr, indices, isOptional: true };
        } else {
          const member = this.advance().value;
          let typeArgs = [];
          if (this.isGenericTypeOrInvocationAhead()) {
            this.match('<');
            do {
              typeArgs.push(this.parseTypeReference());
            } while (this.match(','));
            this.expectClosingGenericBracket();
          }
          if (this.match('(')) {
            const args = this.parseArgumentList();
            this.expect(')');
            expr = { kind: 'InvocationExpression', target: { kind: 'MemberAccessExpression', expression: expr, member, isOptional: true }, typeArgs, arguments: args };
          } else {
            expr = { kind: 'MemberAccessExpression', expression: expr, member, isOptional: true };
          }
        }
      } else if (this.match('[')) {
        const indices = [];
        do {
          indices.push(this.parseExpression());
        } while (this.match(','));
        this.expect(']');
        expr = { kind: 'ElementAccessExpression', expression: expr, indices };
      } else if (this.match('(')) {
        const args = this.parseArgumentList();
        this.expect(')');
        expr = { kind: 'InvocationExpression', target: expr, typeArgs: [], arguments: args };
      } else {
        break;
      }
    }

    return expr;
  }

  parsePrimary() {
    const token = this.current();

    if (token.type === TokenType.NUMBER) {
      this.advance();
      return { kind: 'NumericLiteral', value: token.value };
    }
    if (token.type === TokenType.STRING) {
      this.advance();
      return { kind: 'StringLiteral', value: token.value, isVerbatim: token.isVerbatim, isInterpolated: token.isInterpolated };
    }
    if (token.type === TokenType.CHAR) {
      this.advance();
      return { kind: 'CharLiteral', value: token.value };
    }
    if (token.value === 'true' || token.value === 'false') {
      this.advance();
      return { kind: 'BooleanLiteral', value: token.value === 'true' };
    }
    if (token.value === 'null') {
      this.advance();
      return { kind: 'NullLiteral' };
    }
    if (token.value === 'this') {
      this.advance();
      return { kind: 'ThisExpression' };
    }
    if (token.value === 'base') {
      this.advance();
      return { kind: 'BaseExpression' };
    }
    if (token.value === 'typeof') {
      this.advance(); this.expect('(');
      const t = this.parseTypeReference();
      this.expect(')');
      return { kind: 'TypeOfExpression', type: t };
    }
    if (token.value === 'nameof' && !token.isVerbatim) {
      this.advance(); this.expect('(');
      let name = '';
      let parenD = 1;
      while (this.current().type !== TokenType.EOF) {
        if (this.current().value === '(') parenD++;
        else if (this.current().value === ')') {
          parenD--;
          if (parenD === 0) break;
        }
        name += this.advance().value;
      }
      this.expect(')');
      return { kind: 'NameOfExpression', name };
    }
    if (token.value === 'default') {
      this.advance();
      if (this.match('(')) {
        const defType = this.parseTypeReference();
        this.expect(')');
        return { kind: 'DefaultExpression', type: defType };
      }
      return { kind: 'DefaultLiteral' };
    }
    // Anonymous delegate: delegate { ... } or delegate(int x) { ... }
    if (token.value === 'delegate' && !token.isVerbatim) {
      this.advance();
      let params = [];
      if (this.match('(')) {
        params = this.parseParameterList();
        this.expect(')');
      }
      const body = this.parseBlockStatement();
      return { kind: 'AnonymousMethodExpression', parameters: params, body };
    }

    if (token.value === 'await') {
      this.advance();
      const expr = this.parseUnary();
      return { kind: 'AwaitExpression', expression: expr };
    }
    if (token.value === 'throw') {
      this.advance();
      return { kind: 'ThrowExpression', expression: this.parseExpression() };
    }
    if (token.value === '_') {
      this.advance();
      if (this.match('=>')) {
        const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
        return { kind: 'LambdaExpression', parameters: [{ name: '_' }], body };
      }
      return { kind: 'DiscardExpression' };
    }

    // Async lambda
    if (token.value === 'async' && (this.peek(1).value === '(' || isIdentifierToken(this.peek(1)) || this.peek(1).value === '_')) {
      this.advance();
      const paramExpr = this.parsePrimary();
      if (this.match('=>')) {
        const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
        return { kind: 'LambdaExpression', isAsync: true, parameters: [paramExpr], body };
      }
      return { kind: 'Identifier', name: 'async' };
    }

    // Array / Collection Initializer: { a, b, c }
    if (this.match('{')) {
      const elements = [];
      while (!this.match('}') && this.current().type !== TokenType.EOF) {
        elements.push(this.parseInitializerElement());
        this.match(',');
      }
      return { kind: 'ArrayInitializerExpression', elements };
    }

    if (this.match('(')) {
      if (this.match(')')) {
        if (this.match('=>')) {
          const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
          return { kind: 'LambdaExpression', parameters: [], body };
        }
      }

      // Look ahead to see if this '(' ... ')' is immediately followed by '=>'
      let pDepth = 1;
      let lIdx = 0;
      let isLambdaAhead = false;
      if (!this.inSwitchArmPattern) {
        while (pDepth > 0 && lIdx < 60) {
          const t = this.peek(lIdx);
          if (t.value === '(' && t.type === TokenType.PUNCTUATION) pDepth++;
          else if (t.value === ')' && t.type === TokenType.PUNCTUATION) {
            pDepth--;
            if (pDepth === 0) {
              if (this.peek(lIdx + 1).value === '=>') {
                isLambdaAhead = true;
              }
              break;
            }
          }
          lIdx++;
        }
      }

      if (isLambdaAhead) {
        const params = [];
        while (this.current().value !== ')' && this.current().type !== TokenType.EOF) {
          const attrs = this.parseAttributes();
          let modifier = null;
          if (['ref', 'out', 'in', 'params', 'this'].includes(this.current().value)) {
            modifier = this.advance().value;
          }
          let type = null;
          let name = null;
          const saveParamPos = this.pos;
          const parsedType = this.parseTypeReference();
          if (isIdentifierToken(this.current()) && !['struct', 'class', 'enum', ';', ')', ',', '}', ']', ':'].includes(this.current().value)) {
            type = parsedType;
            name = this.advance().value;
          } else {
            this.pos = saveParamPos;
            name = this.advance().value;
          }
          params.push({ name, type, modifier, attributes: attrs });
          if (!this.match(',')) break;
        }
        this.expect(')');
        this.expect('=>');
        const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
        return { kind: 'LambdaExpression', parameters: params, body };
      }

      let elemName = null;
      if (isIdentifierToken(this.current()) && this.peek(1).value === ':') {
        elemName = this.advance().value;
        this.advance();
      }

      const expr = this.parseExpression();
      if (this.match(',')) {
        const elements = [{ name: elemName, expr }];
        do {
          let nextElemName = null;
          if (isIdentifierToken(this.current()) && this.peek(1).value === ':') {
            nextElemName = this.advance().value;
            this.advance();
          }
          const nextExpr = this.parseExpression();
          elements.push({ name: nextElemName, expr: nextExpr });
        } while (this.match(','));
        this.expect(')');
        if (!this.inSwitchArmPattern && this.match('=>')) {
          const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
          return { kind: 'LambdaExpression', parameters: elements.map(e => e.expr), body };
        }
        return { kind: 'TupleExpression', elements };
      }
      this.expect(')');
      if (!this.inSwitchArmPattern && this.match('=>')) {
        const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
        return { kind: 'LambdaExpression', parameters: [expr], body };
      }
      return { kind: 'ParenthesizedExpression', expression: expr };
    }

    if (this.match('stackalloc')) {
      const type = this.parseTypeReference();
      let initializer = null;
      if (this.match('{')) {
        initializer = [];
        while (!this.match('}') && this.current().type !== TokenType.EOF) {
          initializer.push(this.parseExpression());
          this.match(',');
        }
      }
      return { kind: 'StackAllocExpression', type, initializer };
    }

    // LINQ Query Expression: from x in source select y
    if (token.value === 'from' && !token.isVerbatim && isIdentifierToken(this.peek(1)) && (this.peek(2).value === 'in' || (isIdentifierToken(this.peek(2)) && this.peek(3).value === 'in'))) {
      return this.parseLinqQueryExpression();
    }

    if (this.match('new')) {
      if (this.current().value === '(') {
        // Disambiguate tuple type creation: new (string name, int val)[] from target-typed new(1, 2)
        let depth = 1;
        let idx = 1;
        while (depth > 0 && idx < 40) {
          if (this.peek(idx).value === '(') depth++;
          else if (this.peek(idx).value === ')') depth--;
          idx++;
        }
        const afterParen = this.peek(idx).value;
        if (afterParen !== '[' && afterParen !== '?') {
          this.advance(); // '('
          const args = this.parseArgumentList();
          this.expect(')');
          let initializer = null;
          if (this.match('{')) {
            initializer = [];
            while (!this.match('}') && this.current().type !== TokenType.EOF) {
              initializer.push(this.parseInitializerElement());
              this.match(',');
            }
          }
          return { kind: 'ObjectCreationExpression', type: null, arguments: args, initializer, isTargetTyped: true };
        }
      }

      if (this.match('{')) {
        const properties = [];
        while (!this.match('}') && this.current().type !== TokenType.EOF) {
          if (isIdentifierToken(this.current()) && this.peek(1).value === '=') {
            const propName = this.advance().value;
            this.advance(); // '='
            const propVal = this.parseExpression();
            properties.push({ kind: 'MemberInitializer', name: propName, value: propVal });
          } else {
            properties.push(this.parseExpression());
          }
          this.match(',');
        }
        return { kind: 'AnonymousObjectCreationExpression', properties };
      }

      const type = this.parseTypeReference();
      let args = [];
      let initializer = null;

      while (this.current().type === TokenType.PUNCTUATION && this.current().value === '[') {
        this.advance();
        if (this.current().value !== ']') {
          const sizeExprs = [];
          do {
            sizeExprs.push(this.parseExpression());
          } while (this.match(','));
          type.isArray = true;
          type.sizeExpressions = sizeExprs;
        } else {
          type.isArray = true;
        }
        this.expect(']');
      }

      if (this.match('(')) {
        args = this.parseArgumentList();
        this.expect(')');
      }

      if (this.match('{')) {
        initializer = [];
        while (!this.match('}') && this.current().type !== TokenType.EOF) {
          initializer.push(this.parseInitializerElement());
          this.match(',');
        }
      }

      return { kind: 'ObjectCreationExpression', type, arguments: args, initializer };
    }

    if (isIdentifierToken(token) || token.type === TokenType.KEYWORD) {
      const name = this.advance().value;
      
      if (this.isGenericTypeOrInvocationAhead()) {
        this.match('<');
        const typeArgs = [];
        do {
          typeArgs.push(this.parseTypeReference());
        } while (this.match(','));
        this.expectClosingGenericBracket();

        if (this.match('(')) {
          const args = this.parseArgumentList();
          this.expect(')');
          return { kind: 'InvocationExpression', target: { kind: 'Identifier', name }, typeArgs, arguments: args };
        }
        return { kind: 'GenericNameExpression', name, typeArgs };
      }

      if (!this.inSwitchArmPattern && this.match('=>')) {
        const body = this.current().value === '{' ? this.parseBlockStatement() : this.parseExpression();
        return { kind: 'LambdaExpression', parameters: [{ name }], body };
      }

      return { kind: 'Identifier', name };
    }

    this.advance();
    return { kind: 'UnknownExpression', raw: token.value };
  }

  parseLinqQueryExpression() {
    this.expect('from');
    let itemType = null;
    let itemName = this.advance().value;
    if (this.current().value !== 'in' && isIdentifierToken(this.current())) {
      itemType = itemName;
      itemName = this.advance().value;
    }
    this.expect('in');
    const source = this.parseExpression();
    const clauses = [];
    while (['where', 'let', 'orderby', 'join'].includes(this.current().value)) {
      const clauseType = this.advance().value;
      if (clauseType === 'where') {
        const cond = this.parseExpression();
        clauses.push({ kind: 'WhereClause', condition: cond });
      } else if (clauseType === 'let') {
        const letName = this.advance().value;
        this.expect('=');
        const letExpr = this.parseExpression();
        clauses.push({ kind: 'LetClause', name: letName, expression: letExpr });
      } else {
        const clauseExpr = this.parseExpression();
        clauses.push({ kind: 'LinqClause', type: clauseType, expression: clauseExpr });
      }
    }
    let selectExpr = null;
    if (this.match('select')) {
      selectExpr = this.parseExpression();
    } else if (this.match('group')) {
      const groupExpr = this.parseExpression();
      this.expect('by');
      const byExpr = this.parseExpression();
      selectExpr = { kind: 'GroupClause', group: groupExpr, by: byExpr };
    }
    return { kind: 'LinqQueryExpression', itemType, itemName, source, clauses, select: selectExpr };
  }
}

/** Platforms with no playable-ads target; their branches are never the live one. */
const OBSCURE_PLATFORM_SYMBOLS = [
  'WINDOWS_PHONE', 'WINDOWS_STOREAPP', 'NOT_UNITY3D', 'NETFX_CORE',
  'UNITY_WP8', 'UNITY_METRO', 'UNITY_WINRT',
];

/**
 * Symbols that are only defined inside the Unity Editor. A playable ad is a
 * built runtime, so the editor branch is the WRONG one to keep - taking it
 * silently inverted behaviour (measured: CameraPanDragStrategy.Tick() kept the
 * mouse-drag editor path and dropped the touch path the build actually runs).
 */
const EDITOR_ONLY_SYMBOLS = ['UNITY_EDITOR_WIN', 'UNITY_EDITOR_OSX', 'UNITY_EDITOR_LINUX', 'UNITY_EDITOR'];

/**
 * Decide whether a `#if` / `#elif` condition is live for a built runtime.
 * Returns null when the condition says nothing about editor/obscure platforms,
 * meaning "keep the existing first-branch-wins behaviour".
 */
function evaluateRuntimeCondition(cond) {
  for (const symbol of EDITOR_ONLY_SYMBOLS) {
    const index = cond.indexOf(symbol);
    if (index === -1) continue;
    // `!UNITY_EDITOR` is the runtime branch, so it stays live.
    const negated = /!\s*$/.test(cond.slice(0, index));
    return { live: negated, symbol };
  }
  for (const symbol of OBSCURE_PLATFORM_SYMBOLS) {
    if (cond.includes(symbol)) return { live: false, symbol };
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────
function preprocessCSharp(source) {
  const lines = source.split('\n');
  const out = [];
  const skipStack = [];
  const notes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#if')) {
      if (skipStack.length > 0 && skipStack[skipStack.length - 1].skipping) {
        skipStack.push({ skipping: true, hadActive: true });
        out.push('// ' + line);
        continue;
      }
      const cond = trimmed.replace('#if', '').trim();
      const verdict = evaluateRuntimeCondition(cond);
      if (verdict && !verdict.live) {
        skipStack.push({ skipping: true, hadActive: false });
        notes.push({ line: i + 1, condition: cond, symbol: verdict.symbol, kept: 'else' });
      } else {
        if (verdict) notes.push({ line: i + 1, condition: cond, symbol: verdict.symbol, kept: 'if' });
        skipStack.push({ skipping: false, hadActive: true });
      }
      out.push('// ' + line);
    } else if (trimmed.startsWith('#elif')) {
      const cur = skipStack[skipStack.length - 1];
      if (cur) {
        if (cur.hadActive) {
          cur.skipping = true;
        } else {
          cur.skipping = false;
          cur.hadActive = true;
        }
      }
      out.push('// ' + line);
    } else if (trimmed.startsWith('#else')) {
      const cur = skipStack[skipStack.length - 1];
      if (cur) {
        if (cur.hadActive) {
          cur.skipping = true;
        } else {
          cur.skipping = false;
          cur.hadActive = true;
        }
      }
      out.push('// ' + line);
    } else if (trimmed.startsWith('#endif')) {
      skipStack.pop();
      out.push('// ' + line);
    } else {
      if (skipStack.length > 0 && skipStack[skipStack.length - 1].skipping) {
        out.push('// ' + line);
      } else {
        out.push(line);
      }
    }
  }
  return { text: out.join('\n'), notes };
}

function parseCSharpSource(source, filename = 'source.cs') {
  const preprocessed = preprocessCSharp(source);
  const lexer = new Lexer(preprocessed.text, filename);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, filename);
  const ast = parser.parseCompilationUnit();
  // Which conditional branches were dropped, so the migration can flag them
  // instead of silently shipping whichever branch it happened to keep.
  ast.preprocessorNotes = preprocessed.notes;
  return ast;
}

module.exports = {
  Lexer,
  Parser,
  TokenType,
  parseCSharpSource,
};
