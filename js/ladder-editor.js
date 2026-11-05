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

    return {
      get doc() { return doc; },
      canUndo: () => undo.length > 0,
      canRedo: () => redo.length > 0,
      undo() { if (!undo.length) return false; redo.push(doc); doc = undo.pop(); return true; },
      redo() { if (!redo.length) return false; undo.push(doc); doc = redo.pop(); return true; },
      find: (id) => find(doc, id),
      isContactEditable: editableContact,
      isOutputEditable: editableOutput,
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
          if (!editableOutput(f.item)) return { ok: false, error: "이 출력은 S5에서 편집할 수 없습니다 (타이머·카운터·응용 명령은 S7 이후)." };
          const a = checkAddress(text, f.item.type === "rst" ? RST_PFX : COIL_PFX); if (!a.ok) return a;
          f.item.deviceRef = ensureDevice(d, a); f.item.args = [a.name];
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

  // UI: the model SVG with click selection, an edit panel and undo/redo. The host decides where it lives.
  function mount(host, doc, opts) {
    const ed = create(doc);
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const root = mk("div", "le"), bar = mk("div", "le-bar"), view = mk("div", "le-view"), panel = mk("div", "le-panel"), note = mk("p", "le-note", "편집 내용은 이 화면에서만 유지됩니다. 저장·IL 변환·IL 일치 검사는 아직 지원하지 않으며, PLC 컴파일 성공을 의미하지 않습니다.");
    const msg = mk("div", "le-msg"); msg.setAttribute("role", "status");
    const bUndo = mk("button", "btn sm", "되돌리기"), bRedo = mk("button", "btn sm", "다시 실행");
    bUndo.type = bRedo.type = "button";
    bar.append(bUndo, bRedo);
    root.append(bar, view, panel, msg, note);
    host.appendChild(root);
    let sel = null;

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
        panel.appendChild(mk("h4", null, "출력 " + (names[f.item.deviceRef] || "") + " (" + f.item.op + ")"));
        const ap = mk("button", "btn sm", "주소 적용"); ap.type = "button"; ap.onclick = () => run(ed.setOutputDevice(sel, input.value));
        const ty = mk("select"); ty.setAttribute("aria-label", "출력 종류");
        [["coil", "OUT"], ["set", "SET"], ["rst", "RST"]].forEach(([v, t]) => { const o = mk("option", null, t); o.value = v; if (v === f.item.type) o.selected = true; ty.appendChild(o); });
        ty.onchange = () => run(ed.setOutputType(sel, ty.value));
        row.append(input, ap, ty);
      }
      panel.appendChild(row);
    }
    view.addEventListener("click", (e) => { const g = e.target.closest && e.target.closest(".nd"); if (!g) return; sel = g.dataset.node; say(""); view.querySelectorAll(".nd.sel").forEach((x) => x.classList.remove("sel")); g.classList.add("sel"); form(); });
    bUndo.onclick = () => { if (ed.undo()) { say("되돌렸습니다."); draw(); } };
    bRedo.onclick = () => { if (ed.redo()) { say("다시 실행했습니다."); draw(); } };
    draw();
    return { editor: ed, destroy() { root.remove(); } };
  }

  return { create, mount, enabled, checkAddress, KEY };
})();
