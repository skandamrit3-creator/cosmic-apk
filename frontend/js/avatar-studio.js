import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

(() => {
  "use strict";
  const apiBase=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/+$/,"");
  let mounted=false,renderer,scene,camera,controls,clock,loader,currentRoot,currentVrm;
  let currentTaskId="",speaking=false,audioLevel=0,rotate=false,dbPromise,currentDownloadUrl="",nextBlink=2.5,blinkTime=0;
  let gestureBones=null, activeGesture="idle", gestureUntil=0, conversationBusy=false, conversationSession=localStorage.getItem("cosmic.chat.session.v1")||localStorage.getItem("cosmic.avatar.session.v1")||("chat-"+Date.now().toString(36));
  localStorage.setItem("cosmic.chat.session.v1",conversationSession);
  localStorage.setItem("cosmic.avatar.session.v1",conversationSession);
  const state={frame:0,style:"human",modelName:"COSMIC Preview",mood:"neutral"};
  const $=(selector,root=document)=>root.querySelector(selector);
  function status(message,type="info"){const el=document.querySelector("#cosmicAvatarStatus");if(el){el.textContent=message;el.dataset.state=type;}}
  function badge(message){const el=document.querySelector("#cosmicAvatarStageState");if(el)el.textContent=message;}
  function openDB(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open("cosmic-avatar-library-v1",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("models"))r.result.createObjectStore("models",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbPromise;}
  async function saveModel(name,blob,source){try{const db=await openDB(),id="avatar-"+Date.now().toString(36);await new Promise((resolve,reject)=>{const tx=db.transaction("models","readwrite");tx.objectStore("models").put({id,name,blob,source,createdAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});refreshLibrary();}catch(e){status("Loaded for this session; local save unavailable: "+e.message,"error");}}
  async function refreshLibrary(){const host=document.getElementById("cosmicAvatarMode"),grid=host&&$("#cosmicAvatarLibrary",host);if(!grid)return;try{const db=await openDB(),items=await new Promise((resolve,reject)=>{const q=db.transaction("models","readonly").objectStore("models").getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});grid.replaceChildren();if(!items.length){const p=document.createElement("p");p.className="avatar-help";p.textContent="Imported and generated models will appear here on this device.";grid.append(p);return;}items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).forEach(item=>{const b=document.createElement("button");b.type="button";b.textContent=item.name;b.onclick=()=>loadBlob(item.blob,item.name,false);grid.append(b);});}catch(_){grid.textContent="Local model library unavailable.";}}
  function mesh(geometry,material,x,y,z,sx=1,sy=1,sz=1){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;return m;}
  function previewCharacter(style){
    const g=new THREE.Group(),anime=style==="anime";
    const skin=new THREE.MeshPhysicalMaterial({color:0xf0d4c7,roughness:.62,clearcoat:.12});
    const hair=new THREE.MeshStandardMaterial({color:0xe7c77f,roughness:.62,metalness:.025});
    const hairLight=new THREE.MeshStandardMaterial({color:0xffe6a6,roughness:.58});
    const outfit=new THREE.MeshStandardMaterial({color:0xf0ece4,roughness:.58,metalness:.035});
    const trim=new THREE.MeshStandardMaterial({color:0xd2ad62,metalness:.48,roughness:.34});
    const eyeWhite=new THREE.MeshStandardMaterial({color:0xfff8f3,roughness:.28});
    const iris=new THREE.MeshStandardMaterial({color:0x8062d5,roughness:.22,metalness:.08});
    const pupil=new THREE.MeshStandardMaterial({color:0x211d2d,roughness:.2});
    const lip=new THREE.MeshStandardMaterial({color:0x9e465b,roughness:.5});
    const eyeLids=[];
    const sphere=(x,y,z,sx,sy,sz,mat)=>mesh(new THREE.SphereGeometry(1,32,24),mat,x,y,z,sx,sy,sz);
    // Silhouette, tailored jacket and neck
    g.add(mesh(new THREE.CapsuleGeometry(.39,.62,8,28),outfit,0,1.05,0));
    g.add(mesh(new THREE.CapsuleGeometry(.115,.19,6,18),skin,0,1.65,0));
    g.add(mesh(new THREE.CapsuleGeometry(.40,.72,8,28),hair,0,1.99,-.17,.98,1.05,.72));
    // Face and layered hair cap
    sphere(0,2.08,.015,.385,.49,.33,skin);
    sphere(0,2.42,-.075,.425,.27,.37,hair);
    sphere(-.32,2.15,-.015,.105,.25,.19,hair);
    sphere(.32,2.15,-.015,.105,.25,.19,hair);
    // Fringes frame the forehead rather than covering the eyes
    for(let i=0;i<5;i++){
      const x=-.27+i*.135;
      const bang=sphere(x,2.34,.245,.105,.23,.105,i%2?hair:hairLight);
      bang.rotation.z=(i-2)*-.11;
    }
    // Eyes with iris highlights, brows and a small nose
    for(const side of [-1,1]){
      const eye= sphere(side*.145,2.12,.309,.082,.105,.035,eyeWhite);eyeLids.push(eye);
      sphere(side*.145,2.115,.343,.052,.073,.018,iris);
      sphere(side*.145,2.112,.359,.026,.046,.012,pupil);
      sphere(side*.16,2.255,.305,.09,.018,.025,hair);
      sphere(side*.17,2.145,.371,.014,.018,.008,eyeWhite);
      sphere(side*.405,2.075,.005,.055,.09,.055,skin);
    }
    sphere(0,2.005,.337,.027,.04,.025,skin);
    const mouth=sphere(0,1.91,.326,.075,.018,.014,lip);
    // Shoulders, articulated upper arms and hands
    const arm=(side)=>{
      const pivot=new THREE.Group();pivot.position.set(side*.39,1.42,0);
      const upper=mesh(new THREE.CapsuleGeometry(.105,.35,6,16),outfit,side*.045,-.22,0);
      upper.rotation.z=side*-.12;pivot.add(upper);
      const fore=mesh(new THREE.CapsuleGeometry(.082,.31,6,16),skin,side*.09,-.52,.035);
      fore.rotation.z=side*-.16;pivot.add(fore);
      sphere(side*.13,1,0,.09,.095,.085,skin);
      const hand=sphere(side*.13,-.72,.045,.075,.105,.045,skin);pivot.add(hand);
      for(let finger=0;finger<4;finger++){
        const fx=side*.13+(finger-1.5)*.034;
        const digit=mesh(new THREE.CapsuleGeometry(.014,.075,4,10),skin,fx,-.83,.05,.9,1,.9);
        digit.rotation.z=(finger-1.5)*.07;pivot.add(digit);
      }
      const thumb=mesh(new THREE.CapsuleGeometry(.018,.065,4,10),skin,side*.22,-.75,.065);
      thumb.rotation.z=side*.75;pivot.add(thumb);
      g.add(pivot);return pivot;
    };
    const leftArm=arm(-1),rightArm=arm(1);
    const black=new THREE.MeshStandardMaterial({color:0x24232b,roughness:.5,metalness:.08});
    const burgundy=new THREE.MeshStandardMaterial({color:0x8b344b,roughness:.52});
    const gold=new THREE.MeshStandardMaterial({color:0xd8b56c,metalness:.62,roughness:.28});
    // Full-body silhouette: tailored waist, layered skirt, legs and boots.
    g.add(mesh(new THREE.CylinderGeometry(.30,.43,.42,40),outfit,0,.62,0));
    g.add(mesh(new THREE.CapsuleGeometry(.105,.54,8,20),black,-.145,.22,.015));
    g.add(mesh(new THREE.CapsuleGeometry(.105,.54,8,20),black,.145,.22,.015));
    g.add(mesh(new THREE.CylinderGeometry(.12,.145,.25,28),black,-.145,.055,.035));
    g.add(mesh(new THREE.CylinderGeometry(.12,.145,.25,28),black,.145,.055,.035));
    const skirtTrim=mesh(new THREE.TorusGeometry(.39,.018,8,64),trim,0,.42,0);skirtTrim.rotation.x=Math.PI/2;g.add(skirtTrim);
    // Long layered blonde locks fall behind both shoulders.
    for(const side of [-1,1]){
      const lock=mesh(new THREE.CapsuleGeometry(.075,.58,8,18),hair,side*.34,1.63,-.19,.88,1,.8);
      lock.rotation.z=side*.12;g.add(lock);
      const sideLock=mesh(new THREE.CapsuleGeometry(.045,.42,8,16),hairLight,side*.39,1.77,.02,.85,1,.75);
      sideLock.rotation.z=side*.16;g.add(sideLock);
    }
    // MYRAA signature black bodice, burgundy shoulder accents and gold ornaments.
    g.add(mesh(new THREE.CapsuleGeometry(.205,.46,6,20),black,0,1.05,.205,.94,1,.45));
    for(const side of [-1,1]){
      const accent=mesh(new THREE.SphereGeometry(1,24,16),burgundy,side*.36,1.43,.015,.17,.105,.21);accent.rotation.z=side*-.2;g.add(accent);
      const shoulderGold=mesh(new THREE.SphereGeometry(1,20,14),gold,side*.39,1.39,.06,.09,.035,.13);g.add(shoulderGold);
      const ear=mesh(new THREE.SphereGeometry(1,16,12),gold,side*.39,2.06,.05,.035,.055,.025);g.add(ear);
    }
    const pendant=mesh(new THREE.OctahedronGeometry(.075,1),gold,0,1.43,.245);g.add(pendant);
    const hairRibbon=mesh(new THREE.TorusGeometry(.13,.022,8,32),burgundy,.29,2.31,-.03);hairRibbon.rotation.z=.35;g.add(hairRibbon);
    // Soft collar, jacket seam and understated waist detail
    const collar=mesh(new THREE.TorusGeometry(.19,.026,10,48),trim,0,1.52,.04);collar.rotation.x=Math.PI/2;g.add(collar);
    const waist=mesh(new THREE.TorusGeometry(.31,.012,8,64),trim,0,.73,0);waist.rotation.x=Math.PI/2;g.add(waist);
    const halo=mesh(new THREE.TorusGeometry(.82,.009,8,100),new THREE.MeshBasicMaterial({color:0xb8a6df,transparent:true,opacity:.32}),0,.15,0);halo.rotation.x=Math.PI/2;g.add(halo);
    g.userData.preview=true;g.userData.style=style;g.userData.leftArm=leftArm;g.userData.rightArm=rightArm;g.userData.mouth=mouth;g.userData.eyeLids=eyeLids;
    return g;
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
    const animate=()=>{requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);state.frame+=dt;if(currentRoot?.userData.preview){const t=state.frame,gesture=Date.now()<gestureUntil?activeGesture:"idle";currentRoot.rotation.y=Math.sin(t*.22)*.045;const idle=Math.sin(t*1.35)*.035,talk=speaking?Math.sin(t*2.8)*.11:0;const l=currentRoot.userData.leftArm,r=currentRoot.userData.rightArm;if(l){l.rotation.z=gesture==="celebrate"?.82:gesture==="explain"?-.42:-.08+idle+talk*.35;l.rotation.x=gesture==="think"?-.45:Math.sin(t*.9)*.025;}if(r){r.rotation.z=gesture==="wave"?-.92:gesture==="celebrate"?-.82:gesture==="explain"?.42:.08-idle-talk*.55;r.rotation.x=gesture==="wave"?Math.sin(t*8)*.22:gesture==="think"?.35:Math.cos(t*1.1)*.03;}const mouth=currentRoot.userData.mouth;const mood=state.mood;if(mouth){const open=speaking?.018+Math.max(0,Math.sin(t*10))*.055:.018;mouth.scale.y=mood==="happy"?.026:open;mouth.scale.x=mood==="surprised"?.095:.075;}const blink=(Math.sin(t*.43)>0.997)?0.08:1;(currentRoot.userData.eyeLids||[]).forEach(eye=>{eye.scale.y=.105*blink;});if(mood==="happy"){currentRoot.rotation.z=Math.sin(t*.6)*.012;}else if(mood==="sad"){currentRoot.rotation.z=.018;}else if(mood==="surprised"){currentRoot.rotation.z=Math.sin(t*.8)*.008;}else{currentRoot.rotation.z=0;}}if(currentVrm){
      currentVrm.update(dt);
      const em=currentVrm.expressionManager;
      if(em){
        const pulse=speaking?Math.max(audioLevel,Math.max(0,Math.sin(state.frame*10))*.18):0;
        const visemes={aa:.12+.62*pulse,ih:.08+.24*Math.max(0,Math.sin(state.frame*10+1.2)),ou:.05+.2*Math.max(0,Math.sin(state.frame*10+2.4)),ee:.04+.18*Math.max(0,Math.sin(state.frame*10+3.1)),oh:.04+.2*Math.max(0,Math.sin(state.frame*10+4.2))};
        Object.entries(visemes).forEach(([name,value])=>{if(em.getExpression?.(name))em.setValue(name,speaking?value:0);});
        blinkTime+=dt;
        if(blinkTime>=nextBlink){blinkTime=0;nextBlink=2.1+Math.random()*3.8;}
        const blink=blinkTime<.13?Math.sin(Math.PI*blinkTime/.13):0;
        if(em.getExpression?.("blink"))em.setValue("blink",blink);
        ["happy","sad","angry","surprised","relaxed"].forEach(name=>{if(em.getExpression?.(name))em.setValue(name,state.mood===name?0.72:0);});
      }
      if(gestureBones){const motion=speaking?1:0.16,t=state.frame,wave=Math.sin(t*2.4)*motion,gesture=Date.now()<gestureUntil?activeGesture:"idle";
        for(const [bone,base,side] of [[gestureBones.right,gestureBones.rightBase,1],[gestureBones.left,gestureBones.leftBase,-1]]){
          if(!bone||!base)continue;
          bone.rotation.x=base.x+(gesture==="think"&&side<0?-.55:gesture==="celebrate"?-.7:gesture==="wave"&&side>0?-.85:wave*.13);
          bone.rotation.y=base.y+Math.cos(t*1.8)*motion*.09;
          bone.rotation.z=base.z+(gesture==="wave"&&side>0?-.9:gesture==="explain"?side*.35:gesture==="celebrate"?side*.7:side*(.10+Math.sin(t*1.7)*.07)*motion);
        }
      }
    }controls.update();renderer.render(scene,camera);};animate();
    currentRoot=null;
  }
  async function fitAndAdd(gltf,name,blob,save=true){
    if(currentRoot)scene.remove(currentRoot);currentVrm=gltf.userData.vrm||null;currentRoot=gltf.scene;gestureBones=null;if(currentVrm?.humanoid){const get=name=>currentVrm.humanoid.getNormalizedBoneNode(name),right=get("rightUpperArm"),left=get("leftUpperArm");gestureBones={right,left,rightBase:right?.rotation.clone(),leftBase:left?.rotation.clone()};}
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
  function commandGesture(text){
    const value=String(text||"").toLowerCase();
    activeGesture="idle";gestureUntil=Date.now()+2200;
    if(/\b(hello|hi|hey|welcome|good morning|good evening)\b/.test(value)){activeGesture="wave";state.mood="happy";}
    else if(/\b(explain|show|teach|demonstrate|present)\b/.test(value)){activeGesture="explain";state.mood="neutral";}
    else if(/\b(celebrate|congratulations|congrats|great job|well done|thank you|thanks)\b/.test(value)){activeGesture="celebrate";state.mood="happy";}
    else if(/\b(think|consider|reason|let me see|hmm)\b/.test(value)){activeGesture="think";state.mood="relaxed";}
    else if(/\b(sorry|sad|unhappy)\b/.test(value)){state.mood="sad";}
    else if(/\b(wow|surprise|amazing)\b/.test(value)){state.mood="surprised";}
  }
  window.COSMIC_AVATAR_COMMAND=commandGesture;
  function speak(text){const value=String(text||"").trim();if(!value)return;speaking=true;window.COSMIC_AVATAR_TALK?.(true);const native=window.Capacitor?.Plugins?.CosmicVoice;if(native?.speak){native.speak({text:value}).catch(e=>status("Voice error: "+e.message,"error")).finally(()=>{speaking=false;window.COSMIC_AVATAR_TALK?.(false);});setTimeout(()=>{speaking=false;window.COSMIC_AVATAR_TALK?.(false);},Math.max(1800,value.length*65));return;}if(window.speechSynthesis){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(value);utterance.onend=utterance.onerror=()=>{speaking=false;window.COSMIC_AVATAR_TALK?.(false);};speechSynthesis.speak(utterance);}else{speaking=false;window.COSMIC_AVATAR_TALK?.(false);status("Text-to-speech is unavailable.","error");}}
  function addConversationMessage(text,kind){
    const log=document.querySelector("#avatarConversationLog");if(!log)return;
    const item=document.createElement("div");item.className="avatar-conversation-message "+kind;item.textContent=String(text||"");log.append(item);log.scrollTop=log.scrollHeight;return item;
  }
  async function sendAvatarMessage(){
    const input=document.querySelector("#avatarConversationInput");const message=input?.value.trim();
    if(!message||conversationBusy)return;
    conversationBusy=true;conversationSession=localStorage.getItem("cosmic.chat.session.v1")||conversationSession;input.value="";addConversationMessage(message,"user");commandGesture(message);
    const waiting=addConversationMessage("COSMIC is thinking…","assistant");
    const send=document.querySelector("#avatarConversationSend"),mic=document.querySelector("#avatarConversationMic");
    if(send)send.disabled=true;if(mic)mic.disabled=true;
    try{
      if(window.COSMIC_LIVE?.active){
        if(!await window.COSMIC_LIVE.sendText(message,true))throw new Error("Gemini Live session is not ready.");
        waiting.remove();status("Gemini Live · message sent","success");return;
      }
      const response=await fetch(apiBase()+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message,provider:"auto",model:"auto",mode:"auto",task:"chat",session_id:conversationSession})});
      const data=await response.json();if(!response.ok||data.success===false)throw new Error(data.error||"HTTP "+response.status);
      const answer=data.message||data.response||data.text||"COSMIC returned an empty reply.";
      waiting.textContent=answer;speak(answer);
      status("Conversation connected · "+(data.provider||"AI provider"),"success");
    }catch(error){waiting.classList.add("error");waiting.textContent="API ERROR: "+error.message;status("Conversation failed: "+error.message,"error");}
    finally{conversationBusy=false;if(send)send.disabled=false;if(mic)mic.disabled=false;input?.focus();}
  }
  async function listenAvatarMessage(){
    const mic=document.querySelector("#avatarConversationMic");
    if(!window.COSMIC_LIVE?.toggle){status("Gemini Live voice controller is unavailable.","error");return;}
    try{await window.COSMIC_LIVE.toggle();if(mic)mic.textContent=window.COSMIC_LIVE.listening?"STOP LIVE":"🎙 SPEAK";}
    catch(error){status("Gemini Live: "+(error.message||error),"error");}
  }

  function markup(){return [
    '<div class="avatar-studio-v2">',
    '<header class="avatar-studio-head"><div><h2>COSMIC <span>AVATAR</span></h2><p>Your live AI companion</p></div><div class="avatar-head-actions"><span id="cosmicAvatarModelName">COSMIC 3D Preview</span><button class="avatar-settings-toggle" id="cosmicAvatarSettings" type="button" aria-label="Avatar settings">⚙</button></div></header>',
    '<section class="avatar-stage-v2"><canvas id="cosmicAvatarCanvas" aria-label="Interactive 3D avatar stage"></canvas><div class="avatar-stage-meta"><span>MYRAA · LIVE COMPANION</span><span id="cosmicAvatarStageState">STARTING 3D SCENE</span></div><div class="avatar-stage-actions"><button class="avatar-action" id="cosmicAvatarReset" type="button">RESET VIEW</button><button class="avatar-action" id="cosmicAvatarTurn" type="button">AUTO ROTATE</button><a class="avatar-action" id="cosmicAvatarDownload" hidden download="cosmic-avatar.glb">DOWNLOAD MODEL</a></div><div class="avatar-chat-dock"><div class="avatar-conversation-log avatar-conversation-log-stage" id="avatarConversationLog" aria-live="polite">MYRAA is ready. Talk or type to begin.</div><div class="avatar-chat-row"><textarea id="avatarConversationInput" rows="1" placeholder="Talk to MYRAA…"></textarea><button class="avatar-action" id="avatarConversationMic" type="button">🎙</button><button class="avatar-primary" id="avatarConversationSend" type="button">SEND</button></div></div></section>',
    '<aside class="avatar-panel"><h3>MYRAA · CHARACTER</h3><p>MYRAA is an original companion. The built-in model is a procedural preview; a rigged VRM/GLB supplies detailed production geometry and facial morphs.</p>',

    '<div class="avatar-divider"></div><h3>MYRAA · ORIGINAL CHARACTER</h3><p>Generate the custom blonde-haired, violet-eyed anime companion with a detailed ivory, black, burgundy and gold outfit. This creates a real 3D model and may use paid Tripo credits.</p><div class="avatar-preset-grid"><button type="button" data-avatar-preset="anime_heroine">GENERATE MYRAA · ORIGINAL 3D CHARACTER</button></div><div class="avatar-status" id="cosmicPresetStatus" role="status">MYRAA generation uses the anime heroine preset when the Tripo service is configured.</div>',
    '<div class="avatar-model-import"><button class="avatar-action" id="cosmicAvatarHumanCreator" type="button">OPEN FREE REAL-HUMAN 3D CREATOR</button><p class="avatar-help">Create and export a rigged human GLB with the free Ara 3D Gen tool, then import it here. Its generator and exported assets have separate licences; check the current terms before redistribution.</p><label class="avatar-action" for="cosmicAvatarModelFile">IMPORT GLB / VRM</label><input id="cosmicAvatarModelFile" type="file" accept=".glb,.gltf,.vrm,model/gltf-binary,model/gltf+json"></div>',
    '<div class="avatar-divider"></div><h3>CREATE YOUR 3D TWIN</h3><p>Use photos of the same person, in consistent light. Front is required; two or more views are needed, and four are recommended.</p>',
    '<div class="avatar-upload"><label>01 · FRONT<input type="file" id="avatarPhotoFront" accept="image/jpeg,image/png,image/webp" capture="user"></label><label>02 · LEFT<input type="file" id="avatarPhotoLeft" accept="image/jpeg,image/png,image/webp" capture="environment"></label><label>03 · BACK<input type="file" id="avatarPhotoBack" accept="image/jpeg,image/png,image/webp" capture="environment"></label><label>04 · RIGHT<input type="file" id="avatarPhotoRight" accept="image/jpeg,image/png,image/webp" capture="environment"></label></div>',
    '<label class="avatar-consent"><input type="checkbox" id="avatarPhotoConsent"><span>I have permission to use these photos and agree to send them to Tripo for cloud 3D generation. This may consume paid credits.</span></label>',
    '<button class="avatar-primary" id="avatarGenerate3D" type="button">CREATE DETAILED 3D AVATAR</button><div class="avatar-status" id="cosmicAvatarStatus" role="status">Checking 3D generation service…</div><button class="avatar-action" id="avatarRig3D" type="button" disabled>MAKE MODEL ANIMATABLE</button>',
    '<div class="avatar-divider"></div><h3>VOICE & EXPRESSION</h3><label class="avatar-help">LIVE MODEL<select id="cosmicAvatarLiveModel" class="avatar-setting-select"><option value="gemini-3.8-live">Gemini 3.8 Live</option><option value="gemini-3.8-live-extended-thinking">Gemini 3.8 Live · Extended Thinking</option></select></label><label class="avatar-help">SPEAKING VOICE<select id="cosmicAvatarVoice" class="avatar-setting-select"><option>Kore</option><option>Aoede</option><option>Puck</option><option>Charon</option><option>Fenrir</option><option>Leda</option><option>Orus</option><option>Zephyr</option></select></label><label class="avatar-help">EXPRESSION<select id="cosmicAvatarMood" class="avatar-setting-select"><option value="neutral">Neutral</option><option value="happy">Happy</option><option value="sad">Sad</option><option value="surprised">Surprised</option><option value="angry">Angry</option><option value="relaxed">Relaxed</option></select></label><textarea id="avatarSpeakText" rows="3" placeholder="Write what your character should say…" style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--c-line);background:#081522;color:#f4f8fc"></textarea><button class="avatar-primary" id="avatarSpeakButton" type="button" style="margin-top:8px">SPEAK AS CHARACTER</button><p class="avatar-help">VRM facial expressions are used when the model provides compatible expression morphs. Generic GLB models do not automatically gain realistic lip-sync.</p>',
    '<div class="avatar-divider"></div><h3>VOICE CONVERSATION</h3><p class="avatar-help">Use the microphone or message bar below MYRAA. It shares the Gemini Live session with Chat; no Android SpeechRecognizer or browser dictation fallback is used.</p>',
    '<div class="avatar-divider"></div><h3>BUILT-IN ANIME CHARACTERS</h3><div class="avatar-gallery" id="cosmicAvatarSamples"><button type="button" data-avatar-sample="A" data-url="https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_A.vrm">AVATAR SAMPLE A</button><button type="button" data-avatar-sample="B" data-url="https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_B.vrm">AVATAR SAMPLE B</button><button type="button" data-avatar-sample="C" data-url="https://cdn.jsdelivr.net/gh/madjin/vrm-samples@master/vroid/stable/AvatarSample_C.vrm">AVATAR SAMPLE C</button></div><p class="avatar-help">VRoid sample models A–C. Their use is governed by Pixiv/VRoid sample-model terms, not CC0. <a href="https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z" target="_blank" rel="noopener">View usage terms</a>.</p><div class="avatar-divider"></div><h3>MY CHARACTER LIBRARY</h3><div class="avatar-gallery" id="cosmicAvatarLibrary"></div><p class="avatar-help">Imported and generated model files are saved in local IndexedDB on this device.</p><div class="avatar-price-note">Photo-to-3D uses Tripo’s paid API. Add TRIPO_API_KEY to the backend environment. This repo does not bundle photorealistic/anime asset files.</div></aside></div>'
  ].join("");}
  async function loadFirstCharacter(){
    try{
      const db=await openDB();
      const items=await new Promise((resolve,reject)=>{const q=db.transaction("models","readonly").objectStore("models").getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});
      if(items.length){
        const myraa=items.find(x=>/myraa/i.test(x.name))||items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
        await loadBlob(myraa.blob,myraa.name,false);
        return;
      }
    }catch(error){console.warn("Could not restore saved avatar:",error);}
    const title=document.querySelector("#cosmicAvatarModelName");
    const stage=document.querySelector("#cosmicAvatarStageState");
    setPreview("anime");
    if(title)title.textContent="MYRAA · ORIGINAL 3D COMPANION";
    if(stage)stage.textContent="MYRAA · PROCEDURAL 3D PREVIEW";
    status("MYRAA preview loaded. Generate the detailed rigged heroine from the dedicated MYRAA preset when Tripo is configured.","info");
  }
  function buildUI(host){
    if(host.dataset.avatarV2==="1")return;host.dataset.avatarV2="1";host.innerHTML=markup();initScene($("#cosmicAvatarCanvas",host));
    const studio=host.querySelector(".avatar-studio-v2"),stage=host.querySelector(".avatar-stage-v2"),panel=host.querySelector(".avatar-panel");
    host.querySelector("#cosmicAvatarSettings")?.addEventListener("click",()=>studio.classList.toggle("settings-open"));
    const closeSettings=document.createElement("button");closeSettings.type="button";closeSettings.className="avatar-settings-close";closeSettings.textContent="CLOSE";closeSettings.onclick=()=>studio.classList.remove("settings-open");panel?.prepend(closeSettings);
    const dock=document.createElement("div");dock.className="avatar-chat-dock";dock.innerHTML='<div class="avatar-chat-log-slot"></div><div class="avatar-chat-row"></div>';
    const oldLog=panel?.querySelector("#avatarConversationLog"),oldInput=panel?.querySelector("#avatarConversationInput"),oldActions=panel?.querySelector(".avatar-conversation-actions");
    if(oldLog)dock.querySelector(".avatar-chat-log-slot").append(oldLog);if(oldInput)dock.querySelector(".avatar-chat-row").append(oldInput);if(oldActions)dock.querySelector(".avatar-chat-row").append(oldActions);stage?.append(dock);
    const lm=host.querySelector("#cosmicAvatarLiveModel"),lv=host.querySelector("#cosmicAvatarVoice"),mm=host.querySelector("#cosmicAvatarMood");
    if(lm){lm.value=localStorage.getItem("COSMIC_LIVE_MODEL")||"gemini-3.8-live";lm.onchange=()=>{localStorage.setItem("COSMIC_LIVE_MODEL",lm.value);const x=document.querySelector("#cosmicLiveModel");if(x){x.value=lm.value;x.dispatchEvent(new Event("change"));}};}
    if(lv){lv.value=localStorage.getItem("COSMIC_LIVE_VOICE")||"Kore";lv.onchange=()=>{localStorage.setItem("COSMIC_LIVE_VOICE",lv.value);localStorage.setItem("COSMIC_TTS_VOICE",lv.value);const x=document.querySelector("#cosmicLiveVoice");if(x){x.value=lv.value;x.dispatchEvent(new Event("change"));}};}
    if(mm)mm.onchange=()=>{state.mood=mm.value;status("MYRAA expression: "+mm.options[mm.selectedIndex].text,"success");};
    $("#cosmicAvatarModelFile",host).addEventListener("change",e=>{const f=e.target.files?.[0];if(f){currentTaskId="";$("#avatarRig3D",host).disabled=true;loadBlob(f,f.name);}});

    host.querySelectorAll("[data-avatar-preset]").forEach(b=>b.addEventListener("click",()=>generatePreset(b.dataset.avatarPreset,b)));
    host.querySelectorAll("[data-avatar-sample]").forEach(b=>b.onclick=async()=>{try{status("Loading "+b.dataset.avatarSample+" VRM model from the sample library…");await loadUrl(b.dataset.url,"VRoid Avatar Sample "+b.dataset.avatarSample);}catch(e){status("Could not load sample avatar: "+e.message,"error");}});
    $("#cosmicAvatarReset",host).onclick=()=>{camera.position.set(0,1.5,5.2);controls.target.set(0,1.2,0);controls.update();};
    $("#cosmicAvatarTurn",host).onclick=()=>{rotate=!rotate;controls.autoRotate=rotate;$("#cosmicAvatarTurn",host).textContent=rotate?"STOP ROTATION":"AUTO ROTATE";};
    $("#avatarSpeakButton",host).onclick=()=>speak($("#avatarSpeakText",host).value);
    $("#avatarConversationSend",host).onclick=sendAvatarMessage;
    $("#avatarConversationMic",host).onclick=()=>{if(window.COSMIC_LIVE)window.COSMIC_LIVE.toggle();else listenAvatarMessage();};
    $("#avatarConversationInput",host).addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAvatarMessage();}});
    $("#avatarGenerate3D",host).onclick=generatePhotos;$("#avatarRig3D",host).onclick=rigModel;
    refreshLibrary();checkProvider();loadFirstCharacter();
    $("#cosmicAvatarHumanCreator",host).onclick=()=>window.open("https://ara3dgen.com","_blank","noopener");
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
  async function checkProvider(){try{const r=await fetch(apiBase()+"/api/avatar/3d/status",{cache:"no-store"}),d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);status(d.configured?"Tripo is configured. Photo twin and character generation may use paid credits.":"3D viewer ready; cloud creation is not configured. Add TRIPO_API_KEY to the backend .env.","info");$("#avatarGenerate3D").disabled=!d.configured;document.querySelectorAll("[data-avatar-preset]").forEach(b=>b.disabled=!d.configured);}catch(e){status("3D service status unavailable: "+e.message,"error");document.querySelectorAll("[data-avatar-preset]").forEach(b=>b.disabled=true);}}
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
      if(["failed","cancelled","banned","expired"].includes(d.status))throw new Error(d.error||"Task "+d.status);
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
        body:JSON.stringify({task_id:currentTaskId,rig_type:result.rig_type||"biped",rig_model:"v3.0-20260909",spec:"vrm"})
      });
      const rigData=await rigResponse.json();
      if(!rigResponse.ok||!rigData.success)throw new Error(rigData.error||"Rig request failed");
      await pollTask(rigData.task_id,"rig");
    }catch(e){status("Rigging failed: "+e.message,"error");}
    finally{b.disabled=false;}
  }
  function mount(){const host=document.getElementById("cosmicAvatarMode");if(!host)return;const obs=new MutationObserver(()=>{if(host.dataset.ready==="1"&&host.dataset.avatarV2!=="1")buildUI(host);});obs.observe(host,{childList:true});if(host.dataset.ready==="1")buildUI(host);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
  window.COSMIC_AVATAR_TALK=on=>{speaking=!!on;if(!on)audioLevel=0;};
   window.COSMIC_AVATAR_AUDIO_LEVEL=value=>{audioLevel=Math.max(0,Math.min(1,Number(value)||0));};
})();