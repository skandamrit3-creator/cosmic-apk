const STORAGE_KEY="cosmic.foundation.state.v1";
const newSession=()=> "cosmic-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");}catch(_){return {};}}
const saved=load();
export const state={
 mode:"reactor",sessionId:saved.sessionId||newSession(),messages:Array.isArray(saved.messages)?saved.messages:[],
 provider:saved.provider||"auto",model:saved.model||"auto",routing:saved.routing||"auto",
 backendUrl:saved.backendUrl||"",connection:"checking",latency:null,telemetry:null,busy:false
};
const listeners=new Set();
export function update(patch){Object.assign(state,patch);try{localStorage.setItem(STORAGE_KEY,JSON.stringify({sessionId:state.sessionId,messages:state.messages,provider:state.provider,model:state.model,routing:state.routing,backendUrl:state.backendUrl}));}catch(_){};listeners.forEach(fn=>fn(state));}
export function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function newConversation(){update({sessionId:newSession(),messages:[],busy:false});}
