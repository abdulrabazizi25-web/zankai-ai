const list = document.getElementById("list");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");
const form = document.getElementById("chatForm");
const historyBtn = document.getElementById("historyBtn");
const drawer = document.getElementById("drawer");
const backdrop = document.getElementById("backdrop");
const closeDrawer = document.getElementById("closeDrawer");
const drawerNewBtn = document.getElementById("drawerNewBtn");
const sessionList = document.getElementById("sessionList");

const SESSIONS_KEY = "zankai-ai-sessions-v1";
const LEGACY_KEY = "zankai-ai-history-v1";

let sessions = [];
let currentSessionId = null;
let busy = false;

function loadSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    if (Array.isArray(raw)) {
      sessions = raw.filter(s => s && typeof s.id === "string" && Array.isArray(s.messages));
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    if (Array.isArray(legacy) && legacy.length > 0 && sessions.length === 0) {
      const validLegacy = legacy.filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string");
      if (validLegacy.length > 0) {
        const firstUser = validLegacy.find(m => m.role === "user");
        sessions.push({
          id: "chat-" + Date.now(),
          title: firstUser ? firstUser.content.slice(0, 36) : "Purani Chat",
          updatedAt: Date.now(),
          messages: validLegacy
        });
        localStorage.removeItem(LEGACY_KEY);
        saveSessions();
      }
    }
  } catch {
    sessions = [];
  }
}

function saveSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch { /* Local storage may be unavailable */ }
}

function getCurrentSession() {
  return sessions.find(s => s.id === currentSessionId) || null;
}

function showEmpty() {
  list.replaceChildren();
  const d = document.createElement("div");
  d.className = "empty";
  const mark = document.createElement("div");
  mark.className = "welcome-mark";
  mark.textContent = "Z";
  const b = document.createElement("b");
  b.textContent = "Welcome to ZANKAI AI";
  const p = document.createElement("div");
  p.className = "intro";
  p.textContent = "Your smart AI assistant, ready to help.";
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Apna sawaal neeche likhein aur shuru karein.";
  d.append(mark, b, p, hint);
  list.append(d);
}

function add(role, text, extraClass = "") {
  const empty = list.querySelector(".empty");
  if (empty) empty.remove();
  const d = document.createElement("div");
  d.className = `msg ${role} ${extraClass}`.trim();
  d.textContent = text;
  list.append(d);
  list.scrollTop = list.scrollHeight;
  return d;
}

function addError(text) {
  const d = document.createElement("div");
  d.className = "err";
  d.textContent = text;
  list.append(d);
  list.scrollTop = list.scrollHeight;
}

function renderHistory() {
  list.replaceChildren();
  const session = getCurrentSession();
  if (!session || !session.messages.length) return showEmpty();
  for (const m of session.messages) {
    add(m.role === "user" ? "me" : "bot", m.content);
  }
}

function renderSessionsList() {
  sessionList.replaceChildren();
  const sorted = [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "no-sessions";
    empty.textContent = "Abhi koi saved chat nahi hai.";
    sessionList.append(empty);
    return;
  }

  for (const s of sorted) {
    const item = document.createElement("div");
    item.className = "session-item" + (s.id === currentSessionId ? " active" : "");

    const info = document.createElement("div");
    info.className = "session-info";

    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = s.title || "Nayi Chat";

    const meta = document.createElement("div");
    meta.className = "session-meta";
    const count = s.messages.length;
    meta.textContent = `${count} message${count === 1 ? "" : "s"}`;

    info.append(title, meta);
    info.addEventListener("click", () => {
      if (busy) return;
      currentSessionId = s.id;
      renderHistory();
      renderSessionsList();
      toggleDrawer(false);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "session-del";
    delBtn.type = "button";
    delBtn.title = "Delete chat";
    delBtn.setAttribute("aria-label", "Delete chat");
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (busy) return;
      sessions = sessions.filter(x => x.id !== s.id);
      saveSessions();
      if (currentSessionId === s.id) {
        currentSessionId = sessions.length ? sessions[0].id : null;
        renderHistory();
      }
      renderSessionsList();
    });

    item.append(info, delBtn);
    sessionList.append(item);
  }
}

function toggleDrawer(open) {
  if (open) {
    renderSessionsList();
    drawer.classList.add("open");
    backdrop.classList.add("open");
  } else {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
  }
}

function startNewChat() {
  if (busy) return;
  currentSessionId = null;
  renderHistory();
  renderSessionsList();
  toggleDrawer(false);
  input.focus();
}

async function send() {
  const text = input.value.trim();
  if (!text || busy) return;

  busy = true;
  sendBtn.disabled = true;
  input.value = "";
  input.style.height = "auto";

  let session = getCurrentSession();
  if (!session) {
    session = {
      id: "chat-" + Date.now(),
      title: text.slice(0, 40) + (text.length > 40 ? "…" : ""),
      updatedAt: Date.now(),
      messages: []
    };
    sessions.unshift(session);
    currentSessionId = session.id;
  }

  session.messages.push({ role: "user", content: text });
  session.messages = session.messages.slice(-30);
  session.updatedAt = Date.now();
  add("me", text);
  saveSessions();

  const bubble = add("bot", "ZANKAI AI soch raha hai…", "typing");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: session.messages })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    if (typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error("AI ka jawab nahi mila. Dobara koshish karein.");
    }
    bubble.classList.remove("typing");
    bubble.textContent = data.reply;
    session.messages.push({ role: "assistant", content: data.reply });
    session.messages = session.messages.slice(-30);
    session.updatedAt = Date.now();
    saveSessions();
  } catch (error) {
    bubble.remove();
    session.messages.pop();
    if (session.messages.length === 0) {
      sessions = sessions.filter(s => s.id !== session.id);
      currentSessionId = null;
    }
    saveSessions();
    addError(error.message || "Kuch gadbad ho gayi. Dobara try karein.");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  send();
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

clearBtn.addEventListener("click", startNewChat);
drawerNewBtn.addEventListener("click", startNewChat);
historyBtn.addEventListener("click", () => toggleDrawer(true));
closeDrawer.addEventListener("click", () => toggleDrawer(false));
backdrop.addEventListener("click", () => toggleDrawer(false));

loadSessions();
if (sessions.length > 0) {
  sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  currentSessionId = sessions[0].id;
}
renderHistory();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
