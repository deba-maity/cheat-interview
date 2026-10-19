"use strict";
const api=window.electronAPI;
const $=id => document.getElementById(id);
const state={history:[],busy:false,activeId:null,audioIds:new Set(),audioQueue:Promise.resolve(),pendingClips:0,
  lastTranscript:"",transcriptContext:[],generation:0,settings:null,health:{},listenNotice:"",errorMessage:""};
const requestId=() => crypto.randomUUID();

function status(message,error=false,busy=state.busy) {
  state.errorMessage=error?message:"";
  $("statusText").textContent=message;
  $("statusRow").classList.toggle("error",error);
  $("statusRow").classList.toggle("busy",busy);
  $("cancelButton").hidden=!(state.busy || state.pendingClips);
}
function idleStatus() {
  if (state.errorMessage) {status(state.errorMessage,true,false);return;}
  status(capture.phase==="listening" ? state.listenNotice || "Listening… pause after your question to send it." : "Ready");
}
function setBusy(value) {
  state.busy=value;
  $("sendButton").disabled=value;$("screenButton").disabled=value;
  $("cancelButton").hidden=!(value || state.pendingClips);
}

function renderText(container,answer) {
  // Create text nodes, never HTML from the user or a model.
  const blocks=String(answer).split(/(```[\s\S]*?```)/g);
  for (const block of blocks) {
    if (block.startsWith("```")) {
      const newline=block.indexOf("\n");
      const language=block.slice(3,newline<0?3:newline).trim();
      const code=block.slice(newline<0?3:newline+1,-3).replace(/\n$/,"");
      const label=document.createElement("div");label.className="code-label";
      const name=document.createElement("span");name.textContent=language || "code";
      const copy=document.createElement("button");copy.className="link";copy.textContent="Copy code";
      copy.addEventListener("click",async () => {const result=await api.copyAnswer(code);copy.textContent=result.ok?"Copied":"Copy failed";});
      label.append(name,copy);
      const pre=document.createElement("pre");const node=document.createElement("code");node.textContent=code;
      pre.append(node);container.append(label,pre);
    } else if (block) {
      const node=document.createElement("div");node.className="message-text";node.textContent=block;container.append(node);
    }
  }
}
function message(type,text,meta={}) {
  $("welcome")?.remove();
  const card=document.createElement("article");card.className=`message ${type}`;
  const head=document.createElement("div");head.className="message-head";
  const label=document.createElement("span");label.className="message-label";
  label.textContent=type==="user"?"You":type==="transcript"?"Heard":type==="error"?"Couldn’t complete":"Assistant";
  head.append(label);
  const detail=document.createElement("span");
  detail.textContent=meta.provider ? `${meta.provider} · ${meta.model}${meta.source?` · ${meta.source.toUpperCase()}`:""}${meta.usedFallback?" · fallback":""} · ${(meta.elapsedMs/1000).toFixed(1)}s` : "";
  head.append(detail);
  if (type==="assistant") {
    const copy=document.createElement("button");copy.textContent="Copy";
    copy.addEventListener("click",async () => {const result=await api.copyAnswer(text);copy.textContent=result.ok?"Copied":"Failed";});head.append(copy);
  }
  if (type==="transcript") {
    const ask=document.createElement("button");ask.textContent="Answer this";
    ask.addEventListener("click",() => askQuestion(text,$("includeScreen").checked));head.append(ask);
  }
  card.append(head);renderText(card,text);
  if (meta.truncated) {const note=document.createElement("p");note.className="key-note";note.textContent="The provider reached its output limit. Ask “Continue” for the rest.";card.append(note);}
  if (meta.attempts?.length) {
    const details=document.createElement("details");const summary=document.createElement("summary");summary.textContent=`${meta.attempts.length} fallback attempt(s)`;
    const list=document.createElement("ul");
    for (const a of meta.attempts) {const li=document.createElement("li");li.textContent=`${a.provider} / ${a.model}: ${a.reason}`;list.append(li);}
    details.append(summary,list);card.append(details);
  }
  $("output").append(card);
  while ($("output").children.length>60) $("output").firstElementChild.remove();
  $("output").scrollTop=$("output").scrollHeight;
}
function remember(question,answer) {
  state.history.push({role:"user",content:question},{role:"assistant",content:answer});
  state.history=state.history.slice(-10);
}
function options() {return {history:state.history,mode:$("modeSelect").value,language:$("languageSelect").value,
  meetingContext:state.transcriptContext.join("\n").slice(-12000)};}
