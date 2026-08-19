'use strict';

/**
 * Semantic Resolver for Unity C# to Cocos Creator TypeScript Migration
 *
 * Resolves C# types, Unity engine classes, lifecycle methods, and common APIs
 * to exact Cocos Creator 3.8.8+ equivalents and imports.
 */

const TYPE_MAP = {
  'void': { ts: 'void', cocos: null, isPrimitive: true },
  'int': { ts: 'number', cocos: 'CCInteger', isPrimitive: true, defaultVal: '0' },
  'float': { ts: 'number', cocos: 'CCFloat', isPrimitive: true, defaultVal: '0' },
  'double': { ts: 'number', cocos: 'CCFloat', isPrimitive: true, defaultVal: '0' },
  'bool': { ts: 'boolean', cocos: 'CCBoolean', isPrimitive: true, defaultVal: 'false' },
  'string': { ts: 'string', cocos: 'CCString', isPrimitive: true, defaultVal: '\'\'' },
  'byte': { ts: 'number', cocos: 'CCInteger', isPrimitive: true, defaultVal: '0' },
  'short': { ts: 'number', cocos: 'CCInteger', isPrimitive: true, defaultVal: '0' },
  'long': { ts: 'number', cocos: 'CCInteger', isPrimitive: true, defaultVal: '0' },
  'uint': { ts: 'number', cocos: 'CCInteger', isPrimitive: true, defaultVal: '0' },
  'ulong': { ts: 'number', cocos: 'CCInteger', isPrimitive: true, defaultVal: '0' },
  'char': { ts: 'string', cocos: 'CCString', isPrimitive: true, defaultVal: '\'\'' },
  'object': { ts: 'any', cocos: null, isPrimitive: false, defaultVal: 'null' },
  'decimal': { ts: 'number', cocos: 'CCFloat', isPrimitive: true, defaultVal: '0' },
  'var': { ts: 'any', cocos: null, isPrimitive: false, defaultVal: 'null' },

  // Unity Core -> Cocos Creator
  'GameObject': { ts: 'Node | null', cocos: 'Node', import: 'Node', defaultVal: 'null' },
  'Transform': { ts: 'Node | null', cocos: 'Node', import: 'Node', defaultVal: 'null' },
  'MonoBehaviour': { ts: 'Component', cocos: null, import: 'Component', defaultVal: 'null' },
  'Component': { ts: 'Component', cocos: 'Component', import: 'Component', defaultVal: 'null' },
  'Vector3': { ts: 'Vec3', cocos: 'Vec3', import: 'Vec3', defaultVal: 'new Vec3()' },
  'Vector2': { ts: 'Vec2', cocos: 'Vec2', import: 'Vec2', defaultVal: 'new Vec2()' },
  'Vector4': { ts: 'Vec4', cocos: 'Vec4', import: 'Vec4', defaultVal: 'new Vec4()' },
  'Quaternion': { ts: 'Quat', cocos: 'Quat', import: 'Quat', defaultVal: 'new Quat()' },
  'Color': { ts: 'Color', cocos: 'Color', import: 'Color', defaultVal: 'new Color()' },
  'Color32': { ts: 'Color', cocos: 'Color', import: 'Color', defaultVal: 'new Color()' },
  'Rect': { ts: 'Rect', cocos: 'Rect', import: 'Rect', defaultVal: 'new Rect()' },
  'Ray': { ts: 'geometry.Ray', cocos: null, import: 'geometry', defaultVal: 'new geometry.Ray()' },
  'Plane': { ts: 'geometry.Plane', cocos: null, import: 'geometry', defaultVal: 'new geometry.Plane()' },
  'Bounds': { ts: 'geometry.AABB', cocos: null, import: 'geometry', defaultVal: 'new geometry.AABB()' },

  // Components & Assets
  'AudioClip': { ts: 'AudioClip | null', cocos: 'AudioClip', import: 'AudioClip', defaultVal: 'null' },
  'AudioSource': { ts: 'AudioSource | null', cocos: 'AudioSource', import: 'AudioSource', defaultVal: 'null' },
  'ParticleSystem': { ts: 'ParticleSystem | null', cocos: 'ParticleSystem', import: 'ParticleSystem', defaultVal: 'null' },
  'Camera': { ts: 'Camera | null', cocos: 'Camera', import: 'Camera', defaultVal: 'null' },
  'Light': { ts: 'DirectionalLight | null', cocos: 'DirectionalLight', import: 'DirectionalLight', defaultVal: 'null' },
  'MeshRenderer': { ts: 'MeshRenderer | null', cocos: 'MeshRenderer', import: 'MeshRenderer', defaultVal: 'null' },
  'SkinnedMeshRenderer': { ts: 'SkinnedMeshRenderer | null', cocos: 'SkinnedMeshRenderer', import: 'SkinnedMeshRenderer', defaultVal: 'null' },
  'Animation': { ts: 'Animation | null', cocos: 'Animation', import: 'Animation', defaultVal: 'null' },
  'Animator': { ts: 'Animation | null', cocos: 'Animation', import: 'Animation', defaultVal: 'null' },
  'Material': { ts: 'Material | null', cocos: 'Material', import: 'Material', defaultVal: 'null' },
  'Texture2D': { ts: 'Texture2D | null', cocos: 'Texture2D', import: 'Texture2D', defaultVal: 'null' },
  'Sprite': { ts: 'SpriteFrame | null', cocos: 'SpriteFrame', import: 'SpriteFrame', defaultVal: 'null' },
  'SpriteRenderer': { ts: 'Sprite | null', cocos: 'Sprite', import: 'Sprite', defaultVal: 'null' },

  // Physics
  'Rigidbody': { ts: 'RigidBody | null', cocos: 'RigidBody', import: 'RigidBody', defaultVal: 'null' },
  'Rigidbody2D': { ts: 'RigidBody2D | null', cocos: 'RigidBody2D', import: 'RigidBody2D', defaultVal: 'null' },
  'Collider': { ts: 'Collider | null', cocos: 'Collider', import: 'Collider', defaultVal: 'null' },
  'BoxCollider': { ts: 'BoxCollider | null', cocos: 'BoxCollider', import: 'BoxCollider', defaultVal: 'null' },
  'SphereCollider': { ts: 'SphereCollider | null', cocos: 'SphereCollider', import: 'SphereCollider', defaultVal: 'null' },
  'CapsuleCollider': { ts: 'CapsuleCollider | null', cocos: 'CapsuleCollider', import: 'CapsuleCollider', defaultVal: 'null' },
  'MeshCollider': { ts: 'MeshCollider | null', cocos: 'MeshCollider', import: 'MeshCollider', defaultVal: 'null' },

  // UI
  'Text': { ts: 'Label | null', cocos: 'Label', import: 'Label', defaultVal: 'null' },
  'TextMeshPro': { ts: 'Label | null', cocos: 'Label', import: 'Label', defaultVal: 'null' },
  'TextMeshProUGUI': { ts: 'Label | null', cocos: 'Label', import: 'Label', defaultVal: 'null' },
  'Image': { ts: 'Sprite | null', cocos: 'Sprite', import: 'Sprite', defaultVal: 'null' },
  'Button': { ts: 'Button | null', cocos: 'Button', import: 'Button', defaultVal: 'null' },
  'Slider': { ts: 'Slider | null', cocos: 'Slider', import: 'Slider', defaultVal: 'null' },
  'Canvas': { ts: 'Canvas | null', cocos: 'Canvas', import: 'Canvas', defaultVal: 'null' },
  'CanvasGroup': { ts: 'UIOpacity | null', cocos: 'UIOpacity', import: 'UIOpacity', defaultVal: 'null' },

  // System & Collections
  'IEnumerator': { ts: 'Generator<any, void, any>', cocos: null, defaultVal: 'null' },
  'Coroutine': { ts: 'any', cocos: null, defaultVal: 'null' },
  'Action': { ts: '() => void', cocos: null, defaultVal: 'null' },
  'UnityAction': { ts: '() => void', cocos: null, defaultVal: 'null' },
};

