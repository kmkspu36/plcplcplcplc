// Local project/history storage. Never stores tokens or connection secrets.
const PanelStore = (() => {
  const KEY = "panellab.v1";
  let data = load();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.projects)) return d;
    } catch {}
    return { projects: [], currentId: null };
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
    const p = { id: uid(), name: obj.name, software: obj.software || "GX Works3", created: obj.created || Date.now(), updated: Date.now(), messages: obj.messages, results: Array.isArray(obj.results) ? obj.results : [] };
    if (Array.isArray(obj.fixHistory)) p.fixHistory = obj.fixHistory;
    if (Array.isArray(obj.codeVersions)) p.codeVersions = obj.codeVersions;
    if (typeof obj.currentCode === "string") p.currentCode = obj.currentCode;
    if (typeof obj.cpu === "string") p.cpu = obj.cpu;
    if (obj.hmi && Array.isArray(obj.hmi.screens)) p.hmi = obj.hmi;
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
      if (!p.id || data.projects.some((x) => x.id === p.id)) p.id = uid();
      data.projects.push(p); n++;
    });
    if (n && !save()) throw new Error("저장 공간이 부족하여 백업을 불러오지 못했습니다.");
    return n;
  }

  return { all: () => data.projects, current, createProject, setCurrent, touch, deleteProject, renameProject, clearAll, importProject, exportAll, importAll, uid };
})();
