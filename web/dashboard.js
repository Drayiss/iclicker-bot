const token = document.querySelector('meta[name="pairing-token"]').content;
const $ = id => document.getElementById(id);
let initialized = false;
let lastEvents = '';
async function api(path, data) {
  const response = await fetch(path,{method:data ? 'POST':'GET',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:data ? JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Local app request failed.');
  return result;
}
function notice(message='') {$('notice').textContent=message;$('notice').hidden=!message;}
function render(state) {
  $('status').textContent=state.status;
  $('connection').textContent=state.connected ? `Edge connected · last check ${state.last_seen_seconds}s ago · ${state.poll_seconds??3}-second polling` : state.bridge_connected ? 'Edge extension connected; the selected tab needs attention.' : 'Waiting for Edge extension';
  const detection=state.detection;
  if(detection){
    let details=$('detection');
    if(!details){details=document.createElement('p');details.id='detection';details.className='muted small';$('connection').after(details);}
    details.textContent=`Detected: ${detection.state} · Join ${detection.join_visible?'visible':'absent'} · Question ${detection.question_source} · ${detection.option_count} options · Submission ${detection.submit_mode} · Network ${detection.network_detector||'not inspected'} · Frame ${detection.frame??0}${detection.recovered_selectors?.length?' · Recovered: '+detection.recovered_selectors.join(', '):''}`;
  }
  $('start').disabled=state.running;$('stop').disabled=!state.running;
  for(const element of $('settings').elements) element.disabled=state.running;
  const settings=state.settings;
  if (!initialized) {
    $('provider').value=settings.provider;$('model').value=settings.model;
    $('fallback').value=settings.fallback_models.join(', ');$('codex').value=settings.codex_path;
    $('timeout').value=settings.solver_timeout;$('selectors').value=JSON.stringify(settings.selectors,null,2);
    $('random').checked=settings.random_fallback === true;$('random-wait').value=settings.random_wait_seconds ?? 12;
    $('pairing').value=token;initialized=true;
  }
  $('secrets').textContent=`Discord ${settings.discord_webhook_set?'saved':'not configured'} · API key ${settings.api_key_set?'saved':'not configured'}. Blank fields keep saved values.`;
  const events=JSON.stringify(state.events);
  if(events!==lastEvents){
    lastEvents=events;$('events').replaceChildren();
    for(const event of state.events){
      const box=document.createElement('div');box.className=`event ${event.level==='alert'?'alert':''}`;
      const time=document.createElement('time');time.textContent=new Date(event.time).toLocaleTimeString();
      const message=document.createElement('p');message.textContent=event.message;box.append(time,message);$('events').append(box);
    }
    $('events').scrollTop=$('events').scrollHeight;
  }
}
async function act(path,data={}) {try{notice();render(await api(path,data));return true;}catch(error){notice(error.message);return false;}}
$('start').onclick=()=>act('/api/start');$('stop').onclick=()=>act('/api/stop');
$('retry').onclick=()=>act('/api/retry');$('test').onclick=()=>act('/api/test-alert');
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(token);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy',1800);}catch{$('pairing').type='text';$('pairing').select();}};
$('settings').onsubmit=async event=>{
  event.preventDefault();
  try{
    const settings={provider:$('provider').value,model:$('model').value.trim(),fallback_models:$('fallback').value.split(',').map(s=>s.trim()).filter(Boolean),codex_path:$('codex').value.trim()||'codex',api_key:$('key').value.trim(),discord_webhook:$('webhook').value.trim(),solver_timeout:Number($('timeout').value),selectors:JSON.parse($('selectors').value)};
    settings.random_fallback=$('random').checked;settings.random_wait_seconds=Number($('random-wait').value);
    if(await act('/api/settings',settings)){$('key').value='';$('webhook').value='';}
  }catch(error){notice(error.message);}
};
async function refresh(){try{render(await api('/api/state'));}catch(error){notice('The PC app is unavailable. Restart Start-iClicker-Bot.cmd.');}}
refresh();setInterval(refresh,2000);
