"use strict";

const $ = selector => document.querySelector(selector);

const state = {
  busy:false,
  history:[],
  session:localStorage.getItem("cosmic_session") || crypto.randomUUID()
};

localStorage.setItem("cosmic_session",state.session);

async function request(url,options={}) {
  const response = await fetch(url,{
    ...options,
    headers:{
      "Content-Type":"application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(()=>({}));

  if(!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

function notify(message) {
  const toast=$("#toast");
  toast.textContent=message;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),2500);
}

function addMessage(role,text) {
  $("#welcome").style.display="none";

  const article=document.createElement("article");
  article.className="message "+role;

  const icon=document.createElement("div");
  icon.className="message-icon";
  icon.textContent=role==="user"?"Y":"C";

  const body=document.createElement("div");
  const name=document.createElement("div");
  name.className="message-name";
  name.textContent=role==="user"?"YOU":"COSMIC";

  const content=document.createElement("div");
  content.className="message-content";
  content.textContent=text;

  body.append(name,content);
  article.append(icon,body);
  $("#messages").append(article);

  $("#chatArea").scrollTop=$("#chatArea").scrollHeight;

  return content;
}

async function sendMessage(text) {
  if(state.busy || !text.trim()) return;

  state.busy=true;
  $("#sendButton").disabled=true;

  addMessage("user",text);
  state.history.push({role:"user",content:text});

  const responseBox=addMessage("assistant","COSMIC is processing your request...");

  try {
    const result=await request("/api/chat",{
      method:"POST",
      body:JSON.stringify({
        message:text,
        provider:$("#provider").value,
        session_id:state.session
      })
    });

    const answer=result.message ??
                  result.response ??
                  result.reply ??
                  result.content;

    if(typeof answer==="string" && answer.length) {
      responseBox.textContent=answer;
      state.history.push({role:"assistant",content:answer});
    } else {
      responseBox.textContent="The backend returned no readable answer. Check its response format.";
    }

  } catch(error) {
    responseBox.textContent="Request failed: "+error.message;
    responseBox.closest(".message").classList.add("error");
  } finally {
    state.busy=false;
    $("#sendButton").disabled=false;
    $("#messageInput").focus();
  }
}

$("#chatForm").addEventListener("submit",event=>{
  event.preventDefault();

  const input=$("#messageInput");
  const text=input.value.trim();

  if(!text) return;

  input.value="";
  input.style.height="auto";

  sendMessage(text);
});

$("#messageInput").addEventListener("input",event=>{
  event.target.style.height="auto";
  event.target.style.height=Math.min(event.target.scrollHeight,180)+"px";
});

$("#messageInput").addEventListener("keydown",event=>{
  if(event.key==="Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chatForm").requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach(button=>{
  button.addEventListener("click",()=>{
    $("#messageInput").value=button.dataset.prompt;
    $("#messageInput").focus();
  });
});

$("#newChat").addEventListener("click",()=>{
  state.session=crypto.randomUUID();
  localStorage.setItem("cosmic_session",state.session);
  state.history=[];
  $("#messages").replaceChildren();
  $("#welcome").style.display="block";
  $("#sidebar").classList.remove("open");
});

function navigate(page) {
  document.querySelectorAll(".page").forEach(section=>{
    section.classList.toggle("active",section.id==="page-"+page);
  });

  document.querySelectorAll(".nav").forEach(button=>{
    button.classList.toggle("active",button.dataset.page===page);
  });

  const names={
    chat:"Chat",
    activity:"Activity",
    models:"AI Models",
    settings:"Settings"
  };

  $("#pageHeading").textContent=names[page] || "COSMIC";
  $("#sidebar").classList.remove("open");

  if(page==="activity") loadActivity();
}

document.querySelectorAll(".nav").forEach(button=>{
  button.addEventListener("click",()=>navigate(button.dataset.page));
});

$("#menuButton").addEventListener("click",()=>{
  $("#sidebar").classList.toggle("open");
});

function loadActivity() {
  const list=$("#activityList");
  list.replaceChildren();

  if(!state.history.length) {
    list.textContent="No messages in this conversation yet.";
    return;
  }

  state.history.forEach(item=>{
    const row=document.createElement("p");
    row.textContent=(item.role==="user"?"You: ":"COSMIC: ")+item.content;
    list.append(row);
  });
}

async function checkBackend() {
  const dot=$("#statusDot");
  const status=$("#backendStatus");
  const label=$("#onlineLabel");
  const settings=$("#settingsBackend");

  try {
    const result=await request("/api/health");

    dot.className="online";
    status.textContent="Backend online";
    label.textContent="Online";
    settings.textContent=JSON.stringify(result,null,2);

  } catch(error) {
    dot.className="offline";
    status.textContent="Backend unavailable";
    label.textContent="Offline";
    settings.textContent=error.message;
  }
}

$("#checkBackend").addEventListener("click",checkBackend);

$("#modelPreference").addEventListener("change",event=>{
  $("#provider").value=event.target.value;
  notify("Provider selection updated for this session.");
});

$("#provider").addEventListener("change",event=>{
  $("#modelPreference").value=event.target.value;
});

$("#voiceButton").addEventListener("click",()=>{
  const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;

  if(!SpeechRecognition) {
    notify("Speech recognition is not supported by this browser.");
    return;
  }

  const recognition=new SpeechRecognition();
  recognition.lang="en-IN";
  recognition.interimResults=false;

  recognition.onresult=event=>{
    $("#messageInput").value=event.results[0][0].transcript;
    $("#messageInput").focus();
  };

  recognition.onerror=event=>{
    notify("Microphone error: "+event.error);
  };

  recognition.start();
});

checkBackend();
setInterval(checkBackend,20000);
