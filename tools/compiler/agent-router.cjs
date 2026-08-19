'use strict';

/**
 * AI Domain Agent Router
 *
 * Implements Section 7.5 of the Migration Specification:
 * Routes code refinement chunks, compile errors, and engine mismatches to specialized agents:
 * - Compile Error Agent: TypeScript compile errors (tsc diagnostics)
 * - Physics Agent: Physics mismatches, collision, raycasts
 * - Animation Agent: Animator/Animation conversion
 * - UI Agent: Canvas, RectTransform, Button, Text
 * - Performance/GC Agent: Per-frame allocations, GC pressure, hot paths
 * - Validation Agent: Static analysis, dependency checks, broken symbols
 */

const AGENT_DOMAINS = {
  COMPILE_ERROR: {
    name: 'Compile Error Agent',
    id: 'agent.compile_error',
    domain: 'TypeScript compile errors (tsc diagnostics)',
    keywords: ['TS2339', 'TS2304', 'TS2322', 'TS2345', 'TS2554', 'TS1005', 'error TS', 'compiler error'],
  },
  PHYSICS: {
    name: 'Physics Agent',
    id: 'agent.physics',
    domain: 'Physics mismatches, collision, raycasts',
    keywords: ['physics', 'raycast', 'rigidbody', 'collider', 'collision', 'trigger', 'physicssystem', 'spherecast', 'overlapsphere'],
  },
  ANIMATION: {
    name: 'Animation Agent',
    id: 'agent.animation',
    domain: 'Animator/Animation conversion',
    keywords: ['animator', 'animation', 'animationclip', 'animationcontroller', 'playanim', 'crossfade', 'skeleton', 'tween'],
  },
  UI: {
    name: 'UI Agent',
    id: 'agent.ui',
    domain: 'Canvas, RectTransform, Button, Text',
    keywords: ['canvas', 'recttransform', 'button', 'text', 'image', 'label', 'sprite', 'uiopacity', 'anchor', 'alignment', 'font'],
  },
  PERFORMANCE_GC: {
    name: 'Performance/GC Agent',
    id: 'agent.performance_gc',
    domain: 'Per-frame allocations, GC pressure, hot paths',
    keywords: ['zero-gc', 'allocation', 'new vec3', 'new quat', 'update(', 'lateupdate(', 'per-frame', 'hot path', 'garbage', 'instantiate'],
  },
  VALIDATION: {
    name: 'Validation Agent',
    id: 'agent.validation',
    domain: 'Static analysis, dependency checks, broken symbols',
    keywords: ['broken symbol', 'missing import', 'dangling', 'reference', 'undefined symbol', 'validation', 'contract'],
  },
};

class AgentRouter {
  /**
   * Routes an issue, chunk, or diagnostic to the most specialized agent.
   * @param {{ text?: string, reason?: string, memberName?: string, code?: string, error?: string }} item
   * @returns {{ agentName: string, agentId: string, domain: string, priority: 'HIGH' | 'MEDIUM' | 'LOW' }}
   */
  route(item) {
    const rawText = `${item.text || ''} ${item.reason || ''} ${item.memberName || ''} ${item.code || ''} ${item.error || ''}`.toLowerCase();

    // 1. Compile Error check
    if (item.code && item.code.startsWith('TS') || rawText.includes('ts2') || rawText.includes('error ts')) {
      return {
        agentName: AGENT_DOMAINS.COMPILE_ERROR.name,
        agentId: AGENT_DOMAINS.COMPILE_ERROR.id,
        domain: AGENT_DOMAINS.COMPILE_ERROR.domain,
        priority: 'HIGH',
      };
    }

    // 2. Physics check
    if (this._matchesAny(rawText, AGENT_DOMAINS.PHYSICS.keywords)) {
      return {
        agentName: AGENT_DOMAINS.PHYSICS.name,
        agentId: AGENT_DOMAINS.PHYSICS.id,
        domain: AGENT_DOMAINS.PHYSICS.domain,
        priority: 'HIGH',
      };
    }

    // 3. Performance / GC check (especially in update/lateUpdate)
    if (
      (rawText.includes('update') && (rawText.includes('new ') || rawText.includes('gc') || rawText.includes('alloc'))) ||
      this._matchesAny(rawText, AGENT_DOMAINS.PERFORMANCE_GC.keywords)
    ) {
      return {
        agentName: AGENT_DOMAINS.PERFORMANCE_GC.name,
        agentId: AGENT_DOMAINS.PERFORMANCE_GC.id,
        domain: AGENT_DOMAINS.PERFORMANCE_GC.domain,
        priority: 'HIGH',
      };
    }

    // 4. UI check
    if (this._matchesAny(rawText, AGENT_DOMAINS.UI.keywords)) {
      return {
        agentName: AGENT_DOMAINS.UI.name,
        agentId: AGENT_DOMAINS.UI.id,
        domain: AGENT_DOMAINS.UI.domain,
        priority: 'MEDIUM',
      };
    }

    // 5. Animation check
    if (this._matchesAny(rawText, AGENT_DOMAINS.ANIMATION.keywords)) {
      return {
        agentName: AGENT_DOMAINS.ANIMATION.name,
        agentId: AGENT_DOMAINS.ANIMATION.id,
        domain: AGENT_DOMAINS.ANIMATION.domain,
        priority: 'MEDIUM',
      };
    }

    // Default to Validation Agent
    return {
      agentName: AGENT_DOMAINS.VALIDATION.name,
      agentId: AGENT_DOMAINS.VALIDATION.id,
      domain: AGENT_DOMAINS.VALIDATION.domain,
      priority: 'LOW',
    };
  }

  _matchesAny(text, keywords) {
    return keywords.some(k => text.includes(k));
  }
}

module.exports = {
  AGENT_DOMAINS,
  AgentRouter,
};
