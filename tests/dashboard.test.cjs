const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('web/dashboard.js','utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function dashboard({saveFails=false}={}){
  const elements={};
  function element(){return {value:'',textContent:'',hidden:true,disabled:false,elements:[],append(){},after(node){elements[node.id]=node;},replaceChildren(){},select(){}};}
  for(const id of ['status','connection','start','stop','settings','provider','model','fallback','codex','timeout','selectors','pairing','secrets','events','notice','retry','test','copy','key','webhook','random','random-wait'])elements[id]=element();
  const state={running:false,status:'Paused',connected:true,bridge_connected:true,last_seen_seconds:1,events:[],settings:{provider:'codex',model:'gpt-6.1-sol',fallback_models:['gpt-6.1-terra'],codex_path:'codex',solver_timeout:90,selectors:{},discord_webhook_set:true,api_key_set:false}};
  const requests=[];
  const context=vm.createContext({document:{getElementById:id=>elements[id],querySelector:()=>({content:'token'}),createElement:()=>element()},fetch:async(path,input)=>{requests.push({path,input});if(path==='/api/settings'&&saveFails)return {ok:false,json:async()=>({error:'Settings validation failed'})};return {ok:true,json:async()=>state};},AbortSignal,setInterval:()=>0,setTimeout:()=>0,Date,navigator:{clipboard:{writeText:async()=>{}}}});
  vm.runInContext(source,context);
  await settle();
  return {elements,state,requests,refresh:()=>context.refresh()};
}
test('failed settings save preserves credential fields for correction',async()=>{const d=await dashboard({saveFails:true});d.elements.key.value='typed-key';d.elements.webhook.value='typed-webhook';await d.elements.settings.onsubmit({preventDefault(){}});assert.equal(d.elements.key.value,'typed-key');assert.equal(d.elements.webhook.value,'typed-webhook');assert.equal(d.elements.notice.textContent,'Settings validation failed');});
test('successful settings save clears credential fields',async()=>{const d=await dashboard();d.elements.key.value='typed-key';d.elements.webhook.value='typed-webhook';await d.elements.settings.onsubmit({preventDefault(){}});assert.equal(d.elements.key.value,'');assert.equal(d.elements.webhook.value,'');});
test('automatic refresh preserves unsaved settings edits',async()=>{const d=await dashboard();d.elements.model.value='draft-model';await d.refresh();assert.equal(d.elements.model.value,'draft-model');});
test('a connected extension with a failed tab is not labeled Edge connected',async()=>{const d=await dashboard();d.state.connected=false;await d.refresh();assert.match(d.elements.connection.textContent,/selected tab needs attention/);});
