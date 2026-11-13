const BASE = 'http://127.0.0.1:8765';
const POLL_INTERVAL_MS = 3000;
let busy = false;
let timer;
let screenshotKey = '';
let screenshotData = [];
let lastFailure = '';
let pendingResult = null;
let currentSelectors = {};
let selectedTab;
let queuedPoll = false;
let eventTimer = null;
let lastWake = 'startup';
let lastSignal = null;
let networkEnabled = false;
let networkAttemptAt = 0;
const socketOrigins = new Map();
let watchingSolver = false;

async function watchSolver(token) {
  if(watchingSolver)return;
  watchingSolver=true;
  try {
    for(let attempt=0;attempt<100;attempt++){
      const settings=await chrome.storage.local.get(['armed','token']);
      if(!settings.armed||settings.token!==token)break;
      const response=await fetch(`${BASE}/api/work`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(2500)});
      if(!response.ok)break;
      const work=await response.json();
      if(work.ready&&work.running){wakePoll('solver answer ready');break;}
      if(!work.solving||!work.running)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  } catch {} finally {watchingSolver=false;}
}

function wakePoll(source) {
  lastWake = source;
  if (busy) { queuedPoll = true; return; }
  if (eventTimer !== null) return;
  eventTimer = setTimeout(()=>{eventTimer=null;poll();},200);
}

