(()=>{"use strict";if(window.COSMIC_MYRAA_EXPRESSIONS)return;
let last=0;const phrases={happy:/\b(thank|great|awesome|wonderful|glad|excellent|congrat|love)\b/i,thinking:/\b(think|consider|reason|perhaps|maybe|let me|analyz|calculate)\b/i,explain:/\b(explain|because|first|second|step|therefore|means|example)\b/i,question:/\?|\b(what|why|how|when|where|who)\b/i};
function act(a){window.COSMIC_2D?.action?.(a);document.dispatchEvent(new CustomEvent("cosmic:avatar-action",{detail:{action:a}}))}
function onText(e){const s=String(e.detail?.text||"");if(!s||Date.now()-last<1800)return;last=Date.now();let a="explain";if(phrases.happy.test(s))a="laugh";else if(phrases.thinking.test(s))a="thinking";else if(phrases.question.test(s))a="nod";act(a)}
document.addEventListener("cosmic:live-output",onText);document.addEventListener("cosmic:live-text",onText);
document.addEventListener("cosmic:live-input",()=>act("nod"));
document.addEventListener("cosmic:live-ended",()=>act("idle"));
window.COSMIC_MYRAA_EXPRESSIONS={trigger:act};
})();