async function askQuestion(question,screen=false) {
  question=String(question || "").trim();
  if (!question || state.busy) return false;
  if (!state.settings?.order.some(id=>state.settings.providers[id]?.keyCount)) {
    status("Connect a provider once in Settings. Get API key opens your provider account.",true);openSettings();return false;
  }
  const id=requestId();state.activeId=id;setBusy(true);
  const generation=state.generation;
  const opts=options();
  message("user",screen?`${question}\n[Reading selected screen]`:question);
  status(screen?"Capturing the selected display…":"Thinking…");
  try {
    const payload={id,question,...opts,displayId:$("displaySelect").value,detailedScreen:$("detailedScreen").checked};
    const result=await (screen?api.answerScreen(payload):api.askAI(payload));
    if (generation!==state.generation) return false;
    if (!result.ok) {
      if (result.code!=="CANCELLED") {message("error",result.error,result);status(result.error,true);if(result.code==="NOT_CONFIGURED")openSettings();}
      return false;
    }
    message("assistant",result.answer,result);remember(question,result.answer);idleStatus();return true;
  } catch {if (generation===state.generation) {message("error","The app connection was interrupted. Try again.");status("Connection interrupted.",true);}}
  finally {if (state.activeId===id) {state.activeId=null;setBusy(false);}}
  return false;
}
function readScreen() {
  const question=$("questionBox").value.trim() || ($("modeSelect").value==="coding"
    ? "Read the visible coding problem and teach me how to solve it." : "Read the question on screen and answer it concisely.");
  askQuestion(question,true);
}
function looksLikeQuestion(text) {
  return /\?|\b(what|why|how|when|where|who|which|could you|can you|would you|explain|describe|solve|implement|tell me|walk me)\b/i.test(text);
}
function queueClip(blob) {
  if (state.pendingClips>=2) {capture.stop(true);status("Listening paused: the transcription queue is full. Wait for it to finish, then restart.",true);return;}
  const generation=state.generation;
  ++state.pendingClips;$("cancelButton").hidden=false;
  state.audioQueue=state.audioQueue.then(async () => {
    if (generation!==state.generation) return;
    const id=requestId();state.audioIds.add(id);
    if (!state.busy) status("Transcribing speech…",false,true);
    try {
      const audio=await blob.arrayBuffer();
      if (generation!==state.generation) return;
      const result=await api.transcribe({id,audio,mimeType:blob.type});
      if (generation!==state.generation) return;
      if (!result.ok) {
        if (result.code==="NO_SPEECH" && !state.busy) status("No speech detected. Check your input level or try a different audio source.");
        if (result.code!=="CANCELLED" && result.code!=="NO_SPEECH") {message("error",result.error,result);capture.stop(true);status(result.error,true);}
        return;
      }
      state.lastTranscript=result.text;state.transcriptContext.push(result.text);
      state.transcriptContext=state.transcriptContext.slice(-8);
      message("transcript",result.text,result);
      if ($("autoAnswer").checked && looksLikeQuestion(result.text)) {
        if (state.busy) status("Question transcribed. Use “Answer this” when the current answer finishes.");
        else await askQuestion(result.text,$("includeScreen").checked);
      } else if (!state.busy) idleStatus();
    } finally {state.audioIds.delete(id);}
  }).catch(() => {if (generation===state.generation) status("Audio processing failed. Restart listening.",true);})
    .finally(() => {--state.pendingClips;$("cancelButton").hidden=!(state.busy || state.pendingClips);});
}
const capture=new window.AudioCapture({
  onClip:queueClip,
  onLevel:level => {
    const value=String(Math.round(level*100));
    if($("levelFill").dataset.level!==value){$("levelFill").dataset.level=value;$("levelFill").style.transform=`scaleX(${value/100})`;}
  },
  onState:phase => {
    $("listenButton").classList.toggle("recording",phase==="listening");
    $("listenButton").textContent=phase==="listening"?"■ Stop listening":phase==="starting"?"Opening audio…":phase==="stopping"?"Stopping…":"● Listen · Ctrl L";
    $("listenButton").disabled=phase==="stopping";
    $("audioSource").disabled=phase!=="idle";$("micDevice").disabled=phase!=="idle";
    if (phase==="listening") {idleStatus();refreshDevices();}
    else if (!state.busy) idleStatus();
  },
  onNotice:notice => {state.listenNotice=notice;status(notice);},
  onError:error => status(error,true),
});
function toggleListening() {
  if (capture.phase!=="idle") capture.stop();
  else {
    const configured=state.settings && state.settings.order.some(id => state.settings.providers[id]?.keyCount && state.settings.providers[id].transcriptionModels.length);
    if (!configured) {status("Add a Groq or OpenAI key in Settings to enable transcription.",true);openSettings();return;}
    state.listenNotice="";status("Opening audio…",false,true);capture.start({source:$("audioSource").value,deviceId:$("micDevice").value});
  }
}
async function refreshDevices() {
  try {
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind==="audioinput");
    const selected=$("micDevice").value;
    $("micDevice").replaceChildren(new Option("Default microphone",""));
    devices.forEach((device,i) => $("micDevice").add(new Option(device.label || `Microphone ${i+1}`,device.deviceId)));
    if ([...$("micDevice").options].some(o => o.value===selected)) $("micDevice").value=selected;
  } catch {}
}
async function cancelAll() {
  ++state.generation;capture.stop(true);
  await api.cancelAll();state.activeId=null;setBusy(false);status("Cancelled.");
}
function toggleTheme() {document.body.classList.toggle("light");localStorage.setItem("theme",document.body.classList.contains("light")?"light":"dark");}

