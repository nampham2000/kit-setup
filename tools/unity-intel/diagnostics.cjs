'use strict';

const path = require('node:path');

const SEVERITIES = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

const BLOCKER_RULES = Object.freeze([
  {
    id: 'textmeshpro',
    code: 'UNITY_TEXTMESHPRO',
    severity: SEVERITIES.MEDIUM,
    label: 'TextMeshPro',
    test: (_file, text) => /TMPro|TextMeshProUGUI|TMP_Text/.test(text),
    impact: 'Label của Cocos không có đầy đủ outline/gradient/SDF của TMP.',
    action: 'Quy về cc.Label + bitmap font; dựng lại outline/gradient bằng effect nếu cần.',
  },
  {
    id: 'addressables',
    code: 'UNITY_ADDRESSABLES_RUNTIME_LOAD',
    severity: SEVERITIES.HIGH,
    label: 'Addressables / AssetBundle',
    test: (_file, text) => /Addressables|AssetReference|AsyncOperationHandle|AssetBundle/.test(text),
    impact: 'Playable là single-file: load runtime bất đồng bộ có thể làm mất asset hoặc hành vi.',
    action: 'Chuyển sang resources.preload hoặc nhúng trực tiếp; bỏ load từ remote/runtime catalog.',
  },
  {
    id: 'zenject',
    code: 'UNITY_ZENJECT_DI',
    severity: SEVERITIES.HIGH,
    label: 'Zenject / DI',
    test: (_file, text) => /\[Inject\]|Zenject|MonoInstaller|DiContainer/.test(text),
    impact: 'Không có container DI tương đương trong playable runtime.',
    action: 'Thay bằng tham chiếu trực tiếp hoặc singleton phù hợp với GameManager lifecycle.',
  },
  {
    id: 'dotween',
    code: 'UNITY_DOTWEEN',
    severity: SEVERITIES.HIGH,
    label: 'DOTween',
    test: (_file, text) => /DG\.Tweening|DOTween|\.DOMove|\.DOScale|\.DOFade/.test(text),
    impact: 'Ease, callback và Sequence của DOTween không map 1:1 sang cc.tween.',
    action: 'Dùng cc.tween; ánh xạ easing, callback và sequence theo gameplay gốc.',
  },
  {
    id: 'urp-volume',
    code: 'UNITY_URP_VOLUME',
    severity: SEVERITIES.MEDIUM,
    label: 'URP post-processing (Volume)',
    test: file => /VolumeProfile|UniversalRenderPipelineGlobalSettings/.test(path.basename(file)),
    impact: 'Bloom, vignette và color grading không có tương đương trực tiếp.',
    action: 'Làm lại bằng effect riêng hoặc chủ động bỏ theo visual budget.',
  },
  {
    id: 'shadergraph',
    code: 'UNITY_SHADER_GRAPH',
    severity: SEVERITIES.HIGH,
    label: 'ShaderGraph',
    test: file => file.toLowerCase().endsWith('.shadergraph'),
    impact: 'Bộ dịch node sang GLSL không phủ mọi node và custom function.',
    action: 'Chạy shader.convert, shader.validate rồi đối chiếu hình ảnh.',
  },
  {
    id: 'shaderlab',
    code: 'UNITY_SHADERLAB',
    severity: SEVERITIES.HIGH,
    label: 'ShaderLab (.shader)',
    test: file => file.toLowerCase().endsWith('.shader'),
    impact: 'Shader sinh ra có thể compile nhưng chưa chứng minh tương đương hình ảnh với Unity.',
    action: 'Chạy shader.convert, shader.validate rồi đối chiếu visual với nguồn.',
  },
  {
    id: 'animator',
    code: 'UNITY_ANIMATOR_STATE_MACHINE',
    severity: SEVERITIES.HIGH,
    label: 'Animator state machine',
    test: file => file.toLowerCase().endsWith('.controller'),
    impact: 'Transition, condition và blend tree không map hết sang cc.Animation.',
    action: 'Dựng lại state flow bằng code và port các clip thực sự được gameplay dùng.',
  },
  {
    id: 'particle',
    code: 'UNITY_PARTICLE_SYSTEM',
    severity: SEVERITIES.MEDIUM,
    label: 'Unity ParticleSystem',
    test: (_file, text) => /ParticleSystem:/.test(text),
    impact: 'Sub-emitter, trail và một số module cần kiểm tra trực quan.',
    action: 'Port bằng port.prefab rồi so sánh bằng mắt.',
  },
  {
    id: 'coroutine',
    code: 'UNITY_COROUTINE',
    severity: SEVERITIES.HIGH,
    label: 'Coroutine',
    test: (_file, text) => /StartCoroutine|IEnumerator|yield return/.test(text),
    impact: 'Cocos không có coroutine Unity; bỏ sót sẽ làm mất timing hoặc hành vi.',
    action: 'Chuyển sang async/await, scheduleOnce hoặc cc.tween theo semantics gốc.',
  },
]);

const RULE_BY_ID = new Map(BLOCKER_RULES.map(rule => [rule.id, rule]));

function createDiagnostic(input) {
  const severity = input.severity || SEVERITIES.LOW;
  if (!Object.values(SEVERITIES).includes(severity)) {
    throw new Error(`Unsupported diagnostic severity: ${severity}`);
  }
  return {
    code: String(input.code || 'UNITY_INTEL_NOTE'),
    severity,
    message: String(input.message || ''),
    action: input.action ? String(input.action) : null,
    source: input.source || 'static',
    count: Number.isFinite(input.count) ? input.count : 1,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
  };
}

function detectBlockerIds(file, text) {
  const ids = [];
  for (const rule of BLOCKER_RULES) {
    try {
      if (rule.test(file, text || '')) ids.push(rule.id);
    } catch (_) {
      // A detector must never abort a project scan.
    }
  }
  return ids;
}

function aggregateBlockers(records, options = {}) {
  const maxExamples = options.maxExamples || 3;
  const hits = new Map();
  for (const record of records) {
    for (const id of record.blockerIds || []) {
      const rule = RULE_BY_ID.get(id);
      if (!rule) continue;
      if (!hits.has(id)) {
        hits.set(id, {
          id: rule.id,
          label: rule.label,
          impact: rule.impact,
          action: rule.action,
          severity: rule.severity,
          count: 0,
          examples: [],
        });
      }
      const hit = hits.get(id);
      hit.count += 1;
      if (hit.examples.length < maxExamples) hit.examples.push(record.assetPath || record.path);
    }
  }
  return [...hits.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function diagnosticsFromBlockers(blockers) {
  return blockers.map(blocker => {
    const rule = RULE_BY_ID.get(blocker.id);
    return createDiagnostic({
      code: rule ? rule.code : `UNITY_${blocker.id.toUpperCase()}`,
      severity: blocker.severity || (rule && rule.severity),
      message: `${blocker.label}: ${blocker.impact}`,
      action: blocker.action,
      count: blocker.count,
      evidence: blocker.examples,
    });
  });
}

module.exports = {
  SEVERITIES,
  BLOCKER_RULES,
  createDiagnostic,
  detectBlockerIds,
  aggregateBlockers,
  diagnosticsFromBlockers,
};
