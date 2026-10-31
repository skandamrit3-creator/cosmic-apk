/* Real Android hardware telemetry. Unsupported sensors remain unavailable; never show invented values. */
(() => {
 "use strict";
 const plugin=()=>window.Capacitor?.Plugins?.CosmicVoice;
 const rows=[...document.querySelectorAll(".telemetry-panel .metric")];
 const find=name=>rows.find(row=>row.querySelector("span")?.textContent.trim().toUpperCase()===name);
 const paint=(row,value,label)=>{if(!row)return;const bar=row.querySelector(".metric-bar i"),out=row.querySelector("b");if(out)out.textContent=value==null?"—":value+"%";if(bar)bar.style.width=value==null?"0%":Math.max(0,Math.min(100,value))+"%";if(label)row.querySelector("span").textContent=label;};
 const fmt=bytes=>{if(!Number.isFinite(bytes)||bytes<0)return "—";const units=["B","KB","MB","GB","TB"];let n=bytes,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return n.toFixed(i>1?1:0)+" "+units[i];};
 async function sample(){
  const api=plugin();
  if(typeof api?.getDeviceMetrics!=="function"){
   paint(find("CPU")||find("CORE"),null);paint(find("GPU"),null,"GPU");paint(find("STORAGE"),null,"STORAGE");paint(find("RAM"),null,"RAM");paint(find("BATTERY"),null,"BATTERY");
   const status=document.getElementById("coreLoad");if(status)status.textContent="ANDROID SENSOR BRIDGE REQUIRED";
   return;
  }
  try{
   const m=await api.getDeviceMetrics();
   paint(find("CPU")||find("CORE"),m.cpuPercent>=0?m.cpuPercent:null,"CPU");
   const ram=find("RAM")||find("MEMORY");paint(ram,m.ramPercent>=0?m.ramPercent:null,"RAM");
   if(ram){const out=ram.querySelector("b");if(out&&m.ramTotalBytes)out.title=fmt(m.ramUsedBytes)+" / "+fmt(m.ramTotalBytes);}
   const storage=find("STORAGE")||find("NETWORK");paint(storage,m.storagePercent>=0?m.storagePercent:null,"STORAGE");
   if(storage){const out=storage.querySelector("b");if(out&&m.storageTotalBytes)out.title=fmt(m.storageUsedBytes)+" / "+fmt(m.storageTotalBytes);}
   const gpu=find("GPU");paint(gpu,m.gpuAvailable&&m.gpuPercent>=0?m.gpuPercent:null,"GPU");
   if(gpu){const out=gpu.querySelector("b");if(out)out.title=m.gpuAvailable?"Android GPU utilization":"GPU utilization is not exposed by this Android device";}
   paint(find("BATTERY"),m.batteryPercent>=0?m.batteryPercent:null,"BATTERY");
   const status=document.getElementById("coreLoad");if(status)status.textContent=m.cpuPercent>=0?"LIVE · ANDROID":"SAMPLING CPU";
   const coreMetric=document.getElementById("coreMetric");if(coreMetric&&m.cpuPercent>=0)coreMetric.textContent=m.cpuPercent+"%";
  }catch(error){const status=document.getElementById("coreLoad");if(status)status.textContent="TELEMETRY UNAVAILABLE";}
 }
 document.addEventListener("DOMContentLoaded",()=>{sample();setInterval(sample,2500);},{once:true});
})();
