/* Behavioral adapter tests using a deliberately small DOM double, no packages. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('extension/page.js','utf8');

function fixture({missing=false,ambiguous=false,multiple=false,textInput=false,disabledSubmit=false,nativeIclicker=false,imageOnly=false,hiddenImage=false,joinBanner=false,observe=false,invisibleFrame=false}={}){
  let submitted=0;
  let digestHook;
  const all=[];
  class Element{
    constructor(tag,content='',attrs={}){this.tagName=tag.toUpperCase();this.innerText=content;this.attrs=attrs;this.disabled=false;this.checked=false;this.type=attrs.type;this.previousElementSibling=null;this.parentElement=null;this.classList={contains:()=>false};this.clientHeight=100;this.scrollHeight=100;all.push(this);}
    getAttribute(key){return this.attrs[key]??null;}
    getClientRects(){return [{}];}
    getBoundingClientRect(){return {width:100,height:100};}
    closest(selector){return selector.startsWith('main')?main:null;}
    dispatchEvent(){}
    click(){if(this===join){body.innerText="You're connected. Please wait for your instructor to begin.";map['#btnJoin']=[];map['button, [role="button"], input[type="submit"], a']=[];}else if(this===submit){if(this.disabled)throw Error('Disabled submit clicked');submitted++;body.innerText='Answer submitted';}else if(options.includes(this)){if(!multiple)for(const option of options)option.checked=false;this.checked=multiple?!this.checked:true;submit.disabled=false;if(nativeIclicker){submitted++;body.innerText=`Multiple Choice\nAnswer Received: ${this.innerText}`;}}}
  }
  class Input extends Element{get value(){return this._value||'';}set value(value){this._value=value;submit.disabled=false;}}
  const html=new Element('html');html.scrollWidth=900;html.scrollHeight=600;
  const body=new Element('body',nativeIclicker?'Poll in progress\nMultiple Choice':'Poll in progress');body.parentElement=html;
  const main=new Element('main','What is 2 + 2?\n4\n5');main.parentElement=body;
  const heading=new Element('h2','Question 1');heading.parentElement=main;
  const question=new Element('p',(missing||imageOnly)?'':'What is 2 + 2?');question.parentElement=main;question.previousElementSibling=heading;
  const options=textInput?[]:nativeIclicker?[new Element('button','A'),new Element('button','B')]:[new Input('input','',{type:multiple?'checkbox':'radio'}),new Input('input','',{type:multiple?'checkbox':'radio'})];
  const labels=[new Element('label','4'),new Element('label','5')];
  options.forEach((e,i)=>{if(!nativeIclicker)e.labels=[labels[i]];e.parentElement=labels[i];labels[i].parentElement=main;if(i)labels[i].previousElementSibling=labels[0];});
  const input=textInput?new Input('input','',{type:'text'}):null;if(input)input.parentElement=main;
  const submit=new Element('button','Submit Answer');submit.parentElement=main;submit.disabled=disabledSubmit;
  const other=new Element('button','Submit Answer');other.parentElement=main;other.previousElementSibling=submit;
  const join=new Element('button','Join');join.parentElement=main;join.previousElementSibling=other;
  const image=new Element('img','',{src:hiddenImage?'https://assets.example/image_hidden_2.png':'https://assets.example/shared-slide.png'});image.parentElement=main;image.complete=true;image.naturalWidth=1200;image.naturalHeight=900;
  function cssPath(e){const parts=[];while(e&&e!==html){let i=1;for(let p=e.previousElementSibling;p;p=p.previousElementSibling)if(p.tagName===e.tagName)i++;parts.unshift(`${e.tagName.toLowerCase()}:nth-of-type(${i})`);e=e.parentElement;}return 'html > '+parts.join(' > ');}
  const map={
    'button, [role="button"], input[type="submit"], a':joinBanner?[join]:ambiguous?[submit,other]:nativeIclicker?options:[submit],
    'main input[type="text"], main input[type="number"], main textarea, [role="main"] input[type="text"], [role="main"] textarea, .polling-page-wrapper input[type="text"], .polling-page-wrapper input[type="number"], .polling-page-wrapper input[type="tel"], .polling-page-wrapper textarea':input?[input]:[],
    '[data-testid="question-text"], [data-question-text], .question-text, .question-body, .question-content, #question-text':[question],
    'h1,h2,h3,[data-question-id]':[heading],
    'input[type="radio"], [role="radio"]':(multiple||nativeIclicker)?[]:options,
    'main input[type="checkbox"], [role="main"] input[type="checkbox"], [role="checkbox"][data-option], .polling-page-wrapper input[type="checkbox"]':multiple?options:[],
    '#configured-question':[question],
    '#btnJoin':joinBanner?[join]:[],
    '.polling-page-wrapper':nativeIclicker&&!joinBanner?[main]:[],
    '.question-image-container img, [data-testid="question-image"], [data-question-image], img[alt="Question image"]':imageOnly?[image]:[],
  };
  const document={body,documentElement:html,getElementById:()=>null,querySelectorAll:selector=>map[selector]||all.filter(e=>cssPath(e)===selector && e!==other)};
  const notifications=[],observers=[],listeners={},timers=new Map();let timerId=0;
  const context=vm.createContext({document,location:new URL('https://student.iclicker.com/#/class/1'),innerWidth:900,innerHeight:600,getComputedStyle:()=>({visibility:'visible',display:'block',overflowY:'visible'}),HTMLInputElement:Input,HTMLTextAreaElement:Input,Event:class{},TextEncoder,crypto:{subtle:{digest:async(...args)=>{const result=await webcrypto.subtle.digest(...args);if(digestHook)digestHook();return result;}}},setTimeout:observe?(fn)=>{timers.set(++timerId,fn);return timerId;}:setTimeout,clearTimeout:observe?(id)=>timers.delete(id):clearTimeout});
  if(observe){context.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}};context.chrome={runtime:{sendMessage:message=>{notifications.push(message);return Promise.resolve();}}};context.addEventListener=(type,fn)=>listeners[type]=fn;}
  if(invisibleFrame)context.window={top:{},frameElement:null};
  vm.runInContext(source,context);
  return {adapter:context.__iclickerBot,question,heading,submit,options,input,body,main,image,map,notifications,observers,listeners,create:(tag,text,attrs)=>new Element(tag,text,attrs),get submitted(){return submitted;},onDigest:fn=>digestHook=fn,mutate:()=>{observers[0].callback();for(const fn of timers.values())fn();timers.clear();},reinject:()=>vm.runInContext(source,context)};
}
const command=snapshot=>({kind:'answer',fingerprint:snapshot.fingerprint,answer:{option_ids:['option-1'],text_answer:''}});

test('captures complete question and every option',async()=>{const f=fixture();const snapshot=await f.adapter.capture({});assert.equal(snapshot.state,'question');assert.equal(snapshot.question,'What is 2 + 2?');assert.deepEqual(Array.from(snapshot.options,o=>o.text),['4','5']);assert.equal(snapshot.controlsClear,true);});
test('absent text produces help request',async()=>{const f=fixture({missing:true});const snapshot=await f.adapter.capture({});assert.match(snapshot.problem,/question text is absent/);await assert.rejects(f.adapter.act(command(snapshot),{}));assert.equal(f.submitted,0);});
test('ambiguous submit controls block action',async()=>{const f=fixture({ambiguous:true});const snapshot=await f.adapter.capture({});assert.equal(snapshot.controlsClear,false);await assert.rejects(f.adapter.act(command(snapshot),{}));assert.equal(f.submitted,0);});
test('stale solver answer is discarded before any selection',async()=>{const f=fixture();const snapshot=await f.adapter.capture({});f.heading.innerText='Question 2';await assert.rejects(f.adapter.act(command(snapshot),{}),/Question changed/);assert.equal(f.submitted,0);assert.equal(f.options[0].checked,false);});
test('disabled-until-selection submit is handled and answer is submitted once',async()=>{const f=fixture({disabledSubmit:true});const snapshot=await f.adapter.capture({});assert.equal(snapshot.controlsClear,true);await f.adapter.act(command(snapshot),{});assert.equal(f.submitted,1);assert.equal(f.options[0].checked,true);assert.equal((await f.adapter.capture({})).state,'submitted');await assert.rejects(f.adapter.act(command(snapshot),{}));assert.equal(f.submitted,1);});
test('invented option IDs do not click anything',async()=>{const f=fixture();const snapshot=await f.adapter.capture({});const c=command(snapshot);c.answer.option_ids=['invented'];await assert.rejects(f.adapter.act(c,{}));assert.equal(f.submitted,0);});
test('multi-select clears unwanted choices and verifies selected choices',async()=>{const f=fixture({multiple:true});f.options[1].checked=true;const snapshot=await f.adapter.capture({});assert.equal(snapshot.inputKind,'multiple');await f.adapter.act(command(snapshot),{});assert.equal(f.options[0].checked,true);assert.equal(f.options[1].checked,false);assert.equal(f.submitted,1);});
test('text answer uses input events and submits',async()=>{const f=fixture({textInput:true,disabledSubmit:true});const snapshot=await f.adapter.capture({});const c=command(snapshot);c.answer={option_ids:[],text_answer:'blue'};await f.adapter.act(c,{});assert.equal(f.input.value,'blue');assert.equal(f.submitted,1);});
test('history page never becomes an active question',async()=>{const f=fixture();f.body.innerText='Return to Class History\nTotal Questions : 2';assert.equal((await f.adapter.capture({})).state,'history');});
test('login wins over stale question controls',async()=>{const f=fixture();f.body.innerText='Session expired';assert.equal((await f.adapter.capture({})).state,'error');});
test('custom selector captures full text without truncating',async()=>{const f=fixture();f.question.innerText='Complete content '.repeat(6000);const snapshot=await f.adapter.capture({question:'#configured-question'});assert.equal(snapshot.question,f.question.innerText.trim());});
test('unrelated countdown text does not create a new question identity',async()=>{const f=fixture();const before=await f.adapter.capture({});f.body.innerText='Poll in progress\nTimer 00:25';f.main.innerText+=' Timer 00:25';assert.equal((await f.adapter.capture({})).fingerprint,before.fingerprint);});
test('native iClicker multiple choice submits by one letter click without Submit',async()=>{const f=fixture({nativeIclicker:true});const snapshot=await f.adapter.capture({});assert.equal(snapshot.submitMode,'choice_click');assert.equal(snapshot.controlsClear,true);await f.adapter.act(command(snapshot),{});assert.equal(f.submitted,1);assert.equal((await f.adapter.capture({})).state,'submitted');await assert.rejects(f.adapter.act(command(snapshot),{}));assert.equal(f.submitted,1);});
test('letter buttons without an explicit single-choice type remain blocked',async()=>{const f=fixture({nativeIclicker:true});f.body.innerText='Multiple Answer\nPoll in progress';const snapshot=await f.adapter.capture({});assert.equal(snapshot.controlsClear,false);assert.equal(snapshot.submitMode,'unclear');await assert.rejects(f.adapter.act(command(snapshot),{}));assert.equal(f.submitted,0);});
test('ambiguous explicit submits cannot fall back to implicit submission',async()=>{const f=fixture({nativeIclicker:true,ambiguous:true});f.map['button, [role="button"], input[type="submit"], a'].push(...f.options);assert.equal((await f.adapter.capture({})).controlsClear,false);});
test('native polling slide is forwarded as an image-backed question',async()=>{const f=fixture({nativeIclicker:true,imageOnly:true});const snapshot=await f.adapter.capture({});assert.equal(snapshot.question,'');assert.equal(snapshot.questionSource,'visible_image');assert.match(snapshot.questionImage.source,/shared-slide/);assert.equal(snapshot.problem,'');});
test('instructor-hidden question image is never treated as question content',async()=>{const f=fixture({nativeIclicker:true,imageOnly:true,hiddenImage:true});const snapshot=await f.adapter.capture({});assert.equal(snapshot.questionSource,'absent');assert.match(snapshot.problem,/instructor has hidden/);await assert.rejects(f.adapter.act(command(snapshot),{}));assert.equal(f.submitted,0);});
test('image replacement changes the question fingerprint',async()=>{const f=fixture({nativeIclicker:true,imageOnly:true});const before=await f.adapter.capture({});f.image.attrs.src='https://assets.example/next-slide.png';assert.notEqual((await f.adapter.capture({})).fingerprint,before.fingerprint);});
test('visible Join banner wins over old history text',async()=>{const f=fixture({joinBanner:true});f.body.innerText='Your instructor started class.\nTotal Questions : 2';const snapshot=await f.adapter.capture({});assert.equal(snapshot.state,'join');assert.ok(snapshot.joinSelector);await f.adapter.act({kind:'join',fingerprint:snapshot.fingerprint},{});});
test('native joined confirmation is recognized as waiting',async()=>{const f=fixture();f.map['button, [role="button"], input[type="submit"], a']=[];f.map['input[type="radio"], [role="radio"]']=[];f.map['[data-testid="question-text"], [data-question-text], .question-text, .question-body, .question-content, #question-text']=[];f.body.innerText="You're connected. Please wait for your instructor to begin.";assert.equal((await f.adapter.capture({})).state,'waiting');});
test('native answer click checks for question changes after async fingerprinting',async()=>{const f=fixture({nativeIclicker:true});const snapshot=await f.adapter.capture({});f.onDigest(()=>{f.heading.innerText='Question 2';});await assert.rejects(f.adapter.act(command(snapshot),{}),/immediately before/);assert.equal(f.submitted,0);});
test('DOM observer wakes monitoring for a new question but ignores countdown ticks',async()=>{const f=fixture({observe:true});await f.adapter.capture({});f.body.innerText='Poll in progress\n00:24';f.mutate();assert.equal(f.notifications.length,0);f.heading.innerText='Question 2';f.mutate();assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].type,'page-changed');});
test('repeated page inspections do not install duplicate observers',async()=>{const f=fixture({observe:true});f.reinject();f.reinject();assert.equal(f.observers.length,1);assert.ok(f.listeners.hashchange);assert.ok(f.listeners.popstate);});
test('a closed question is waiting state rather than an ended class',async()=>{const f=fixture();f.body.innerText='Poll is closed';assert.equal((await f.adapter.capture({})).state,'waiting');});
test('authorized random fallback can select and submit with missing question text',async()=>{const f=fixture({missing:true});const snapshot=await f.adapter.capture({});const c=command(snapshot);c.random_fallback=true;await f.adapter.act(c,{});assert.equal(f.submitted,1);});
test('authorized random fallback can submit a native hidden-image question',async()=>{const f=fixture({nativeIclicker:true,imageOnly:true,hiddenImage:true});const snapshot=await f.adapter.capture({});const c=command(snapshot);c.random_fallback=true;await f.adapter.act(c,{});assert.equal(f.submitted,1);});
test('random fallback does not bypass ambiguous submit controls',async()=>{const f=fixture({missing:true,ambiguous:true});const snapshot=await f.adapter.capture({});const c=command(snapshot);c.random_fallback=true;await assert.rejects(f.adapter.act(c,{}));assert.equal(f.submitted,0);});
test('random fallback cannot submit when the poll has closed',async()=>{const f=fixture({missing:true});const snapshot=await f.adapter.capture({});f.body.innerText='Poll is closed';const c=command(snapshot);c.random_fallback=true;await assert.rejects(f.adapter.act(c,{}));assert.equal(f.submitted,0);});
test('a stale question selector recovers through a unique documented match',async()=>{const f=fixture();const snapshot=await f.adapter.capture({question:'.old-question-class'});assert.equal(snapshot.question,'What is 2 + 2?');assert.ok(snapshot.recoveredSelectors.includes('question'));});
test('invalid selector syntax blocks submission without crashing polling',async()=>{const f=fixture();f.map['[broken']=Error('Syntax error');const snapshot=await f.adapter.capture({submit:'[broken'});assert.equal(snapshot.controlsClear,false);assert.match(snapshot.problem,/selector is invalid/);});
test('semantic question labels survive CSS class changes',async()=>{const f=fixture();f.map['[data-testid="question-text"], [data-question-text], .question-text, .question-body, .question-content, #question-text']=[];f.map['[aria-label="Question text"], [aria-label="Current question"], [data-test="question-text"], [data-testid="question-stem"]']=[f.question];assert.equal((await f.adapter.capture({})).question,'What is 2 + 2?');});
test('a documented click-to-submit interface can recover from a stale Submit selector',async()=>{const f=fixture({nativeIclicker:true});const snapshot=await f.adapter.capture({submit:'.old-submit'});assert.equal(snapshot.submitMode,'choice_click');assert.ok(snapshot.recoveredSelectors.includes('submit mode'));});
test('native route and question type can detect a poll after its wrapper class changes',async()=>{const f=fixture({nativeIclicker:true});f.map['.polling-page-wrapper']=[];f.map['.polling-page-wrapper, [data-testid="poll-question"], [data-testid="active-question"], [role="region"][aria-label="Current question"]']=[f.main];assert.equal((await f.adapter.capture({})).controlsClear,true);});
test('a clear timer supplies a bounded remaining-time budget',async()=>{const f=fixture();f.map['[role="timer"], [data-testid="poll-timer"], .poll-timer']=[f.create('div','00:08')];assert.equal((await f.adapter.capture({})).remainingSeconds,8);});
test('non-visible or inaccessible iframe contexts are marked ineligible',async()=>{const f=fixture({invisibleFrame:true});assert.equal((await f.adapter.capture({})).frameVisible,false);});
test('cosmetic figure resizing does not create a new question identity',async()=>{const f=fixture();let width=100;f.image.getBoundingClientRect=()=>({width,height:100});f.map['main img, main svg, main canvas, [role="main"] img, [role="main"] svg, [role="main"] canvas, .question-content img, [data-question-text] img, .question-image-container img']=[f.image];const first=await f.adapter.capture({});width=200;assert.equal((await f.adapter.capture({})).fingerprint,first.fingerprint);});