async function refreshSettings() {
  const result=await api.getSettings();
  if (!result.ok) {status(result.error,true);return;}
  state.settings=result.settings;
  state.health=result.health || {};
  const selected=$("displaySelect").value;
  $("displaySelect").replaceChildren();
  result.displays.forEach(d => $("displaySelect").add(new Option(d.label,d.id)));
  if (result.displays.some(d => d.id===selected)) $("displaySelect").value=selected;
  if ($("displaySelect").value) await api.setDisplay($("displaySelect").value);
  if (result.shortcutFailures.length) status(`Shortcut unavailable: ${result.shortcutFailures.join(", ")}. The on-screen buttons still work.`,true);
  else if (result.settings.loadError) status(result.settings.loadError,true);
  const hint=$("configurationHint");
  if (hint) hint.textContent=result.settings.order.some(id => result.settings.providers[id]?.keyCount)
    ? "Providers configured. Choose an audio source or ask your first question." : "Open Settings to connect your AI providers.";
}
function inputField(labelText,id,value,type="text") {
  const label=document.createElement("label");label.textContent=labelText;
  const input=document.createElement("input");input.id=id;input.type=type;input.value=value;
  input.autocomplete="off";input.spellcheck=false;label.append(input);return label;
}
async function openSettings() {
  if ($("settingsDialog").open) return;
  await refreshSettings();
  if (!state.settings) return;
  if ($("settingsDialog").open) return;
  $("providerOrder").value=state.settings.order.join(",");
  $("timeoutSeconds").value=state.settings.timeoutMs/1000;
  $("settingsStatus").textContent=state.settings.keyFileError || (state.settings.keyFileLoaded?"Local .env loaded. Its keys override saved keys for the matching provider.":state.settings.encryptedStorage?"Paste your own key once; it will be saved securely on this computer.":"Use a local .env beside the executable; encrypted storage is unavailable.");
  $("providerSettings").replaceChildren();
  for (const [id,p] of Object.entries(state.settings.providers)) {
    const card=document.createElement("section");card.className="provider-card";
    const head=document.createElement("div");head.className="provider-head";
    const title=document.createElement("strong");title.textContent=p.label;
    const count=document.createElement("small");count.textContent=`${p.keyCount} key(s) loaded${p.keyCount?` · ${p.keySource}`:""}`;
    const getKey=document.createElement("button");getKey.textContent="Get API key ↗";getKey.type="button";getKey.className="get-key";
    getKey.addEventListener("click",async()=>{const result=await api.openKeyPage(id);if(!result.ok)$("settingsStatus").textContent=result.error;});
    const check=document.createElement("button");check.textContent="Check connection";check.type="button";
    const checkResult=document.createElement("div");checkResult.className="provider-check";
    if(state.health[id])checkResult.textContent=state.health[id].reason;
    check.disabled=!p.keyCount;
    check.addEventListener("click",async () => {
      check.disabled=true;checkResult.textContent="Checking saved configuration…";
      try {const result=await api.checkProvider(id);checkResult.textContent=result.ok?`Connected · ${result.model}${result.usedFallback?" (fallback)":""}`:result.error;}
      finally {check.disabled=false;}
    });
    head.append(title,count,getKey,check);card.append(head);
    card.append(inputField(p.keySource==="file"?"Keys loaded from .env — edit that file, then Reload keys":"API key (leave blank to keep the saved key)",`${id}-keys`,"","password"));
    card.querySelector(`#${id}-keys`).disabled=p.keySource==="file";
    const clear=document.createElement("button");clear.type="button";clear.className="link danger";clear.textContent="Clear saved keys";
    clear.addEventListener("click",() => {
      const field=$(`${id}-keys`);field.value="";field.dataset.clear=field.dataset.clear==="true"?"false":"true";
      clear.textContent=field.dataset.clear==="true"?"Keys will be cleared on Save · Undo":"Clear saved keys";
    });clear.disabled=p.keySource==="file";card.append(clear);
    card.append(inputField("API base URL",`${id}-url`,p.baseURL));
    const models=document.createElement("div");models.className="model-grid";
    models.append(inputField("Text models (in fallback order)",`${id}-text`,p.textModels.join(",")));
    models.append(inputField("Vision models (blank disables vision)",`${id}-vision`,p.visionModels.join(",")));
    if (id==="groq" || id==="openai") models.append(inputField("Transcription models",`${id}-transcription`,p.transcriptionModels.join(",")));
    card.append(models,checkResult);$("providerSettings").append(card);
  }
  $("settingsDialog").showModal();
}
async function saveSettings() {
  const providers={};
  for (const id of Object.keys(state.settings.providers)) {
    providers[id]={keys:$(`${id}-keys`).value,clearKeys:$(`${id}-keys`).dataset.clear==="true",
      baseURL:$(`${id}-url`).value,textModels:$(`${id}-text`).value,visionModels:$(`${id}-vision`).value};
    if ($(`${id}-transcription`)) providers[id].transcriptionModels=$(`${id}-transcription`).value;
  }
  $("saveSettings").disabled=true;
  try {
    const result=await api.saveSettings({providers,order:$("providerOrder").value,timeoutMs:Number($("timeoutSeconds").value)*1000});
    if (!result.ok) {$("settingsStatus").textContent=result.error;return;}
    state.settings=result.settings;
    for (const id of Object.keys(providers)) {$(`${id}-keys`).value="";$(`${id}-keys`).dataset.clear="false";}
    $("settingsDialog").close();status("Provider settings saved.");
  } finally {$("saveSettings").disabled=false;}
}

