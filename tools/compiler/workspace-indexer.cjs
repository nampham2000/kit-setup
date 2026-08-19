'use strict';

/**
 * Workspace Indexer for Unity C# Multi-File & Solution Projects
 *
 * Scans, parses, and indexes symbols across an entire Unity project workspace
 * to resolve cross-file types, inheritance chains, MonoBehaviour inheritance,
 * and serialization hierarchy flattening.
 */

const fs = require('fs');
const path = require('path');
const { parseCSharpSource } = require('./csharp-parser.cjs');

class WorkspaceIndexer {
  constructor() {
    this.classes = new Map();       // className -> classMetadata
    this.enums = new Map();         // enumName -> enumMetadata
    this.interfaces = new Map();    // ifaceName -> ifaceMetadata
    this.structs = new Map();       // structName -> structMetadata
    this.delegates = new Map();     // delegateName -> delegateMetadata
    this.fileMap = new Map();       // filePath -> AST
    this.isIndexed = false;
  }

  indexFiles(filePaths) {
    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) continue;
      try {
        const source = fs.readFileSync(filePath, 'utf8');
        const filename = path.basename(filePath);
        const ast = parseCSharpSource(source, filename);
        this.fileMap.set(filePath, ast);
        this.extractDeclarations(ast, filePath);
      } catch (err) {
        // Skip unparseable files in indexer pass
      }
    }

    this.resolveInheritanceHierarchy();
    this.isIndexed = true;
    return this;
  }

  extractDeclarations(ast, filePath) {
    const collectFromList = (list, namespacePrefix = '') => {
      for (const item of list || []) {
        const fullName = namespacePrefix ? `${namespacePrefix}.${item.name}` : item.name;
        const simpleName = item.name;

        if (item.kind === 'ClassDeclaration' || !item.kind) {
          const meta = {
            name: simpleName,
            fullName,
            filePath,
            attributes: item.attributes || [],
            baseTypes: (item.baseTypes || []).map(b => b.name),
            modifiers: item.modifiers || [],
            isMonoBehaviour: (item.baseTypes || []).some(b => b.name === 'MonoBehaviour'),
            inheritanceChain: [],
            serializedFields: [],
            publicFields: [],
            methods: [],
            members: item.members || [],
          };

          for (const member of item.members || []) {
            if (member.kind === 'FieldDeclaration') {
              const isSerialized = (member.attributes || []).some(a =>
                a.name === 'SerializeField' || a.name === 'UnityEngine.SerializeField'
              );
              const isPublic = (member.modifiers || []).includes('public');
              for (const decl of member.declarations || []) {
                const fieldInfo = {
                  name: decl.name,
                  type: member.type,
                  attributes: member.attributes || [],
                  isSerialized,
                  isPublic,
                };
                if (isSerialized) meta.serializedFields.push(fieldInfo);
                if (isPublic) meta.publicFields.push(fieldInfo);
              }
            } else if (member.kind === 'MethodDeclaration') {
              meta.methods.push({
                name: member.name,
                returnType: member.returnType,
                parameters: member.parameters || [],
                modifiers: member.modifiers || [],
                attributes: member.attributes || [],
              });
            }
          }

          this.classes.set(simpleName, meta);
          this.classes.set(fullName, meta);
        } else if (item.kind === 'EnumDeclaration') {
          const enumMeta = {
            name: simpleName,
            fullName,
            filePath,
            members: item.members || [],
          };
          this.enums.set(simpleName, enumMeta);
          this.enums.set(fullName, enumMeta);
        } else if (item.kind === 'InterfaceDeclaration') {
          this.interfaces.set(simpleName, { name: simpleName, fullName, filePath, members: item.members || [] });
          this.interfaces.set(fullName, { name: simpleName, fullName, filePath, members: item.members || [] });
        } else if (item.kind === 'StructDeclaration') {
          this.structs.set(simpleName, { name: simpleName, fullName, filePath, members: item.members || [] });
          this.structs.set(fullName, { name: simpleName, fullName, filePath, members: item.members || [] });
        } else if (item.kind === 'DelegateDeclaration') {
          this.delegates.set(simpleName, { name: simpleName, fullName, filePath });
          this.delegates.set(fullName, { name: simpleName, fullName, filePath });
        }
      }
    };

    collectFromList(ast.classes);
    collectFromList(ast.enums);
    collectFromList(ast.interfaces);
    collectFromList(ast.structs);
    collectFromList(ast.delegates);

    for (const ns of ast.namespaces || []) {
      const nsName = ns.name || '';
      collectFromList(ns.classes, nsName);
      collectFromList(ns.enums, nsName);
      collectFromList(ns.interfaces, nsName);
      collectFromList(ns.structs, nsName);
      collectFromList(ns.delegates, nsName);
    }
  }

  resolveInheritanceHierarchy() {
    for (const [className, meta] of this.classes.entries()) {
      if (meta.inheritanceChain.length > 0) continue; // Already resolved

      const chain = [className];
      let current = meta;
      let isMono = meta.isMonoBehaviour;
      const visited = new Set([className]);

      while (current && current.baseTypes && current.baseTypes.length > 0) {
        const directBase = current.baseTypes[0];
        if (directBase === 'MonoBehaviour' || directBase === 'UnityEngine.MonoBehaviour') {
          isMono = true;
          chain.push('UnityEngine.MonoBehaviour');
          break;
        }

        chain.push(directBase);
        if (visited.has(directBase)) break; // Prevent cycle
        visited.add(directBase);

        current = this.classes.get(directBase);
        if (current && current.isMonoBehaviour) {
          isMono = true;
        }
      }

      meta.inheritanceChain = chain;
      meta.isMonoBehaviour = isMono;
    }
  }

  isMonoBehaviour(className) {
    const meta = this.classes.get(className);
    return meta ? meta.isMonoBehaviour : false;
  }

  isEnum(typeName) {
    return this.enums.has(typeName);
  }

  isStruct(typeName) {
    return this.structs.has(typeName);
  }

  isInterface(typeName) {
    return this.interfaces.has(typeName);
  }

  isKnownClass(typeName) {
    return this.classes.has(typeName);
  }

  getModulePath(typeName, fromFilePath = null) {
    const meta = this.classes.get(typeName) || this.enums.get(typeName) || this.interfaces.get(typeName) || this.structs.get(typeName);
    if (!meta) {
      if (typeName.includes('.')) {
        const parts = typeName.split('.');
        const simpleName = parts.pop();
        const folder = parts.join('/');
        return `./${folder}/${simpleName}`;
      }
      return `./${typeName}`;
    }

    if (fromFilePath && meta.filePath) {
      let rel = path.relative(path.dirname(fromFilePath), meta.filePath).replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = './' + rel;
      return rel.replace(/\.(cs|ts)$/, '');
    }

    if (meta.fullName && meta.fullName.includes('.')) {
      const parts = meta.fullName.split('.');
      const simpleName = parts.pop();
      const folder = parts.join('/');
      return `./${folder}/${simpleName}`;
    }

    return `./${meta.name}`;
  }

  getInheritedSerializedFields(className) {
    const meta = this.classes.get(className);
    if (!meta) return [];

    const fields = [];
    const seen = new Set();

    for (const ancestor of meta.inheritanceChain) {
      if (ancestor === className || ancestor === 'UnityEngine.MonoBehaviour' || ancestor === 'MonoBehaviour') continue;
      const parentMeta = this.classes.get(ancestor);
      if (parentMeta) {
        for (const f of parentMeta.serializedFields) {
          if (!seen.has(f.name)) {
            seen.add(f.name);
            fields.push({ ...f, inheritedFrom: ancestor });
          }
        }
      }
    }

    return fields;
  }
}

module.exports = {
  WorkspaceIndexer,
};
