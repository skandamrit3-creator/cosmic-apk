const $=id=>document.getElementById(id);
const plugin=()=>window.Capacitor?.Plugins?.CosmicHomeAutomation;
const states=Array(8).fill("UNKNOWN");
const RELAY_NAMES_KEY="COSMIC_HOME_RELAY_NAMES_V1";
const DEFAULT_RELAY_NAMES=Array.from({length:8},(_,i)=>"Relay "+(i+1));
const pendingStates=new Map();
function loadRelayNames(){
 try{
  const saved=JSON.parse(localStorage.getItem(RELAY_NAMES_KEY)||"null");
  return Array.from({length:8},(_,i)=>String(saved?.[i]||DEFAULT_RELAY_NAMES[i]).trim().slice(0,40)||DEFAULT_RELAY_NAMES[i]);
 }catch(_){return [...DEFAULT_RELAY_NAMES];}
}
let relayNames=loadRelayNames();
function persistRelayNames(){localStorage.setItem(RELAY_NAMES_KEY,JSON.stringify(relayNames));}
function resolveRelayChannel(value){
 const raw=String(value??"").trim();
 if(/^[1-8]$/.test(raw))return Number(raw);
 const matches=relayNames.map((name,index)=>name.toLocaleLowerCase()===raw.toLocaleLowerCase()?index+1:0).filter(Boolean);
 if(matches.length===1)return matches[0];
 if(matches.length>1)throw new Error("That relay name is ambiguous. Give each relay a unique name.");
 throw new Error("No saved relay matches "+raw+". Say a relay number or rename it first.");
}
function renameRelay(channel,name){
 const n=Number(channel),label=String(name||"").trim().replace(/\s+/g," ").slice(0,40);
 if(!Number.isInteger(n)||n<1||n>8)throw new Error("Relay number must be 1–8.");
 if(label.length<2)throw new Error("Relay name must contain at least 2 characters.");
 if(relayNames.some((item,index)=>index!==n-1&&item.toLocaleLowerCase()===label.toLocaleLowerCase()))throw new Error("That name is already assigned to another relay.");
 relayNames[n-1]=label;persistRelayNames();renderRelays();
 status("Saved name for relay "+n+": "+label,"connected");
 return {success:true,channel:n,name:label};
}
let selectedAddress="",connected=false,listenerReady=false,bulkOff=false;

