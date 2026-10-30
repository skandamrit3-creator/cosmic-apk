(() => {
"use strict";
const base=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/+$/,"");
async function get(path){const r=await fetch(base()+path,{cache:"no-store"});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||"HTTP "+r.status);return d;}
async function preview(path,content){const r=await fetch(base()+"/api/upgrades/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path,content})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Preview failed");return d;}
async function apply(path,content,approved){if(approved!==true)throw new Error("A separate explicit approval is required.");const r=await fetch(base()+"/api/upgrades/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path,content,approved:true})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Apply failed");return d;}
async function rollback(id,approved){if(approved!==true)throw new Error("A separate explicit approval is required.");const r=await fetch(base()+"/api/upgrades/rollback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,approved:true})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Rollback failed");return d;}
window.COSMIC_UPGRADES={status:()=>get("/api/upgrades/status"),project:()=>get("/api/upgrades/project"),history:()=>get("/api/upgrades/history"),preview,apply,rollback};
})();