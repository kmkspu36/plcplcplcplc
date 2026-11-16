// TechTranscript: automatic chat transcript, recorded ONLY by observing the existing TechChat hooks (chat.js / bridge.js are not touched).
// Records what the browser actually saw on the shared Direct Line connection: text of user and bot "message" activities.
// Cards and attachments are recorded by type/title only, so those parts are NOT complete. Storage: localStorage "techcore.transcript.v1".
// Every storage step is wrapped so a failure can never affect sending or receiving chat messages.
const TechTranscript = (() => {
  const KEY = "techcore.transcript.v1";
  const MAX_CONV = 20, MAX_MSG = 300, MAX_TEXT = 4000, MAX_CHARS = 700000;
  const BAK = KEY + ".bak";
  let attached = false, cur = null, seen = new Set(), prevState = "", timer = 0, lastError = "", trimmed = 0;
  // Messages seen before the first user message (e.g. the welcome text) are held in memory only; nothing is stored until the user writes.
  let live = false, pre = [];

  const emptyStore = () => ({ version: 1, convs: [] });
  const valid = (d) => !!d && d.version === 1 && Array.isArray(d.convs);
  // Read-only view of the stored data (never writes).
  function read() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (valid(d)) return d;
    } catch {}
    return emptyStore();
  }
  // The raw string is copied to a backup key (and verified) before anything is overwritten.
  function backup(raw) {
    try {
      for (const k of [BAK, BAK + "." + Date.now()]) {
        const ex = localStorage.getItem(k);
        if (ex === raw) return true;
        if (ex === null) {
          localStorage.setItem(k, raw);
          return localStorage.getItem(k) === raw;
        }
      }
    } catch {}
    return false;
  }
  // Returns {ok:false} when existing data can't be read or safely backed up; the caller must then not write.
  function load() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch { return { ok: false }; }
    if (raw === null || raw === "") return { ok: true, d: emptyStore() };
    try {
      const d = JSON.parse(raw);
      if (valid(d)) return { ok: true, d };
    } catch {}
    return backup(raw) ? { ok: true, d: emptyStore() } : { ok: false };
  }
  function write(d) {
    d.convs = d.convs.slice(-MAX_CONV);
    // Shrink order: oldest other conversations first, then the oldest messages of the current one (newest messages are kept).
    const shrink = () => {
      if (d.convs.length > 1) { d.convs.shift(); return true; }
      const c = d.convs[0];
      if (c && c.messages.length > 1) {
        const n = Math.min(Math.max(1, Math.ceil(c.messages.length * 0.2)), c.messages.length - 1);
        c.messages.splice(0, n); trimmed += n; return true;
      }
      return false;
    };
    let text = JSON.stringify(d);
    while (text.length > MAX_CHARS && shrink()) text = JSON.stringify(d);
    for (let i = 0; i < 12; i++) {
      try { localStorage.setItem(KEY, text); lastError = ""; return true; } catch {
        lastError = "저장하지 못했습니다(저장 공간 부족 등). 채팅에는 영향이 없습니다.";
        if (!shrink()) return false;
        text = JSON.stringify(d);
      }
    }
    return false;
  }

  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; };
  function attachSummary(a) {
    if (!Array.isArray(a.attachments) || !a.attachments.length) return undefined;
    return a.attachments.slice(0, 8).map((x) => {
      const c = x && x.content;
      const title = (x && x.name) || (c && typeof c === "object" && (c.title || c.text)) || "";
      return { type: clip(x && x.contentType, 60), name: clip(title, 120) };
    });
  }

  function startConv() {
    cur = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), startedAt: Date.now(), route: clip(location.hash, 80), messages: [] };
    seen = new Set(); live = false; pre = [];
  }
  let dirty = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, 250);
  }
  let halted = false;
  function flush() {
    timer = 0;
    if (halted || !cur || !live || !dirty) return;
    try {
      const r = load();
      if (!r.ok) { lastError = "기존 저장 데이터를 안전하게 백업하지 못해 저장을 중단했습니다. 기존 기록은 그대로 보존됩니다."; return; }
      const d = r.d;
      const i = d.convs.findIndex((c) => c.id === cur.id);
      if (i >= 0) d.convs[i] = cur; else d.convs.push(cur);
      if (write(d)) dirty = null;
    } catch {}
  }
  const when = (a) => {
    const t = typeof a.timestamp === "number" ? a.timestamp : Date.parse(a.timestamp);
    return Number.isFinite(t) && t > 946684800000 && t < Date.now() + 864e5 ? t : Date.now();
  };

  function onActivity(a) {
    try {
      if (!a || a.type !== "message" || !a.from) return;
      const role = a.from.role === "user" ? "user" : "bot";
      if (a.id) { if (seen.has(a.id)) return; seen.add(a.id); }
      if (!cur) startConv();
      const m = { at: when(a), role, text: clip(a.text, MAX_TEXT) };
      if (a.id) m.id = clip(a.id, 80);
      const tag = a.channelData && a.channelData.techbridge && a.channelData.techbridge.requestId;
      if (tag) m.origin = "panellab";
      const att = attachSummary(a); if (att) m.attachments = att;
      if (!m.text && !att) return;
      if (!live) {
        if (role !== "user") { pre.push(m); if (pre.length > 20) pre.shift(); return; }
        live = true; cur.messages = pre.splice(0);
      }
      cur.messages.push(m);
      if (cur.messages.length > MAX_MSG) cur.messages.splice(0, cur.messages.length - MAX_MSG);
      dirty = true;
      schedule();
    } catch {}
  }

  function attach() {
    if (attached || typeof TechChat === "undefined") return;
    attached = true;
    try {
      TechChat.subscribe((s) => {
        try {
          // A new Direct Line conversation starts on a user-initiated (re)connect; the automatic "reconnecting" message is not a new one.
          if (s.state === "connecting" && prevState !== "connecting" && !s.message) { flush(); startConv(); }
          prevState = s.state;
        } catch {}
      });
      TechChat.onActivity(onActivity);
      window.addEventListener("pagehide", () => { try { flush(); } catch {} });
    } catch {}
  }

  const stats = () => { const d = read(); return { convs: d.convs.length, messages: d.convs.reduce((n, c) => n + c.messages.length,   0),  chars: JSON.stringify(d).length, lastError, trimmed }; };
    function clear() { try { dirty = null; localStorage.removeItem(KEY); cur = null; seen = new Set(); live = false; pre = []; return true; } catch { return false; } }
  function exportText() { return JSON.stringify({ app: "TECHCORE", kind: "transcript", version: 1, exported: Date.now(), conversations: read().convs }, null, 2); }

  // Used while a full backup is being restored: pending writes are dropped so they cannot overwrite the restored record.
  function suspend() { halted = true; dirty = null; if (timer) { clearTimeout(timer); timer = 0; } }
  function resume() { halted = false; }

  return { attach, stats, clear, exportText, flush, suspend, resume, key: KEY };
})();
window.TechTranscript = TechTranscript;
