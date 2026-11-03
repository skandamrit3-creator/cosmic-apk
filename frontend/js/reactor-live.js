(() => {
"use strict";
const root=document.querySelector(".hud-main");
if(!root)return;
let timer=null, inFlight=false;
const panel=document.createElement("section");
panel.id="reactorLiveReadings";
panel.className="reactor-live-readings";
panel.innerHTML='<header class="reactor-live-head"><div><small>LIVE DEVICE TELEMETRY</small><h2>System health</h2></div><span id="reactorLiveState">CONNECTING</span></header><div class="reactor-live-grid"><article><small>CPU LOAD</small><b id="rxCpu">—</b><i><em id="rxCpuBar"></em></i></article><article><small>MEMORY</small><b id="rxMemory">—</b><i><em id="rxMemoryBar"></em></i></article><article><small>STORAGE</small><b id="rxDisk">—</b><i><em id="rxDiskBar"></em></i></article><article><small>BATTERY</small><b id="rxBattery">—</b><i><em id="rxBatteryBar"></em></i></article></div><footer><span id="rxNetwork">Network totals: unavailable</span><span id="rxDevice">Waiting for device readings</span></footer>';
root.prepend(panel);
const fmt=n=>{if(n===null||n===undefined)return "Unavailable";if(n<1024)return n+" B";const u=["KB","MB","GB","TB"];let x=n/1024,i=0;while(x>=1024&&i<u.length-1){x/=1024;i++;}return x.toFixed(1)+" "+u[i];};
const set=(id,value)=>{const el=panel.querySelector("#"+id);if(el)el.textContent=value;};
const bar=(id,value)=>{const el=panel.querySelector("#"+id);if(el)el.style.width=Number.isFinite(value)?Math.max(0,Math.min(100,value))+"%":"0%";};
async function refresh(){
 if(inFlight||document.hidden)return;inFlight=true;
 try{
  const base=String(window.COSMIC_API_BASE||location.origin).replace(/\/+$/,"");
  const r=await fetch(base+"/api/reactor/telemetry",{cache:"no-store",signal:AbortSignal.timeout(7000)});
  const d=await r.json();if(!r.ok||!d.success)throw Error(d.error||"HTTP "+r.status);
  const pct=v=>v===null||v===undefined?"Unavailable":Number(v).toFixed(0)+"%";
  set("rxCpu",pct(d.cpu_percent));bar("rxCpuBar",d.cpu_percent);
  set("rxMemory",pct(d.memory_percent));bar("rxMemoryBar",d.memory_percent);
  set("rxDisk",pct(d.disk_percent));bar("rxDiskBar",d.disk_percent);
  set("rxBattery",d.battery_percent===null?"Unavailable":Math.round(d.battery_percent)+"%"+(d.battery_plugged?" · charging":""));bar("rxBatteryBar",d.battery_percent);
  set("rxNetwork",d.network_sent_bytes===null?"Network totals: unavailable":"Network totals · ↑ "+fmt(d.network_sent_bytes)+"  ↓ "+fmt(d.network_received_bytes));
  set("rxDevice",d.platform+" · "+d.machine+" · uptime "+Math.floor(d.uptime_seconds/60)+" min");
  set("reactorLiveState",d.sensor_source==="psutil"?"LIVE · "+new Date(d.sampled_at).toLocaleTimeString():"PARTIAL · "+d.sensor_source);
  panel.dataset.state=d.sensor_source;
 }catch(e){set("reactorLiveState","OFFLINE");set("rxDevice","Telemetry unavailable · "+e.message);}
 finally{inFlight=false;}
}
function start(){if(timer)clearInterval(timer);refresh();timer=setInterval(refresh,5000);}
document.addEventListener("visibilitychange",()=>{if(document.hidden){if(timer)clearInterval(timer);timer=null;}else start();});
start();
window.COSMIC_REACTOR_REFRESH=refresh;
})();