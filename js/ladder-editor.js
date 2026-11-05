// Basic ladder editor (S5): select a contact/output in the model-based SVG, change its address, NO/NC or output type, undo/redo.
// Works only on PanelLadderModel documents. Edits are validated and rolled back on failure; the original IL (metadata.sourceIL) is never touched.
const PanelLadderEditor = (() => {
  const HEX = new Set(["X", "Y", "B"]);
  const CONTACT_PFX = ["SM", "SB", "ST", "SC", "X", "Y", "M", "L", "S", "B", "F", "V", "T", "C"];
  const COIL_PFX = ["Y", "M", "L", "S", "B", "F", "V"];
  const RST_PFX = COIL_PFX.concat(["T", "C"]);
  const OUT_OPS = { coil: "OUT", set: "SET", rst: "RST" };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const KEY = "panellab.ladderEditor";
  const isTC = (o) => !!o && (o.type === "timer" || o.type === "counter");
  // K constants only. The 0-32767 range is a conservative editor limit; CPU-specific ranges and time units are unconfirmed.
  function parsePreset(text) {
    const m = /^K?(\d{1,5})$/i.exec(String(text == null ? "" : text).trim());
    if (!m || +m[1] > 32767) return { ok: false, error: "설정값은 K0~K32767 범위의 상수여야 합니다." };
    return { ok: true, value: "K" + +m[1] };
  }
  const tcDupes = (d) => {
    const c = {}, out = new Set();
    d.networks.forEach((n) => (n.outputs || []).forEach((o) => { if (isTC(o)) { c[o.deviceRef] = (c[o.deviceRef] || 0) + 1; if (c[o.deviceRef] > 1) out.add(o.deviceRef); } }));
    return out;
  };

  function enabled() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }

  // Returns { ok, name } with the normalized address, or { ok:false, error }.
  function checkAddress(text, allowed) {
    const s = String(text == null ? "" : text).trim().toUpperCase();
    if (!s) return { ok: false, error: "디바이스 주소를 입력하세요." };
    const m = /^(SM|SB|ST|SC|X|Y|M|L|S|B|F|V|T|C)([0-9A-F]+)$/.exec(s);
    if (!m) return { ok: false, error: "지원하지 않는 디바이스 형식입니다: " + s };
    if (allowed.indexOf(m[1]) < 0) return { ok: false, error: m[1] + " 디바이스는 이 위치에 사용할 수 없습니다." };
    if (!HEX.has(m[1]) && !/^\d+$/.test(m[2])) return { ok: false, error: m[1] + " 디바이스 번호는 10진수여야 합니다." };
    if (s.length > 12) return { ok: false, error: "주소가 너무 깁니다." };
    return { ok: true, name: s, type: m[1] };
  }

  function find(doc, id) {
    for (const net of doc.networks) {
      if (net.metadata && net.metadata.status === "invalid") continue;
      for (const o of net.outputs || []) if (o.id === id) return { net, item: o, isOutput: true };
      let hit = null;
      (function walk(n) {
        if (hit || !n) return;
        if (n.id === id) { hit = n; return; }
        if (n.child) walk(n.child);
        (n.children || []).forEach(walk);
      })(net.logic);
      if (hit) return { net, item: hit, isOutput: false };
    }
    return null;
  }

  function referenced(doc) {
    const s = new Set();
    const add = (o) => { if (o && o.deviceRef) s.add(o.deviceRef); };
    doc.networks.forEach((net) => {
      (function walk(n) { if (!n) return; add(n); (n.operands || []).forEach(add); if (n.child) walk(n.child); (n.children || []).forEach(walk); })(net.logic);
      (net.outputs || []).forEach((o) => { add(o); add(o.preset); (o.operands || []).forEach(add); });
    });
    return s;
  }

  function create(initial) {
    if (!PanelLadderModel.validate(initial).ok) throw new Error("invalid model");
    let doc = clone(initial);
    const undo = [], redo = [];

    // Runs fn on a draft copy, validates it, and commits only if everything holds.
    function change(fn) {
      const draft = clone(doc);
      let r;
      try { r = fn(draft); } catch (e) { return { ok: false, error: "편집 중 오류가 발생해 취소했습니다." }; }
      if (r && r.ok === false) return r;
      if (JSON.stringify(draft) === JSON.stringify(doc)) return { ok: true, changed: false };
      const refs = referenced(draft);
      const before = tcDupes(doc), now = tcDupes(draft);
      for (const k of now) if (!before.has(k)) return { ok: false, error: k.replace("dev:", "") + " 타이머/카운터가 이미 다른 출력에 사용되고 있습니다." };
      draft.devices = draft.devices.filter((d) => refs.has(d.id));
      draft.metadata = Object.assign({}, draft.metadata, { edited: true, updatedAt: new Date().toISOString() });
      const v = PanelLadderModel.validate(draft);
      if (!v.ok) return { ok: false, error: "편집 결과가 모델 검증을 통과하지 못해 취소했습니다." };
      draft.validation = { status: v.issues.some((i) => i.lvl === "warn") ? "partial" : "valid", ilRoundTrip: "unverified", issues: v.issues };
      undo.push(doc); if (undo.length > 100) undo.shift();
      redo.length = 0;
      doc = draft;
      return { ok: true, changed: true };
    }
    const ensureDevice = (d, a) => {
      const id = "dev:" + a.name;
      if (!d.devices.some((x) => x.id === id)) d.devices.push({ id, name: a.name, type: a.type, comment: "" });
      return id;
    };
    const target = (d, id, wantOutput) => {
      const f = find(d, id);
      if (!f) return { ok: false, error: "대상을 찾을 수 없습니다." };
      if (f.net.metadata && f.net.metadata.readOnly) return { ok: false, error: "읽기 전용 네트워크입니다 (" + (f.net.metadata.readOnlyReason || "-") + ")." };
      if (f.isOutput !== wantOutput) return { ok: false, error: "대상 종류가 맞지 않습니다." };
      return f;
    };
    const editableContact = (n) => n.type === "contact" && !n.edgeOp && (n.kind === "NO" || n.kind === "NC") && n.deviceRef;
    const editableOutput = (o) => o.type === "coil" || o.type === "set" || o.type === "rst";

    // S6 structure helpers. The nesting cap is a conservative editor limit; the real maximum depth is still undecided.
    const MAX_PAR_DEPTH = 3;
    const seqOf = (d) => {
      let m = 0;
      const see = (id) => { const x = /^(?:n|o|net)-(\d+)$/.exec(id || ""); if (x) m = Math.max(m, +x[1]); };
      d.networks.forEach((net) => { see(net.id); (net.outputs || []).forEach((o) => see(o.id)); (function w(n) { if (!n) return; see(n.id); if (n.child) w(n.child); (n.children || []).forEach(w); })(net.logic); });
      return m;
    };
    const parDepth = (n) => !n ? 0 : Math.max(n.type === "parallel" ? 1 : 0, 0) + Math.max(0, n.child ? parDepth(n.child) : 0, ...(n.children || []).map(parDepth));
    const locate = (root, id) => {
      let res = null;
      (function w(n, parent, key, idx) {
        if (res || !n) return;
        if (n.id === id) { res = { node: n, parent, key, idx }; return; }
        if (n.child) w(n.child, n, "child", 0);
        (n.children || []).forEach((c, i) => w(c, n, "children", i));
      })(root, null, null, 0);
      return res;
    };
    const netTarget = (d, netId) => {
      const net = d.networks.find((x) => x.id === netId);
      if (!net) return { ok: false, error: "네트워크를 찾을 수 없습니다." };
      if (net.metadata && (net.metadata.readOnly || net.metadata.status === "invalid")) return { ok: false, error: "읽기 전용 네트워크입니다 (" + ((net.metadata && net.metadata.readOnlyReason) || "-") + ")." };
      return { ok: true, net };
    };
    const newContact = (d, seq, kind, text) => {
      const a = checkAddress(text, CONTACT_PFX); if (!a.ok) return a;
      if (kind !== "NO" && kind !== "NC") return { ok: false, error: "NO 또는 NC만 선택할 수 있습니다." };
      return { ok: true, node: { id: "n-" + String(seq).padStart(3, "0"), type: "contact", kind, deviceRef: ensureDevice(d, a) } };
    };
    const newOutput = (d, seq, type, text, preset) => {
      const id = "o-" + String(seq).padStart(3, "0");
      if (type === "timer" || type === "counter") {
        const a = checkAddress(text, [type === "timer" ? "T" : "C"]); if (!a.ok) return a;
        const k = parsePreset(preset); if (!k.ok) return k;
        return { ok: true, out: { id, op: "OUT", args: [a.name, k.value], type, preset: { literal: k.value }, deviceRef: ensureDevice(d, a) } };
      }
      if (!OUT_OPS[type]) return { ok: false, error: "OUT, SET, RST, 타이머, 카운터 중에서 선택하세요." };
      const a = checkAddress(text, type === "rst" ? RST_PFX : COIL_PFX); if (!a.ok) return a;
      return { ok: true, out: { id: "o-" + String(seq).padStart(3, "0"), op: OUT_OPS[type], args: [a.name], type, deviceRef: ensureDevice(d, a) } };
    };
    const put = (net, loc, node) => { if (!loc.parent) net.logic = node; else if (loc.key === "child") loc.parent.child = node; else loc.parent.children[loc.idx] = node; };

    return {
      get doc() { return doc; },
      load(next) {
        if (!next || !PanelLadderModel.validate(next).ok) return { ok: false, error: "복원할 모델이 올바르지 않습니다." };
        undo.push(doc); if (undo.length > 100) undo.shift(); redo.length = 0; doc = clone(next);
        return { ok: true };
      },
      // rel: "series-after" | "series-before" | "parallel"
      addContact(id, rel, kind, text) {
        return change((d) => {
          const f = target(d, id, false); if (f.ok === false) return f;
          if (["series-after", "series-before", "parallel"].indexOf(rel) < 0) return { ok: false, error: "알 수 없는 삽입 방식입니다." };
          const seq = seqOf(d), c = newContact(d, seq + 1, kind, text); if (!c.ok) return c;
          const loc = locate(f.net.logic, id), type = rel === "parallel" ? "parallel" : "series";
          if (loc.parent && loc.parent.type === type && loc.key === "children") loc.parent.children.splice(loc.idx + (rel === "series-before" ? 0 : 1), 0, c.node);
          else put(f.net, loc, { id: "n-" + String(seq + 2).padStart(3, "0"), type, children: rel === "series-before" ? [c.node, loc.node] : [loc.node, c.node] });
          if (parDepth(f.net.logic) > MAX_PAR_DEPTH) return { ok: false, error: "병렬 중첩은 " + MAX_PAR_DEPTH + "단계까지만 허용합니다." };
        });
      },
      deleteNode(id) {
        return change((d) => {
          const f = target(d, id, false); if (f.ok === false) return f;
          const loc = locate(f.net.logic, id);
          if (!loc.parent) return { ok: false, error: "네트워크의 유일한 접점은 삭제할 수 없습니다. 네트워크를 삭제하세요." };
          if (loc.key === "child") return { ok: false, error: "반전(NOT) 안의 접점은 삭제할 수 없습니다." };
          loc.parent.children.splice(loc.idx, 1);
          if (loc.parent.children.length === 1) { const gp = locate(f.net.logic, loc.parent.id); put(f.net, gp, loc.parent.children[0]); }
        });
      },
      addOutput(netId, type, text, preset) {
        return change((d) => {
          const t = netTarget(d, netId); if (!t.ok) return t;
          const o = newOutput(d, seqOf(d) + 1, type, text, preset); if (!o.ok) return o;
          t.net.outputs.push(o.out);
        });
      },
      deleteOutput(id) {
        return change((d) => {
          const f = target(d, id, true); if (f.ok === false) return f;
          if (f.net.outputs.length < 2) return { ok: false, error: "네트워크에는 출력이 최소 1개 필요합니다." };
          f.net.outputs = f.net.outputs.filter((o) => o.id !== id);
        });
      },
      addNetwork(afterNetId, contactText, outText) {
        return change((d) => {
          let at = d.networks.length;
          if (afterNetId) { const t = netTarget(d, afterNetId); if (!t.ok) return t; at = d.networks.indexOf(t.net) + 1; }
          const seq = seqOf(d), c = newContact(d, seq + 1, "NO", contactText); if (!c.ok) return c;
          const o = newOutput(d, seq + 2, "coil", outText); if (!o.ok) return o;
          d.networks.splice(at, 0, { id: "net-" + String(seq + 3).padStart(3, "0"), comment: "", logic: c.node, outputs: [o.out], layout: { autoArrange: true }, metadata: { source: "editor", ilRange: null, readOnly: false, readOnlyReason: null } });
        });
      },
      deleteNetwork(netId) {
        return change((d) => {
          const t = netTarget(d, netId); if (!t.ok) return t;
          if (d.networks.length < 2) return { ok: false, error: "마지막 네트워크는 삭제할 수 없습니다." };
          d.networks = d.networks.filter((n) => n !== t.net);
        });
      },
      moveNetwork(netId, delta) {
        return change((d) => {
          const t = netTarget(d, netId); if (!t.ok) return t;
          const i = d.networks.indexOf(t.net), j = i + (delta < 0 ? -1 : 1);
          if (j < 0 || j >= d.networks.length) return { ok: false, error: "더 이상 이동할 수 없습니다." };
          d.networks.splice(i, 1); d.networks.splice(j, 0, t.net);
        });
      },
      setNetworkComment(netId, text) {
        return change((d) => {
          const t = netTarget(d, netId); if (!t.ok) return t;
          t.net.comment = String(text == null ? "" : text).slice(0, 100);
        });
      },
      canUndo: () => undo.length > 0,
      canRedo: () => redo.length > 0,
      undo() { if (!undo.length) return false; redo.push(doc); doc = undo.pop(); return true; },
      redo() { if (!redo.length) return false; undo.push(doc); doc = redo.pop(); return true; },
      find: (id) => find(doc, id),
      isContactEditable: editableContact,
      isOutputEditable: (o) => editableOutput(o) || isTC(o),
      setContactDevice(id, text) {
        return change((d) => {
          const f = target(d, id, false); if (f.ok === false) return f;
          if (!editableContact(f.item)) return { ok: false, error: "이 접점은 S5에서 편집할 수 없습니다." };
          const a = checkAddress(text, CONTACT_PFX); if (!a.ok) return a;
          f.item.deviceRef = ensureDevice(d, a);
        });
      },
      setContactKind(id, kind) {
        return change((d) => {
          const f = target(d, id, false); if (f.ok === false) return f;
          if (!editableContact(f.item)) return { ok: false, error: "이 접점은 S5에서 편집할 수 없습니다." };
          if (kind !== "NO" && kind !== "NC") return { ok: false, error: "NO 또는 NC만 선택할 수 있습니다." };
          f.item.kind = kind;
        });
      },
      setOutputDevice(id, text) {
        return change((d) => {
          const f = target(d, id, true); if (f.ok === false) return f;
          if (!editableOutput(f.item) && !isTC(f.item)) return { ok: false, error: "이 출력은 편집할 수 없습니다 (응용 명령 등)." };
          const a = checkAddress(text, f.item.type === "timer" ? ["T"] : f.item.type === "counter" ? ["C"] : f.item.type === "rst" ? RST_PFX : COIL_PFX); if (!a.ok) return a;
          f.item.deviceRef = ensureDevice(d, a); f.item.args = isTC(f.item) ? [a.name, f.item.preset.literal] : [a.name];
        });
      },
      setPreset(id, text) {
        return change((d) => {
          const f = target(d, id, true); if (f.ok === false) return f;
          if (!isTC(f.item)) return { ok: false, error: "타이머·카운터만 설정값을 가집니다." };
          if (!f.item.preset || typeof f.item.preset.literal !== "string") return { ok: false, error: "K 상수가 아닌 설정값은 편집할 수 없습니다." };
          const k = parsePreset(text); if (!k.ok) return k;
          f.item.preset = { literal: k.value }; f.item.args = [f.item.args[0], k.value];
        });
      },
      setOutputType(id, type) {
        return change((d) => {
          const f = target(d, id, true); if (f.ok === false) return f;
          if (!editableOutput(f.item)) return { ok: false, error: "이 출력은 S5에서 편집할 수 없습니다 (타이머·카운터·응용 명령은 S7 이후)." };
          if (!OUT_OPS[type]) return { ok: false, error: "OUT, SET, RST 중에서 선택하세요." };
          const dev = d.devices.find((x) => x.id === f.item.deviceRef);
          if (dev && type !== "rst" && COIL_PFX.indexOf(dev.type) < 0) return { ok: false, error: dev.type + " 디바이스는 " + OUT_OPS[type] + " 대상으로 사용할 수 없습니다." };
          f.item.type = type; f.item.op = OUT_OPS[type];
        });
      }
    };
  }

  // Text summary of a model, used for version comparison and checks. Not IL.
  function exprOf(n, names) {
    if (!n) return "";
    const nm = (r) => names[r] || "?";
    if (n.type === "contact") return (n.kind === "NC" ? "/" : "") + (n.edgeOp ? n.edgeOp : nm(n.deviceRef));
    if (n.type === "compare") return "[" + (n.operands || []).map((o) => nm(o.deviceRef) === "?" && o.literal ? o.literal : nm(o.deviceRef)).join(" " + n.op + " ") + "]";
    if (n.type === "not") return "NOT(" + exprOf(n.child, names) + ")";
    if (n.type === "series") return (n.children || []).map((c) => exprOf(c, names)).join(" · ");
    if (n.type === "parallel") return "(" + (n.children || []).map((c) => exprOf(c, names)).join(" + ") + ")";
    return "?";
  }
  function outOf(o, names) { return o.op + " " + (o.args && o.args.length ? o.args.join(" ") : names[o.deviceRef] || "?"); }
  function summarize(doc) {
    const names = {}; (doc.devices || []).forEach((d) => { names[d.id] = d.name; });
    return doc.networks.map((n) => ({
      id: n.id, comment: n.comment || "",
      cond: n.metadata && n.metadata.status === "invalid" ? "(검증되지 않은 네트워크)" : exprOf(n.logic, names),
      outs: n.metadata && n.metadata.status === "invalid" ? [] : (n.outputs || []).map((o) => outOf(o, names))
    }));
  }
  function diff(a, b) {
    const A = summarize(a), B = summarize(b), ch = [], byA = {}, byB = {};
    A.forEach((n) => { byA[n.id] = n; }); B.forEach((n) => { byB[n.id] = n; });
    A.forEach((n) => { if (!byB[n.id]) ch.push("삭제: " + n.id + " [" + n.cond + " → " + n.outs.join(", ") + "]"); });
    B.forEach((n) => {
      const o = byA[n.id];
      if (!o) { ch.push("추가: " + n.id + " [" + n.cond + " → " + n.outs.join(", ") + "]"); return; }
      if (o.cond !== n.cond) ch.push(n.id + " 조건: " + o.cond + " → " + n.cond);
      if (o.outs.join("|") !== n.outs.join("|")) ch.push(n.id + " 출력: " + o.outs.join(", ") + " → " + n.outs.join(", "));
      if (o.comment !== n.comment) ch.push(n.id + " 설명 변경");
    });
    const common = (x, y) => x.filter((n) => y.some((m) => m.id === n.id)).map((n) => n.id).join();
    if (common(A, B) !== common(B, A)) ch.push("네트워크 순서가 바뀌었습니다.");
    return ch;
  }
  // PanelLab's own checks on the model. This is not a PLC compile result and does not replace the IL analyzer.
  function check(doc) {
    const f = [], names = {}; (doc.devices || []).forEach((d) => { names[d.id] = d.name; });
    const v = PanelLadderModel.validate(doc);
    v.issues.forEach((i) => f.push({ source: "ladder-editor", lvl: i.lvl === "warn" ? "warning" : "error", code: i.path, desc: i.msg }));
    if (!v.ok) return f;
    const coils = {}, sets = {}, rsts = {}, used = new Set();
    const useC = (n) => { if (!n) return; if (n.deviceRef) used.add(n.deviceRef); (n.operands || []).forEach((o) => o.deviceRef && used.add(o.deviceRef)); if (n.child) useC(n.child); (n.children || []).forEach(useC); };
    doc.networks.forEach((n) => {
      if (n.metadata && n.metadata.status === "invalid") return;
      useC(n.logic);
      (n.outputs || []).forEach((o) => {
        if (o.type === "coil") coils[o.deviceRef] = (coils[o.deviceRef] || 0) + 1;
        if (o.type === "set") sets[o.deviceRef] = 1;
        if (o.type === "rst") rsts[o.deviceRef] = 1;
      });
    });
    Object.keys(coils).forEach((k) => { if (coils[k] > 1) f.push({ source: "ladder-editor", lvl: "warning", code: names[k], desc: names[k] + " 코일(OUT)이 " + coils[k] + "곳에서 사용되었습니다 (이중 코일)." }); });
    Object.keys(sets).forEach((k) => { if (!rsts[k]) f.push({ source: "ladder-editor", lvl: "warning", code: names[k], desc: names[k] + "에 SET만 있고 RST가 없습니다." }); });
    doc.networks.forEach((n) => (n.outputs || []).forEach((o) => { if ((o.type === "timer" || o.type === "counter") && !used.has(o.deviceRef)) f.push({ source: "ladder-editor", lvl: "warning", code: names[o.deviceRef], desc: names[o.deviceRef] + " " + (o.type === "timer" ? "타이머" : "카운터") + "의 접점이 회로에서 사용되지 않습니다." }); }));
    return f;
  }

  // UI: the model SVG with click selection, an edit panel and undo/redo. The host decides where it lives.
  function mount(host, doc, opts) {
    const ed = create(doc);
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const root = mk("div", "le"), bar = mk("div", "le-bar"), view = mk("div", "le-view"), panel = mk("div", "le-panel"), note = mk("p", "le-note", "편집 내용은 [저장]을 눌러야 보관되며 래더 모델로만 저장됩니다. 원본 IL과 현재 코드는 바뀌지 않고, IL 변환·IL 일치 검사는 지원하지 않습니다. 편집 검사는 PanelLab 자체 검사이며 PLC 컴파일 성공을 의미하지 않습니다.");
    const msg = mk("div", "le-msg"); msg.setAttribute("role", "status");
    const bUndo = mk("button", "btn sm", "되돌리기"), bRedo = mk("button", "btn sm", "다시 실행");
    bUndo.type = bRedo.type = "button";
    bar.append(bUndo, bRedo);
    const rep = mk("div", "le-rep");
    const bChk = mk("button", "btn sm", "편집 검사"); bChk.type = "button";
    bChk.onclick = () => {
      const fs = check(ed.doc); rep.textContent = "";
      rep.appendChild(mk("strong", null, "편집 검사 결과 (PanelLab 자체 검사 · PLC 컴파일 결과 아님)"));
      if (!fs.length) rep.appendChild(mk("p", "muted", "발견된 문제가 없습니다. 이는 확인한 규칙 범위 안에서만 의미가 있습니다."));
      fs.forEach((x) => rep.appendChild(mk("p", x.lvl === "error" ? "notice-inline" : "muted", (x.lvl === "error" ? "오류: " : "주의: ") + x.desc)));
    };
    bar.append(bChk);
    if (opts && opts.onSave) {
      const bSave = mk("button", "btn sm", "저장"); bSave.type = "button";
      const vs = mk("select"); vs.setAttribute("aria-label", "저장된 버전");
      const bRes = mk("button", "btn sm", "복원"), bCmp = mk("button", "btn sm", "현재와 비교"); bRes.type = bCmp.type = "button";
      const vers = () => (opts.versions ? opts.versions() : []);
      const fill = () => { vs.textContent = ""; vers().forEach((v) => { const o = mk("option", null, "v" + v.n + " · " + new Date(v.ts).toLocaleString() + (v.label ? " · " + v.label : "")); o.value = v.id; vs.appendChild(o); }); bRes.disabled = bCmp.disabled = !vs.options.length; };
      bSave.onclick = () => { const r = opts.onSave(ed.doc); say(r && r.ok ? "저장했습니다 (래더 모델)." : (r && r.error) || "저장하지 못했습니다.", !(r && r.ok)); fill(); };
      const pick = () => vers().find((v) => v.id === vs.value);
      bRes.onclick = () => { const v = pick(); if (!v) return; const r = ed.load(v.doc); if (r.ok) { say("v" + v.n + "을 복원했습니다. 되돌리기로 취소할 수 있습니다."); draw(); } else say(r.error, true); };
      bCmp.onclick = () => { const v = pick(); if (!v) return; const ch = diff(v.doc, ed.doc); rep.textContent = ""; rep.appendChild(mk("strong", null, "v" + v.n + " → 현재 변경 사항")); if (!ch.length) rep.appendChild(mk("p", "muted", "차이가 없습니다.")); ch.forEach((c) => rep.appendChild(mk("p", "muted", c))); };
      bar.append(bSave, vs, bRes, bCmp); fill();
    }
    root.append(bar, view, panel, msg, rep, note);
    host.appendChild(root);
    let sel = null;
    const isTCo = (o) => o.type === "timer" || o.type === "counter";

    function say(t, bad) { msg.textContent = t || ""; msg.classList.toggle("bad", !!bad); }
    function draw() {
      const svg = PanelLadder.renderModel(ed.doc, { ids: true });
      view.innerHTML = svg || "";
      if (!svg) view.textContent = "래더를 표시할 수 없습니다.";
      const g = sel && view.querySelector('.nd[data-node="' + sel + '"]'); if (g) g.classList.add("sel"); else sel = null;
      bUndo.disabled = !ed.canUndo(); bRedo.disabled = !ed.canRedo();
      form();
      if (opts && opts.onChange) opts.onChange(ed.doc);
    }
    function run(res) { if (!res.ok) say(res.error, true); else say(res.changed ? "적용했습니다." : "변경 사항이 없습니다."); if (res.ok) draw(); }
    function form() {
      panel.textContent = "";
      const f = sel && ed.find(sel);
      if (!f) { panel.appendChild(mk("p", "muted", "접점이나 출력을 눌러 선택하세요.")); return; }
      const ro = f.net.metadata && f.net.metadata.readOnly;
      const names = {}; ed.doc.devices.forEach((d) => { names[d.id] = d.name; });
      const input = mk("input"); input.type = "text"; input.maxLength = 12; input.value = names[f.item.deviceRef] || "";
      input.setAttribute("aria-label", "디바이스 주소");
      const row = mk("div", "row gap");
      if (ro) { panel.appendChild(mk("p", "notice-inline", "읽기 전용 네트워크입니다 (" + (f.net.metadata.readOnlyReason || "-") + "). 편집할 수 없습니다.")); return; }
      if (!f.isOutput) {
        if (!ed.isContactEditable(f.item)) { panel.appendChild(mk("p", "muted", "이 접점은 현재 단계에서 편집할 수 없습니다.")); return; }
        panel.appendChild(mk("h4", null, "접점 " + (names[f.item.deviceRef] || "") + " (" + f.item.kind + ")"));
        const ap = mk("button", "btn sm", "주소 적용"); ap.type = "button"; ap.onclick = () => run(ed.setContactDevice(sel, input.value));
        const no = mk("button", "btn sm", "NO"), nc = mk("button", "btn sm", "NC");
        no.type = nc.type = "button"; no.onclick = () => run(ed.setContactKind(sel, "NO")); nc.onclick = () => run(ed.setContactKind(sel, "NC"));
        row.append(input, ap, no, nc);
      } else {
        if (!ed.isOutputEditable(f.item)) { panel.appendChild(mk("p", "muted", "이 출력(" + f.item.type + ")은 현재 단계에서 편집할 수 없습니다.")); return; }
        panel.appendChild(mk("h4", null, (isTCo(f.item) ? (f.item.type === "timer" ? "타이머 " : "카운터 ") : "출력 ") + (names[f.item.deviceRef] || "") + " (" + f.item.op + (f.item.preset ? " " + f.item.preset.literal : "") + ")"));
        const ap = mk("button", "btn sm", "주소 적용"); ap.type = "button"; ap.onclick = () => run(ed.setOutputDevice(sel, input.value));
        if (isTCo(f.item)) {
          const pin = mk("input"); pin.type = "text"; pin.maxLength = 6; pin.value = (f.item.preset && f.item.preset.literal) || ""; pin.setAttribute("aria-label", "설정값");
          const pb = mk("button", "btn sm", "설정값 적용"); pb.type = "button"; pb.onclick = () => run(ed.setPreset(sel, pin.value));
          row.append(input, ap, pin, pb);
        } else {
        const ty = mk("select"); ty.setAttribute("aria-label", "출력 종류");
        [["coil", "OUT"], ["set", "SET"], ["rst", "RST"]].forEach(([v, t]) => { const o = mk("option", null, t); o.value = v; if (v === f.item.type) o.selected = true; ty.appendChild(o); });
        ty.onchange = () => run(ed.setOutputType(sel, ty.value));
        row.append(input, ap, ty);
        }
      }
      panel.appendChild(row);
      const nin = mk("input"); nin.type = "text"; nin.maxLength = 12; nin.placeholder = "새 주소"; nin.setAttribute("aria-label", "추가할 디바이스 주소");
      const nk = mk("select"); nk.setAttribute("aria-label", "추가할 종류");
      (f.isOutput ? [["coil", "OUT"], ["set", "SET"], ["rst", "RST"], ["timer", "타이머 OUT T"], ["counter", "카운터 OUT C"]] : [["NO", "NO"], ["NC", "NC"]]).forEach(([v, t]) => { const o = mk("option", null, t); o.value = v; nk.appendChild(o); });
      const kin = mk("input"); kin.type = "text"; kin.maxLength = 6; kin.placeholder = "설정값 K"; kin.setAttribute("aria-label", "추가할 설정값");
      const btn = (label, fn) => { const b = mk("button", "btn sm", label); b.type = "button"; b.onclick = () => run(fn()); return b; };
      const s = mk("div", "row gap");
      s.append(nin, nk); if (f.isOutput) s.append(kin);
      if (!f.isOutput) s.append(btn("직렬 뒤", () => ed.addContact(sel, "series-after", nk.value, nin.value)), btn("직렬 앞", () => ed.addContact(sel, "series-before", nk.value, nin.value)), btn("병렬", () => ed.addContact(sel, "parallel", nk.value, nin.value)), btn("접점 삭제", () => { const r = ed.deleteNode(sel); if (r.ok) sel = null; return r; }));
      else s.append(btn("출력 추가", () => ed.addOutput(f.net.id, nk.value, nin.value, kin.value)), btn("출력 삭제", () => { const r = ed.deleteOutput(sel); if (r.ok) sel = null; return r; }));
      panel.appendChild(s);
      const nr = mk("div", "row gap"), cm = mk("input"); cm.type = "text"; cm.maxLength = 100; cm.value = f.net.comment || ""; cm.placeholder = "네트워크 설명"; cm.setAttribute("aria-label", "네트워크 설명");
      nr.append(cm, btn("설명 적용", () => ed.setNetworkComment(f.net.id, cm.value)), btn("네트워크 위로", () => ed.moveNetwork(f.net.id, -1)), btn("네트워크 아래로", () => ed.moveNetwork(f.net.id, 1)), btn("네트워크 삭제", () => { const r = ed.deleteNetwork(f.net.id); if (r.ok) sel = null; return r; }), btn("새 네트워크 추가(X0→Y0)", () => ed.addNetwork(f.net.id, "X0", "Y0")));
      panel.appendChild(nr);
    }
    view.addEventListener("click", (e) => { const g = e.target.closest && e.target.closest(".nd"); if (!g) return; sel = g.dataset.node; say(""); view.querySelectorAll(".nd.sel").forEach((x) => x.classList.remove("sel")); g.classList.add("sel"); form(); });
    bUndo.onclick = () => { if (ed.undo()) { say("되돌렸습니다."); draw(); } };
    bRedo.onclick = () => { if (ed.redo()) { say("다시 실행했습니다."); draw(); } };
    draw();
    return { editor: ed, destroy() { root.remove(); } };
  }

  return { create, mount, enabled, checkAddress, summarize, diff, check, KEY };
})();