function status(message,kind="neutral"){
 const el=$("homeAutomationStatus");if(!el)return;
 el.textContent=message;el.dataset.state=kind;
}
function renderRelays(){
 const grid=$("relayGrid");if(!grid)return;grid.replaceChildren();
 states.forEach((state,index)=>{
  const card=document.createElement("article");card.className="relay-card";
  const title=document.createElement("b");title.textContent="RELAY "+(index+1)+" · "+relayNames[index].toUpperCase();
  const pin=document.createElement("small");pin.className="relay-pin";pin.textContent="ARDUINO D"+(index+2);
  const value=document.createElement("span");value.className="relay-state";value.textContent=state;
  const rename=document.createElement("button");rename.type="button";rename.className="relay-rename";rename.textContent="RENAME";
  rename.addEventListener("click",()=>{const next=window.prompt("Name for Relay "+(index+1)+" (Arduino D"+(index+2)+"):",relayNames[index]);if(next!==null){try{renameRelay(index+1,next);}catch(error){status(error.message,"error");}}});
  const actions=document.createElement("div");actions.className="relay-actions";
  for(const next of ["ON","OFF"]){
   const button=document.createElement("button");button.type="button";button.textContent=next;
   button.disabled=!connected||bulkOff||state===next||Array.from(pendingStates.keys()).some(key=>key.startsWith((index+1)+":"));
   button.addEventListener("click",()=>setRelay(index+1,next,button));
   actions.append(button);
  }
  card.append(title,pin,value,rename,actions);grid.append(card);
 });
}
function parseLine(line){
 const p=String(line||"").trim().split(",");
 if(p[0]!=="COSMIC"||p[1]!=="1")return;
 if(p[2]==="STATE"&&p.length===5){
  const n=Number(p[3]),value=p[4];
  if(Number.isInteger(n)&&n>=1&&n<=8&&["ON","OFF"].includes(value)){
   states[n-1]=value;
   const key=n+":"+value,pending=pendingStates.get(key);
   if(pending){pendingStates.delete(key);clearTimeout(pending.timer);pending.resolve({success:true,channel:n,state:value,verification:"controller_reported"});}
   renderRelays();
  }
 }else if(p[2]==="READY"){status("Controller ready · "+(p[3]||"8")+" channels","connected");}
 else if(p[2]==="ACK"){status("Controller accepted relay "+p[3]+" "+p[4]+" · awaiting state report","pending");}
 else if(p[2]==="ERR"){
  const error=new Error("Controller rejected command: "+p.slice(3).join(","));
  for(const [key,pending] of pendingStates){pendingStates.delete(key);clearTimeout(pending.timer);pending.reject(error);}
  renderRelays();status(error.message,"error");
 }
}
async function refreshDevices(){
 const api=plugin();if(!api)throw new Error("Bluetooth control is available in the installed Android COSMIC app.");
 const result=await api.listPairedDevices(),select=$("homeAutomationDevice");
 select.replaceChildren();
 (result.devices||[]).forEach(device=>{
  const option=document.createElement("option");option.value=device.address;
  option.textContent=(device.name||"Bluetooth device")+" · "+device.address;select.append(option);
 });
 if(!select.options.length)throw new Error("No paired Bluetooth devices found. Pair the HC-05 in Android Bluetooth settings first.");
 selectedAddress=select.value;status("Select your paired HC-05 device, then connect.");
}
async function connect(){
 const api=plugin();if(!api)throw new Error("Open COSMIC in its Android app to use Bluetooth SPP.");
 selectedAddress=$("homeAutomationDevice").value;if(!selectedAddress)throw new Error("Select a paired controller first.");
 status("Connecting to Bluetooth controller…","pending");
 if(!listenerReady){
  await Promise.all([
   api.addListener("homeAutomationData",event=>parseLine(event.line)),
   api.addListener("homeAutomationError",event=>{connected=false;states.fill("UNKNOWN");for(const [key,p] of pendingStates){pendingStates.delete(key);clearTimeout(p.timer);p.reject(new Error("Bluetooth connection lost."));}renderRelays();status("Bluetooth stream ended · "+(event.error||"connection lost"),"error");})
  ]);
  listenerReady=true;
 }
 const result=await api.connect({address:selectedAddress});
 connected=!!result.connected;states.fill("UNKNOWN");renderRelays();
 status("Bluetooth connected · requesting controller state","connected");
 await api.sendCommand({command:"COSMIC,1,GET,ALL"});
}
async function disconnect(){
 await plugin()?.disconnect?.();connected=false;states.fill("UNKNOWN");
 for(const [key,p] of pendingStates){pendingStates.delete(key);clearTimeout(p.timer);p.reject(new Error("Bluetooth disconnected."));}
 renderRelays();status("Disconnected · relay state unknown");
}
async function commandAndWait(api,channel,value){
 const key=channel+":"+value;
 if(pendingStates.has(key))throw new Error("That relay command is already awaiting a controller response.");
 let resolveResponse,rejectResponse;
 const response=new Promise((resolve,reject)=>{resolveResponse=resolve;rejectResponse=reject;});
 const pending={resolve:resolveResponse,reject:rejectResponse,timer:0};
 pending.timer=setTimeout(()=>{if(pendingStates.get(key)===pending){pendingStates.delete(key);renderRelays();}rejectResponse(new Error("No matching controller state report received within 5 seconds."));},5000);
 pendingStates.set(key,pending);renderRelays();
 try{await api.sendCommand({command:"COSMIC,1,SET,"+channel+","+value});}
 catch(error){if(pendingStates.get(key)===pending)pendingStates.delete(key);clearTimeout(pending.timer);renderRelays();rejectResponse(error);throw error;}
 return response;
}
async function setRelay(channel,value){
 if(!connected)return;
 if(value==="ON"&&!window.confirm("Turn ON relay channel "+channel+"? Make sure the connected load and wiring are safe."))return;
 try{
  status("Sending relay "+channel+" "+value+" · waiting for controller state","pending");
  const result=await commandAndWait(plugin(),channel,value);
  status("Relay "+channel+" "+value+" · controller reported state (physical load not verified)","connected");
  return result;
 }catch(error){status("Relay command not verified · "+error.message,"error");}
}
async function allOff(){
 if(!connected||bulkOff)return;
 if(!window.confirm("Send OFF to all eight relay channels?"))return;
 bulkOff=true;renderRelays();
 try{
  for(let channel=1;channel<=8;channel++){
   status("Turning OFF relay "+channel+" of 8 · awaiting state report","pending");
   await commandAndWait(plugin(),channel,"OFF");
  }
  status("All eight channels reported OFF by the controller · physical loads not verified","connected");
 }catch(error){status("All-off stopped · "+error.message,"error");}
 finally{bulkOff=false;renderRelays();}
}
async function setRelayFromVoice(channel,value){
 const n=resolveRelayChannel(channel),next=String(value||"").toUpperCase();
 if(!Number.isInteger(n)||n<1||n>8||!["ON","OFF"].includes(next))throw new Error("Relay channel must be 1–8 and state must be ON or OFF.");
 const api=plugin();if(!api)throw new Error("Home automation Bluetooth is available only in the COSMIC Android app.");
 const connection=await api.getConnectionStatus();if(!connection?.connected)throw new Error("Connect the paired HC-05 controller in COSMIC Home Automation first.");
 if(next==="ON"&&!window.confirm("COSMIC wants to turn ON relay channel "+n+". Confirm only if you know the connected load is safe."))throw new Error("Relay activation cancelled by user.");
 const result=await commandAndWait(api,n,next);
 return {...result,name:relayNames[n-1],physicalLoadVerified:false};
}
window.COSMIC_HOME_AUTOMATION_SET=setRelayFromVoice;
window.COSMIC_HOME_AUTOMATION_RENAME=renameRelay;

export function initHomeAutomation(){
 const refresh=$("refreshHomeDevices"),connectButton=$("connectHomeController"),disconnectButton=$("disconnectHomeController"),allOffButton=$("allRelaysOff");
 if(!refresh||refresh.dataset.bound)return;refresh.dataset.bound="1";
 refresh.addEventListener("click",()=>refreshDevices().catch(error=>status(error.message,"error")));
 connectButton.addEventListener("click",()=>connect().catch(error=>status(error.message,"error")));
 disconnectButton.addEventListener("click",()=>disconnect().catch(error=>status(error.message,"error")));
 allOffButton.addEventListener("click",allOff);
 $("homeAutomationDevice").addEventListener("change",event=>selectedAddress=event.target.value);
 renderRelays();
 if(!plugin()){status("Android Bluetooth adapter unavailable · open this workspace in COSMIC Android app");return;}
 refreshDevices().catch(error=>status(error.message,"error"));
}