const LIFECYCLE_MAP = {
  'Awake': { name: 'onLoad', params: [] },
  'OnEnable': { name: 'onEnable', params: [] },
  'Start': { name: 'start', params: [] },
  'Update': { name: 'update', params: [{ name: 'dt', type: 'number' }] },
  'LateUpdate': { name: 'lateUpdate', params: [{ name: 'dt', type: 'number' }] },
  'OnDisable': { name: 'onDisable', params: [] },
  'OnDestroy': { name: 'onDestroy', params: [] },
  'OnCollisionEnter': { name: 'onCollisionEnter', params: [{ name: 'event', type: 'ICollisionEvent' }], import: 'ICollisionEvent' },
  'OnCollisionExit': { name: 'onCollisionExit', params: [{ name: 'event', type: 'ICollisionEvent' }], import: 'ICollisionEvent' },
  'OnTriggerEnter': { name: 'onTriggerEnter', params: [{ name: 'event', type: 'ITriggerEvent' }], import: 'ITriggerEvent' },
  'OnTriggerExit': { name: 'onTriggerExit', params: [{ name: 'event', type: 'ITriggerEvent' }], import: 'ITriggerEvent' },
};

class SemanticResolver {
  constructor(workspaceIndexer = null) {
    this.indexer = workspaceIndexer;
    this.customClasses = new Set();
  }

