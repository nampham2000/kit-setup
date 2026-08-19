'use strict';

/**
 * Universal Migration Intermediate Representation (IR)
 *
 * Provides a clean, normalized abstraction between the C# AST and the target
 * Cocos Creator 3.8.8 TypeScript AST / code generator.
 */

class IRCompilationUnit {
  constructor(filename = '') {
    this.filename = filename;
    this.imports = new Map(); // module -> Set<symbol>
    this.declarations = [];   // IRClass, IREnum, IRInterface, etc.
    this.scratchVariables = new Set(); // e.g. '_tempVec3', '_tempQuat'
    this.confidenceScore = 1.0;
    this.todoNotes = [];
    this.rawComments = [];
  }

  addImport(sourceModule, symbol) {
    if (!this.imports.has(sourceModule)) {
      this.imports.set(sourceModule, new Set());
    }
    this.imports.get(sourceModule).add(symbol);
  }

  addScratchVar(varName) {
    this.scratchVariables.add(varName);
  }
}

class IRClass {
  constructor(name) {
    this.name = name;
    this.baseClass = 'Component';
    this.interfaces = [];
    this.isCCClass = true;
    this.decorators = [];
    this.fields = [];
    this.properties = [];
    this.methods = [];
    this.constructors = [];
    this.isStatic = false;
    this.modifiers = ['public'];
    this.comments = [];
    this.confidence = 1.0;
  }
}

class IRField {
  constructor(name, type, cocosType = null) {
    this.name = name;
    this.type = type;             // TS type (e.g. 'number', 'Node | null', 'Vec3')
    this.cocosType = cocosType;   // Cocos decorator type (e.g. 'CCFloat', 'Node', '[Node]')
    this.isProperty = false;      // true if @property decorator needed
    this.propertyOptions = {};    // e.g. { type: 'CCFloat', tooltip: '...' }
    this.initializer = null;
    this.modifiers = ['public'];
    this.isStatic = false;
    this.isReadonly = false;
    this.comments = [];
  }
}

class IRProperty {
  constructor(name, type) {
    this.name = name;
    this.type = type;
    this.getter = null;
    this.setter = null;
    this.expression = null; // for getter-only arrow expressions
    this.initializer = null;
    this.isAuto = false;
    this.modifiers = ['public'];
    this.isStatic = false;
    this.comments = [];
  }
}

class IRTypeAlias {
  constructor(name) {
    this.name = name;
    this.genericParams = [];
    this.parameters = [];
    this.returnType = 'void';
  }
}

class IRMethod {
  constructor(name, returnType = 'void') {
    this.name = name;
    this.returnType = returnType;
    this.parameters = []; // array of { name, type, defaultValue }
    this.body = [];       // array of IRStatements
    this.isLifecycle = false; // onLoad, start, update, onDestroy, etc.
    this.isCoroutine = false;
    this.isAsync = false;
    this.isStatic = false;
    this.modifiers = ['public'];
    this.comments = [];
    this.confidence = 1.0;
    this.todos = [];
  }
}

class IREnum {
  constructor(name) {
    this.name = name;
    this.members = []; // array of { name, value }
    this.modifiers = ['export'];
  }
}

class IRInterface {
  constructor(name) {
    this.name = name;
    this.methods = [];
    this.properties = [];
    this.modifiers = ['export'];
  }
}

module.exports = {
  IRCompilationUnit,
  IRClass,
  IRField,
  IRProperty,
  IRMethod,
  IREnum,
  IRInterface,
  IRTypeAlias,
};
