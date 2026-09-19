'use strict';
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function lintManagedAudio(files,{projectRoot}){
  const sources=files.map(file=>({file,relative:path.relative(projectRoot,file).replace(/\\/g,'/'),tree:ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)}));
  const mapFile=path.join(projectRoot,'tools/audio-port-map.json');
  const gameplay=sources.filter(s=>!s.relative.startsWith('assets/script/shared/'));
  function hasManagedCall(node){
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='playSound')return true;
    return !!ts.forEachChild(node,hasManagedCall);
  }
  if(!fs.existsSync(mapFile)&&!gameplay.some(s=>hasManagedCall(s.tree)))return [];
  const violations=[];
  const fail=(file,line,rule,message)=>violations.push({file,line,rule,severity:'error',message});
  if(!fs.existsSync(mapFile))fail('tools/audio-port-map.json',1,'AUDIO_PORT_MAP_MISSING','Managed gameplay audio requires a portable source callback map.');
  for(const {relative,tree} of gameplay){
    const names=new Set(['AudioSource']);
    for(const statement of tree.statements){
      if(!ts.isImportDeclaration(statement)||statement.moduleSpecifier.text!=='cc')continue;
      const bindings=statement.importClause?.namedBindings;
      if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if((item.propertyName||item.name).text==='AudioSource')names.add(item.name.text);
    }
    function visit(node){
      let forbidden=false;
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
        const method=node.expression.name.text;
        forbidden=['playSFX','playLoopingSFX','playOneShot'].includes(method)
          ||method==='addComponent'&&node.arguments.some(a=>names.has(a.getText(tree))||a.getText(tree)==='cc.AudioSource');
      }
      if(forbidden)fail(relative,tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,'MANAGED_AUDIO_BYPASS','Route gameplay audio through SoundManager.playSound and preserve owner handles.');
      ts.forEachChild(node,visit);
    }
    visit(tree);
  }
  if(fs.existsSync(mapFile)){
    try{
      const map=JSON.parse(fs.readFileSync(mapFile,'utf8'));
      if(map.schemaVersion!==1||!Array.isArray(map.entries)||!map.entries.length)throw new Error('Expected audio map v1 entries');
      const ids=new Set();
      for(const entry of map.entries){
        if(!entry.id||ids.has(entry.id))throw new Error('Missing or duplicate audio intent id');ids.add(entry.id);
        if(!['preserved','adapted'].includes(entry.policyDisposition)||entry.policyDisposition==='adapted'&&!entry.reason)throw new Error(`Missing policy disposition: ${entry.id}`);
        for(const key of ['runtimeConsumer','regression'])if(typeof entry[key]!=='string'||path.isAbsolute(entry[key])||entry[key].split(/[\\/]/).includes('..')||!fs.existsSync(path.join(projectRoot,entry[key])))throw new Error(`Missing portable ${key}: ${entry.id}`);
        if(!Array.isArray(entry.sourceEvidence)||!entry.sourceEvidence.length||entry.sourceEvidence.some(e=>!e.path||!e.callback||!/^[a-f0-9]{64}$/.test(e.sha256)))throw new Error(`Missing source evidence: ${entry.id}`);
      }
    }catch(error){fail('tools/audio-port-map.json',1,'AUDIO_PORT_MAP_INVALID',error.message);}
  }
  return violations;
}
module.exports={lintManagedAudio};
