// Triage Copilot UI: chat + service list + per-service timeline. No framework, no build step.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const form = $("chat-form");
  const input = $("input");
  const sendBtn = $("send");
  const servicesEl = $("services");
  const timelineEl = $("timeline");
  const timelineTitle = $("timeline-title");

  let selected = null;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function sevBadge(sev) {
    return el("span", { class: `sev ${sev}` }, sev);
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    const m = el("div", { class: `msg ${role}` }, text);
    messagesEl.append(m);
    scrollToBottom();
    return m;
  }

  async function sendChat(message) {
    addMessage("user", message);
    const pending = addMessage("bot pending", "Thinking…");
    sendBtn.disabled = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      pending.classList.remove("pending");
      if (!res.ok) {
        pending.textContent = res.status === 429 ? "Slow down a little: rate limit hit, try again in a minute." : `Error: ${data.error || res.status}`;
        return;
      }
      pending.textContent = data.answer;
      const meta = el("div", { class: "meta" });
      if (data.services && data.services.length) {
        meta.append("Services: ", ...data.services.map((s) => el("span", { class: "tag" }, s)));
      }
      if (data.sources && data.sources.length) {
        meta.append(el("br"), "Sources: ", ...data.sources.map((s) => el("span", { class: "tag", title: s.id }, `${s.title} (${s.score.toFixed(2)})`)));
      }
      if (data.source === "fallback") {
        meta.append(el("br"), el("span", { class: "tag fallback" }, "AI unavailable: showing raw timeline"));
      }
      if (meta.childNodes.length) pending.append(meta);
      refreshServices();
    } catch (err) {
      pending.classList.remove("pending");
      pending.textContent = `Network error: ${err.message}`;
    } finally {
      sendBtn.disabled = false;
      scrollToBottom();
    }
  }

  async function refreshServices() {
    try {
      const res = await fetch("/api/services");
      const { services = [] } = await res.json();
      servicesEl.replaceChildren();
      if (!services.length) {
        servicesEl.append(el("li", { class: "empty" }, "No alerts received yet. Send one with scripts/send-alert.sh."));
        return;
      }
      for (const s of services) {
        const li = el(
          "li",
          { class: s.name === selected ? "active" : "", onclick: () => selectService(s.name), title: `last alert ${timeAgo(s.last_seen)}` },
          sevBadge(s.last_severity),
          el("span", { class: "name" }, s.name),
          el("span", { class: "count" }, `${s.alert_count} · ${timeAgo(s.last_seen)}`),
        );
        servicesEl.append(li);
      }
      if (!selected && services[0]) selectService(services[0].name);
      else if (selected) loadTimeline(selected);
    } catch {
      servicesEl.replaceChildren(el("li", { class: "empty" }, "Could not load services."));
    }
  }

  function selectService(name) {
    selected = name;
    for (const li of servicesEl.children) {
      li.classList.toggle("active", li.querySelector(".name")?.textContent === name);
    }
    loadTimeline(name);
  }

  async function loadTimeline(name) {
    timelineTitle.textContent = `Timeline · ${name}`;
    try {
      const res = await fetch(`/api/services/${encodeURIComponent(name)}/timeline?limit=30`);
      if (!res.ok) throw new Error(String(res.status));
      const { entries = [] } = await res.json();
      timelineEl.replaceChildren();
      if (!entries.length) {
        timelineEl.append(el("div", { class: "empty" }, "No entries yet."));
        return;
      }
      for (const e of entries) {
        timelineEl.append(
          el(
            "div",
            { class: "entry" },
            el(
              "div",
              { class: "top" },
              sevBadge(e.severity),
              el("span", { class: "alertname" }, e.alertname),
              e.status === "resolved" ? el("span", { class: "status-resolved" }, "resolved") : null,
              el("span", { class: "when", title: new Date(e.ts).toISOString() }, timeAgo(e.ts)),
            ),
            el("p", {}, e.summary),
            el("p", {}, el("span", { class: "label" }, "Impact: "), e.user_impact),
            el("p", {}, el("span", { class: "label" }, "Cause: "), e.likely_cause),
            el("p", {}, el("span", { class: "label" }, "Action: "), e.suggested_action),
            el("p", { class: "label" }, `${e.source} · confidence ${Math.round(e.confidence * 100)}%`),
          ),
        );
      }
    } catch {
      timelineEl.replaceChildren(el("div", { class: "empty" }, "Could not load timeline."));
    }
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const message = input.value.trim();
    if (!message || sendBtn.disabled) return;
    input.value = "";
    input.style.height = "";
    sendChat(message);
  });

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  $("suggestions").addEventListener("click", (ev) => {
    if (ev.target instanceof HTMLButtonElement && !sendBtn.disabled) sendChat(ev.target.textContent);
  });

  $("refresh").addEventListener("click", refreshServices);

  refreshServices();
  setInterval(refreshServices, 30000);
})();
