// TechElectric (P6-A): data model, validation, static check, SVG/JSON export and storage for the 전기·전자 workroom.
// No UI here (see electric-ui.js). Storage key: "techcore.field.electric.v1" (new key; existing keys/formats are untouched).
//
// DESIGN SCHEMA (version 1)
//   design = {
//     version: 1, id, name(<=60), projectId("" or a PanelLab project id), created, updated (ms),
//     canvas: { w: 400..2000, h: 400..2000 },
//     parts:  [{ id, type, name(<=40), x, y, w, h, props: { value(<=30) } }]   // type must be a key of TYPES; pins come from TYPES[type].pins
//     wires:  [{ id, net(<=30), from: { part, pin }, to: { part, pin } }]       // part = part id, pin = a pin id of that part's type
//     notes:  [{ id, x, y, text(<=100) }]
//   }
//   Limits: parts <= 200, wires <= 400, notes <= 100. Unknown types/pins/references are removed with a warning; numbers are clamped.
// STORE (one JSON value): { version: 1, designs: [design], snaps: { [designId]: [{ id, name, at, design }] }, trash: [{ trashId, id, name, deletedAt, expiresAt, design, snaps }], lastSeen }
// The 30-day design trash lives INSIDE this key on purpose: the shared "techcore.trash.v1" holds PanelLab project snapshots only and its
// restore code would write a design into panellab.v1 (see report question).
// This module never claims a circuit is electrically correct or safe; the static check is a site-side lint only.
const TechElectric = (() => {
  const KEY = "techcore.field.electric.v1";
  const RETENTION_MS = 30 * 24 * 3600 * 1000;
  const CLOCK_JUMP_MS = 45 * 24 * 3600 * 1000;
  const MAX = { parts: 200, wires: 400, notes: 100, snaps: 20, pinWires: 4 };
  const DISCLAIMER = "이 점검은 사이트가 자체적으로 하는 형식 점검입니다. 회로의 전기적 안전성이나 정상 동작을 보증하지 않으며, 실제 설비는 자격을 갖춘 담당자가 검토해야 합니다.";
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const str = (v, n) => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);

  const two = () => [{ id: "1", fx: 0, fy: 0.5 }, { id: "2", fx: 1, fy: 0.5 }];
  const side = (n, fx, from) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), fx, fy: (i + 0.5) / n }));
  const TYPES = {
    resistor: { label: "저항", prefix: "R", w: 70, h: 26, pins: two() },
    capacitor: { label: "커패시터", prefix: "C", w: 60, h: 30, pins: two() },
    inductor: { label: "인덕터", prefix: "L", w: 70, h: 26, pins: two() },
    diode: { label: "다이오드", prefix: "D", w: 60, h: 30, pins: [{ id: "A", fx: 0, fy: 0.5 }, { id: "K", fx: 1, fy: 0.5 }] },
    led: { label: "LED", prefix: "LED", w: 60, h: 30, pins: [{ id: "A", fx: 0, fy: 0.5 }, { id: "K", fx: 1, fy: 0.5 }] },
    switch: { label: "스위치", prefix: "SW", w: 70, h: 30, pins: two() },
    fuse: { label: "퓨즈", prefix: "F", w: 70, h: 26, pins: two() },
    lamp: { label: "램프", prefix: "H", w: 50, h: 50, pins: two() },
    motor: { label: "모터", prefix: "M", w: 60, h: 60, pins: two() },
    source: { label: "DC 전원", prefix: "V", w: 50, h: 70, pins: [{ id: "+", fx: 0.5, fy: 0 }, { id: "-", fx: 0.5, fy: 1 }] },
    ground: { label: "접지", prefix: "GND", w: 40, h: 30, pins: [{ id: "G", fx: 0.5, fy: 0 }] },
    relay: { label: "릴레이", prefix: "K", w: 80, h: 80, pins: [{ id: "A1", fx: 0, fy: 0.3 }, { id: "A2", fx: 0, fy: 0.7 }, { id: "COM", fx: 1, fy: 0.2 }, { id: "NO", fx: 1, fy: 0.5 }, { id: "NC", fx: 1, fy: 0.8 }] },
    breaker: { label: "차단기", prefix: "Q", w: 40, h: 70, pins: [{ id: "1", fx: 0.5, fy: 0 }, { id: "2", fx: 0.5, fy: 1 }] },
    terminal: { label: "단자", prefix: "X", w: 30, h: 30, pins: [{ id: "1", fx: 0.5, fy: 0.5 }] },
    ic: { label: "IC", prefix: "U", w: 90, h: 100, pins: side(4, 0, 1).concat(side(4, 1, 5)) },
    sensor: { label: "센서", prefix: "S", w: 80, h: 60, pins: [{ id: "VCC", fx: 0, fy: 0.25 }, { id: "GND", fx: 0, fy: 0.75 }, { id: "OUT", fx: 1, fy: 0.5 }] },
    connector: { label: "커넥터", prefix: "J", w: 50, h: 90, pins: side(4, 0, 1) },
  };
  const typeOf = (t) => (typeof t === "string" && own(TYPES, t) ? TYPES[t] : null);
  const pinIds = (type) => (typeOf(type) ? typeOf(type).pins.map((p) => p.id) : []);
  const pinPos = (part, pinId) => {
    const t = typeOf(part.type), p = t && t.pins.find((x) => x.id === pinId);
    return p ? { x: num(part.x, 0) + p.fx * num(part.w, t.w), y: num(part.y, 0) + p.fy * num(part.h, t.h) } : null;
  };

  function newDesign(name, projectId) {
    const now = Date.now();
    return { version: 1, id: uid(), name: str(name, 60) || "새 설계", projectId: str(projectId, 60), created: now, updated: now, canvas: { w: 900, h: 600 }, parts: [], wires: [], notes: [] };
  }
  function newPart(type, x, y, existing) {
    const t = typeOf(type); if (!t) return null;
    const n = (existing || []).filter((p) => p.type === type).length + 1;
    return { id: uid(), type, name: t.prefix + n, x, y, w: t.w, h: t.h, props: { value: "" } };
  }
  const safeId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);

  // Returns { design, warnings }. Never throws; unknown or unsafe content is dropped and reported.
  function validate(input, opt) {
    const w = [];
    const src = input && typeof input === "object" && input.design && typeof input.design === "object" && !Array.isArray(input.parts) ? input.design : input;
    const d = newDesign("", "");
    if (!src || typeof src !== "object") { w.push("설계 데이터가 객체가 아닙니다."); return { design: d, warnings: w }; }
    if (opt && opt.keepMeta) {
      if (safeId(src.id)) d.id = src.id;
      d.created = num(src.created, d.created); d.updated = num(src.updated, d.updated);
    }
    d.name = str(src.name, 60) || (opt && opt.defaultName) || "AI 설계";
    d.projectId = str(src.projectId, 60);
    const cv = src.canvas && typeof src.canvas === "object" ? src.canvas : {};
    d.canvas = { w: clamp(Math.round(num(cv.w, 900)), 400, 2000), h: clamp(Math.round(num(cv.h, 600)), 400, 2000) };
    const rawParts = Array.isArray(src.parts) ? src.parts : [];
    if (!Array.isArray(src.parts)) w.push("parts 배열이 없습니다.");
    if (rawParts.length > MAX.parts) w.push("부품은 최대 " + MAX.parts + "개까지만 사용합니다. 나머지는 제거했습니다.");
    const idMap = new Map(), names = new Set();
    rawParts.slice(0, MAX.parts).forEach((p, i) => {
      if (!p || typeof p !== "object") { w.push("부품 " + (i + 1) + ": 형식이 올바르지 않아 제거했습니다."); return; }
      const t = typeOf(p.type);
      if (!t) { w.push("부품 " + (i + 1) + ": 알 수 없는 종류(" + str(p.type, 20) + ")라 제거했습니다."); return; }
      let id = safeId(p.id) ? p.id : "";
      if (!id || [...idMap.values()].some((x) => x.id === id)) { if (p.id !== undefined) w.push("부품 " + (i + 1) + ": id가 없거나 중복·부적합하여 새로 부여했습니다."); id = uid() + i; }
      const pw = clamp(Math.round(num(p.w, t.w)), 20, 300), ph = clamp(Math.round(num(p.h, t.h)), 20, 300);
      let x = num(p.x, 0), y = num(p.y, 0);
      const cx = clamp(Math.round(x), 0, d.canvas.w - pw), cy = clamp(Math.round(y), 0, d.canvas.h - ph);
      if (cx !== x || cy !== y) w.push("부품 " + (i + 1) + ": 위치가 캔버스를 벗어나거나 숫자가 아니어서 보정했습니다.");
      let name = str(p.name, 40) || t.prefix + (idMap.size + 1);
      if (names.has(name.toLowerCase())) w.push("부품 이름 '" + name + "'이(가) 중복입니다(제거하지는 않았습니다).");
      names.add(name.toLowerCase());
      const part = { id, type: p.type, name, x: cx, y: cy, w: pw, h: ph, props: { value: str(p.props && p.props.value != null ? p.props.value : p.value, 30) } };
      idMap.set(p.id !== undefined ? String(p.id) : id, part); if (!idMap.has(id)) idMap.set(id, part);
      d.parts.push(part);
    });
    const byId = new Map(d.parts.map((p) => [p.id, p]));
    const rawWires = Array.isArray(src.wires) ? src.wires : [];
    if (rawWires.length > MAX.wires) w.push("연결선은 최대 " + MAX.wires + "개까지만 사용합니다.");
    const seen = new Set();
    rawWires.slice(0, MAX.wires).forEach((c, i) => {
      if (!c || typeof c !== "object" || !c.from || !c.to) { w.push("연결선 " + (i + 1) + ": 시작/끝이 없어 제거했습니다."); return; }
      const a = idMap.get(String(c.from.part)), b = idMap.get(String(c.to.part));
      if (!a || !b) { w.push("연결선 " + (i + 1) + ": 존재하지 않는 부품을 가리켜 제거했습니다."); return; }
      const pa = str(c.from.pin, 10), pb = str(c.to.pin, 10);
      if (pinIds(a.type).indexOf(pa) < 0 || pinIds(b.type).indexOf(pb) < 0) { w.push("연결선 " + (i + 1) + ": 존재하지 않는 핀(" + esc(pa) + "/" + esc(pb) + ")이라 제거했습니다."); return; }
      if (a.id === b.id && pa === pb) { w.push("연결선 " + (i + 1) + ": 같은 핀끼리의 연결이라 제거했습니다."); return; }
      const k = [a.id + ":" + pa, b.id + ":" + pb].sort().join("|");
      if (seen.has(k)) { w.push("연결선 " + (i + 1) + ": 같은 연결이 중복되어 제거했습니다."); return; }
      seen.add(k);
      d.wires.push({ id: safeId(c.id) && !d.wires.some((x) => x.id === c.id) ? c.id : uid() + "w" + i, net: str(c.net, 30).replace(/[^\w가-힣 +\-.]/g, ""), from: { part: a.id, pin: pa }, to: { part: b.id, pin: pb } });
    });
    (Array.isArray(src.notes) ? src.notes : []).slice(0, MAX.notes).forEach((n, i) => {
      if (!n || typeof n !== "object" || !str(n.text, 100)) return;
      d.notes.push({ id: safeId(n.id) && !d.notes.some((x) => x.id === n.id) ? n.id : uid() + "n" + i, x: clamp(Math.round(num(n.x, 0)), 0, d.canvas.w), y: clamp(Math.round(num(n.y, 0)), 0, d.canvas.h), text: str(n.text, 100) });
    });
    void byId;
    return { design: d, warnings: w };
  }

  // Extracts the first JSON object that looks like a design from free text (```json fences first, then balanced braces).
  function extractJson(text) {
    const t = String(text || "");
    const tryParse = (s) => { try { const o = JSON.parse(s); return o && typeof o === "object" ? o : null; } catch { return null; } };
    const isDesign = (o) => o && (Array.isArray(o.parts) || (o.design && Array.isArray(o.design.parts)));
    const re = /```(?:json)?\s*([\s\S]*?)```/gi; let m;
    while ((m = re.exec(t))) { const o = tryParse(m[1]); if (isDesign(o)) return { obj: o, rest: (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim() }; }
    for (let i = t.indexOf("{"); i >= 0 && i < t.length; i = t.indexOf("{", i + 1)) {
      let depth = 0, inStr = false, esc2 = false;
      for (let j = i; j < t.length; j++) {
        const c = t[j];
        if (inStr) { if (esc2) esc2 = false; else if (c === "\\") esc2 = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) {
          const o = tryParse(t.slice(i, j + 1));
          if (isDesign(o)) return { obj: o, rest: (t.slice(0, i) + t.slice(j + 1)).trim() };
          break;
        }
      }
    }
    return { obj: null, rest: t.trim() };
  }

  // Site-side static check (NOT the AI). Result items: { sev: "warn"|"info", msg }.
  function staticCheck(d) {
    const out = [], uses = new Map();
    const use = (p, pin) => { const k = p + ":" + pin; uses.set(k, (uses.get(k) || 0) + 1); };
    d.wires.forEach((c) => { use(c.from.part, c.from.pin); use(c.to.part, c.to.pin); });
    const names = new Map();
    d.parts.forEach((p) => {
      const t = typeOf(p.type); if (!t) return;
      const k = p.name.toLowerCase(); names.set(k, (names.get(k) || 0) + 1);
      t.pins.forEach((pin) => {
        const n = uses.get(p.id + ":" + pin.id) || 0;
        if (n === 0) out.push({ sev: "warn", msg: "미연결 핀: " + p.name + " 핀 " + pin.id });
        else if (n > MAX.pinWires) out.push({ sev: "warn", msg: "한 핀에 연결선이 많습니다(" + n + "개): " + p.name + " 핀 " + pin.id });
      });
      if (p.x < 0 || p.y < 0 || p.x + p.w > d.canvas.w || p.y + p.h > d.canvas.h) out.push({ sev: "warn", msg: "캔버스 범위를 벗어난 부품: " + p.name });
    });
    names.forEach((n, k) => { if (n > 1) out.push({ sev: "warn", msg: "이름이 같은 부품 " + n + "개: " + k }); });
    if (d.parts.some((p) => p.type === "source") && !d.parts.some((p) => p.type === "ground")) out.push({ sev: "info", msg: "접지 부품이 없습니다(필요한 회로인지는 사용자가 판단)." });
    if (!d.parts.length) out.push({ sev: "info", msg: "부품이 없습니다." });
    return out;
  }

  // ---- SVG ----
  function symbol(p) {
    const w = num(p.w, 60), h = num(p.h, 30), t = typeOf(p.type);
    const body = '<rect width="' + w + '" height="' + h + '" rx="4" fill="#fff" stroke="#14243a" stroke-width="1.5"/>';
    const lab = '<text x="' + w / 2 + '" y="' + (h / 2 + 4) + '" font-size="11" text-anchor="middle" fill="#14243a">' + esc((t ? t.label : "") ) + "</text>";
    const pins = t ? t.pins.map((q) => '<circle cx="' + q.fx * w + '" cy="' + q.fy * h + '" r="3.5" fill="#3678c8"/><text x="' + clamp(q.fx * w + (q.fx < 0.5 ? 6 : q.fx > 0.5 ? -6 : 0), 0, w) + '" y="' + clamp(q.fy * h + (q.fy === 0 ? 12 : q.fy === 1 ? -5 : 3), 8, h) + '" font-size="8" text-anchor="' + (q.fx < 0.5 ? "start" : q.fx > 0.5 ? "end" : "middle") + '" fill="#566579">' + esc(q.id) + "</text>").join("") : "";
    return body + lab + pins;
  }
  function wirePath(d, c) {
    const A = d.parts.find((p) => p.id === c.from.part), B = d.parts.find((p) => p.id === c.to.part);
    if (!A || !B) return null;
    const a = pinPos(A, c.from.pin), b = pinPos(B, c.to.pin); if (!a || !b) return null;
    const mx = (a.x + b.x) / 2;
    return { path: "M" + a.x + " " + a.y + "L" + mx + " " + a.y + "L" + mx + " " + b.y + "L" + b.x + " " + b.y, lx: mx, ly: (a.y + b.y) / 2 };
  }
  // opt: { interactive, selPart, selWire }. Interactive output adds data-id / tabindex for the editor; exports stay plain.
  function inner(d, opt) {
    opt = opt || {};
    let o = "";
    d.wires.forEach((c) => {
      const p = wirePath(d, c); if (!p) return;
      const on = opt.selWire === c.id;
      o += '<g' + (opt.interactive ? ' data-wire="' + esc(c.id) + '" tabindex="0" role="button" aria-label="' + esc("연결선 " + (c.net || "") + " " + c.from.pin + "-" + c.to.pin) + '"' : "") + '><path d="' + p.path + '" fill="none" stroke="' + (on ? "#c27a14" : "#2f6db8") + '" stroke-width="' + (on ? 3 : 1.8) + '"/>' +
        (opt.interactive ? '<path d="' + p.path + '" fill="none" stroke="transparent" stroke-width="10"/>' : "") + (c.net ? '<text x="' + p.lx + '" y="' + (p.ly - 3) + '" font-size="9" fill="#566579">' + esc(c.net) + "</text>" : "") + "</g>";
    });
    d.parts.forEach((p) => {
      o += '<g transform="translate(' + num(p.x, 0) + "," + num(p.y, 0) + ')"' + (opt.interactive ? ' data-id="' + esc(p.id) + '" tabindex="0" role="button" aria-label="' + esc(p.name + " " + (typeOf(p.type) ? typeOf(p.type).label : "") + " (Enter로 선택, 방향키로 이동)") + '"' : "") + ">" + symbol(p) +
        '<text x="0" y="-4" font-size="10" fill="#14243a" font-weight="600">' + esc(p.name) + (p.props && p.props.value ? " " + esc(p.props.value) : "") + "</text>" +
        (opt.interactive ? (typeOf(p.type) ? typeOf(p.type).pins.map((q) => '<circle data-pin="' + esc(q.id) + '" data-part="' + esc(p.id) + '" cx="' + q.fx * num(p.w, 60) + '" cy="' + q.fy * num(p.h, 30) + '" r="7" fill="transparent" style="cursor:crosshair"/>').join("") : "") : "") + "</g>";
      if (opt.interactive && opt.selPart === p.id) o += '<rect x="' + (num(p.x, 0) - 3) + '" y="' + (num(p.y, 0) - 3) + '" width="' + (num(p.w, 60) + 6) + '" height="' + (num(p.h, 30) + 6) + '" fill="none" stroke="#c27a14" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>' +
        '<rect data-handle="se" x="' + (num(p.x, 0) + num(p.w, 60) - 6) + '" y="' + (num(p.y, 0) + num(p.h, 30) - 6) + '" width="12" height="12" fill="#c27a14" style="cursor:nwse-resize"/>';
    });
    d.notes.forEach((n) => { o += '<text x="' + num(n.x, 0) + '" y="' + num(n.y, 0) + '" font-size="12" fill="#7a4a00"' + (opt.interactive ? ' data-note="' + esc(n.id) + '"' : "") + ">" + esc(n.text) + "</text>"; });
    return o;
  }
  function toSvg(d) {
    const w = num(d.canvas.w, 900), h = num(d.canvas.h, 600);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" font-family="sans-serif"><rect width="' + w + '" height="' + h + '" fill="#fff"/>' + inner(d) + "</svg>";
  }
  function toJson(d) { return JSON.stringify({ app: "TECHCORE", kind: "electric-design", version: 1, exported: Date.now(), design: d }, null, 1); }

  // ---- storage ----
  const emptyStore = () => ({ version: 1, designs: [], snaps: {}, trash: [], lastSeen: 0 });
  function readStore() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch { return { ok: false, reason: "storage" }; }
    if (raw === null) return { ok: true, data: emptyStore(), raw: null };
    let d;
    try { d = JSON.parse(raw); } catch { d = null; }
    if (!d || typeof d !== "object" || !Array.isArray(d.designs)) {
      try { const k = KEY + ".corrupt"; if (localStorage.getItem(k) === null) localStorage.setItem(k, raw); } catch {}
      return { ok: false, reason: "corrupt" };
    }
    const data = emptyStore();
    d.designs.forEach((x) => { data.designs.push(validate(x, { keepMeta: true }).design); });
    if (d.snaps && typeof d.snaps === "object") Object.keys(d.snaps).forEach((k) => {
      if (!Array.isArray(d.snaps[k])) return;
      data.snaps[k] = d.snaps[k].slice(0, MAX.snaps).filter((s) => s && typeof s === "object").map((s) => ({ id: str(s.id, 40) || uid(), name: str(s.name, 30), at: num(s.at, 0), design: validate(s.design, { keepMeta: true }).design }));
    });
    if (Array.isArray(d.trash)) d.trash.forEach((t) => {
      if (!t || typeof t !== "object" || !t.design) return;
      data.trash.push({ trashId: str(t.trashId, 40) || uid(), id: str(t.id, 40), name: str(t.name, 60), deletedAt: num(t.deletedAt, 0), expiresAt: num(t.expiresAt, 0), design: validate(t.design, { keepMeta: true }).design, snaps: Array.isArray(t.snaps) ? t.snaps.slice(0, MAX.snaps) : [] });
    });
    data.lastSeen = num(d.lastSeen, 0);
    return { ok: true, data, raw };
  }
  function writeStore(data, baseRaw) {
    let cur;
    try { cur = localStorage.getItem(KEY); } catch { return { ok: false, reason: "storage" }; }
    if (cur !== baseRaw) return { ok: false, reason: "conflict" };
    const text = JSON.stringify(data);
    try {
      localStorage.setItem(KEY, text);
      if (localStorage.getItem(KEY) !== text) throw new Error("verify");
      return { ok: true };
    } catch (e) {
      try { if (baseRaw === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, baseRaw); } catch {}
      return { ok: false, reason: e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) ? "quota" : "error" };
    }
  }
  const REASON = {
    quota: "저장 공간이 부족합니다. 설계 백업을 내려받은 뒤 휴지통을 비우거나 불필요한 설계를 정리하세요.", storage: "브라우저 저장소에 접근할 수 없습니다.", error: "저장하지 못했습니다.",
    conflict: "다른 탭에서 전기·전자 데이터가 바뀌었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요(현재 편집 내용은 JSON으로 내려받아 두세요).",
    corrupt: "저장된 전기·전자 데이터를 읽을 수 없어 안전을 위해 쓰기를 막았습니다. 원본은 'techcore.field.electric.v1.corrupt'에 보관했습니다.", notfound: "대상을 찾지 못했습니다.", full: "스냅샷은 설계마다 최대 " + MAX.snaps + "개입니다. 오래된 스냅샷을 삭제한 뒤 다시 저장하세요.",
  };
  function mutate(fn) {
    const r = readStore(); if (!r.ok) return r;
    const out = fn(r.data); if (out && out.ok === false) return out;
    const w = writeStore(r.data, r.raw); if (!w.ok) return w;
    return Object.assign({ ok: true }, out || {});
  }
  const touch = (data) => { data.lastSeen = Date.now(); };

  const api = {
    KEY, TYPES, MAX, DISCLAIMER, RETENTION_DAYS: 30, REASON, esc, uid, typeOf, pinIds, pinPos, newDesign, newPart, validate, extractJson, staticCheck, inner, toSvg, toJson, wirePath,
    read: readStore,
    create(design) { return mutate((s) => { s.designs.push(design); touch(s); return { design }; }); },
    // Saves one design. Refuses when the stored copy changed (other tab) after `baseUpdated` so nothing is silently overwritten.
    save(design, baseUpdated) {
      return mutate((s) => {
        const i = s.designs.findIndex((x) => x.id === design.id);
        if (i >= 0 && s.designs[i].updated > baseUpdated) return { ok: false, reason: "conflict" };
        const next = Object.assign({}, design, { updated: Date.now() });
        if (i >= 0) s.designs[i] = next; else s.designs.push(next);
        touch(s); return { updated: next.updated };
      });
    },
    trash(id) {
      return mutate((s) => {
        const i = s.designs.findIndex((x) => x.id === id); if (i < 0) return { ok: false, reason: "notfound" };
        const d = s.designs[i], now = Date.now();
        s.trash.push({ trashId: uid(), id: d.id, name: d.name, deletedAt: now, expiresAt: now + RETENTION_MS, design: d, snaps: s.snaps[id] || [] });
        s.designs.splice(i, 1); delete s.snaps[id]; touch(s);
      });
    },
    restore(trashId) {
      return mutate((s) => {
        const i = s.trash.findIndex((x) => x.trashId === trashId); if (i < 0) return { ok: false, reason: "notfound" };
        const t = s.trash[i], d = t.design;
        if (s.designs.some((x) => x.id === d.id)) d.id = uid();
        s.designs.push(d); if (t.snaps && t.snaps.length) s.snaps[d.id] = t.snaps;
        s.trash.splice(i, 1); touch(s); return { design: d };
      });
    },
    purge(trashId) { return mutate((s) => { const n = s.trash.length; s.trash = s.trash.filter((x) => x.trashId !== trashId); if (s.trash.length === n) return { ok: false, reason: "notfound" }; touch(s); }); },
    // Auto-expire is skipped when the PC clock looks wrong (earlier than last seen, or a very large jump).
    expire() {
      const r = readStore(); if (!r.ok) return { removed: 0 };
      const s = r.data, now = Date.now();
      if (s.lastSeen && (now < s.lastSeen - 5 * 60 * 1000 || now - s.lastSeen > CLOCK_JUMP_MS)) return { removed: 0, skipped: "clock" };
      const keep = s.trash.filter((t) => t.expiresAt > now), n = s.trash.length - keep.length;
      if (!n) return { removed: 0 };
      s.trash = keep; touch(s);
      return writeStore(s, r.raw).ok ? { removed: n } : { removed: 0, failed: true };
    },
    snapshots(id) { const r = readStore(); return r.ok ? (r.data.snaps[id] || []) : []; },
    addSnapshot(design, name) {
      return mutate((s) => {
        const a = s.snaps[design.id] = s.snaps[design.id] || [];
        if (a.length >= MAX.snaps) return { ok: false, reason: "full" };
        a.push({ id: uid(), name: str(name, 30) || new Date().toLocaleString("ko-KR"), at: Date.now(), design: JSON.parse(JSON.stringify(design)) }); touch(s);
      });
    },
    deleteSnapshot(designId, snapId) { return mutate((s) => { s.snaps[designId] = (s.snaps[designId] || []).filter((x) => x.id !== snapId); touch(s); }); },
    backup() { const r = readStore(); return r.ok ? { app: "TECHCORE", kind: "electric-backup", version: 1, exported: Date.now(), designs: r.data.designs } : null; },
    // Import never overwrites: every design is added as a new design with a new id. Returns skipped/warning counts.
    importAny(obj) {
      let list = [];
      if (obj && obj.kind === "electric-backup" && Array.isArray(obj.designs)) list = obj.designs;
      else if (obj && obj.kind === "electric-design" && obj.design) list = [obj.design];
      else if (obj && Array.isArray(obj.parts)) list = [obj];
      else return { ok: false, reason: "format" };
      const added = [], warnings = [];
      list.slice(0, 200).forEach((x) => { const v = validate(x, { defaultName: "가져온 설계" }); v.design.projectId = ""; added.push(v.design); warnings.push(...v.warnings); });
      if (!added.length) return { ok: false, reason: "format" };
      const w = mutate((s) => { s.designs.push(...added); touch(s); });
      return w.ok ? { ok: true, count: added.length, warnings: warnings.length, added } : w;
    },
    usageBytes() { try { const v = localStorage.getItem(KEY); return v ? v.length * 2 : 0; } catch { return 0; } },
  };
  return api;
})();
window.TechElectric = TechElectric;
