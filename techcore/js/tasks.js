// TechTasks: task records ("techcore.tasks.v1") and the TECHCORE -> PanelLab handoff.
// Records live only in this browser's localStorage (not a server). panellab.v1 is never written from here.
// Status uses the workflow vocabulary; nothing here means "verified" - COMPLETED is only set by an explicit user action.
const TechTasks = (() => {
  const KEY = "techcore.tasks.v1", MAX = 200;
  const STATUS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "UNVERIFIED", "FAILED", "NOT_CONNECTED"];
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  let lastError = "", ready = false, pending = null, pendingOpen = null, lastOpenFailed = false, listeners = [];

  const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function clean(t) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !ID.test(t.id)) return null;
    return {
      id: t.id, createdAt: clip(t.createdAt, 40), updatedAt: clip(t.updatedAt, 40),
      request: clip(t.request, 1000), summary: clip(t.summary, 4000),
      field: t.field === "plc-hmi" ? "plc-hmi" : "other", fieldBasis: t.fieldBasis === "user" ? "user" : "keyword-estimate",
      status: STATUS.includes(t.status) ? t.status : "UNVERIFIED",
      panelProjectId: typeof t.panelProjectId === "string" && ID.test(t.panelProjectId) ? t.panelProjectId : null,
      handoffAt: t.handoffAt ? clip(t.handoffAt, 40) : null,
    };
  }

  // A damaged value is copied aside (never deleted) and writing is blocked until it is handled.
  function read() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { lastError = "storage"; return { tasks: [], blocked: true }; }
    if (!raw) return { tasks: [], blocked: false };
    try {
      const d = JSON.parse(raw);
      if (!d || d.v !== 1 || !Array.isArray(d.tasks)) throw new Error("shape");
      return { tasks: d.tasks.map(clean).filter(Boolean), blocked: false };
    } catch (e) {
      try { if (!localStorage.getItem(KEY + ".corrupt")) localStorage.setItem(KEY + ".corrupt", raw); } catch (e2) { /* keep original in place */ }
      lastError = "corrupt";
      return { tasks: [], blocked: true };
    }
  }

  function write(tasks) {
    try {
      const s = JSON.stringify({ v: 1, tasks: tasks.slice(0, MAX) });
      localStorage.setItem(KEY, s);
      if (localStorage.getItem(KEY) !== s) throw new Error("verify");
      lastError = ""; return true;
    } catch (e) { lastError = "write"; return false; }
  }

  const list = () => read().tasks.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const get = (id) => read().tasks.find((t) => t.id === id) || null;

  function create(o) {
    const r = read(); if (r.blocked) return null;
    const now = new Date().toISOString();
    const t = clean({ id: uid(), createdAt: now, updatedAt: now, request: o.request, summary: o.summary, field: o.field, fieldBasis: o.fieldBasis, status: "NOT_STARTED" });
    return write([t].concat(r.tasks)) ? t : null;
  }

  function update(id, patch) {
    const r = read(); if (r.blocked) return null;
    const i = r.tasks.findIndex((t) => t.id === id); if (i < 0) return null;
    const t = clean(Object.assign({}, r.tasks[i], patch, { id, updatedAt: new Date().toISOString() }));
    r.tasks[i] = t;
    return write(r.tasks) ? t : null;
  }

  const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { /* ignore listener errors */ } });
  const frame = () => { const f = document.querySelector("#tcFrameHost iframe"); return f && f.contentWindow ? f : null; };
  const send = (m) => { const f = frame(); if (f) f.contentWindow.postMessage(m, location.origin); return !!f; };

  // Messages are accepted only from the PanelLab iframe of this page (same origin) and only in the exact shapes below.
  window.addEventListener("message", (e) => {
    const f = frame();
    if (!f || e.source !== f.contentWindow || e.origin !== location.origin) return;
    const d = e.data; if (!d || typeof d !== "object") return;
    if (d.type === "panellab.ready.v1") {
      ready = true;
      if (pending) send({ type: "techcore.handoff.v1", taskId: pending.id, text: pending.text });
      if (pendingOpen) send({ type: "techcore.openProject.v1", projectId: pendingOpen });
    } else if (d.type === "panellab.openProject.result.v1") { pendingOpen = null; if (d.ok !== true) { lastOpenFailed = true; emit(); } }
    else if (d.type === "panellab.handoff.ack.v1" && pending && d.taskId === pending.id) {
      update(pending.id, { handoffAt: new Date().toISOString(), status: "IN_PROGRESS" }); pending = null; emit();
    } else if (d.type === "panellab.link.v1" && typeof d.taskId === "string" && ID.test(d.taskId) && typeof d.projectId === "string" && ID.test(d.projectId)) {
      if (get(d.taskId)) { update(d.taskId, { panelProjectId: d.projectId }); emit(); }
    }
  });

  // Called after the user pressed the explicit button. The frame is created by the PanelLab route; this only delivers.
  function handoff(id, text) {
    const t = get(id); if (!t) return false;
    pending = { id, text: clip(text, 4000) };
    if (!frame()) ready = false;
    if (ready) send({ type: "techcore.handoff.v1", taskId: id,     text: pending.text });
    return true;
  }
  const openProject = (projectId) => {
    if (!ID.test(String(projectId))) return false;
    pendingOpen = projectId;
    if (!frame()) ready = false;
    if (ready) send({ type: "techcore.openProject.v1", projectId });
    return true;
  };
  const onChange = (f) => { listeners.push(f); };
  const resetReady = () => { ready = false; };
  const openFailed = () => { const f = lastOpenFailed; lastOpenFailed = false; return f; };

  return { STATUS, list, get, create, update, handoff, openProject, openFailed, onChange, resetReady, error: () => lastError, isBlocked: () => read().blocked };
})();
window.TechTasks = TechTasks;
