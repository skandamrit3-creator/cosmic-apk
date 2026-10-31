/* Verified frontend feature packs. Native Android code still requires an in-place APK update. */
(() => {
 "use strict";
 const OWNER="skandamrit777-ops",REPO="cosmic-ai",CACHE="cosmic-feature-overrides-v1";
 const API="https://api.github.com/repos/"+OWNER+"/"+REPO+"/releases?per_page=30";
 const MIN_APP_VERSION=12;
 let lastManifest=null;
 const allowedPath=p=>typeof p==="string"&&!p.startsWith("/")&&!p.includes("..")&&/^(js|css)\/[A-Za-z0-9._-]+\.(js|css)$/.test(p);
 async function registerWorker(){
  if(!("serviceWorker" in navigator)||!window.isSecureContext)return {available:false};
  try{return {available:true,registration:await navigator.serviceWorker.register("/cosmic-feature-sw.js",{scope:"/"})};}
  catch(error){return {available:false,error:error.message};}
 }
 async function latestRelease(){
  const response=await fetch(API,{cache:"no-store",headers:{"Accept":"application/vnd.github+json"}});
  if(!response.ok)throw new Error("GitHub release check HTTP "+response.status);
  const releases=await response.json();
  const release=releases.filter(x=>!x.draft&&String(x.tag_name||"").startsWith("features-")).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
  if(!release)throw new Error("No published COSMIC feature pack is available yet.");
  const asset=(release.assets||[]).find(x=>x.name==="cosmic-feature-manifest.json");
  if(!asset)throw new Error("Latest feature release has no manifest.");
  const r=await fetch(asset.browser_download_url,{cache:"no-store"});
  if(!r.ok)throw new Error("Feature manifest download HTTP "+r.status);
  const manifest=await r.json();
  if(manifest.schema!==1||!Array.isArray(manifest.files)||!String(manifest.version||"").startsWith("features-"))throw new Error("Unsupported feature manifest.");
  if(Number(manifest.min_version_code||0)>MIN_APP_VERSION)throw new Error("This feature pack requires a newer Android app version.");
  lastManifest={release,manifest};
  return {release,manifest};
 }
 async function sha256(buffer){
  if(!crypto?.subtle)throw new Error("Secure SHA-256 verification is unavailable in this WebView.");
  const hash=await crypto.subtle.digest("SHA-256",buffer);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
 }
 async function check(){
  await registerWorker();
  const {release,manifest}=await latestRelease();
  const installed=localStorage.getItem("COSMIC_FEATURE_VERSION")||"";
  return {available:true,version:manifest.version,installed,updateAvailable:installed!==manifest.version,files:manifest.files.length,releaseUrl:release.html_url};
 }
 async function install(){
  const {release,manifest}=lastManifest||await latestRelease();
  if(!("caches" in window))throw new Error("Secure local feature cache is unavailable.");
  if(!navigator.serviceWorker?.controller)await registerWorker();
  const assets=new Map((release.assets||[]).map(x=>[x.name,x]));
  const cache=await caches.open(CACHE);
  const prepared=[];
  let total=0;
  for(const file of manifest.files){
   if(!allowedPath(file.path))throw new Error("Blocked unsafe feature path: "+file.path);
   if(!Number.isInteger(file.size)||file.size<1||file.size>2*1024*1024)throw new Error("Feature file exceeds the allowed size.");
   total+=file.size;if(total>15*1024*1024)throw new Error("Feature pack exceeds the 15 MB safety limit.");
   const asset=assets.get(file.asset_name);
   if(!asset)throw new Error("Missing feature asset: "+file.asset_name);
   const assetUrl=new URL(asset.browser_download_url);\n   if(assetUrl.protocol!=="https:"||assetUrl.hostname!=="github.com"||!assetUrl.pathname.startsWith("/"+OWNER+"/"+REPO+"/releases/download/"))throw new Error("Blocked untrusted feature asset URL.");\n   const response=await fetch(assetUrl.href,{cache:"no-store"});
   if(!response.ok)throw new Error("Could not download "+file.path+" · HTTP "+response.status);
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength!==file.size)throw new Error("Size check failed for "+file.path);
   const digest=await sha256(bytes);
   if(digest!==file.sha256)throw new Error("SHA-256 verification failed for "+file.path);
   const type=file.content_type==="text/css"?"text/css; charset=utf-8":"text/javascript; charset=utf-8";
   prepared.push({key:new URL("/__cosmic_feature_overrides__/"+file.path,location.origin).href,response:new Response(bytes,{headers:{"Content-Type":type,"X-COSMIC-Feature-Version":manifest.version}})});
  }
  for(const item of prepared)await cache.put(item.key,item.response);
  localStorage.setItem("COSMIC_FEATURE_VERSION",manifest.version);
  document.dispatchEvent(new CustomEvent("cosmic:features-installed",{detail:{version:manifest.version,files:prepared.length}}));
  return {success:true,version:manifest.version,files:prepared.length,requiresRestart:true,releaseUrl:release.html_url};
 }
 async function rollback(){
  await caches.delete(CACHE);localStorage.removeItem("COSMIC_FEATURE_VERSION");
  return {success:true,requiresRestart:true};
 }
 window.COSMIC_FEATURE_UPDATER={check,install,rollback,registerWorker};
 registerWorker().catch(()=>{});
})();