$("questionForm").addEventListener("submit",event => {
  event.preventDefault();const q=$("questionBox").value.trim();
  if (q && !state.busy) {$("questionBox").value="";askQuestion(q);}
});
$("questionBox").addEventListener("keydown",event => {
  if (event.key==="Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
    event.preventDefault();$("questionForm").requestSubmit();
  }
});
$("listenButton").addEventListener("click",toggleListening);
$("screenButton").addEventListener("click",readScreen);
$("settingsButton").addEventListener("click",openSettings);
$("reloadKeys").addEventListener("click",async()=>{
  $("reloadKeys").disabled=true;
  try {
    const result=await api.reloadKeys();
    if(!result.ok){$("settingsStatus").textContent=result.error;return;}
    $("settingsDialog").close();await openSettings();
    if(!result.settings.order.some(id=>result.settings.providers[id]?.keyCount))$("settingsStatus").textContent="No keys found. Choose Get API key, sign into your own account, paste the key, and Save settings.";
  }finally{$("reloadKeys").disabled=false;}
});
$("closeSettings").addEventListener("click",() => $("settingsDialog").close());
$("saveSettings").addEventListener("click",saveSettings);
$("cancelButton").addEventListener("click",cancelAll);
$("themeButton").addEventListener("click",toggleTheme);
$("hideButton").addEventListener("click",() => api.windowAction("hide"));
$("quitButton").addEventListener("click",() => api.windowAction("quit"));
$("displaySelect").addEventListener("change",() => api.setDisplay($("displaySelect").value));
$("audioSource").addEventListener("change",() => {$("micDevice").disabled=$("audioSource").value==="system";});
$("modeSelect").addEventListener("change",() => {$("languageLabel").hidden=$("modeSelect").value!=="coding";});
$("exampleMeeting").addEventListener("click",() => {$("questionBox").value="Explain the difference between TCP and UDP with an example.";$("questionBox").focus();});
$("exampleCode").addEventListener("click",() => {$("modeSelect").value="coding";$("languageLabel").hidden=false;$("questionBox").value="Help me solve Two Sum. Explain the approach and edge cases.";$("questionBox").focus();});
$("clearButton").addEventListener("click",async () => {await cancelAll();state.history=[];state.transcriptContext=[];state.lastTranscript="";$("output").replaceChildren();idleStatus();});
document.addEventListener("keydown",event => {
  if (event.key==="Escape" && !$("settingsDialog").open) cancelAll();
});
api.onAction(action => {
  if (action==="toggle-listening") toggleListening();
  else if (action==="stop-listening") capture.stop(true);
  else if (action==="pause-work") cancelAll();
  else if (action==="refresh-keys") refreshSettings().then(()=>{if(!state.settings?.order.some(id=>state.settings.providers[id]?.keyCount))openSettings();});
  else if (action==="screen-answer") readScreen();
  else if (action==="toggle-theme") toggleTheme();
});
api.onStatus(detail => {if (detail.id===state.activeId || state.audioIds.has(detail.id) && !state.busy) status(detail.message,false,true);});
navigator.mediaDevices?.addEventListener("devicechange",refreshDevices);
window.addEventListener("beforeunload",() => capture.stop(true));
if (localStorage.getItem("theme")==="light") document.body.classList.add("light");
refreshSettings().then(()=>{if(!state.settings?.order.some(id=>state.settings.providers[id]?.keyCount))openSettings();}).catch(() => status("Could not load settings. Restart the app.",true));
refreshDevices();
