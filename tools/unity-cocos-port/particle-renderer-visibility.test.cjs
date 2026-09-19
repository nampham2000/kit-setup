'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {applyUnityParticleDataToCocos}=require('./particle-system-converter');
const createRuntimePorter=require('./runtime-component-porter');
for(const renderer of [{m_Enabled:false,m_RenderMode:0},{m_Enabled:true,m_RenderMode:5},{m_Enabled:true,m_RenderMode:0}]) {
  test(`renderer ${JSON.stringify(renderer)} preserves simulation and serializes separate visibility`,()=>{
    const objects=[{__type__:'cc.Node',_components:[]},{__type__:'cc.ParticleSystem',node:{__id__:0},_enabled:true,renderer:{__id__:2}},{}];
    const builder={objects,cocosDb:{findScriptClass:()=>({classId:'visibility-script'})},addComponent(node,type,props){objects[node]._components.push({__id__:objects.length});objects.push({__type__:type,...props});}};
    applyUnityParticleDataToCocos(builder,1,{},renderer);
    assert.equal(objects[1]._enabled,true);
    createRuntimePorter({}).attachParticleRendererVisibility(builder,{high(){throw new Error('Unexpected missing helper');}});
    const hidden=!renderer.m_Enabled||renderer.m_RenderMode===5;
    assert.equal(objects[0]._components.length,hidden?1:0);
    if(hidden)assert.deepEqual(objects[3].source,{__id__:1});
    if(hidden)assert.equal(objects[3].trailsVisible,renderer.m_Enabled);
    assert.ok(!JSON.stringify(objects).includes('unityRendererHidden'));
  });
}
test('visibility adapter hides model and trails without stopping particles',()=>{
  const source=fs.readFileSync(path.join(__dirname,'runtime/UnityParticleRendererVisibility.ts'),'utf8');
  const body=source.slice(source.indexOf('        if (!this.source)'),source.lastIndexOf('\n    }')).replace(/ as any/g,'');
  const run=new Function(body);
  const ps={processor:{_model:{enabled:true}},trailModule:{_trailModel:{enabled:true},getModel(){return this._trailModel;}},stop(){throw new Error('Simulation must remain running');}};
  run.call({source:ps,rendererVisible:false});
  assert.equal(ps.processor._model.enabled,false);assert.equal(ps.trailModule._trailModel.enabled,false);
  ps.processor._model.enabled=true;ps.trailModule._trailModel.enabled=true;
  run.call({source:ps,rendererVisible:false,trailsVisible:true});
  assert.equal(ps.processor._model.enabled,false);assert.equal(ps.trailModule._trailModel.enabled,true);
});
