'use strict';

/**
 * Engine Mismatch Database
 *
 * Implements Section 4.1 & 4.2 of the Migration Specification:
 * - 4.2.1 Coordinate System
 * - 4.2.2 Physics
 * - 4.2.3 Lifecycle
 * - 4.2.4 UI
 * - 4.2.5 Animation
 * - 4.2.6 Garbage Collection / Value Semantics
 */

/**
 * @typedef {Object} EngineMismatch
 * @property {string} id
 * @property {'coordinate' | 'lifecycle' | 'physics' | 'ui' | 'animation' | 'audio' | 'gc' | 'input' | 'serialization'} category
 * @property {string} unityConcept
 * @property {string} cocosEquivalent
 * @property {string} description
 * @property {'HIGH' | 'MEDIUM' | 'LOW'} severity
 * @property {string[]} detectionPatterns
 * @property {string} remediation
 * @property {number} confidence
 */

/** @type {Record<string, EngineMismatch>} */
const ENGINE_MISMATCH_ENTRIES = {
  // ── 4.2.1 Coordinate System ──────────────────────────────────────────────
  'coordinate.forward': {
    id: 'coordinate.forward',
    category: 'coordinate',
    unityConcept: 'Transform.forward / Vector3.forward (+Z)',
    cocosEquivalent: 'this.node.forward / Vec3.FORWARD (-Z)',
    description: 'Unity is left-handed (+Z forward), while Cocos Creator 3.8.8+ is right-handed (-Z forward). Direct mapping to Vec3.FORWARD works because Cocos defines Vec3.FORWARD as (0, 0, -1). All forward/backward directions must be inverted along Z.',
    severity: 'HIGH',
    detectionPatterns: ['Vector3.forward', 'transform.forward', 'this.transform.forward', 'Vector3.back'],
    remediation: 'Use Vec3.FORWARD / Vec3.BACK or this.node.forward. For custom coordinate vectors along Z, invert the Z sign.',
    confidence: 1.0,
  },
  'coordinate.lookRotation': {
    id: 'coordinate.lookRotation',
    category: 'coordinate',
    unityConcept: 'Quaternion.LookRotation(forward, up)',
    cocosEquivalent: 'Quat.fromViewUp(out, forward, up)',
    description: 'LookRotation in Unity points +Z forward; Cocos Quat.fromViewUp aligns -Z forward with the target view direction. Must handle coordinate flip if forward is not already Cocos-converted.',
    severity: 'HIGH',
    detectionPatterns: ['Quaternion.LookRotation', 'LookRotation'],
    remediation: 'Emit Quat.fromViewUp(_tempQuat_0, forward, up || Vec3.UP). Ensure forward vector is right-handed.',
    confidence: 0.95,
  },
  'coordinate.eulerRotation': {
    id: 'coordinate.eulerRotation',
    category: 'coordinate',
    unityConcept: 'Transform.eulerAngles (ZXY/YXZ in Unity)',
    cocosEquivalent: 'this.node.eulerAngles / setRotationFromEuler',
    description: 'Euler angle rotation order differs slightly between engines. Direct component setters in Cocos use intrinsic extrinsic conversions.',
    severity: 'MEDIUM',
    detectionPatterns: ['eulerAngles', 'transform.eulerAngles'],
    remediation: 'Use this.node.setRotationFromEuler(x, y, z) or Quat.fromEuler(_tempQuat_0, x, y, z).',
    confidence: 0.9,
  },

  // ── 4.2.2 Physics ────────────────────────────────────────────────────────
  'physics.coordinate_handedness': {
    id: 'physics.coordinate_handedness',
    category: 'physics',
    unityConcept: 'Left-handed PhysX physics engine',
    cocosEquivalent: 'Right-handed Bullet / PhysX physics engine',
    description: 'Unity uses left-handed physics, Cocos uses right-handed (Bullet). Gravity vector sign and angular torque orientations may differ.',
    severity: 'HIGH',
    detectionPatterns: ['Rigidbody', 'AddForce', 'AddTorque', 'Physics.Raycast'],
    remediation: 'Invert angular forces along Z; use UnityPhysics compatibility helper for raycasting and overlaps.',
    confidence: 0.95,
  },
  'physics.callbacks_events': {
    id: 'physics.callbacks_events',
    category: 'physics',
    unityConcept: 'OnCollisionEnter(Collision) / OnTriggerEnter(Collider)',
    cocosEquivalent: 'Collider.on("onCollisionEnter", callback) / Collider.on("onTriggerEnter", callback)',
    description: 'Collision/Trigger callback names differ. Unity dispatches magic callback methods; Cocos Creator requires registering event listeners on Collider components.',
    severity: 'HIGH',
    detectionPatterns: ['OnCollisionEnter', 'OnCollisionExit', 'OnCollisionStay', 'OnTriggerEnter', 'OnTriggerExit', 'OnTriggerStay'],
    remediation: 'Register event listeners in start()/onLoad() via this.getComponent(Collider).on("onTriggerEnter", this.onTriggerEnter, this).',
    confidence: 0.95,
  },
  'physics.fixed_timestep': {
    id: 'physics.fixed_timestep',
    category: 'physics',
    unityConcept: 'FixedUpdate() at fixed 50Hz timestep',
    cocosEquivalent: 'update(dt: number) or PhysicsSystem fixed timestep scheduling',
    description: 'Fixed timestep vs Cocos update. Cocos Playables typically execute physics inside update(dt) or tick PhysicsSystem with fixedTimeStep.',
    severity: 'MEDIUM',
    detectionPatterns: ['FixedUpdate'],
    remediation: 'Transform FixedUpdate into update(dt: number) using dt for deterministic movement or schedule at 50Hz.',
    confidence: 0.9,
  },
  'physics.layer_matrix': {
    id: 'physics.layer_matrix',
    category: 'physics',
    unityConcept: 'Layer collision matrix (1 << layer)',
    cocosEquivalent: 'PhysicsGroup bitmask (PhysicsSystem.PhysicsGroup)',
    description: 'Layer collision matrix uses different indexing between Unity and Cocos.',
    severity: 'LOW',
    detectionPatterns: ['LayerMask.GetMask', '1 << LayerMask.NameToLayer'],
    remediation: 'Use UnityLayerMask.getMask or UnityPhysics compatibility wrappers.',
    confidence: 0.95,
  },

  // ── 4.2.3 Lifecycle ──────────────────────────────────────────────────────
  'lifecycle.awake': {
    id: 'lifecycle.awake',
    category: 'lifecycle',
    unityConcept: 'Awake()',
    cocosEquivalent: 'onLoad()',
    description: 'Not identical; Cocos onLoad fires before children nodes are guaranteed to be fully initialized. Child references should be wired in start().',
    severity: 'MEDIUM',
    detectionPatterns: ['void Awake(', 'Awake()'],
    remediation: 'Map to onLoad(); move cross-node / child component lookups to start().',
    confidence: 0.95,
  },
  'lifecycle.onEnable': {
    id: 'lifecycle.onEnable',
    category: 'lifecycle',
    unityConcept: 'OnEnable()',
    cocosEquivalent: 'onEnable()',
    description: 'Similar, but node hierarchy active/inactive propagation behavior differs when toggled during initialization.',
    severity: 'LOW',
    detectionPatterns: ['void OnEnable(', 'OnEnable()'],
    remediation: 'Map directly to onEnable().',
    confidence: 1.0,
  },
  'lifecycle.start': {
    id: 'lifecycle.start',
    category: 'lifecycle',
    unityConcept: 'Start()',
    cocosEquivalent: 'start()',
    description: 'Generally equivalent; called before the first frame update.',
    severity: 'LOW',
    detectionPatterns: ['void Start(', 'Start()'],
    remediation: 'Map directly to start().',
    confidence: 1.0,
  },
  'lifecycle.update': {
    id: 'lifecycle.update',
    category: 'lifecycle',
    unityConcept: 'Update() + Time.deltaTime',
    cocosEquivalent: 'update(dt: number)',
    description: 'Equivalent if Time.deltaTime is mapped to dt parameter.',
    severity: 'LOW',
    detectionPatterns: ['void Update(', 'Update()'],
    remediation: 'Map to update(dt: number) and replace Time.deltaTime references with dt.',
    confidence: 1.0,
  },
  'lifecycle.fixedUpdate': {
    id: 'lifecycle.fixedUpdate',
    category: 'lifecycle',
    unityConcept: 'FixedUpdate()',
    cocosEquivalent: 'No direct equivalent (use update(dt) or PhysicsSystem events)',
    description: 'Must use PhysicsSystem events or fixed timestep scheduling.',
    severity: 'HIGH',
    detectionPatterns: ['void FixedUpdate(', 'FixedUpdate()'],
    remediation: 'Transform FixedUpdate into update(dt: number) or schedule with PhysicsSystem.instance.',
    confidence: 0.85,
  },
  'lifecycle.onDisable': {
    id: 'lifecycle.onDisable',
    category: 'lifecycle',
    unityConcept: 'OnDisable()',
    cocosEquivalent: 'onDisable()',
    description: 'Similar; fires when component or node is deactivated.',
    severity: 'LOW',
    detectionPatterns: ['void OnDisable(', 'OnDisable()'],
    remediation: 'Map directly to onDisable().',
    confidence: 1.0,
  },
  'lifecycle.onDestroy': {
    id: 'lifecycle.onDestroy',
    category: 'lifecycle',
    unityConcept: 'OnDestroy()',
    cocosEquivalent: 'onDestroy()',
    description: 'Similar; fires when component or node is destroyed. Clean up all event listeners here.',
    severity: 'LOW',
    detectionPatterns: ['void OnDestroy(', 'OnDestroy()'],
    remediation: 'Map directly to onDestroy() and unbind node/input listeners.',
    confidence: 1.0,
  },

  // ── 4.2.4 UI ─────────────────────────────────────────────────────────────
  'ui.coordinate_origin': {
    id: 'ui.coordinate_origin',
    category: 'ui',
    unityConcept: 'Unity UI origin bottom-left / RectTransform anchors',
    cocosEquivalent: 'Cocos UI origin center (anchorPoint 0.5, 0.5) + UITransform',
    description: 'Unity UI coordinates default to bottom-left origin; Cocos Creator 3.8.8+ defaults to center origin with anchorPoint (0.5, 0.5).',
    severity: 'HIGH',
    detectionPatterns: ['RectTransform', 'anchoredPosition', 'sizeDelta'],
    remediation: 'Set UITransform contentSize and anchorPoint(0.5, 0.5); attach Widget component for responsive alignment.',
    confidence: 0.9,
  },
  'ui.canvas_hierarchy': {
    id: 'ui.canvas_hierarchy',
    category: 'ui',
    unityConcept: 'Canvas component',
    cocosEquivalent: 'Canvas component (Cocos 3.8)',
    description: 'Cocos requires Canvas component on root 2D UI hierarchy with camera render target.',
    severity: 'LOW',
    detectionPatterns: ['Canvas'],
    remediation: 'Ensure root 2D node has Canvas + UITransform components.',
    confidence: 1.0,
  },
  'ui.text_mapping': {
    id: 'ui.text_mapping',
    category: 'ui',
    unityConcept: 'Text / TextMeshProUGUI',
    cocosEquivalent: 'Label component',
    description: 'Unity Text.text maps to Cocos Label.string.',
    severity: 'LOW',
    detectionPatterns: ['Text.text', 'TextMeshProUGUI', 'TMP_Text'],
    remediation: 'Map to Label component and access .string property.',
    confidence: 1.0,
  },
  'ui.image_mapping': {
    id: 'ui.image_mapping',
    category: 'ui',
    unityConcept: 'Image / SpriteRenderer',
    cocosEquivalent: 'Sprite component + SpriteFrame',
    description: 'Unity Image.sprite maps to Cocos Sprite.spriteFrame.',
    severity: 'LOW',
    detectionPatterns: ['Image.sprite', 'Image.color'],
    remediation: 'Map to Sprite component and set .spriteFrame.',
    confidence: 1.0,
  },

  // ── 4.2.5 Animation ──────────────────────────────────────────────────────
  'animation.state_machine': {
    id: 'animation.state_machine',
    category: 'animation',
    unityConcept: 'Unity Animator state machine (transitions, blend trees)',
    cocosEquivalent: 'Cocos AnimationClip / AnimationState / animation.AnimationController',
    description: 'No direct 1:1 mapping for complex Unity Mecanim blend trees or sub-state machines; requires AnimationController or custom state machine in TypeScript.',
    severity: 'HIGH',
    detectionPatterns: ['Animator', 'SetTrigger', 'SetBool', 'SetFloat', 'SetInteger', 'CrossFade'],
    remediation: 'Use Cocos Animation component for clip playback (play/crossFade) or animation.AnimationController with boolean/float parameters.',
    confidence: 0.85,
  },

  // ── 4.2.6 Garbage Collection / Value Semantics ───────────────────────────
  'gc.value_vs_reference_semantics': {
    id: 'gc.value_vs_reference_semantics',
    category: 'gc',
    unityConcept: 'Unity Vector3, Quaternion, Color are C# structs (stack-allocated, pass-by-value)',
    cocosEquivalent: 'Cocos Vec3, Quat, Color are TypeScript classes (heap-allocated, pass-by-reference)',
    description: 'In Unity, mutating a vector copy does not mutate the original. In Cocos, assigning a Vec3 shares reference. Per-frame object creation creates heavy GC pressure.',
    severity: 'HIGH',
    detectionPatterns: ['new Vector3', 'new Vector2', 'new Quaternion', 'new Color'],
    remediation: 'Emitter must use module-level scratch variables (_tempV3_0, _tempQuat_0) and in-place math (.set, .clone, Vec3.add).',
    confidence: 1.0,
  },
  'gc.spawner_object_pool': {
    id: 'gc.spawner_object_pool',
    category: 'gc',
    unityConcept: 'Instantiate / Destroy in gameplay loops',
    cocosEquivalent: 'ObjectPool from playable-core',
    description: 'Frequent instantiate/destroy calls in playable ad loops trigger GC spikes and frame drops.',
    severity: 'HIGH',
    detectionPatterns: ['Instantiate', 'Destroy'],
    remediation: 'Use ObjectPool for pooling bullets, particles, and enemies.',
    confidence: 1.0,
  },
};

