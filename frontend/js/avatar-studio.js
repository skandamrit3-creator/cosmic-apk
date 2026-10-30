import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

(() => {
  "use strict";
  const apiBase=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/+$/,"");
  let mounted=false,renderer,scene,camera,controls,clock,loader,currentRoot,currentVrm;
  let currentTaskId="",speaking=false,rotate=false,dbPromise,currentDownloadUrl="";
  const state={frame:0,style:"human",modelName:"COSMIC Preview"};
  const $=(selector,root=document)=>root.querySelector(selector);
  function status(message,type="info"){const el=document.querySelector("#cosmicAvatarStatus");if(el){el.textContent=message;el.dataset.state=type;}}
  function badge(message){const el=document.querySelector("#cosmicAvatarStageState");if(el)el.textContent=message;}
  function openDB(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open("cosmic-avatar-library-v1",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("models"))r.result.createObjectStore("models",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbPromise;}
  async function saveModel(name,blob,source){try{const db=await openDB(),id="avatar-"+Date.now().toString(36);await new Promise((resolve,reject)=>{const tx=db.transaction("models","readwrite");tx.objectStore("models").put({id,name,blob,source,createdAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});refreshLibrary();}catch(e){status("Loaded for this session; local save unavailable: "+e.message,"error");}}
  async function refreshLibrary(){const host=document.getElementById("cosmicAvatarMode"),grid=host&&$("#cosmicAvatarLibrary",host);if(!grid)return;try{const db=await openDB(),items=await new Promise((resolve,reject)=>{const q=db.transaction("models","readonly").objectStore("models").getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});grid.replaceChildren();if(!items.length){const p=document.createElement("p");p.className="avatar-help";p.textContent="Imported and generated models will appear here on this device.";grid.append(p);return;}items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).forEach(item=>{const b=document.createElement("button");b.type="button";b.textContent=item.name;b.onclick=()=>loadBlob(item.blob,item.name,false);grid.append(b);});}catch(_){grid.textContent="Local model library unavailable.";}}
  function mesh(geometry,material,x,y,z,sx=1,sy=1,sz=1){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;return m;}
  function previewCharacter(style){
    const g=new THREE.Group(),anime=style==="anime";
    const skin=new THREE.MeshPhysicalMaterial({color:anime?0xe8cabc:0xb98065,roughness:.7,clearcoat:.08});
    const hair=new THREE.MeshStandardMaterial({color:anime?0x322744:0x282b39,roughness:.82});
    const clothes=new THREE.MeshStandardMaterial({color:anime?0x657aa5:0x426c7d,roughness:.66,metalness:.06});
    const dark=new THREE.MeshStandardMaterial({color:anime?0x252037:0x18232d,roughness:.35});
    const lip=new THREE.MeshStandardMaterial({color:0x874e5c,roughness:.6});
    g.add(mesh(new THREE.CapsuleGeometry(.44,.64,6,24),clothes,0,1.02,0));
    g.add(mesh(new THREE.CapsuleGeometry(.12,.2,5,16),skin,0,1.68,0));
    g.add(mesh(new THREE.SphereGeometry(1,40,32),skin,0,2.08,0,.4,.51,.35));
    g.add(mesh(new THREE.SphereGeometry(1,32,24),hair,0,2.42,-.035,.43,.28,.37));
    g.add(mesh(new THREE.SphereGeometry(1,24,16),hair,-.29,2.23,.13,.1,.2,.17));
    g.add(mesh(new THREE.SphereGeometry(1,24,16),hair,.29,2.23,.13,.1,.2,.17));
    const eye=anime?.072:.052;
    g.add(mesh(new THREE.SphereGeometry(1,20,16),dark,-.145,2.12,.322,eye,anime?.1:.05,.022));
    g.add(mesh(new THREE.SphereGeometry(1,20,16),dark,.145,2.12,.322,eye,anime?.1:.05,.022));
    g.add(mesh(new THREE.SphereGeometry(1,16,12),skin,-.43,2.09,0,.065,.095,.06));
    g.add(mesh(new THREE.SphereGeometry(1,16,12),skin,.43,2.09,0,.065,.095,.06));
    g.add(mesh(new THREE.SphereGeometry(1,20,12),lip,0,1.94,.33,.09,.025,.018));
    g.add(mesh(new THREE.CylinderGeometry(.58,.68,.1,64),new THREE.MeshStandardMaterial({color:0x26394c,metalness:.35,roughness:.5}),0,.12,0));
    const halo=mesh(new THREE.TorusGeometry(.8,.012,10,100),new THREE.MeshBasicMaterial({color:anime?0xb7a4ef:0x8edcf1,transparent:true,opacity:.6}),0,.2,0);halo.rotation.x=Math.PI/2;g.add(halo);
    g.userData.preview=true;g.userData.style=style;return g;
  }
  function initScene(canvas){
    if(renderer)return;
    scene=new THREE.Scene();scene.background=new THREE.Color(0x101c2a);
    camera=new THREE.PerspectiveCamera(32,1,.1,100);camera.position.set(0,1.5,5.2);
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:"high-performance"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
    controls=new OrbitControls(camera,canvas);controls.target.set(0,1.2,0);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=2.5;controls.maxDistance=8;
    scene.add(new THREE.HemisphereLight(0xd9edff,0x202c45,1.9));
    const key=new THREE.DirectionalLight(0xffe7d3,3.1);key.position.set(3,5,4);scene.add(key);
    const fill=new THREE.DirectionalLight(0x8dbce9,2);fill.position.set(-4,2,2);scene.add(fill);
    const rim=new THREE.DirectionalLight(0xcbb9f0,2.7);rim.position.set(0,3,-4);scene.add(rim);
    const floor=mesh(new THREE.CircleGeometry(3.6,80),new THREE.MeshStandardMaterial({color:0x182b3e,roughness:.75,metalness:.12}),0,.04,0);floor.rotation.x=-Math.PI/2;scene.add(floor);
    const ring=mesh(new THREE.TorusGeometry(1.35,.014,10,120),new THREE.MeshBasicMaterial({color:0x82cde4,transparent:true,opacity:.35}),0,.12,0);ring.rotation.x=Math.PI/2;scene.add(ring);
    loader=new GLTFLoader();loader.crossOrigin="anonymous";loader.register(parser=>new VRMLoaderPlugin(parser));clock=new THREE.Clock();
    const resize=()=>{const r=canvas.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=Math.max(1,r.width)/Math.max(1,r.height);camera.updateProjectionMatrix();};
    new ResizeObserver(resize).observe(canvas);resize();
    const animate=()=>{requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);state.frame+=dt;if(currentRoot?.userData.preview)currentRoot.rotation.y=Math.sin(state.frame*.22)*.06;if(currentVrm){currentVrm.update(dt);if(speaking&&currentVrm.expressionManager)currentVrm.expressionManager.setValue("aa",.18+.48*Math.abs(Math.sin(state.frame*12)));}controls.update();renderer.render(scene,camera);};animate();
    currentRoot=previewCharacter("human");scene.add(currentRoot);
  }
  async function fitAndAdd(gltf,name,blob,save=true){
    if(currentRoot)scene.remove(currentRoot);currentVrm=gltf.userData.vrm||null;currentRoot=gltf.scene;
    const box=new THREE.Box3().setFromObject(currentRoot),size=box.getSize(new THREE.Vector3());
    if(size.y>0){currentRoot.scale.multiplyScalar(1.85/size.y);const fitted=new THREE.Box3().setFromObject(currentRoot);currentRoot.position.y-=fitted.min.y-.12;}
    currentRoot.position.x=0;scene.add(currentRoot);state.modelName=name;
    const title=document.querySelector("#cosmicAvatarModelName");if(title)title.textContent=name;badge(name.toUpperCase().slice(0,28));
    if(save&&blob)await saveModel(name,blob,"local");
  }
  async function loadBlob(blob,name="Imported avatar",save=true){const url=URL.createObjectURL(blob);try{const gltf=await loader.loadAsync(url);await fitAndAdd(gltf,name,blob,save);status(name+" loaded in the 3D viewport.","success");}catch(e){status("3D model could not be loaded: "+e.message,"error");}finally{setTimeout(()=>URL.revokeObjectURL(url),15000);}}
  async function loadUrl(url,name){
    if(!/^https:\/\//i.test(url))throw new Error("Model URL must use HTTPS.");
    const dl=document.querySelector("#cosmicAvatarDownload");
    try{
      const response=await fetch(url,{cache:"no-store",mode:"cors"});
      if(!response.ok)throw new Error("Model download HTTP "+response.status);
      const blob=await response.blob();
      await loadBlob(blob,name,true);
      if(dl){
        if(currentDownloadUrl)URL.revokeObjectURL(currentDownloadUrl);
        currentDownloadUrl=URL.createObjectURL(blob);
        dl.href=currentDownloadUrl;dl.hidden=false;
      }
    }catch(downloadError){
      status("Downloading a permanent local copy failed; trying the live model link: "+downloadError.message,"info");
      const gltf=await loader.loadAsync(url);
      await fitAndAdd(gltf,name,null,false);
      if(dl){dl.href=url;dl.hidden=false;}
    }
  }
  function setPreview(style){if(currentRoot)scene.remove(currentRoot);currentVrm=null;currentRoot=previewCharacter(style);scene.add(currentRoot);state.style=style;state.modelName=style==="anime"?"Anime-style 3D Preview":"Human-style 3D Preview";badge(state.modelName.toUpperCase());}
  function speak(text){const value=String(text||"").trim();if(!value)return;speaking=true;window.COSMIC_AVATAR_TALK?.(true);const native=window.Capacitor?.Plugins?.CosmicVoice;if(native?.speak){native.speak({text:value}).catch(e=>status("Voice error: "+e.message,"error")).finally(()=>{speaking=false;window.COSMIC_AVATAR_TALK?.(false);});setTimeout(()=>{speaking=false;window.COSMIC_AVATAR_TALK?.(false);},Math.max(1800,value.length*65));return;}if(window.speechSynthesis){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(value);utterance.onend=utterance.onerror=()=>{speaking=false;window.COSMIC_AVATAR_TALK?.(false);};speechSynthesis.speak(utterance);}else{speaking=false;window.COSMIC_AVATAR_TALK?.(false);status("Text-to-speech is unavailable.","error");}}
  function markup(){return [
    '<div class="avatar-studio-v2">',
    '<header class="avatar-studio-head"><div><h2>Avatar Studio</h2><p>Real human models, anime/VRM characters and your own photo-based 3D twin.</p></div><div class="avatar-stage-meta"><span id="cosmicAvatarModelName">COSMIC 3D Preview</span></div></header>',
    '<section class="avatar-stage-v2"><canvas id="cosmicAvatarCanvas" aria-label="Interactive 3D avatar stage"></canvas><div class="avatar-stage-meta"><span>3D VIEWPORT</span><span id="cosmicAvatarStageState">STARTER PREVIEW</span></div><div class="avatar-stage-actions"><button class="avatar-action" id="cosmicAvatarReset" type="button">RESET VIEW</button><button class="avatar-action" id="cosmicAvatarTurn" type="button">AUTO ROTATE</button><a class="avatar-action" id="cosmicAvatarDownload" hidden download="cosmic-avatar.glb">DOWNLOAD MODEL</a></div></section>',
    '<aside class="avatar-panel"><h3>CHARACTER STYLE</h3><p>Starter meshes are previews. Import a real GLB/VRM or generate a detailed model from multiple photos.</p>',
    '<div class="avatar-segment"><button type="button" class="active" data-avatar-style="human">HUMAN PREVIEW</button><button type="button" data-avatar-style="anime">ANIME PREVIEW</button></div>',
    '<div class="avatar-divider"></div><h3>GENERATE REAL 3D CHARACTERS</h3><p>Generate full-body textured human or anime characters. Each generation can use paid Tripo credits.</p><div class="avatar-preset-grid"><button type="button" data-avatar-preset="hyderabad_man">HYDERABAD MAN</button><button type="button" data-avatar-preset="hyderabad_woman">HYDERABAD WOMAN</button><button type="button" data-avatar-preset="global_man">REALISTIC MAN</button><button type="button" data-avatar-preset="global_woman">REALISTIC WOMAN</button><button type="button" data-avatar-preset="anime_hero">ANIME HERO</button><button type="button" data-avatar-preset="anime_heroine">ANIME HEROINE</button></div><div class="avatar-status" id="cosmicPresetStatus" role="status">Select a character preset to generate a real model.</div>',
    '<div class="avatar-model-import"><label class="avatar-action" for="cosmicAvatarModelFile">IMPORT GLB / VRM</label><input id="cosmicAvatarModelFile" type="file" accept=".glb,.gltf,.vrm,model/gltf-binary,model/gltf+json"></div>',
    '<div class="avatar-divider"></div><h3>CREATE YOUR 3D TWIN</h3><p>Use photos of the same person, in consistent light. Front is required; two or more views are needed, and four are recommended.</p>',
    '<div class="avatar-upload"><label>01 · FRONT<input type="file" id="avatarPhotoFront" accept="image/jpeg,image/png,image/webp" capture="user"></label><label>02 · LEFT<input type="file" id="avatarPhotoLeft" accept="image/jpeg,image/png,image/webp" capture="environment"></label><label>03 · BACK<input type="file" id="avatarPhotoBack" accept="image/jpeg,image/png,image/webp" capture="environment"></label><label>04 · RIGHT<input type="file" id="avatarPhotoRight" accept="image/jpeg,image/png,image/webp" capture="environment"></label></div>',
    '<label class="avatar-consent"><input type="checkbox" id="avatarPhotoConsent"><span>I have permission to use these photos and agree to send them to Tripo for cloud 3D generation. This may consume paid credits.</span></label>',
    '<button class="avatar-primary" id="avatarGenerate3D" type="button">CREATE DETAILED 3D AVATAR</button><div class="avatar-status" id="cosmicAvatarStatus" role="status">Checking 3D generation service…</div><button class="avatar-action" id="avatarRig3D" type="button" disabled>MAKE MODEL ANIMATABLE</button>',
    '<div class="avatar-divider"></div><h3>VOICE & EXPRESSION</h3><textarea id="avatarSpeakText" rows="3" placeholder="Write what your character should say…" style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--c-line);background:#081522;color:#f4f8fc"></textarea><button class="avatar-primary" id="avatarSpeakButton" type="button" style="margin-top:8px">SPEAK AS CHARACTER</button><p class="avatar-help">VRM facial expressions are used when the model provides compatible expression morphs. Generic GLB models do not automatically gain realistic lip-sync.</p>',
    '<div class="avatar-divider"></div><h3>BUILT-IN ANIME CHARACTERS</h3><div class="avatar-gallery" id="cosmicAvatarSamples"><button type="button" data-avatar-sample="A" data-url="https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm">AVATAR SAMPLE A</button><button type="button" data-avatar-sample="B" data-url="https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_B.vrm">AVATAR SAMPLE B</button><button type="button" data-avatar-sample="C" data-url="https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_C.vrm">AVATAR SAMPLE C</button></div><p class="avatar-help">VRoid sample models A–C. Their use is governed by Pixiv/VRoid sample-model terms, not CC0. <a href="https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z" target="_blank" rel="noopener">View usage terms</a>.</p><div class="avatar-divider"></div><h3>MY CHARACTER LIBRARY</h3><div class="avatar-gallery" id="cosmicAvatarLibrary"></div><p class="avatar-help">Imported and generated model files are saved in local IndexedDB on this device.</p><div class="avatar-price-note">Photo-to-3D uses Tripo’s paid API. Add TRIPO_API_KEY to the backend environment. This repo does not bundle photorealistic/anime asset files.</div></aside></div>'
  ].join("");}
  function buildUI(host){
    if(host.dataset.avatarV2==="1")return;host.dataset.avatarV2="1";host.innerHTML=markup();initScene($("#cosmicAvatarCanvas",host));
    $("#cosmicAvatarModelFile",host).addEventListener("change",e=>{const f=e.target.files?.[0];if(f)loadBlob(f,f.name);});
    host.querySelectorAll("[data-avatar-style]").forEach(b=>b.onclick=()=>{host.querySelectorAll("[data-avatar-style]").forEach(x=>x.classList.toggle("active",x===b));setPreview(b.dataset.avatarStyle);});
    host.querySelectorAll("[data-avatar-preset]").forEach(b=>b.addEventListener("click",()=>generatePreset(b.dataset.avatarPreset,b)));
    host.querySelectorAll("[data-avatar-sample]").forEach(b=>b.onclick=async()=>{try{status("Loading "+b.dataset.avatarSample+" VRM model from the sample library…");await loadUrl(b.dataset.url,"VRoid Avatar Sample "+b.dataset.avatarSample);}catch(e){status("Could not load sample avatar: "+e.message,"error");}});
    $("#cosmicAvatarReset",host).onclick=()=>{camera.position.set(0,1.5,5.2);controls.target.set(0,1.2,0);controls.update();};
    $("#cosmicAvatarTurn",host).onclick=()=>{rotate=!rotate;controls.autoRotate=rotate;$("#cosmicAvatarTurn",host).textContent=rotate?"STOP ROTATION":"AUTO ROTATE";};
    $("#avatarSpeakButton",host).onclick=()=>speak($("#avatarSpeakText",host).value);
    $("#avatarGenerate3D",host).onclick=generatePhotos;$("#avatarRig3D",host).onclick=rigModel;
    refreshLibrary();checkProvider();
  }
  async function generatePreset(preset,button){
    if(!preset)return;
    const all=Array.from(document.querySelectorAll("[data-avatar-preset]"));
    all.forEach(x=>x.disabled=true);
    const label=preset.replaceAll("_"," ").toUpperCase();
    const out=document.querySelector("#cosmicPresetStatus");
    if(out)out.textContent="Starting "+label+" 3D generation…";
    try{
      const r=await fetch(apiBase()+"/api/avatar/3d/preset",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({preset})
      });
      const d=await r.json();
      if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);
      currentTaskId=d.task_id;
      if(out)out.textContent="Generating "+label+" · task "+d.task_id;
      $("#avatarRig3D").disabled=true;
      await pollTask(d.task_id,"preset");
    }catch(e){
      if(out)out.textContent="Character generation failed: "+e.message;
      status("Preset generation failed: "+e.message,"error");
    }finally{all.forEach(x=>x.disabled=false);}
  }
  async function checkProvider(){try{const r=await fetch(apiBase()+"/api/avatar/3d/status",{cache:"no-store"}),d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);status(d.configured?"Tripo connection configured. Generation still requires your explicit photo upload.":"3D viewer ready; photo-to-3D is not configured. Add TRIPO_API_KEY to backend .env.","info");$("#avatarGenerate3D").disabled=!d.configured;}catch(e){status("3D service status unavailable: "+e.message,"error");}}
  async function generatePhotos(){
    const consent=$("#avatarPhotoConsent");if(!consent?.checked){status("Confirm permission to upload the selected photos first.","error");return;}
    const views=["front","left","back","right"],files=views.map(v=>[v,document.getElementById("avatarPhoto"+v[0].toUpperCase()+v.slice(1))?.files?.[0]]).filter(x=>x[1]);
    if(!files.some(x=>x[0]==="front")||files.length<2){status("Choose a front photo and at least one other angle.","error");return;}
    for(const [v,f] of files){if(!/^image\/(jpeg|png|webp)$/i.test(f.type)||f.size>20*1024*1024){status(v+" image must be JPEG/PNG/WebP and no larger than 20 MB.","error");return;}}
    const button=$("#avatarGenerate3D");button.disabled=true;status("Uploading selected views and starting 3D generation…");
    try{const form=new FormData();form.append("consent","true");files.forEach(([v,f])=>form.append(v,f,f.name));const r=await fetch(apiBase()+"/api/avatar/3d/generate",{method:"POST",body:form});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);currentTaskId=d.task_id;$("#avatarRig3D").disabled=true;status("3D generation queued · "+files.length+" views · "+d.task_id);await pollTask(d.task_id,"generation");}
    catch(e){status("3D generation failed: "+e.message,"error");}finally{button.disabled=false;}
  }
  async function pollTask(id,kind){
    const start=Date.now();
    while(Date.now()-start<20*60*1000){
      await new Promise(r=>setTimeout(r,5000));
      const r=await fetch(apiBase()+"/api/avatar/3d/task/"+encodeURIComponent(id),{cache:"no-store"});
      const d=await r.json();
      if(!r.ok||!d.success)throw new Error(d.error||"Task status failed");
      status((kind==="rig"?"Rigging":kind==="rig-check"?"Checking rig compatibility":"Generating model")+" · "+d.status+" · "+(d.progress||0)+"%");
      if(d.status==="success"){
        if(kind==="rig-check")return d;
        if(!d.model_url)throw new Error("Task finished without a model URL.");
        await loadUrl(d.model_url,kind==="rig"?"Rigged character":kind==="preset"?"Generated character":"My 3D twin");
        if(kind==="generation"||kind==="preset"){
          $("#avatarRig3D").disabled=false;
          status(kind==="preset"?"Generated character saved to your device.":"Your 3D twin is ready and saved to this device.", "success");
        }else status("Rigging completed. The rigged model is saved locally.", "success");
        return d;
      }
      if(["failed","cancelled","banned"].includes(d.status))throw new Error(d.error||"Task "+d.status);
    }
    throw new Error("Task is still processing after 20 minutes; it can be checked again later.");
  }
  async function rigModel(){
    if(!currentTaskId){status("Generate a Tripo model before rigging it.","error");return;}
    const b=$("#avatarRig3D");b.disabled=true;
    try{
      status("Checking whether Tripo can rig this model…");
      const checkResponse=await fetch(apiBase()+"/api/avatar/3d/rig-check",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({task_id:currentTaskId})
      });
      const checkData=await checkResponse.json();
      if(!checkResponse.ok||!checkData.success)throw new Error(checkData.error||"Rig check failed");
      const result=await pollTask(checkData.task_id,"rig-check");
      if(result.riggable!==true)throw new Error("Tripo reports that this model cannot be rigged. Try a neutral standing A-pose preset or regenerate the photos.");
      const rigResponse=await fetch(apiBase()+"/api/avatar/3d/rig",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({task_id:currentTaskId,rig_type:result.rig_type||"biped"})
      });
      const rigData=await rigResponse.json();
      if(!rigResponse.ok||!rigData.success)throw new Error(rigData.error||"Rig request failed");
      await pollTask(rigData.task_id,"rig");
    }catch(e){status("Rigging failed: "+e.message,"error");}
    finally{b.disabled=false;}
  }
  function mount(){const host=document.getElementById("cosmicAvatarMode");if(!host)return;const obs=new MutationObserver(()=>{if(host.dataset.ready==="1"&&host.dataset.avatarV2!=="1")buildUI(host);});obs.observe(host,{childList:true});if(host.dataset.ready==="1")buildUI(host);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
  window.COSMIC_AVATAR_TALK=on=>{speaking=!!on;};
})();