  setIndexer(indexer) {
    this.indexer = indexer;
  }

  registerCustomClass(className) {
    this.customClasses.add(className);
  }

  resolveType(csharpType) {
    if (!csharpType) return { ts: 'any', cocos: null, import: null, defaultVal: 'null' };

    if (csharpType.kind === 'TupleTypeReference') {
      const elements = csharpType.elements.map(e => this.resolveType(e.type).ts);
      return { ts: `[${elements.join(', ')}]`, cocos: null, import: null, defaultVal: 'null' };
    }

    let typeName = (typeof csharpType === 'string' ? csharpType : (csharpType.name || 'object'))
      .replace(/^global::/, '')
      .replace(/::/g, '.');
    const simpleTypeName = typeName.split('.').pop();

    // Generic type: List<T>, Dictionary<K,V>, HashSet<T>
    if (csharpType.typeArgs && csharpType.typeArgs.length > 0) {
      const args = csharpType.typeArgs.map(t => this.resolveType(t));
      if (typeName === 'List' || typeName === 'System.Collections.Generic.List') {
        const inner = args[0].ts;
        return {
          ts: `${inner.includes('|') ? `(${inner})` : inner}[]`,
          cocos: null,
          import: null,
          defaultVal: '[]'
        };
      }
      if (typeName === 'Dictionary' || typeName === 'System.Collections.Generic.Dictionary') {
        return {
          ts: `Map<${args[0].ts}, ${args[1].ts}>`,
          cocos: null,
          import: null,
          defaultVal: 'new Map()'
        };
      }
      if (typeName === 'HashSet' || typeName === 'System.Collections.Generic.HashSet') {
        return {
          ts: `Set<${args[0].ts}>`,
          cocos: null,
          import: null,
          defaultVal: 'new Set()'
        };
      }
    }

    // Array type: T[]
    if (csharpType.isArray) {
      const base = this.resolveType({ name: typeName });
      return {
        ts: `${base.ts.includes('|') ? `(${base.ts})` : base.ts}[]`,
        cocos: base.cocos ? `[${base.cocos}]` : null,
        import: base.import,
        defaultVal: '[]'
      };
    }

    // Known type map
    if (TYPE_MAP[typeName] || TYPE_MAP[simpleTypeName]) {
      const mapped = TYPE_MAP[typeName] || TYPE_MAP[simpleTypeName];
      return {
        ts: mapped.ts,
        cocos: mapped.cocos,
        import: mapped.import,
        defaultVal: mapped.defaultVal,
        isPrimitive: mapped.isPrimitive || false,
      };
    }

    let modulePath = null;
    let simpleName = typeName;
    const isExternAlias = typeof csharpType !== 'string' && csharpType.name && csharpType.name.includes('::') && !csharpType.name.startsWith('global::');
    if (this.indexer) {
      if (this.indexer.isKnownClass(typeName) || this.indexer.isEnum(typeName) || this.indexer.isInterface(typeName)) {
        modulePath = this.indexer.getModulePath(typeName);
        simpleName = typeName.split('.').pop();
      }
    } else if (typeName.includes('.') && !isExternAlias) {
      const parts = typeName.split('.');
      simpleName = parts.pop();
      const folder = parts.join('/');
      modulePath = `./${folder}/${simpleName}`;
    }

    return {
      ts: `${simpleName} | null`,
      cocos: simpleName,
      import: null,
      modulePath,
      symbolName: simpleName,
      defaultVal: 'null',
      isCustomClass: true,
    };
  }

  resolveLifecycleMethod(methodName) {
    return LIFECYCLE_MAP[methodName] || null;
  }
}

module.exports = {
  SemanticResolver,
  TYPE_MAP,
  LIFECYCLE_MAP,
};
