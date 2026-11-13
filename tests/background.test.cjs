const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('extension/background.js','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function worker(options={}){
  const stored={armed:false,token:'test-token',tabId:1,...(options.stored||{})};
  const requests=[],notifications=[],actions=[],events={},executions=[],intervals=[];
  let workChecks=0;
  let attaches=0;
  let storageFailures=options.storageFailures||0;
  let snapshot={state:'question',question:'What is 2+2?',fingerprint:'q1',controlsClear:true,problem:'',options:[{id:'option-1',text:'A'},{id:'option-2',text:'B'}],documentWidth:900,documentHeight:600,...(options.snapshot||{})};
  const chrome={
    storage:{local:{get:async()=>{if(storageFailures){storageFailures--;throw Error('Storage temporarily unavailable');}return {...stored};},set:async values=>Object.assign(stored,values)}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    notifications:{create:async message=>notifications.push(message)},
    tabs:{get:async()=>{if(options.browserFailure)throw Error('Selected tab is closed');return {url:'https://student.iclicker.com/#/polling'};},query:async()=>options.availableTabs||[],onUpdated:{addListener:fn=>events.route=fn}},
    debugger:{attach:async()=>{attaches++;if(options.attachFailure)throw Error('Debugger already attached');},getTargets:async()=>[],detach:async()=>{},sendCommand:async(_target,method)=>{if(method==='Network.enable'&&options.networkUnavailable)throw Error('Network events unavailable');if(method==='Page.getLayoutMetrics'&&options.foreignDebugger)throw Error('Not attached to this extension');if(method==='Page.captureScreenshot'){if(options.captureFailure)throw Error('Screenshot failed');return {data:'aW1hZ2U='};}return {};},onDetach:{addListener:fn=>events.detach=fn},onEvent:{addListener:fn=>events.network=fn}},
    scripting:{executeScript:async input=>{
      executions.push(input);
      if(input.target.allFrames&&options.frameProbeFailure)throw Error('Frames not accessible');
      if(input.files)return [];
      if(input.target.allFrames&&options.frames)return clone(options.frames);
      if(input.args[0]==='capture')return [{result:clone(snapshot)}];
      actions.push(input.args[1]);
      if(options.actionFailure)throw Error('Question changed before submission');
      snapshot={...snapshot,state:'submitted'};
      if(options.changeOnAction)snapshot.fingerprint='q2';
      return [{result:{phase:'answer'}}];
    }},
    alarms:{create:()=>{},onAlarm:{addListener:fn=>events.alarm=fn}},
    runtime:{onStartup:{addListener:fn=>events.start=fn},onInstalled:{addListener:()=>{}},onMessage:{addListener:fn=>events.message=fn}}
  };
  const context=vm.createContext({chrome,URL,AbortSignal,fetch:async(_url,input)=>{
    if(_url.endsWith('/api/work')){workChecks++;return {ok:true,json:async()=>options.workState||{ready:true,solving:false,running:true}};}
    const payload=JSON.parse(input.body);requests.push(payload);
    const response=options.respond?await options.respond(payload,stored,requests):{running:true,selectors:{},command:null};
    if(response instanceof Error)throw response;
    return {ok:true,status:200,json:async()=>response};
  },setInterval:(_callback,ms)=>{intervals.push(ms);return intervals.length;},clearInterval:()=>{},setTimeout:fn=>queueMicrotask(fn),Date});
  vm.runInContext(source,context);
  await settle();
  return {stored,requests,notifications,actions,events,executions,intervals,poll:()=>context.poll(),classify:value=>context.signalFromFrame(value),get attaches(){return attaches;},get workChecks(){return workChecks;}};
}
const answer={id:'command1',kind:'answer',fingerprint:'q1',answer:{option_ids:['option-1'],text_answer:''}};

test('unarmed worker does no page capture or network work',async()=>{const w=await worker();await w.poll();assert.equal(w.requests.length,0);assert.equal(w.attaches,0);});
test('armed worker sends a complete snapshot and captured image',async()=>{const w=await worker();w.stored.armed=true;await w.poll();assert.equal(w.requests[0].snapshot.question,'What is 2+2?');assert.deepEqual(w.requests[0].snapshot.screenshots,['aW1hZ2U=']);});
test('submission acknowledgments do not request another command',async()=>{let sent=false;const w=await worker({respond:payload=>{if(!sent){sent=true;return {running:true,selectors:{},command:answer};}return {running:true,selectors:{},command:null};}});w.stored.armed=true;await w.poll();assert.equal(w.actions.length,1);assert.equal(w.requests[1].result.ok,true);assert.equal(w.requests[1].acknowledgmentOnly,true);});
test('a different question cannot acknowledge an old answer',async()=>{let sent=false;const w=await worker({changeOnAction:true,respond:()=>{if(!sent){sent=true;return {running:true,command:answer};}return {running:true};}});w.stored.armed=true;await w.poll();assert.equal(w.requests[1].result.ok,false);});
test('disconnect received before action prevents clicking',async()=>{const w=await worker({respond:(_payload,stored)=>{stored.armed=false;return {running:true,command:answer};}});w.stored.armed=true;await w.poll();assert.equal(w.actions.length,0);assert.equal(w.requests[1].result.ok,false);assert.match(w.requests[1].result.message,/connection changed/);});
test('browser access failure is sent to the PC app and notified locally',async()=>{const w=await worker({browserFailure:true});w.stored.armed=true;await w.poll();assert.match(w.requests[0].error,/Selected tab is missing/);assert.equal(w.notifications.length,1);});
test('storage failure releases the busy flag so polling can recover',async()=>{const w=await worker({storageFailures:1});w.stored.armed=true;await w.poll();assert.equal(w.requests.length,1);});
test('network failures show a deduplicated PC notification',async()=>{const w=await worker({respond:()=>Error('Network unavailable')});w.stored.armed=true;await w.poll();await w.poll();assert.equal(w.notifications.length,1);});
test('lost acknowledgment is retained for the next poll',async()=>{let sent=false,failed=false;const w=await worker({respond:payload=>{if(!sent){sent=true;return {running:true,command:answer};}if(payload.acknowledgmentOnly&&!failed){failed=true;return Error('Connection dropped');}return {running:true};}});w.stored.armed=true;await w.poll();await w.poll();assert.equal(w.actions.length,1);assert.equal(w.requests[2].result.id,'command1');assert.equal(w.requests[2].result.ok,true);});
test('revoked debugger access disarms instead of reattaching',async()=>{const w=await worker();w.stored.armed=true;await w.poll();assert.equal(w.attaches,1);await w.events.detach({tabId:1},'canceled_by_user');assert.equal(w.stored.armed,false);await w.poll();assert.equal(w.attaches,1);});
test('network detector failure does not disable the primary polling path',async()=>{const w=await worker({networkUnavailable:true});w.stored.armed=true;await w.poll();assert.equal(w.requests[0].snapshot.signals.network,'unavailable');assert.equal(w.requests[0].snapshot.state,'question');});
test('structured websocket events wake capture without retaining raw credentials',async()=>{const w=await worker();w.stored.armed=true;await w.poll();w.events.network({tabId:1},'Network.webSocketFrameReceived',{requestId:'ws',response:{payloadData:JSON.stringify({type:'question.opened',data:{questionId:'q2',access_token:'DO_NOT_RETAIN'}})}});await settle();assert.ok(w.requests.length>=2);assert.equal(w.requests.at(-1).snapshot.signals.lastEvent.kind,'question');assert.equal(JSON.stringify(w.requests).includes('DO_NOT_RETAIN'),false);});
test('irrelevant or oversized websocket messages are ignored',async()=>{const w=await worker();assert.equal(w.classify('{"type":"heartbeat","text":"question"}'),null);assert.equal(w.classify('x'.repeat(140000)),null);assert.equal(w.classify('not json'),null);assert.equal(w.classify('42["question_opened",{"questionId":"q3"}]').key,'q3');});
test('third-party websocket origins do not trigger activity detection',async()=>{const w=await worker();w.stored.armed=true;await w.poll();w.events.network({tabId:1},'Network.webSocketCreated',{requestId:'ads',url:'wss://example.test/events'});w.events.network({tabId:1},'Network.webSocketFrameReceived',{requestId:'ads',response:{payloadData:'{"type":"question.opened"}'}});await settle();assert.equal(w.requests.length,1);});
test('a visible same-origin question iframe can supply the active question',async()=>{const w=await worker({frames:[{frameId:0,result:{state:'unknown',fingerprint:'root',frameVisible:true}},{frameId:4,documentId:'doc-4',result:{state:'question',question:'What is 2+2?',fingerprint:'q-frame',controlsClear:true,frameVisible:true,documentWidth:900,documentHeight:600}}]});w.stored.armed=true;await w.poll();assert.equal(w.requests[0].snapshot.frameId,4);assert.equal(w.requests[0].snapshot.documentId,'doc-4');});
test('two visible active question frames are blocked instead of guessed',async()=>{const w=await worker({frames:[{frameId:0,result:{state:'question',question:'one',fingerprint:'q1',controlsClear:true,frameVisible:true}},{frameId:4,result:{state:'question',question:'two',fingerprint:'q2',controlsClear:true,frameVisible:true}}]});w.stored.armed=true;await w.poll();assert.equal(w.requests[0].snapshot.controlsClear,false);assert.match(w.requests[0].snapshot.problem,/Multiple visible question frames/);});
test('inaccessible frame probing falls back to the main page',async()=>{const w=await worker({frameProbeFailure:true});w.stored.armed=true;await w.poll();assert.equal(w.requests[0].snapshot.frameProbe,'unavailable');assert.equal(w.requests[0].snapshot.question,'What is 2+2?');});
test('capture failure preserves visible options for the configured random fallback',async()=>{const w=await worker({captureFailure:true});w.stored.armed=true;await w.poll();assert.match(w.requests[0].snapshot.captureProblem,/Screenshot failed/);assert.equal(w.requests[0].snapshot.options.length,2);assert.equal(w.requests[0].error,undefined);});
test('persistent command ledger prevents duplicate actions',async()=>{const w=await worker({respond:()=>({running:true,command:answer})});w.stored.armed=true;await w.poll();await w.poll();assert.equal(w.actions.length,1);assert.equal(w.stored.commandLedger[0].id,answer.id);});
test('a started command surviving a worker restart is never clicked again',async()=>{const w=await worker({stored:{commandLedger:[{id:answer.id,fingerprint:'q1'}]},respond:()=>({running:true,command:answer})});w.stored.armed=true;await w.poll();assert.equal(w.actions.length,0);assert.equal(w.requests[1].result.ok,false);});
test('a stored acknowledgment is restored after worker restart',async()=>{const w=await worker({stored:{pendingResult:{id:'old-action',ok:true}}});w.stored.armed=true;await w.poll();assert.equal(w.requests[0].result.id,'old-action');assert.equal(w.stored.pendingResult,null);});
test('an attachment owned by this extension can recover after worker restart',async()=>{const w=await worker({attachFailure:true});w.stored.armed=true;await w.poll();assert.equal(w.requests[0].snapshot.state,'question');});
test('another debugger is never commandeered',async()=>{const w=await worker({attachFailure:true,foreignDebugger:true});w.stored.armed=true;await w.poll();assert.match(w.requests[0].error,/already attached/);assert.equal(w.actions.length,0);});
test('browser tab recovery requires exactly one matching course URL',async()=>{const url='https://student.iclicker.com/#/courses/course-123/tab/default';const w=await worker({browserFailure:true,stored:{tabUrl:url},availableTabs:[{id:8,url}]});w.stored.armed=true;await w.poll();assert.equal(w.stored.tabId,8);assert.equal(w.requests[0].snapshot.state,'question');});
test('multiple matching tabs stop automatic reconnection',async()=>{const url='https://student.iclicker.com/#/courses/course-123/tab/default';const w=await worker({browserFailure:true,stored:{tabUrl:url},availableTabs:[{id:8,url},{id:9,url}]});w.stored.armed=true;await w.poll();assert.match(w.requests[0].error,/exactly one tab/);assert.equal(w.actions.length,0);});
test('a generic polling URL is not enough to reconnect to the intended class',async()=>{const url='https://student.iclicker.com/#/polling';const w=await worker({browserFailure:true,stored:{tabUrl:url},availableTabs:[{id:8,url}]});w.stored.armed=true;await w.poll();assert.match(w.requests[0].error,/no course identity/);assert.equal(w.actions.length,0);});
test('a ready solver answer wakes inspection without waiting for the three-second timer',async()=>{let sent=false;const w=await worker({respond:()=>{if(!sent){sent=true;return {running:true,workPending:true};}return {running:true};}});w.stored.armed=true;await w.poll();await settle();assert.ok(w.workChecks>=1);assert.ok(w.requests.length>=2);});
test('actions are bound to the captured iframe document ID',async()=>{let sent=false;const w=await worker({frames:[{frameId:4,documentId:'doc-4',result:{state:'question',question:'What is 2+2?',fingerprint:'q1',controlsClear:true,frameVisible:true,documentWidth:900,documentHeight:600}}],respond:()=>{if(!sent){sent=true;return {running:true,command:answer};}return {running:true};}});w.stored.armed=true;await w.poll();const action=w.executions.find(call=>call.args?.[0]==='act');assert.deepEqual(Array.from(action.target.documentIds),['doc-4']);});
test('regular inspection runs every three seconds',async()=>{const w=await worker();assert.ok(w.intervals.includes(3000));assert.equal(w.intervals.includes(5000),false);});
