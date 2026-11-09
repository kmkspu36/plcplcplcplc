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
  function sanitizeHmi(hmi) {
    if (!hmi || !Array.isArray(hmi.screens)) return;
    hmi.screens.forEach((s) => {
      if (!s || typeof s !== "object") return;
      s.w = finite(Number(s.w), 800);
      s.h = finite(Number(s.h), 480);
      if (!Array.isArray(s.objects)) { s.objects = []; return; }
      s.objects = s.objects.filter((o) => o && typeof o === "object");
      s.objects.forEach((o) => {
        o.x = finite(Number(o.x), 0); o.y = finite(Number(o.y), 0);
        o.w = finite(Number(o.w), 80); o.h = finite(Number(o.h), 40);
      });
    });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function createProject(name, software) {
    const p = { id: uid(), name: name.trim() || "새 프로젝트", software: software || "GX Works2", created: Date.now(), updated: Date.now(), messages: [], results: [] };
    data.projects.unshift(p);
    data.currentId = p.id;
    save();
    return p;
  }
  const current = () => data.projects.find((p) => p.id === data.currentId) || null;
  function setCurrent(id) { if (data.projects.some((p) => p.id === id)) { data.currentId = id; save(); } }
  function touch(p) { p.updated = Date.now(); return save(); }
  function deleteProject(id) {
    data.projects = data.projects.filter((p) => p.id !== id);
    if (data.currentId === id) data.currentId = data.projects[0] ? data.projects[0].id : null;
    save();
  }
  function renameProject(id, name) {
    const p = data.projects.find((x) => x.id === id);
    if (p && name.trim()) { p.name = name.trim(); touch(p); }
  }
  function clearAll() { data = { projects: [], currentId: null }; save(); }
  function importProject(obj) {
    if (!obj || typeof obj.name !== "string" || !Array.isArray(obj.messages)) throw new Error("올바른 PanelLab 프로젝트 파일이 아닙니다.");
    const p = { id: uid(), name: obj.name, software: obj.software || "GX Works2", created: obj.created || Date.now(), updated: Date.now(), messages: obj.messages, results: Array.isArray(obj.results) ? obj.results : [] };
    if (Array.isArray(obj.fixHistory)) p.fixHistory = obj.fixHistory;
    if (Array.isArray(obj.codeVersions)) p.codeVersions = obj.codeVersions;
    if (typeof obj.currentCode === "string") p.currentCode = obj.currentCode;
    if (typeof obj.cpu === "string") p.cpu = obj.cpu;
    if (obj.hmi && Array.isArray(obj.hmi.screens)) { p.hmi = obj.hmi; sanitizeHmi(p.hmi); }
    if (Array.isArray(obj.labels)) p.labels = obj.labels;
    data.projects.unshift(p);
    data.currentId = p.id;
    save();
    return p;
  }

  function exportAll() { return { app: "PanelLab", kind: "backup", version: 1, exported: Date.now(), projects: data.projects }; }
  // Merge only: existing projects are never overwritten; id collisions get a new id.
  function importAll(obj) {
    if (!obj || obj.app !== "PanelLab" || !Array.isArray(obj.projects)) throw new Error("올바른 PanelLab 백업 파일이 아닙니다.");
    let n = 0;
    obj.projects.forEach((q) => {
      if (!q || typeof q.name !== "string" || !Array.isArray(q.messages) || !Array.isArray(q.results)) return;
      const p = Object.assign({}, q);
      if (typeof p.id !== "string" || !SAFE_ID.test(p.id) || data.projects.some((x) => x.id === p.id)) p.id = uid();
      if (p.hmi) sanitizeHmi(p.hmi);
      data.projects.push(p); n++;
    });
    if (n && !save()) throw new Error("저장 공간이 부족하여 백업을 불러오지 못했습니다.");
    return n;
  }

  return { all: () => data.projects, current, createProject, setCurrent, touch, deleteProject, renameProject, clearAll, importProject, exportAll, importAll, uid };
})();
