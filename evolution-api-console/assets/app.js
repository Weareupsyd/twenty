(() => {
  const STORE = 'evolution-console-v1';
  const defaults = { baseUrl: '', instance: '', apiKey: '', values: {} };
  let settings;
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { settings = { ...defaults }; }
  let collection;
  let endpoints = [];
  let selected = null;
  let requestBodyInitial = '';
  let dynamicKeys = [];
  const $ = (selector) => document.querySelector(selector);
  const esc = (value='') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nice = (value) => String(value).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase());
  const save = () => localStorage.setItem(STORE, JSON.stringify(settings));
  const toast = (message, bad=false) => { $('#toast').innerHTML=`<div class="toast${bad?' bad':''}">${esc(message)}</div>`;setTimeout(()=>$('#toast').innerHTML='',3800); };
  const methodClass = (method='GET') => method.toLowerCase();
  const cleanExample = (raw='') => {
    let output='',inString=false,escaped=false;
    for(let i=0;i<raw.length;i++){
      const char=raw[i],next=raw[i+1];
      if(inString){output+=char;if(escaped)escaped=false;else if(char.charCodeAt(0)===92)escaped=true;else if(char==='"')inString=false;continue;}
      if(char==='"'){inString=true;output+=char;continue;}
      if(char==='/'&&next==='/'){while(i<raw.length&&raw.charCodeAt(i)!==10)i++;output+='\n';continue;}
      if(char==='/'&&next==='*'){i+=2;while(i<raw.length&&!(raw[i]==='*'&&raw[i+1]==='/'))i++;i++;continue;}
      output+=char;
    }
    return output.replace(/,\s*([}\]])/g,'$1').trim();
  };
  const collectionValue = (key) => {
    const item=(collection?.variable||[]).find((variable)=>variable.key===key);
    return item?.value ? String(item.value).replace(/\s*\([^)]*\)\s*$/,'').trim() : '';
  };
  const getVariable = (key) => {
    if(key==='baseUrl') return settings.baseUrl;
    if(key==='instance') return settings.instance;
    if(key==='globalApikey'||key==='apikey') return settings.apiKey;
    return settings.values[key] ?? collectionValue(key) ?? '';
  };
  function flatten(items, parents=[]){
    for(const item of items||[]){
      if(Array.isArray(item.item)){flatten(item.item,[...parents,item.name]);continue;}
      if(!item.request)continue;
      endpoints.push({id:`ep-${endpoints.length}`,name:item.name||'Untitled request',parents,request:item.request,description:item.request.description||item.description||''});
    }
  }
  function endpointLabel(endpoint){return endpoint.parents.length>1?`${endpoint.parents.slice(1).join(' / ')} / ${endpoint.name}`:endpoint.name;}
  function renderTree(filter=''){
    const groups=new Map();for(const ep of endpoints){const group=ep.parents[0]||'Requests';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(ep);}
    const query=filter.trim().toLowerCase();let html='';
    for(const [group,items] of groups){const visible=items.filter(ep=>`${ep.name} ${ep.parents.join(' ')} ${ep.request.method} ${ep.request.url?.raw||''}`.toLowerCase().includes(query));if(!visible.length)continue;
      html+=`<section class="folder"><button class="folder-heading"><span class="folder-arrow">▾</span><span>${esc(group)}</span><span class="folder-count">${visible.length}</span></button><div class="folder-list">${visible.map(ep=>`<button class="endpoint${selected?.id===ep.id?' selected':''}" data-endpoint="${ep.id}"><span class="method-mini ${methodClass(ep.request.method)}">${esc(ep.request.method)}</span><span class="endpoint-name">${esc(endpointLabel(ep))}</span></button>`).join('')}</div></section>`;
    }
    $('#endpoint-tree').innerHTML=html||'<div style="padding:12px;color:#858a98;font-size:9px">No matching requests.</div>';
    document.querySelectorAll('.folder-heading').forEach(button=>button.onclick=()=>button.parentElement.classList.toggle('closed'));
    document.querySelectorAll('[data-endpoint]').forEach(button=>button.onclick=()=>selectEndpoint(endpoints.find(ep=>ep.id===button.dataset.endpoint)));
  }
  function bodyExample(request){
    const body=request.body;if(!body)return '';
    if(body.mode==='raw')return cleanExample(body.raw||'');
    if(body.mode==='urlencoded'||body.mode==='formdata')return JSON.stringify(Object.fromEntries((body[body.mode]||[]).filter(item=>!item.disabled).map(item=>[item.key,item.value||''])),null,2);
    return '';
  }
  function discoverKeys(endpoint){
    const request=endpoint.request,body=bodyExample(request),url=typeof request.url==='string'?request.url:request.url?.raw||'';
    const raw=`${url}\n${body}\n${(request.header||[]).map(h=>h.value||'').join('\n')}`;const keys=new Set();
    for(const match of raw.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g))keys.add(match[1]);
    for(const match of raw.matchAll(/:([A-Za-z][\w-]*)/g))keys.add(match[1]);
    return [...keys].filter(key=>!['baseUrl','instance','globalApikey','apikey'].includes(key));
  }
  function rawUrl(endpoint){const u=endpoint.request.url;return typeof u==='string'?u:u?.raw||'';}
  function shownUrl(endpoint){
    const url=rawUrl(endpoint);return url.replace(/\{\{\s*([\w-]+)\s*\}\}/g,(_,key)=>key==='baseUrl'?settings.baseUrl||'{{baseUrl}}':key==='instance'?settings.instance||'{{instance}}':`{{${key}}}`).replace(/:([A-Za-z][\w-]*)/g,(_,key)=>`:${key}`);
  }
  function selectEndpoint(endpoint){
    if(!endpoint)return;selected=endpoint;dynamicKeys=discoverKeys(endpoint);requestBodyInitial=bodyExample(endpoint.request);$('#request-title').textContent=endpoint.name;$('#request-description').textContent=endpoint.description||`Send ${endpoint.request.method} request using this endpoint from the Postman collection.`;$('#active-folder').textContent=endpoint.parents.join(' / ');
    const method=String(endpoint.request.method||'GET').toUpperCase();$('#request-line').innerHTML=`<span class="method-badge ${methodClass(method)}">${esc(method)}</span><code>${esc(shownUrl(endpoint))}</code>`;
    const fields=dynamicKeys.map(key=>`<div class="variable-field"><label for="var-${esc(key)}">${esc(nice(key))}</label><input id="var-${esc(key)}" data-variable="${esc(key)}" value="${esc(getVariable(key))}" placeholder="Enter ${esc(nice(key).toLowerCase())}" autocomplete="off"></div>`).join('');
    $('#dynamic-fields').innerHTML=fields;document.querySelectorAll('[data-variable]').forEach(input=>input.oninput=()=>{settings.values[input.dataset.variable]=input.value;save();$('#request-line').querySelector('code').textContent=shownUrl(selected);});
    const body=$('#request-body');const hasBody=['GET','HEAD'].indexOf(method)<0&&Boolean(endpoint.request.body);body.disabled=!hasBody;body.value=hasBody?requestBodyInitial:'';body.placeholder=hasBody?'Enter or edit the JSON payload for this request.':'This endpoint does not require a request body.';$('#body-hint').textContent=hasBody?'JSON payload; edit placeholders before sending':'No body for this request';$('#format-json').style.visibility=hasBody?'visible':'hidden';$('#send-request').disabled=false;renderTree($('#search').value);
  }
  function replaceUrlVariables(url){
    let output=url.replace(/\{\{\s*([\w-]+)\s*\}\}/g,(_,key)=>key==='baseUrl'?String(getVariable(key)).replace(/\/$/,''):encodeURIComponent(String(getVariable(key))));
    output=output.replace(/:([A-Za-z][\w-]*)/g,(_,key)=>encodeURIComponent(String(getVariable(key))));
    if(!/^https?:\/\//i.test(output))throw new Error('The endpoint URL is not valid. Check the base URL in settings.');
    return output;
  }
  function replaceBodyVariables(body){return body.replace(/\{\{\s*([\w-]+)\s*\}\}/g,(_,key)=>JSON.stringify(String(getVariable(key))).slice(1,-1));}
  function renderConfigModal(){
    $('#modal').innerHTML=`<div class="modal-backdrop" data-backdrop><section class="modal" role="dialog" aria-modal="true"><div class="modal-heading"><div><h2>Remote API connection</h2><p>Connect to the Evolution API server and instance you already run.</p></div><button class="modal-close" data-close aria-label="Close">×</button></div><form id="config-form"><div class="modal-field"><label for="base-url">Evolution API base URL</label><input id="base-url" type="url" required placeholder="https://evolution.example.com" value="${esc(settings.baseUrl)}"></div><div class="modal-field"><label for="instance-name">Instance name</label><input id="instance-name" required placeholder="whatsapp-instance" value="${esc(settings.instance)}"></div><div class="modal-field"><label for="api-key">Global API key</label><input id="api-key" type="password" placeholder="API key" autocomplete="new-password" value="${esc(settings.apiKey)}"></div><div class="modal-help">The key is sent in the <code>apikey</code> HTTP header, following the supplied Postman collection. This app calls the remote Evolution API directly; the server needs to allow browser CORS.</div><div class="modal-actions"><button class="cancel-button" type="button" data-close>Cancel</button><button class="save-button" type="submit">Save connection</button></div></form></section></div>`;
    $('#modal').querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$('#modal').innerHTML='');$('#modal').querySelector('[data-backdrop]').onclick=e=>{if(e.target===e.currentTarget)$('#modal').innerHTML='';};
    $('#config-form').onsubmit=e=>{e.preventDefault();settings.baseUrl=$('#base-url').value.trim().replace(/\/$/,'');settings.instance=$('#instance-name').value.trim();settings.apiKey=$('#api-key').value.trim();save();$('#modal').innerHTML='';updateServerCard();if(selected)selectEndpoint(selected);toast('Evolution API connection settings saved in this browser.');};
  }
  function updateServerCard(){const ready=Boolean(settings.baseUrl&&settings.instance);$('#instance-label').textContent=ready?settings.instance:'Not configured';$('#server-url-label').textContent=settings.baseUrl||'Add your API endpoint';$('#config-notice').classList.toggle('hidden',ready);$('#send-request').disabled=!selected;}
  function headersOf(request,hasBody){
    const headers={};for(const header of request.header||[]){if(header.disabled)continue;const key=String(header.key||'');const value=String(header.value||'').replace(/\{\{\s*([\w-]+)\s*\}\}/g,(_,name)=>getVariable(name));if(key)headers[key]=value;}
    if(settings.apiKey&&!Object.keys(headers).some(key=>key.toLowerCase()==='apikey'))headers.apikey=settings.apiKey;
    if(hasBody&&!Object.keys(headers).some(key=>key.toLowerCase()==='content-type'))headers['Content-Type']='application/json';
    return headers;
  }
  async function apiRequest(endpoint,bodyOverride){
    if(!settings.baseUrl||!settings.instance)throw new Error('Configure the remote API base URL and instance first.');
    const request=endpoint.request,url=replaceUrlVariables(rawUrl(endpoint));const method=String(request.method||'GET').toUpperCase();
    const bodySource=bodyOverride!==undefined?bodyOverride:$('#request-body').value;const hasBody=Boolean(bodySource.trim())&&!['GET','HEAD'].includes(method);const headers=headersOf(request,hasBody);
    const started=performance.now();const response=await fetch(url,{method,headers,...(hasBody?{body:replaceBodyVariables(bodySource)}:{})});const duration=Math.round(performance.now()-started);const text=await response.text();let content=text;try{content=JSON.stringify(JSON.parse(text),null,2);}catch{}
    $('#response-empty').hidden=true;$('#response-output').hidden=false;$('#response-output').textContent=content||'(empty response)';$('#response-status').textContent=`${response.status} ${response.statusText}`;$('#response-status').className=`response-status ${response.ok?'ok':'bad'}`;$('#response-meta').textContent=`${duration} ms · ${new Blob([text]).size} B`;
    if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,220)}`);
    return {response,text};
  }
  async function sendSelected(){if(!selected)return;const button=$('#send-request');button.disabled=true;button.innerHTML='<span>◌</span> Sending…';$('#response-empty').hidden=false;$('#response-output').hidden=true;$('#response-status').textContent='Sending request…';$('#response-status').className='response-status';
    try{await apiRequest(selected);toast('Request completed successfully.');}catch(error){$('#response-status').textContent='Request failed';$('#response-status').className='response-status bad';if(error.message.startsWith('HTTP ')){toast(error.message,true);}else{const output=$('#response-output');$('#response-empty').hidden=true;output.hidden=false;output.textContent=error.message;toast(error.message==='Failed to fetch'?'Could not reach the remote API. Check URL, CORS and network.':error.message,true);}}finally{button.disabled=!selected;button.innerHTML='<span>▶</span> Send request';}
  }
  async function quickSend(){const number=$('#quick-number').value.replace(/\D/g,''),text=$('#quick-message').value.trim();if(!number||!text){toast('Enter a WhatsApp number and message.',true);return;}if(!settings.baseUrl||!settings.instance){renderConfigModal();toast('Configure your Evolution API instance first.',true);return;}const button=$('#quick-send');button.disabled=true;button.textContent='Sending…';try{const endpoint={request:{method:'POST',url:{raw:'{{baseUrl}}/message/sendText/{{instance}}',host:['{{baseUrl}}'],path:['message','sendText','{{instance}}']},header:[],body:{mode:'raw',raw:JSON.stringify({number,text})}}};await apiRequest(endpoint,JSON.stringify({number,text},null,2));toast('WhatsApp text message sent.');}catch(error){toast(error.message==='Failed to fetch'?'Could not reach Evolution API. Check URL, CORS and network.':error.message,true);}finally{button.disabled=false;button.innerHTML='<span>↗</span> Send WhatsApp message';}}
  async function checkConnection(){if(!settings.baseUrl||!settings.instance){renderConfigModal();toast('Add your remote URL and instance first.');return;}const dot=$('#server-dot');dot.classList.remove('online','offline');try{const response=await fetch(`${settings.baseUrl.replace(/\/$/,'')}/instance/connectionState/${encodeURIComponent(settings.instance)}`,{headers:settings.apiKey?{apikey:settings.apiKey}:{}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`HTTP ${response.status}`);const state=body?.instance?.state||body?.state||'unknown';const online=state==='open';dot.classList.toggle('online',online);dot.classList.toggle('offline',!online);toast(online?'WhatsApp instance is connected.':`API reachable · instance state: ${state}`,!online);}catch(error){dot.classList.add('offline');toast(error.message==='Failed to fetch'?'Connection failed. Check URL, CORS and network.':`Connection failed: ${error.message}`,true);}}
  async function init(){
    try{const response=await fetch('/collection.json');if(!response.ok)throw new Error(`Collection file returned ${response.status}`);collection=await response.json();flatten(collection.item);$('#request-count').textContent=endpoints.length;$('#detail-request-count').textContent=endpoints.length;$('#group-count').textContent=new Set(endpoints.map(e=>e.parents[0])).size;renderTree();const first=endpoints.find(ep=>ep.name.toLowerCase()==='send text')||endpoints[0];selectEndpoint(first);}
    catch(error){$('#request-description').textContent='Could not load the Evolution API Postman collection.';$('#endpoint-tree').innerHTML=`<div style="padding:12px;color:#f69;font-size:9px">${esc(error.message)}</div>`;toast('Collection JSON is missing. Run the included server.py from the repo checkout.',true);}
    updateServerCard();
  }
  $('#send-request').onclick=sendSelected;$('#quick-send').onclick=quickSend;$('#check-connection').onclick=checkConnection;$('#top-config').onclick=renderConfigModal;$('#open-config').onclick=renderConfigModal;$('#notice-config').onclick=renderConfigModal;$('#search').oninput=e=>renderTree(e.target.value);$('#format-json').onclick=()=>{try{$('#request-body').value=JSON.stringify(JSON.parse($('#request-body').value),null,2);}catch{toast('Request body is not valid JSON.',true);}};$('#reset-request').onclick=()=>{if(selected){requestBodyInitial=bodyExample(selected.request);$('#request-body').value=requestBodyInitial;toast('Request body reset to the collection example.');}};
  $('#about-button').onclick=()=>{const count=endpoints.length||'the';toast(`Standalone Evolution API console · ${count} requests loaded from the supplied Postman collection.`);};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();}if(e.key==='Escape')$('#modal').innerHTML='';});
  init();
})();
