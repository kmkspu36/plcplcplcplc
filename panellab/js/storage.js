// Local project/history storage. Never stores tokens or connection secrets.
const PanelStore = (() => {
  const KEY = "panellab.v1";
  let data = load();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.projects)) return d;
    } catch {}
    preserveCorrupt();
    return { projects: [], currentId: null };
  }
  // If stored data exists but cannot be used, keep the raw text under a separate key before it can be overwritten.
  function preserveCorrupt() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return;
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.projects)) return;
    } catch {
      /* unparsable: fall through and preserve */
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (raw !== null) localStorage.setItem(KEY + ".corrupt-" + Date.now(), raw);
    } catch {}
  }
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const finite = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  // Coerce geometry fields of imported HMI data to numbers; they are later placed into SVG markup.
  // Saved versions hold copies of screens and are restored into the editor, so they get the same treatment.
  function sanitizeHmi(hmi) {
    if (!hmi || !Array.isArray(hmi.screens)) return;
    sanitizeScreens(hmi.screens);
    if (Array.isArray(hmi.versions)) {
      hmi.versions = hmi.versions.filter((v) => v && typeof v === "object" && Array.isArray(v.screens));
      hmi.versions.forEach((v) => { v.id = typeof v.id === "string" && SAFE_ID.test(v.id) ? v.id : uid(); v.name = String(v.name == null ? "" : v.name).slice(0, 30); v.at = finite(Number(v.at), 0); sanitizeScreens(v.screens); });
    }
  }
  function sanitizeScreens(screens) {
    for (let i = screens.length - 1; i >= 0; i--) if (!screens[i] || typeof screens[i] !== "object") screens.splice(i, 1);
    screens.forEach((s) => {
      s.w = finite(Number(s.w), 800);
      s.h = finite(Number(s.h), 480);
      s.name = String(s.name == null ? "" : s.name).slice(0, 40);
      if (!Array.isArray(s.objects)) { s.objects = []; return; }
      s.objects = s.objects.filter((o) => o && typeof o === "object");
      s.objects.forEach((o) => {
        o.x = finite(Number(o.x), 0); o.y = finite(Number(o.y), 0);
        o.w = finite(Number(o.w), 80); o.h = finite(Number(o.h), 40);
        o.type = String(o.type == null ? "" : o.type);
        if (!o.props || typeof o.props !== "object" || Array.isArray(o.props)) o.props = {};
      });
    });
  }
  // ---- external-change guard (round 1, fix A) ----
  // lastRaw: the exact text of "panellab.v1" this tab last read or wrote. base: project id -> updated at that moment.
  // If storage differs from lastRaw at save time, another writer (TECHCORE trash/restore, another tab) changed it.
  let lastRaw = readRaw();
  let base = snap(data);
  let lastSaveError = null;
  const listeners = [];
  function readRaw() { try { return localStorage.getItem(KEY); } catch { return null; } }
  function snap(d) { const m = {}; d.projects.forEach((p) => { if (p && p.id != null) m[p.id] = p.updated || 0; }); return m; }
  function notify(type, message) { setTimeout(() => listeners.slice().forEach((fn) => { try { fn({ type, message }); } catch {} }), 0); }
  function parseExternal(raw) {
    if (raw === null) return { projects: [], currentId: null };
    try { const d = JSON.parse(raw); if (d && Array.isArray(d.projects)) return cleanLoaded(d); } catch {}
    return null;
  }
  // Merge rule: union by project id; for the same id the larger "updated" wins (ties go to the external copy).
  // Deletions are honored only when the other side did not change that project after the last sync.
  // Returns null when the stored text is unusable, so the caller refuses to overwrite it.
  function mergeExternal(raw) {
    const ext = parseExternal(raw);
    if (!ext) return null;
    const local = new Map(data.projects.map((p) => [p.id, p]));
    const out = [];
    const seenIds = new Set();
    ext.projects.forEach((e) => {
      if (!e || e.id == null || seenIds.has(e.id)) return;
      seenIds.add(e.id);
      const l = local.get(e.id);
      if (!l) {
        const deletedLocally = Object.prototype.hasOwnProperty.call(base, e.id) && (e.updated || 0) === base[e.id];
        if (!deletedLocally) out.push(e);
      } else out.push((l.updated || 0) > (e.updated || 0) ? l : e);
    });
    data.projects.forEach((l) => {
      if (seenIds.has(l.id)) return;
      const deletedExternally = Object.prototype.hasOwnProperty.call(base, l.id) && (l.updated || 0) === base[l.id];
      if (!deletedExternally) out.push(l);
    });
    const ids = new Set(out.map((p) => p.id));
    const currentId = ids.has(data.currentId) ? data.currentId : ids.has(ext.currentId) ? ext.currentId : out[0] ? out[0].id : null;
    return Object.assign({}, ext, { projects: out, currentId });
  }
  function save() {
    lastSaveError = null;
    let merged = false;
    try {
      const cur = readRaw();
      if (cur !== lastRaw) {
        const m = mergeExternal(cur);
        if (!m) {
          lastSaveError = "conflict";
          notify("blocked", "다른 곳에서 저장된 데이터를 읽을 수 없어 저장하지 않았습니다. 기존 저장 데이터는 그대로 두었습니다. 백업을 내려받은 뒤 새로고침해 주세요.");
          return false;
        }
        data = m; merged = true;
      }
      const text = JSON.stringify(data);
      localStorage.setItem(KEY, text);
      lastRaw = text; base = snap(data);
      if (merged) notify("merged", "다른 화면에서 바뀐 프로젝트와 합쳐서 저장했습니다.");
      return true;
    } catch {
      lastSaveError = "quota";
      notify("savefail", "브라우저 저장 공간이 부족하거나 저장이 막혀 변경 내용을 저장하지 못했습니다. 지금 백업(내보내기)을 받아 두세요. 새로고침하면 마지막으로 저장된 상태로 돌아갑니다.");
      return false;
    }
  }
  // Another document changed the key: re-read it. On failure keep the in-memory data and tell the user.
  function reloadExternal() {
    const raw = readRaw();
    if (raw === lastRaw) return;
    const m = mergeExternal(raw);
    if (!m) { notify("corrupt", "저장된 프로젝트 데이터를 읽지 못해 현재 화면의 데이터를 유지합니다. 지금 백업을 내려받아 주세요."); return; }
    data = m; lastRaw = raw; base = snap(parseExternal(raw));
    notify("reloaded", "다른 화면에서 프로젝트가 바뀌어 목록을 새로 불러왔습니다.");
  }
  window.addEventListener("storage", (e) => { if (e.key === KEY) reloadExternal(); });
  // Same-tab writers (TECHCORE in the parent window) do not fire "storage"; callers may invoke this directly.
  function refresh() { reloadExternal(); }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // Data already stored (older imports, other tabs) gets the same HMI cleanup; only in-memory values change here.
  const cleanLoaded = (d) => { d.projects.forEach((p) => { if (p && typeof p === "object" && p.hmi) sanitizeHmi(p.hmi); }); return d; };
  cleanLoaded(data);
  // Import validation: keep only well-formed list entries and bounded strings. Unknown extra fields are left as they are.
  const objs = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : []);
  const str = (v, n, d) => (typeof v === "string" ? v.slice(0, n) : d);
  function checkProject(obj) {
    if (!obj || typeof obj !== "object" || typeof obj.name !== "string" || !Array.isArray(obj.messages)) return null;
    const p = Object.assign({}, obj);
    p.name = str(obj.name, 100, "").trim() || "가져온 프로젝트";
    p.software = str(obj.software, 40, "GX Works2");
    p.created = finite(Number(obj.created), Date.now());
    p.updated = finite(Number(obj.updated), Date.now());
    p.messages = objs(obj.messages);
    p.results = objs(obj.results);
    ["fixHistory", "codeVersions", "labels"].forEach((k) => { if (k in p) { if (Array.isArray(p[k])) p[k] = objs(p[k]); else delete p[k]; } });
    ["currentCode", "cpu"].forEach((k) => { if (k in p && typeof p[k] !== "string") delete p[k]; });
    if ("hmi" in p) { if (p.hmi && typeof p.hmi === "object" && Array.isArray(p.hmi.screens)) sanitizeHmi(p.hmi); else delete p.hmi; }
    return p;
  }

  function createProject(name, software) {
    const p = { id: uid(), name: name.trim() || "새 프로젝트", software: software || "GX Works2", created: Date.now(), updated: Date.now(), messages: [], results: [] };
    const prevId = data.currentId;
    data.projects.unshift(p);
    data.currentId = p.id;
    if (!save()) { data.projects = data.projects.filter((x) => x !== p); data.currentId = prevId; throw new Error(saveReason() + " 새 프로젝트를 만들지 못했습니다."); }
    return p;
  }
  const current = () => data.projects.find((p) => p.id === data.currentId) || null;
  function setCurrent(id) { if (data.projects.some((p) => p.id === id)) { data.currentId = id; save(); } }
  function touch(p) { p.updated = Date.now(); return save(); }
  // Moves a project to the trash instead of deleting it outright. Returns { ok, reason? }.
  // Embedded in TECHCORE: delegates to window.parent.TechProjects.moveToTrash. Standalone: writes the trash copy itself first.
  // TRASH SCHEMA: keep identical to techcore/js/projects.js (동일 스키마 유지): key "techcore.trash.v1" = { version:1, items:[{ trashId, id, name, deletedAt, expiresAt (+30 days), wasCurrent, snapshot }] }.
  const TRASH_KEY = "techcore.trash.v1";
  const RETENTION_MS = 30 * 24 * 3600 * 1000;
  function embeddedTech() {
    try {
      if (window.parent !== window && window.parent.TechProjects && typeof window.parent.TechProjects.moveToTrash === "function") return window.parent.TechProjects;
    } catch {}
    return null;
  }
  function adopt(raw) { const d = parseExternal(raw); if (d) { data = d; lastRaw = raw; base = snap(d); } return !!d; }
  function writeVerified(key, text) {
    let prev = null;
    try {
      prev = localStorage.getItem(key);
      localStorage.setItem(key, text);
      if (localStorage.getItem(key) !== text) throw new Error("verify");
      return { ok: true };
    } catch (e) {
      try { if (prev === null) localStorage.removeItem(key); else localStorage.setItem(key, prev); } catch {}
      return { ok: false, reason: e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) ? "quota" : "error" };
    }
  }
  function deleteProject(id) {
    reloadExternal();
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx < 0) return { ok: false, reason: "notfound" };
    const tp = embeddedTech();
    if (tp) {
      const r = tp.moveToTrash(id);
      if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || "error" };
      adopt(readRaw());
      return { ok: true, via: "techcore" };
    }
    let trash;
    try {
      const raw = localStorage.getItem(TRASH_KEY);
      trash = raw === null ? { version: 1, items: [] } : JSON.parse(raw);
      if (!trash || !Array.isArray(trash.items)) throw new Error("shape");
    } catch { return { ok: false, reason: "trash-corrupt" }; }
    const proj = data.projects[idx], now = Date.now();
    const item = { trashId: uid(), id: proj.id, name: String(proj.name || ""), deletedAt: now, expiresAt: now + RETENTION_MS, wasCurrent: data.currentId === proj.id, snapshot: proj };
    const prevTrash = JSON.stringify(trash);
    trash.items.push(item);
    const w = writeVerified(TRASH_KEY, JSON.stringify(trash));
    if (!w.ok) return { ok: false, reason: w.reason, stage: "trash" };
    const keep = data;
    data = Object.assign({}, data, { projects: data.projects.filter((_, i) => i !== idx) });
    if (data.currentId === id) data.currentId = data.projects[0] ? data.projects[0].id : null;
    if (!save()) {
      data = keep;
      writeVerified(TRASH_KEY, prevTrash);
      return { ok: false, reason: lastSaveError || "error", stage: "panellab" };
    }
    return { ok: true, via: "local" };
  }
  function renameProject(id, name) {
    const p = data.projects.find((x) => x.id === id);
    if (p && name.trim()) { p.name = name.trim(); touch(p); }
  }
  // Permanently removes every project (the trash is not touched). Callers must have made a backup first. Returns true/false.
  function clearAll() {
    reloadExternal();
    const empty = { projects: [], currentId: null };
    const text = JSON.stringify(empty);
    const w = writeVerified(KEY, text);
    if (!w.ok) { lastSaveError = w.reason; return false; }
    data = empty; lastRaw = text; base = {};
    return true;
  }
  function saveReason() { return lastSaveError === "conflict" ? "다른 탭에서 데이터가 바뀌어 저장하지 않았습니다." : "저장 공간이 부족하거나 저장에 실패했습니다."; }
  function importProject(obj) {
    const c = checkProject(obj);
    if (!c) throw new Error("올바른 PanelLab 프로젝트 파일이 아닙니다.");
    const p = Object.assign(c, { id: uid(), updated: Date.now() });
    const prevId = data.currentId;
    data.projects.unshift(p);
    data.currentId = p.id;
    if (!save()) { data.projects = data.projects.filter((x) => x !== p); data.currentId = prevId; throw new Error(saveReason() + " 프로젝트를 불러오지 못했습니다."); }
    return p;
  }

  function exportAll() { return { app: "PanelLab", kind: "backup", version: 1, exported: Date.now(), projects: data.projects }; }
  // Merge only: existing projects are never overwritten; id collisions get a new id.
  function importAll(obj) {
    if (!obj || obj.app !== "PanelLab" || !Array.isArray(obj.projects)) throw new Error("올바른 PanelLab 백업 파일이 아닙니다.");
    let n = 0, skipped = 0;
    const before = data.projects.slice();
    obj.projects.forEach((q) => {
      let p = null;
      try { p = checkProject(q); } catch (e) { p = null; }
      if (!p || !Array.isArray(q.results)) { skipped++; return; }
      if (typeof p.id !== "string" || !SAFE_ID.test(p.id) || data.projects.some((x) => x.id === p.id)) p.id = uid();
      data.projects.push(p); n++;
    });
    if (n && !save()) { data.projects = before; throw new Error(saveReason() + " 백업을 불러오지 못했습니다. 기존 프로젝트는 그대로입니다."); }
    importAll.skipped = skipped;
    return n;
  }

  return { all: () => data.projects, current, createProject, setCurrent, touch, deleteProject, renameProject, clearAll, importProject, exportAll, importAll, uid, onExternalChange: (fn) => { if (typeof fn === "function") listeners.push(fn); }, refresh, lastSaveError: () => lastSaveError };
})();
