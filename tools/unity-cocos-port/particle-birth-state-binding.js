'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');

function attachBirthStateRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.__type__==='cc.ParticleSystem' &&
    ['_rotationOvertimeModule','_sizeOvertimeModule','_colorOverLifetimeModule','_velocityOvertimeModule','_forceOvertimeModule','_limitVelocityOvertimeModule'].some(key=>{
      const module=builder.objects[p[key]?.__id__];return module?._enable ?? module?.enable;
    }));
  if (!particles.length) return;
  if (!options.dryRun) for (const name of ['UnityParticleBirthState','UnityParticleBirthStateAdapter']) {
    const target=path.join(options.cocosRoot,'assets/script',name+'.ts');
    const text=fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8');
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)fs.writeFileSync(target,text);
  }
  let classId=builder.cocosDb?.findScriptClass?.('UnityParticleBirthStateAdapter')?.classId;
  const meta=path.join(options.cocosRoot,'assets/script/UnityParticleBirthStateAdapter.ts.meta');
  if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
  for(const {p,id} of particles) {
    if(!classId) {
      reporter.high('PARTICLE_BIRTH_STATE_ADAPTER_REQUIRED',options.src||'',builder.objects[p.node.__id__]?._name||'',
        'Refresh AssetDB to import UnityParticleBirthStateAdapter.ts, then rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__,classId,{source:{__id__:id}},null,`cmp-unity-birth-state-${id}`);
  }
}
module.exports={attachBirthStateRuntime};
