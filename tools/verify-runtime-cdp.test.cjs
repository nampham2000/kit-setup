const test=require('node:test'),assert=require('node:assert/strict');
const {CdpSession}=require('./verify-runtime.cjs');
class Socket{
  constructor(){this.readyState=0;this.listeners=new Map();Socket.last=this;}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  event(name,data={}){for(const fn of this.listeners.get(name)||[])fn(data);}
  send(value){if(this.throwSend)throw new Error('send failed');this.last=JSON.parse(value);}
  close(){this.readyState=3;this.event('close');}
}
async function withSocket(fn){const previous=global.WebSocket;global.WebSocket=Socket;try{await fn();}finally{global.WebSocket=previous;}}
async function connect(){const s=new CdpSession('ws://fixture',20,20),p=s.connect();Socket.last.readyState=1;Socket.last.event('open');await p;return s;}
test('CDP response clears its deadline and pending record',()=>withSocket(async()=>{const s=await connect(),p=s.send('Runtime.evaluate');Socket.last.event('message',{data:JSON.stringify({id:1,result:{ok:true}})});assert.deepEqual(await p,{ok:true});assert.equal(s.pending.size,0);s.close();}));
test('a closed browser rejects all pending commands instead of leaving capture hung',()=>withSocket(async()=>{const s=await connect(),a=assert.rejects(s.send('Page.captureScreenshot'),/closed/),b=assert.rejects(s.send('Runtime.evaluate'),/closed/);Socket.last.close();await Promise.all([a,b]);assert.equal(s.pending.size,0);await assert.rejects(s.send('Page.captureScreenshot'),/not open/);}));
test('unanswered command, failed send and unopened connection have bounded failures',()=>withSocket(async()=>{const s=await connect();await assert.rejects(s.send('Page.captureScreenshot'),/timed out/);assert.equal(s.pending.size,0);Socket.last.throwSend=true;await assert.rejects(s.send('Runtime.evaluate'),/send failed/);assert.equal(s.pending.size,0);s.close();const opening=new CdpSession('ws://fixture',20,20);await assert.rejects(opening.connect(),/connection timed out/);}));
