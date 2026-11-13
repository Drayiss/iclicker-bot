const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('web/dashboard.js','utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function dashboard({saveFails=false,savedWebhook='https://discord.com/api/webhooks/123/test',delayWebhook=false,loadFails=false}={}){
  const elements={};
  function element(){return {value:'',textContent:'',hidden:true,disabled:false,elements:[],append(){},after(node){elements[node.id]=node;},replaceChildren(){},select(){}};}
  for(const id of ['status','connection','start','stop','settings','provider','model','fallback','codex','timeout','selectors','pairing','secrets','events','notice','retry','test','copy','key','webhook','random','random-wait'])elements[id]=element();
  const state={running:false,status:'Paused',connected:true,bridge_connected:true,last_seen_seconds:1,events:[],settings:{provider:'codex',model:'gpt-6.1-sol',fallback_models:['gpt-6.1-terra'],codex_path:'codex',solver_timeout:90,selectors:{},discord_webhook_set:true,api_key_set:false}};
  const requests=[];
  let releaseWebhook;
  const webhookReady=delayWebhook?new Promise(resolve=>{releaseWebhook=resolve;}):Promise.resolve();
  const context=vm.createContext({document:{getElementById:id=>elements[id],querySelector:()=>({content:'token'}),createElement:()=>element()},fetch:async(path,input)=>{
    requests.push({path,input});
    if(path==='/api/settings-form'){
      await webhookReady;
      return {ok:!loadFails,json:async()=>loadFails?{error:'Load failed'}:{discord_webhook:savedWebhook}};
    }
    if(path==='/api/settings'){
      if(saveFails)return {ok:false,json:async()=>({error:'Settings validation failed'})};
      const settings=JSON.parse(input.body);
      if(settings.discord_webhook)savedWebhook=settings.discord_webhook;
    }
    return {ok:true,json:async()=>state};
  },AbortSignal,setInterval:()=>0,setTimeout:()=>0,Date,navigator:{clipboard:{writeText:async()=>{}}}});
  vm.runInContext(source,context);
  await settle();
  return {elements,state,requests,refresh:()=>context.refresh(),releaseWebhook};
}
test('failed settings save preserves credential fields for correction',async()=>{const d=await dashboard({saveFails:true});d.elements.key.value='typed-key';d.elements.webhook.value='typed-webhook';await d.elements.settings.onsubmit({preventDefault(){}});assert.equal(d.elements.key.value,'typed-key');assert.equal(d.elements.webhook.value,'typed-webhook');assert.equal(d.elements.notice.textContent,'Settings validation failed');});
test('successful save keeps webhook filled and clears API key',async()=>{const d=await dashboard();d.elements.key.value='typed-key';d.elements.webhook.value='typed-webhook';await d.elements.settings.onsubmit({preventDefault(){}});assert.equal(d.elements.key.value,'');assert.equal(d.elements.webhook.value,'typed-webhook');});
test('startup fills saved webhook without filling the API key',async()=>{const d=await dashboard();assert.equal(d.elements.webhook.value,'https://discord.com/api/webhooks/123/test');assert.equal(d.elements.key.value,'');assert.equal(d.requests.find(r=>r.path==='/api/settings-form').input.headers.Authorization,'Bearer token');});
test('new installation leaves webhook empty',async()=>{const d=await dashboard({savedWebhook:''});assert.equal(d.elements.webhook.value,'');});
test('blank webhook on save preserves and reloads the saved value',async()=>{const d=await dashboard();d.elements.webhook.value='';await d.elements.settings.onsubmit({preventDefault(){}});assert.equal(d.elements.webhook.value,'https://discord.com/api/webhooks/123/test');});
test('state refresh does not overwrite an unsaved webhook',async()=>{const d=await dashboard();d.elements.webhook.value='draft-webhook';await d.refresh();assert.equal(d.elements.webhook.value,'draft-webhook');assert.equal(d.requests.filter(r=>r.path==='/api/settings-form').length,1);});
test('slow initial load cannot overwrite webhook edits',async()=>{const d=await dashboard({delayWebhook:true});d.elements.webhook.value='draft-webhook';d.elements.webhook.oninput();d.releaseWebhook();await settle();assert.equal(d.elements.webhook.value,'draft-webhook');});
test('failed webhook load shows an error without stopping state updates',async()=>{const d=await dashboard({loadFails:true});assert.match(d.elements.notice.textContent,/Could not load the saved Discord webhook/);assert.equal(d.elements.status.textContent,'Paused');});
test('automatic refresh preserves unsaved settings edits',async()=>{const d=await dashboard();d.elements.model.value='draft-model';await d.refresh();assert.equal(d.elements.model.value,'draft-model');});
test('a connected extension with a failed tab is not labeled Edge connected',async()=>{const d=await dashboard();d.state.connected=false;await d.refresh();assert.match(d.elements.connection.textContent,/selected tab needs attention/);});
