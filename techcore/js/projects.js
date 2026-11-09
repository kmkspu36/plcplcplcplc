// TECHCORE project adapter (stage 1).
// Reads PanelLab data ("panellab.v1") READ-ONLY and never writes to it.
// TECHCORE's own management metadata lives under a separate key so the PanelLab structure is untouched.
const TechProjects = (() => {
  const PANEL_KEY = "panellab.v1";
  const META_KEY = "techcore.projects.v1";

  function readPanel() {
    let raw;
    try { raw = localStorage.getItem(PANEL_KEY); } catch { return { ok: false, projects: [], error: "storage" }; }
    if (raw === null) return { ok: true, projects: [], empty: true };
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.projects)) return { ok: true, projects: d.projects.filter((p) => p && typeof p === "object"), currentId: d.currentId || null };
      return { ok: false, projects: [], error: "shape" };
    } catch {
      return { ok: false, projects: [], error: "parse" };
    }
  }

  const len = (v) => (Array.isArray(v) ? v.length : 0);
  // Counts what a project contains, so users can see what a later delete would affect.
  function summarize(p) {
    const screens = p.hmi && Array.isArray(p.hmi.screens) ? p.hmi.screens : [];
    return {
      messages: len(p.messages),
      results: len(p.results),
      ladderCode: typeof p.currentCode === "string" && p.currentCode.length > 0,
      codeVersions: len(p.codeVersions),
      fixHistory: len(p.fixHistory),
      labels: len(p.labels),
      hmiScreens: screens.length,
      hmiVersions: p.hmi && Array.isArray(p.hmi.versions) ? p.hmi.versions.length : 0,
      bytes: (() => { try { return JSON.stringify(p).length; } catch { return 0; } })(),
    };
  }

  function list() {
    const r = readPanel();
    return {
      ok: r.ok,
      error: r.error || null,
      projects: r.projects.map((p) => ({
        id: String(p.id == null ? "" : p.id),
        name: String(p.name == null ? "" : p.name),
        software: String(p.software == null ? "" : p.software),
        created: p.created || 0,
        updated: p.updated || 0,
        summary: summarize(p),
      })),
    };
  }

  function search(items, q) {
    const s = String(q || "").trim().toLowerCase();
    return s ? items.filter((p) => p.name.toLowerCase().includes(s) || p.software.toLowerCase().includes(s)) : items;
  }

  // Same format PanelLab's own "backup" uses, so it can be restored with PanelLab's existing import.
  function buildBackup() {
    const r = readPanel();
    if (!r.ok) return null;
    return { app: "PanelLab", kind: "backup", version: 1, exported: Date.now(), source: "TECHCORE", projects: r.projects };
  }

  function downloadBackup() {
    const b = buildBackup();
    if (!b) return { ok: false, reason: "unreadable" };
    if (!b.projects.length) return { ok: false, reason: "empty" };
    try {
      const blob = new Blob([JSON.stringify(b)], { type: "application/json" });
      const a = document.createElement("a");
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      a.href = URL.createObjectURL(blob);
      a.download = "techcore-backup-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return { ok: true, count: b.projects.length };
    } catch {
      return { ok: false, reason: "download" };
    }
  }

  function readMeta() {
    try {
      const d = JSON.parse(localStorage.getItem(META_KEY));
      if (d && typeof d === "object") return d;
    } catch {}
    return { version: 1, trash: [], log: [] };
  }

  // Writes only the metadata key and verifies by reading back. On failure the existing value stays as it was.
  function writeMeta(meta) {
    let prev = null;
    try {
      prev = localStorage.getItem(META_KEY);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      if (localStorage.getItem(META_KEY) !== JSON.stringify(meta)) throw new Error("verify");
      return { ok: true };
    } catch (e) {
      try { if (prev === null) localStorage.removeItem(META_KEY); else localStorage.setItem(META_KEY, prev); } catch {}
      const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
      return { ok: false, reason: quota ? "quota" : "error" };
    }
  }

  // Approximate usage (UTF-16 characters x 2 bytes) of the keys this platform uses.
  function usage() {
    const keys = [PANEL_KEY, META_KEY, "techcore.trash.v1", "techcore.v1", "panellab.ui.v1"];
    const out = {};
    keys.forEach((k) => { try { const v = localStorage.getItem(k); out[k] = v ? v.length * 2 : 0; } catch { out[k] = 0; } });
    return out;
  }

  // ---- stage 2: trash (30-day retention) ----
  // TRASH SCHEMA (동일 스키마 유지): panellab/js/storage.js writes the same "techcore.trash.v1" items when PanelLab runs standalone.
  // Any change to the entry fields here must be mirrored there.
  const TRASH_KEY = "techcore.trash.v1";
  const RETENTION_MS = 30 * 24 * 3600 * 1000;
  const SOON_MS = 7 * 24 * 3600 * 1000;

  function errReason(e) {
    return e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) ? "quota" : "error";
  }
  // Writes a key and verifies by reading it back; restores the previous value on failure.
  function writeVerified(key, text) {
    let prev = null;
    try {
      prev = localStorage.getItem(key);
      localStorage.setItem(key, text);
      if (localStorage.getItem(key) !== text) throw new Error("verify");
      return { ok: true };
    } catch (e) {
      try { if (prev === null) localStorage.removeItem(key); else localStorage.setItem(key, prev); } catch {}
      return { ok: false, reason: errReason(e) };
    }
  }
  // A trash that exists but cannot be parsed is NOT treated as empty: writing over it would destroy the user's only copies.
  // The raw text is kept under a ".corrupt" key and all trash writes are refused until the user resolves it.
  // trashRaw is the text last read/written; a write is refused if another tab changed the key in between.
  let trashRaw = null, trashCorrupt = false;
  function readTrash() {
    let raw = null;
    try { raw = localStorage.getItem(TRASH_KEY); } catch {}
    trashRaw = raw; trashCorrupt = false;
    if (raw === null) return { version: 1, items: [] };
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.items)) return d;
    } catch {}
    trashCorrupt = true;
    try { const k = TRASH_KEY + ".corrupt"; if (localStorage.getItem(k) === null) localStorage.setItem(k, raw); } catch {}
    return { version: 1, items: [] };
  }
  function writeTrash(t) {
    if (trashCorrupt) return { ok: false, reason: "trash-corrupt" };
    let cur = null;
    try { cur = localStorage.getItem(TRASH_KEY); } catch {}
    if (cur !== trashRaw) return { ok: false, reason: "conflict" };
    const text = JSON.stringify(t);
    const w = writeVerified(TRASH_KEY, text);
    if (w.ok) trashRaw = text;
    return w;
  }
  function logEvent(type, name, extra) {
    const m = readMeta();
    m.log = (Array.isArray(m.log) ? m.log : []).concat([Object.assign({ at: Date.now(), type, name }, extra || {})]).slice(-200);
    writeMeta(m);
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function trashList() {
    const now = Date.now();
    return readTrash().items.map((it) => ({
      trashId: it.trashId, id: it.id, name: it.name, deletedAt: it.deletedAt, expiresAt: it.expiresAt,
      daysLeft: Math.max(0, Math.ceil((it.expiresAt - now) / 86400000)),
      soon: it.expiresAt - now <= SOON_MS,
      summary: summarize(it.snapshot || {}),
    }));
  }
  // Removes entries past their expiry. Distinct from manual permanent delete; both are logged.
  // Clock guard: a badly wrong system clock must not mass-delete the trash. The last seen time is kept in its own key.
  const CLOCK_KEY = "techcore.clock.v1";
  const CLOCK_JUMP_MS = 45 * 24 * 3600 * 1000;
  function readClock() { try { const v = Number(JSON.parse(localStorage.getItem(CLOCK_KEY)).lastSeen); return Number.isFinite(v) ? v : 0; } catch { return 0; } }
  function writeClock(v) { try { localStorage.setItem(CLOCK_KEY, JSON.stringify({ lastSeen: v })); } catch {} }
  function confirmClock() { writeClock(Date.now()); return { ok: true }; }
  function expireDue() {
    const t = readTrash(), now = Date.now();
    const due = t.items.filter((it) => it.expiresAt <= now);
    const last = readClock();
    if (last && (now < last - 5 * 60 * 1000 || now - last > CLOCK_JUMP_MS)) return { removed: 0, skipped: "clock", pending: due.length };
    if (!due.length) { writeClock(now); return { removed: 0 }; }
    t.items = t.items.filter((it) => it.expiresAt > now);
    if (!writeTrash(t).ok) return { removed: 0, failed: true };
    due.forEach((it) => logEvent("auto-expire", it.name));
    writeClock(now);
    return { removed: due.length };
  }

  function readPanelRaw() {
    let raw;
    try { raw = localStorage.getItem(PANEL_KEY); } catch { return { ok: false, reason: "storage" }; }
    if (raw === null) return { ok: false, reason: "empty" };
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.projects)) return { ok: false, reason: "shape" };
      return { ok: true, data: d };
    } catch { return { ok: false, reason: "parse" }; }
  }

  // 1) copy snapshot to trash and verify, 2) only then remove from panellab.v1. A failure at any step leaves the original data.
  function moveToTrash(id) {
    const r = readPanelRaw();
    if (!r.ok) return { ok: false, reason: r.reason };
    const idx = r.data.projects.findIndex((p) => p && String(p.id) === String(id));
    if (idx < 0) return { ok: false, reason: "notfound" };
    const proj = r.data.projects[idx];
    const now = Date.now();
    const item = { trashId: newId(), id: proj.id, name: String(proj.name || ""), deletedAt: now, expiresAt: now + RETENTION_MS, wasCurrent: r.data.currentId === proj.id, snapshot: proj };
    const t = readTrash();
    t.items.push(item);
    const w1 = writeTrash(t);
    if (!w1.ok) return { ok: false, reason: w1.reason, stage: "trash" };
    const next = Object.assign({}, r.data, { projects: r.data.projects.filter((_, i) => i !== idx) });
    if (next.currentId === proj.id) next.currentId = next.projects[0] ? next.projects[0].id : null;
    const w2 = writeVerified(PANEL_KEY, JSON.stringify(next));
    if (!w2.ok) {
      t.items = t.items.filter((x) => x.trashId !== item.trashId);
      writeTrash(t);
      return { ok: false, reason: w2.reason, stage: "panellab" };
    }
    logEvent("delete", item.name);
    return { ok: true, item };
  }

  function restore(trashId) {
    const t = readTrash();
    if (trashCorrupt) return { ok: false, reason: "trash-corrupt" };
    const item = t.items.find((x) => x.trashId === trashId);
    if (!item) return { ok: false, reason: "notfound" };
    const r = readPanelRaw();
    const data = r.ok ? r.data : r.reason === "empty" ? { projects: [], currentId: null } : null;
    if (!data) return { ok: false, reason: r.reason };
    const proj = Object.assign({}, item.snapshot);
    let idChanged = false;
    if (data.projects.some((p) => p && String(p.id) === String(proj.id))) { proj.id = newId(); idChanged = true; }
    data.projects.unshift(proj);
    const w = writeVerified(PANEL_KEY, JSON.stringify(data));
    if (!w.ok) return { ok: false, reason: w.reason, stage: "panellab" };
    // Verify the restored project is really present in the stored data before the trash copy is removed.
    const chk = readPanelRaw();
    if (!chk.ok || !chk.data.projects.some((p) => p && String(p.id) === String(proj.id))) return { ok: false, reason: "verify", stage: "panellab" };
    t.items = t.items.filter((x) => x.trashId !== trashId);
    const w2 = writeTrash(t);
    logEvent("restore", item.name, idChanged ? { idChanged: true } : null);
    syncPanelFrames();
    return { ok: true, idChanged, trashCleanupFailed: !w2.ok };
  }

  // Asks an open same-origin PanelLab frame to re-read its data so a restored project shows up without waiting for its timer.
  function syncPanelFrames() {
    try {
      document.querySelectorAll("iframe").forEach((f) => {
        try { const w = f.contentWindow; if (w && w.PanelStore && typeof w.PanelStore.refresh === "function") w.PanelStore.refresh(); } catch {}
      });
    } catch {}
  }

  // Manual permanent delete requires the exact project name.
  function purge(trashId, typedName) {
    const t = readTrash();
    if (trashCorrupt) return { ok: false, reason: "trash-corrupt" };
    const item = t.items.find((x) => x.trashId === trashId);
    if (!item) return { ok: false, reason: "notfound" };
    if (String(typedName) !== item.name) return { ok: false, reason: "name" };
    t.items = t.items.filter((x) => x.trashId !== trashId);
    const w = writeTrash(t);
    if (!w.ok) return { ok: false, reason: w.reason };
    logEvent("purge", item.name);
    return { ok: true };
  }

  function downloadTrashBackup() {
    const t = readTrash();
    if (!t.items.length) return { ok: false, reason: "empty" };
    try {
      const blob = new Blob([JSON.stringify({ app: "PanelLab", kind: "backup", version: 1, exported: Date.now(), source: "TECHCORE-trash", projects: t.items.map((x) => x.snapshot) })], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "techcore-trash-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return { ok: true, count: t.items.length };
    } catch { return { ok: false, reason: "download" }; }
  }

  const history = () => (Array.isArray(readMeta().log) ? readMeta().log.slice().reverse() : []);

  return { readPanel, list, search, summarize, buildBackup, downloadBackup, readMeta, writeMeta, usage, PANEL_KEY, META_KEY, TRASH_KEY, RETENTION_DAYS: 30, confirmClock, trashList, trashDamaged: () => trashCorrupt, expireDue, moveToTrash, restore, purge, downloadTrashBackup, history };
})();
// Exposed on window so the embedded PanelLab can call window.parent.TechProjects.moveToTrash (a top-level const is not a window property).
window.TechProjects = TechProjects;
