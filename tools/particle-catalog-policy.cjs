'use strict';

// A previous pack's passing suites cannot certify a new particle catalog.
function summarizeBindingGaps(report) {
  if (!report || !Array.isArray(report.gaps) || !Array.isArray(report.moduleGaps)) {
    throw Object.assign(Error('Both renderer gaps and moduleGaps must be reported'), {code:'PARTICLE_GAP_REPORT_INVALID'});
  }
  const all=[...report.gaps,...report.moduleGaps],byCode={};
  for(const gap of all){const code=gap.code||'PARTICLE_RENDERER_UNVERIFIED';byCode[code]=(byCode[code]||0)+1;}
  return {rendererGaps:report.gaps.length,moduleGaps:report.moduleGaps.length,totalGaps:all.length,byCode,
    status:all.length?'generated-with-unverified-semantics':'generated-awaiting-visual-acceptance',visualAccepted:false};
}

function auditParticleCatalog(catalog, bindingReport, suites, boundedPixels) {
  const errors=[];
  if(catalog?.schemaVersion!==1 || !Array.isArray(catalog.prefabs) || !catalog.prefabs.length ||
     catalog.prefabs.some(p=>typeof p!=='string'||!p.startsWith('assets/')||!p.endsWith('.prefab')||p.includes('..')||p.includes('\\')) ||
     new Set(catalog.prefabs).size!==catalog.prefabs.length) {
    return {ok:false,errors:['Particle catalog requires unique project-relative prefab paths'],missing:[]};
  }
  const summary=summarizeBindingGaps(bindingReport);
  if(summary.totalGaps)errors.push(`${summary.totalGaps} unresolved binding obligations (${summary.rendererGaps} renderer, ${summary.moduleGaps} module)`);
  if(catalog.referenceDecision!=='selected')errors.push('Particle reference baseline is unresolved');
  const phases=catalog.phases;
  if(!Array.isArray(phases)||!['birth','peak','decay'].every(p=>phases.includes(p))||new Set(phases).size!==phases.length||phases.some(p=>!['birth','peak','decay','loop','terminal'].includes(p))) {
    return {ok:false,errors:[...errors,'Catalog must request birth, peak and decay phases'],missing:[],summary};
  }
  const missing=[];
  const thresholds=catalog.referenceMetrics;
  if(!thresholds||!['foregroundRgbSimilarity','foregroundIou'].every(k=>typeof thresholds[k]==='number'&&thresholds[k]>0&&thresholds[k]<=1))
    return {ok:false,errors:[...errors,'Catalog requires explicit color and silhouette similarity thresholds'],missing:[],summary};
  for(const prefab of catalog.prefabs)for(const phase of phases){
    const covered=suites.some(s=>s.mandatory&&s.risks.includes('particle-vfx')&&s.watchFiles.includes(prefab)&&
      s.matrixEvidence.value.cases.some(c=>c.particlePrefab===prefab&&c.particlePhase===phase&&c.referenceImage&&
        c.requireEvalOk===true&&boundedPixels(c)&&Object.entries(thresholds).every(([key,min])=>
          typeof c.requiredReferenceMetrics?.[key]?.min==='number'&&c.requiredReferenceMetrics[key].min>=min)));
    if(!covered)missing.push({prefab,phase});
  }
  if(missing.length)errors.push(`${missing.length} prefab/phase cells lack mandatory source-image and semantic coverage`);
  return {ok:!errors.length,errors,missing,summary,totalPrefabs:catalog.prefabs.length,totalCells:catalog.prefabs.length*phases.length};
}
module.exports={summarizeBindingGaps,auditParticleCatalog};
