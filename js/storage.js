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
    const p = { id: uid(), name: name.trim() || "새 프로젝트", software: software || "GX Works3", created: Date.now(), updated: Date.now(), messages: [], results: [] };
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
    data.projects.unshift(p);
    data.currentId = p.id;
    save();
    return p;
  }

  return { all: () => data.projects, current, createProject, setCurrent, touch, deleteProject, renameProject, clearAll, importProject, uid };
})();