class EngineMismatchDatabase {
  constructor() {
    this.entries = new Map(Object.entries(ENGINE_MISMATCH_ENTRIES));
  }

  /**
   * Get mismatch definition by ID
   * @param {string} id
   * @returns {EngineMismatch | null}
   */
  get(id) {
    return this.entries.get(id) || null;
  }

  /**
   * Query an entry by concept, ID, or keyword
   * @param {string} concept
   * @returns {EngineMismatch | null}
   */
  queryByConcept(concept) {
    const term = concept.toLowerCase();
    for (const [id, entry] of this.entries.entries()) {
      if (
        id.toLowerCase().includes(term) ||
        entry.unityConcept.toLowerCase().includes(term) ||
        entry.cocosEquivalent.toLowerCase().includes(term) ||
        entry.category.toLowerCase().includes(term)
      ) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Generate remediation report matching concept or category
   * @param {string} concept
   * @returns {{ totalMismatches: number, mismatches: EngineMismatch[], reportMarkdown: string }}
   */
  generateRemediationReport(concept = '') {
    let mismatches = [];
    if (concept) {
      const term = concept.toLowerCase();
      for (const [id, entry] of this.entries.entries()) {
        if (
          id.toLowerCase().includes(term) ||
          entry.unityConcept.toLowerCase().includes(term) ||
          entry.cocosEquivalent.toLowerCase().includes(term) ||
          entry.category.toLowerCase().includes(term)
        ) {
          mismatches.push(entry);
        }
      }
    } else {
      mismatches = Array.from(this.entries.values());
    }
    return {
      totalMismatches: mismatches.length,
      mismatches,
      reportMarkdown: this.formatReport(mismatches),
    };
  }

  /**
   * Get all entries in a category
   * @param {string} category
   * @returns {EngineMismatch[]}
   */
  getByCategory(category) {
    const results = [];
    for (const entry of this.entries.values()) {
      if (entry.category === category) results.push(entry);
    }
    return results;
  }

  /**
   * Get all entries with specific severity
   * @param {'HIGH' | 'MEDIUM' | 'LOW'} severity
   * @returns {EngineMismatch[]}
   */
  getBySeverity(severity) {
    const results = [];
    for (const entry of this.entries.values()) {
      if (entry.severity === severity) results.push(entry);
    }
    return results;
  }

  /**
   * Detect potential engine mismatches from C# source code or AST keywords
   * @param {string} sourceCode
   * @returns {EngineMismatch[]}
   */
  detectInSource(sourceCode) {
    const detected = new Map();
    for (const entry of this.entries.values()) {
      for (const pattern of entry.detectionPatterns) {
        if (sourceCode.includes(pattern)) {
          detected.set(entry.id, entry);
          break;
        }
      }
    }
    return Array.from(detected.values());
  }

  /**
   * Generate remediation report from detected mismatch entries
   * @param {EngineMismatch[]} mismatches
   * @returns {string}
   */
  formatReport(mismatches) {
    const lines = ['# Engine Mismatch Remediation Report', ''];
    for (const m of mismatches) {
      lines.push(`### [${m.severity}] ${m.unityConcept} -> ${m.cocosEquivalent}`);
      lines.push(`- **Category**: \`${m.category}\``);
      lines.push(`- **Description**: ${m.description}`);
      lines.push(`- **Remediation**: ${m.remediation}`);
      lines.push(`- **Confidence**: ${(m.confidence * 100).toFixed(0)}%`);
      lines.push('');
    }
    return lines.join('\n');
  }
}

module.exports = {
  ENGINE_MISMATCH_ENTRIES,
  EngineMismatchDatabase,
};