// Only reduce well-formed activity events to tiny detection hints. Raw payloads,
// request headers, cookies, access tokens and response bodies are never retained.
function signalFromFrame(payload) {
  if (typeof payload !== 'string' || payload.length > 131072) return null;
  const start = payload.search(/[\[{]/);
  if (start < 0) return null;
  let value;
  try { value = JSON.parse(payload.slice(start)); } catch { return null; }
  const names=[];
  let questionId='';
  const visit=(object,depth=0)=>{
    if(depth>4 || object===null)return;
    if(Array.isArray(object)){for(const child of object.slice(0,24)){if(typeof child==='string' && child.length<100)names.push(child);else visit(child,depth+1);}return;}
    if(typeof object!=='object')return;
    for(const key of ['type','event','eventType','action','command','name','method','topic'])if(typeof object[key]==='string'&&object[key].length<100)names.push(object[key]);
    for(const key of ['questionId','question_id','questionGuid'])if(typeof object[key]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(object[key]))questionId=object[key];
    for(const key of ['data','payload','message','body','question','activity'])if(object[key]&&typeof object[key]==='object')visit(object[key],depth+1);
  };
  visit(value);
  for(const name of names){
    const event=name.toLowerCase().replace(/[^a-z]/g,'');
    if(/(?:question|poll)(?:started|opened|start|open|available)|(?:start|open)(?:poll|question)/.test(event))return {source:'websocket',kind:'question',key:questionId||event};
    if(/(?:class|session)(?:started|opened|start|open)/.test(event))return {source:'websocket',kind:'class',key:event};
    if(/(?:question|poll|session|class)(?:closed|ended|stopped)/.test(event))return {source:'websocket',kind:'end',key:event};
  }
  return null;
}
function relevantNetworkUrl(value) {
  try {const url=new URL(value);return /^(?:https:|wss:)$/.test(url.protocol)&&(url.hostname==='iclicker.com'||url.hostname.endsWith('.iclicker.com'));}catch{return false;}
}
function stableClassUrl(value) {
  try {const url=new URL(value);return url.origin==='https://student.iclicker.com'&&/#\/(?:courses|activity)\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.href);}catch{return false;}
}

async function localAlert(message) {
  await chrome.action.setBadgeText({text:'!'});
  await chrome.action.setBadgeBackgroundColor({color:'#bb3344'});
  if (lastFailure !== message) {
    lastFailure = message;
    await chrome.notifications.create({type:'basic', iconUrl:'icon.png', title:'iClicker Bot needs attention', message});
  }
}
async function post(token, payload) {
  const response = await fetch(`${BASE}/api/poll`, {method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, body:JSON.stringify(payload), signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Error(response.status === 401 ? 'Pairing code was rejected. Copy the current code from the local app.' : `Local app returned HTTP ${response.status}.`);
  return response.json();
}
async function inPage(operation,arg,selectors) {
    if (!globalThis.__iclickerBot) throw Error('Page adapter is not loaded.');
    return operation === 'capture' ? globalThis.__iclickerBot.capture(selectors) : globalThis.__iclickerBot.act(arg,selectors);
}
async function page(tabId, operation, arg, frame={}) {
  const target={tabId};
  if(frame.documentId)target.documentIds=[frame.documentId];
  else if(frame.frameId)target.frameIds=[frame.frameId];
  const [result] = await chrome.scripting.executeScript({target,func:inPage,args:[operation,arg ?? null,currentSelectors]});
  if (!result?.result) throw Error('Could not read the selected tab. Reload it and check access.');
  return result.result;
}
async function capturePage(tabId) {
  let frameProbe='available';
  let results;
  try {
    await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:['page.js']});
    results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:inPage,args:['capture',null,currentSelectors]});
  } catch {
    frameProbe='unavailable';
    await chrome.scripting.executeScript({target:{tabId},files:['page.js']});
    results=[{frameId:0,result:await page(tabId,'capture')}];
  }
  const frames=results.filter(item=>item.result&&item.result.frameVisible!==false).map(item=>({...item.result,frameId:item.frameId||0,documentId:item.documentId}));
  const main=frames.find(frame=>frame.frameId===0);
  if(main&&['login','error','join'].includes(main.state))return {...main,frameProbe};
  const candidates=frames.filter(frame=>(frame.state==='question'&&frame.controlsClear)||frame.state==='submitted');
  if(candidates.length>1){
    const base=main||candidates[0];
    return {...base,state:'question',controlsClear:false,problem:'Multiple visible question frames were found. No answer will be submitted until the active frame is unambiguous.',frameProbe};
  }
  const chosen=candidates[0]||frames.find(frame=>frame.state==='question')||main||frames[0];
  if(!chosen)throw Error('No visible accessible page frame could be inspected.');
  return {...chosen,frameProbe};
}
async function attach(tabId) {
  if (selectedTab === tabId) {
    await chrome.debugger.sendCommand({tabId}, 'Page.getLayoutMetrics');
    if(!networkEnabled&&Date.now()-networkAttemptAt>30000){
      networkAttemptAt=Date.now();
      try{await chrome.debugger.sendCommand({tabId},'Network.enable',{});networkEnabled=true;}catch{}
    }
    return;
  }
  try { await chrome.debugger.attach({tabId}, '1.3'); }
  catch (error) {
    // sendCommand succeeds only for this extension's own attachment, including
    // one surviving a worker restart. It cannot commandeer another debugger.
    try {await chrome.debugger.sendCommand({tabId}, 'Page.getLayoutMetrics');}
    catch {throw error;}
  }
  selectedTab = tabId;
  socketOrigins.clear();
  networkAttemptAt=Date.now();
  try {await chrome.debugger.sendCommand({tabId},'Network.enable',{});networkEnabled=true;}
  catch {networkEnabled=false;} // Polling and DOM detection continue independently.
}
async function screenshot(tabId, snapshot) {
  const metrics=await chrome.debugger.sendCommand({tabId},'Page.getLayoutMetrics');
  const width=metrics.cssContentSize?.width||snapshot.documentWidth;
  const height=metrics.cssContentSize?.height||snapshot.documentHeight;
  if (height > 16000 || width > 6000) throw Error('Question page is too large to capture completely. Reduce its size or expand only the current question.');
  const result = await chrome.debugger.sendCommand({tabId}, 'Page.captureScreenshot', {
    format:'png', captureBeyondViewport:true, fromSurface:true,
    clip:{x:0,y:0,width,height,scale:1}
  });
  if (!result.data || result.data.length > 12_000_000) throw Error('Complete question screenshot exceeded the capture limit. No answer will be guessed.');
  return [result.data];
}
async function poll() {
  if (busy) {queuedPoll=true;return;}
  busy = true;
  try {
    const settings = await chrome.storage.local.get(['token','tabId','armed','pendingResult','selectors','commandLedger','tabUrl','bindingUrl']);
    if (!settings.armed || !settings.token || !settings.tabId) return;
    pendingResult = pendingResult || settings.pendingResult || null;
    if(!Object.keys(currentSelectors).length&&settings.selectors)currentSelectors=settings.selectors;
    let snapshot;
    try {
      let tab;
      try {tab=await chrome.tabs.get(settings.tabId);}
      catch(error){
        const binding=settings.bindingUrl||(stableClassUrl(settings.tabUrl)?settings.tabUrl:null);
        if(!binding)throw Error('Selected tab is missing. The saved URL has no course identity; reconnect the intended class tab manually.');
        const matches=(await chrome.tabs.query({url:'https://student.iclicker.com/*'})).filter(candidate=>candidate.url===binding);
        if(matches.length!==1)throw Error('Selected tab is missing. Reconnection requires exactly one tab with the saved class URL.');
        tab=matches[0];settings.tabId=tab.id;
        await chrome.storage.local.set({tabId:tab.id});
      }
      const url = new URL(tab.url);
      if (!(url.origin === 'https://student.iclicker.com' || (url.origin === BASE && url.pathname === '/demo'))) throw Error('Selected tab left iClicker. Return to the class tab and arm it again.');
      await chrome.storage.local.set({tabUrl:tab.url});
      if(stableClassUrl(tab.url))await chrome.storage.local.set({bindingUrl:tab.url});
      await attach(settings.tabId);
      snapshot = await capturePage(settings.tabId);
      if (snapshot.state === 'question' && (snapshot.question || snapshot.questionSource === 'visible_image') && !snapshot.problem && snapshot.controlsClear) {
        try {
          if (screenshotKey !== snapshot.fingerprint) {
            screenshotData = await screenshot(settings.tabId, snapshot);
          // Rendering may advance during screenshot acquisition; never mix two questions.
          const after = await page(settings.tabId, 'capture',null,snapshot);
          if (after.fingerprint !== snapshot.fingerprint) throw Error('Question changed during capture. Waiting for the next complete question.');
            screenshotKey = snapshot.fingerprint;
          }
          snapshot.screenshots = screenshotData;
        } catch(error) {snapshot.captureProblem=error.message;snapshot.screenshots=[];}
      }
      snapshot.signals={wake:lastWake,network:networkEnabled?'available':'unavailable',lastEvent:lastSignal?{...lastSignal,ageSeconds:Math.round((Date.now()-lastSignal.receivedAt)/1000)}:null};
    } catch (error) {
      const message = `Browser/login/access failure: ${error.message}`;
      await localAlert(message);
      const response = await post(settings.token, {error:message,result:pendingResult});
      if (response.selectors) currentSelectors = response.selectors;
      return;
    }
    const response = await post(settings.token, {snapshot,result:pendingResult});
    if(response.workPending)watchSolver(settings.token);
    pendingResult = null;
    await chrome.storage.local.set({pendingResult:null});
    currentSelectors = response.selectors || {};
    lastFailure = '';
    await chrome.action.setBadgeText({text:response.running ? 'ON' : '||'});
    await chrome.action.setBadgeBackgroundColor({color:response.running ? '#26846d' : '#667085'});
    await chrome.storage.local.set({lastStatus:`${snapshot.state} · ${new Date().toLocaleTimeString()}`,selectors:currentSelectors,lastScan:{checkedAt:Date.now(),state:snapshot.state,problem:snapshot.problem||snapshot.captureProblem||'',source:snapshot.questionSource,options:snapshot.options?.length||0,submitMode:snapshot.submitMode,recoveredSelectors:snapshot.recoveredSelectors||[],frame:snapshot.frameId,frameProbe:snapshot.frameProbe,signals:snapshot.signals}});
    const command = response.command;
    if (command && response.running) {
      try {
        const latest = await chrome.storage.local.get(['tabId','armed','token']);
        if (!latest.armed || latest.tabId !== settings.tabId || latest.token !== settings.token) throw Error('Tab selection or connection changed before the action. No action was taken.');
        const prior = (settings.commandLedger||[]).find(entry=>entry.id===command.id);
        if(prior){pendingResult=prior.result||{id:command.id,ok:false,message:'This action was already started before a restart; it will not be repeated.'};}
        else {
        const ledger=[...(settings.commandLedger||[]).slice(-49),{id:command.id,fingerprint:command.fingerprint}];
        await chrome.storage.local.set({commandLedger:ledger});
        await page(settings.tabId, 'act', command,snapshot);
        let verified = false;
        // Acknowledgment is explicit page state, never just a successful click.
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(resolve=>setTimeout(resolve,250));
          const after = await page(settings.tabId,'capture',null,{frameId:snapshot.frameId});
          if (command.kind === 'answer' && after.fingerprint !== command.fingerprint) break;
          if (command.kind === 'join' ? ['waiting','question','submitted'].includes(after.state) : after.state === 'submitted') {
            verified = true;
            break;
          }
        }
        pendingResult = {id:command.id,ok:verified,message:verified ? '' : 'The browser action was clicked but acknowledgment is unclear. Check the tab. It will not be retried automatically.'};
        ledger[ledger.length-1].result=pendingResult;
        await chrome.storage.local.set({commandLedger:ledger});
        }
      } catch (error) {
        pendingResult = {id:command.id,ok:false,message:error.message};
      }
      await chrome.storage.local.set({pendingResult});
      // Deliver acknowledgment immediately; retain it if the network drops.
      await post(settings.token, {snapshot:await capturePage(settings.tabId),result:pendingResult,acknowledgmentOnly:true});
      pendingResult = null;
      await chrome.storage.local.set({pendingResult:null});
    }
  } catch (error) {
    await localAlert(`Local app connection failure: ${error.message} Keep Start-iClicker-Bot.cmd running.`);
  } finally { busy = false;if(queuedPoll){queuedPoll=false;wakePoll('queued event');} }
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(poll,POLL_INTERVAL_MS);
  // The attached debugger keeps the worker alive (Chromium 118+). An alarm
  // recovers after browser startup/worker restart; it is not the three-second timer.
  chrome.alarms.create('recover',{periodInMinutes:0.5});
}
chrome.alarms.onAlarm.addListener(()=>{ schedule(); poll(); });
chrome.runtime.onStartup.addListener(()=>{ schedule(); poll(); });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (message.type === 'page-changed' && sender.tab) {
    chrome.storage.local.get(['tabId','armed']).then(settings=>{
      if (settings.armed && sender.tab.id === settings.tabId) wakePoll('DOM or route change');
    });
    return false;
  }
  if (message.type === 'arm') {
    (async()=>{
      try {
        if (selectedTab && selectedTab !== message.tabId) {
          const previous = selectedTab;
          selectedTab = undefined;
          await chrome.debugger.detach({tabId:previous}).catch(()=>{});
        }
        await chrome.storage.local.set({token:message.token,tabId:message.tabId,armed:true,bindingUrl:null,tabUrl:null});
        screenshotKey = ''; screenshotData = []; lastFailure = '';
        schedule(); await poll(); reply({ok:!lastFailure,error:lastFailure});
      } catch(error) { reply({ok:false,error:error.message}); }
    })();
    return true;
  }
  if (message.type === 'disarm') {
    (async()=>{
      await chrome.storage.local.set({armed:false});
      if (selectedTab) await chrome.debugger.detach({tabId:selectedTab}).catch(()=>{});
      selectedTab = undefined;
      clearInterval(timer);
      await chrome.action.setBadgeText({text:''});
      reply({ok:true});
    })();
    return true;
  }
});
chrome.debugger.onDetach.addListener(async(source,reason)=>{
  if (source.tabId === selectedTab) {
    selectedTab = undefined;
    const settings = await chrome.storage.local.get(['armed','token']);
    if (settings.armed) {
      // Respect Edge's Cancel button; do not automatically reattach after revocation.
      const mayRecover=reason==='target_closed';
      if(!mayRecover)await chrome.storage.local.set({armed:false});
      const message = mayRecover ? 'The selected tab closed. Looking for one matching class tab; reopen the same class URL to recover.' : 'Edge debugger access was detached. Monitoring stopped. Re-arm the extension when ready.';
      await localAlert(message);
      await post(settings.token,{error:message}).catch(()=>{});
    }
  }
});
schedule();
poll();

chrome.tabs.onUpdated?.addListener((tabId,change)=>{
  if(tabId===selectedTab&&(change.url||change.status==='complete'))wakePoll('tab navigation');
});
chrome.debugger.onEvent?.addListener((source,method,params)=>{
  if(source.tabId!==selectedTab)return;
  if(method==='Network.webSocketCreated'){
    socketOrigins.set(params.requestId,relevantNetworkUrl(params.url));
    if(socketOrigins.size>64)socketOrigins.delete(socketOrigins.keys().next().value);
  } else if(method==='Network.webSocketFrameReceived'){
    if(socketOrigins.get(params.requestId)===false)return;
    const hint=signalFromFrame(params.response?.payloadData);
    if(hint){
      if(lastSignal&&lastSignal.key===hint.key&&Date.now()-lastSignal.receivedAt<1000)return;
      lastSignal={...hint,receivedAt:Date.now()};wakePoll('server activity event');
    }
  } else if(method==='Network.responseReceived'&&relevantNetworkUrl(params.response?.url)){
    const path=new URL(params.response.url).pathname;
    if(/\/(?:polls?|polling|questions?|sessions?|activities)(?:\/|$)/i.test(path))wakePoll('activity response');
  }
});
