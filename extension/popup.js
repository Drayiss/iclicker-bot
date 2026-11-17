const token = document.querySelector('#token');
const tabs = document.querySelector('#tab');
const status = document.querySelector('#status');
const saved = await chrome.storage.local.get(['token','tabId','armed','lastStatus','connectionError']);
token.value = saved.token || '';
for (const tab of await chrome.tabs.query({})) {
  if (!tab.url?.startsWith('https://student.iclicker.com/') && tab.url !== 'http://127.0.0.1:8765/demo') continue;
  const option = document.createElement('option');
  option.value = tab.id; option.textContent = tab.title || tab.url;
  if (saved.tabId === tab.id) option.selected = true;
  tabs.append(option);
}
status.textContent = saved.armed ? (saved.connectionError || (saved.lastStatus ? `Connected. ${saved.lastStatus}` : 'Connection not yet verified. Connect your class tab.')) : 'Disconnected. Open the local app, then connect your class tab.';
document.querySelector('#arm').onclick = async()=>{
  if (!token.value.trim() || !tabs.value) {status.textContent='Enter a pairing code and select an open iClicker tab.';return;}
  status.textContent = 'Connecting…';
  try {
    const result = await chrome.runtime.sendMessage({type:'arm',token:token.value.trim(),tabId:Number(tabs.value)});
    status.textContent = result?.ok ? 'Tab connected. Start monitoring in the PC app. Check its status for any access errors.' : result?.error || 'Connection was not confirmed. Reload the extension and try again.';
  } catch {
    status.textContent = 'The extension could not complete the connection. Reload it at edge://extensions, reopen this popup on the class tab, and try again.';
  }
};
document.querySelector('#disarm').onclick = async()=>{
  await chrome.runtime.sendMessage({type:'disarm'}); status.textContent='Disconnected.';
};
document.querySelector('#scan').onclick = async()=>{
  const {lastScan}=await chrome.storage.local.get(['lastScan']);
  const details=document.querySelector('#scan-details');
  details.hidden=false;
  details.textContent=lastScan ? `Last inspected: ${new Date(lastScan.checkedAt).toLocaleTimeString()}\n${JSON.stringify(lastScan,null,2)}` : 'No inspection yet. Connect a tab and keep the PC app running.';
};
