const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('extension/popup.js','utf8');

async function popup({saved={},response={ok:true},messageFails=false}={}){
  const elements=Object.fromEntries(['token','tab','status','arm','disarm','scan','scan-details'].map(id=>[id,{value:'',textContent:'',hidden:true,append(option){if(!this.value||option.selected)this.value=String(option.value);}}]));
  const messages=[];
  const chrome={storage:{local:{get:async()=>({token:'saved-token',tabId:1,...saved})}},tabs:{query:async()=>[{id:1,url:'https://student.iclicker.com/#/polling',title:'Class'}]},runtime:{sendMessage:async message=>{messages.push(message);if(messageFails)throw Error('Worker unavailable');return response;}}};
  const context=vm.createContext({chrome,document:{querySelector:selector=>elements[selector.slice(1)],createElement:()=>({})},Date});
  await vm.runInContext('(async()=>{'+source+'})()',context);
  return {elements,messages};
}
test('reopened popup shows saved connection error instead of Connected',async()=>{
  const error='Edge blocked debugger access. Extension frame IDs found: '+ 'b'.repeat(32);
  const p=await popup({saved:{armed:true,lastStatus:'Connection blocked',connectionError:error}});assert.equal(p.elements.status.textContent,error);assert.equal(p.elements.token.value,'saved-token');
});
test('popup preserves the diagnostic details returned by a failed connection',async()=>{
  const error='Edge blocked debugger access; frame '+ 'b'.repeat(32);
  const p=await popup({response:{ok:false,error}});await p.elements.arm.onclick();assert.equal(p.elements.status.textContent,error);assert.equal(p.messages[0].tabId,1);
});
test('popup offers recovery if the extension worker cannot respond',async()=>{
  const p=await popup({messageFails:true});await p.elements.arm.onclick();assert.match(p.elements.status.textContent,/Reload it at edge:\/\/extensions/);
});
test('popup does not call an unverified armed connection Connected',async()=>{
  const p=await popup({saved:{armed:true,lastStatus:''}});assert.match(p.elements.status.textContent,/not yet verified/);
});
test('successful connection still shows the monitoring instruction',async()=>{
  const p=await popup();await p.elements.arm.onclick();assert.match(p.elements.status.textContent,/Tab connected/);
});
