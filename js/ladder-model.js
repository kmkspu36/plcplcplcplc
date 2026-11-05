// Ladder JSON model (schema v1): builds a document from IL using PanelLadder.parse and validates it.
// S1 scope: IL -> model only. Model -> IL is intentionally not provided until the conversion is verified.
const PanelLadderModel = (() => {
  const SCHEMA_VERSION = 1, DOC_TYPE = "panellab.ladder";
  const APPLY_OPS = new Set(["MOV", "DMOV", "ADD", "SUB", "MUL", "DIV", "DADD", "DSUB", "DMUL", "DDIV", "INC", "DEC", "CMP", "ZRST", "BMOV", "FMOV", "WAND", "WOR", "WXOR", "NEG", "SFTL", "SFTR"]);
  const LITERAL = /^(K-?\d+|H[0-9A-F]+|E-?[\d.]+(E[+-]?\d+)?|"[^"]*")$/i;
  const DEVICE = /^([A-Z]{1,2})([0-9A-F]+)/i;
  const TCRE = /^(S?T|S?C)\d/i;

  const LD_RE = /^(LD(I|P|F|PI|FI)?|LD[DE]?(=|<>|>=|<=|>|<))$/;
  const COMB_RE = /^((AND|OR)(I|P|F|PI|FI)?|(AND|OR)[DE]?(=|<>|>=|<=|>|<)|ANB|ORB|INV|MEP|MEF|MRD)$/;
  const WIDE_CMP = /^(LD|AND|OR)[DE](=|<>|>=|<=|>|<)$/i;

  // Splits IL into rung-sized blocks using the same boundaries PanelLadder.parse uses (an LD after an output starts a new rung outside MPS groups).
  function segments(code) {
    const lines = String(code).split("\n"), segs = [];
    let cur = null, depth = 0, prevOut = false;
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li].replace(/;.*$/, "").replace(/\/\/.*$/, "").trim();
      if (!raw) continue;
      const t = raw.split(/\s+/);
      if (/^\d+$/.test(t[0]) && t.length > 1) t.shift();
      const op = ({ ANI: "ANDI" }[t[0].toUpperCase()] || t[0].toUpperCase());
      if (op === "END") break;
      if (op === "NOP") continue;
      const isLd = LD_RE.test(op), isMps = op === "MPS" || op === "MPP";
      if (isLd && prevOut && depth === 0) { segs.push(cur); cur = null; }
      if (isLd) prevOut = false;
      if (!cur) cur = { start: li + 1, end: li + 1, hasOut: false };
      cur.end = li + 1;
      if (op === "MPS") depth++;
      else if (op === "MPP") depth = Math.max(0, depth - 1);
      if (!isLd && !isMps && !COMB_RE.test(op)) { prevOut = true; cur.hasOut = true; }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  function build(code, opts) {
    opts = opts || {};
    code = String(code || "");
    let items = [];
    if (opts.isolate) {
      const lines = code.split("\n");
      segments(code).forEach((s) => {
        const text = "\n".repeat(s.start - 1) + lines.slice(s.start - 1, s.end).join("\n");
        const rs = s.hasOut ? PanelLadder.parse(text) : null;
        if (rs) rs.forEach((r) => items.push({ r }));
        else items.push({ bad: { start: s.start, end: s.end, reason: s.hasOut ? "parse-failed" : "no-output", rawLines: lines.slice(s.start - 1, s.end) } });
      });
      if (!items.length) return { ok: false, error: "parse-failed", doc: null };
    } else {
      const rungs = PanelLadder.parse(code);
      if (!rungs) return { ok: false, error: "parse-failed", doc: null };
      items = rungs.map((r) => ({ r }));
    }
    let seq = 0;
    const nid = (p) => p + "-" + String(++seq).padStart(3, "0");
    const devices = [], devIdx = {};

    function ref(text) {
      const s = String(text);
      if (LITERAL.test(s)) return { literal: s };
      const m = DEVICE.exec(s);
      if (!m) return { raw: s };
      const key = s.toUpperCase();
      if (!devIdx[key]) { devIdx[key] = "dev:" + key; devices.push({ id: devIdx[key], name: key, type: m[1].toUpperCase(), comment: "" }); }
      return { deviceRef: devIdx[key] };
    }

    function node(n) {
      if (n.t === "c") {
        if (n.k === "CMP") {
          return { id: nid("n"), type: "compare", op: n.sym, operands: (n.args || []).map(ref) };
        }
        if ((n.d === "MEP" || n.d === "MEF") && (n.k === "P" || n.k === "F")) return { id: nid("n"), type: "contact", kind: n.k, edgeOp: n.d };
        return Object.assign({ id: nid("n"), type: "contact", kind: n.k }, ref(n.d));
      }
      if (n.t === "i") return { id: nid("n"), type: "not", child: node(n.n[0]) };
      const type = n.t === "s" ? "series" : "parallel", kids = [];
      (function flat(x) { if (x.t === n.t) x.n.forEach(flat); else kids.push(x); })(n);
      return { id: nid("n"), type, children: kids.map(node) };
    }

    function output(o, rung) {
      const op = o.op.toUpperCase(), a = o.args, base = { id: nid("o"), op, args: a.slice() };
      if (op === "OUT" && a.length === 1 && !TCRE.test(a[0])) return Object.assign(base, { type: "coil" }, ref(a[0]));
      if ((op === "SET" || op === "RST") && a.length === 1) return Object.assign(base, { type: op.toLowerCase() }, ref(a[0]));
      if (a.length >= 2 && TCRE.test(a[0]) && (op === "OUT" || op === "TIM" || op === "CNT")) {
        const kind = /^S?T/i.test(a[0]) ? "timer" : "counter";
        return Object.assign(base, { type: kind, preset: ref(a[1]) }, ref(a[0]));
      }
      if (APPLY_OPS.has(op)) return Object.assign(base, { type: "apply", operands: a.map(ref) });
      return Object.assign(base, { type: "raw", text: [op].concat(a).join(" ") });
    }

    const src = code.split("\n");
    const readOnlyOf = (lines) => {
      if (lines.some((l) => /^\s*(MPS|MRD|MPP)\b/i.test(l))) return "MPS/MRD/MPP";
      if (lines.some((l) => WIDE_CMP.test(l.trim().split(/\s+/)[0] || ""))) return "compare-width-unpreserved";
      return null;
    };
    const networks = items.map((it, i) => {
      const id = "net-" + String(i + 1).padStart(3, "0");
      if (it.bad) {
        return { id, comment: "", logic: null, outputs: [], layout: { autoArrange: true }, metadata: { source: opts.origin || "il", ilRange: { start: it.bad.start, end: it.bad.end }, readOnly: true, readOnlyReason: it.bad.reason, status: "invalid", rawLines: it.bad.rawLines } };
      }
      const r = it.r, reason = readOnlyOf(src.slice(r.start - 1, r.end));
      return {
        id,
        comment: "",
        logic: node(r.cond),
        outputs: r.outs.map((o) => output(o, r)),
        layout: { autoArrange: true },
        metadata: { source: opts.origin || "il", ilRange: { start: r.start, end: r.end }, readOnly: !!reason, readOnlyReason: reason }
      };
    });
    // MPS/MRD/MPP also feed rungs after the group start, so any rung in a branch group is read-only.
    if (/^\s*(MPS|MRD|MPP)\b/im.test(code)) networks.forEach((n) => { n.metadata.readOnly = true; if (!n.metadata.status) n.metadata.readOnlyReason = "MPS/MRD/MPP"; });

    const doc = {
      schemaVersion: SCHEMA_VERSION,
      documentType: DOC_TYPE,
      project: { plcBrand: "Mitsubishi", gxWorksVersion: "UNCONFIRMED", cpuModel: "UNCONFIRMED" },
      devices,
      networks,
      validation: { status: "unchecked", ilRoundTrip: "unverified", issues: [] },
      metadata: { sourceIL: code, origin: opts.origin || "il", createdAt: null, updatedAt: null }
    };
    const v = validate(doc);
    const isolated = networks.filter((n) => n.metadata.status === "invalid").length;
    doc.validation = { status: !v.ok ? "invalid" : isolated ? "partial" : "valid", ilRoundTrip: "unverified", issues: v.issues };
    return { ok: v.ok, partial: v.ok && isolated > 0, isolated, error: v.ok ? null : "invalid-model", doc };
  }

  // Pulls the first JSON object that claims to be a PanelLab ladder document out of an AI reply (fenced block first, then balanced braces).
  function extractJson(text) {
    text = String(text || "");
    const cands = [];
    const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
    let m;
    while ((m = fence.exec(text))) cands.push(m[1]);
    let from = 0, tries = 0;
    while (tries++ < 20) {
      const s = text.indexOf("{", from);
      if (s < 0) break;
      let depth = 0, inStr = false, esc = false, e = -1;
      for (let i = s; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) { e = i; break; }
      }
      if (e < 0) break;
      cands.push(text.slice(s, e + 1));
      from = e + 1;
    }
    let sawJson = false;
    for (const c of cands) {
      let o;
      try { o = JSON.parse(c.trim()); } catch (err) { continue; }
      sawJson = true;
      if (o && typeof o === "object" && o.documentType === DOC_TYPE) return { ok: true, doc: o };
    }
    return { ok: false, error: sawJson ? "no-ladder-document" : cands.length ? "json-parse" : "no-json" };
  }

  // AI reply -> validated model. Nothing is repaired or guessed: any structural problem rejects the whole document.
  function fromAI(text) {
    const x = extractJson(text);
    if (!x.ok) return { ok: false, error: x.error, doc: null, issues: [] };
    const doc = x.doc;
    let v;
    try { v = validate(doc); } catch (e) { return { ok: false, error: "invalid-model", doc: null, issues: [{ path: "", msg: "validation threw", lvl: "error" }] }; }
    if (!v.ok) return { ok: false, error: "invalid-model", doc: null, issues: v.issues };
    doc.validation = { status: v.issues.length ? "partial" : "valid", ilRoundTrip: "unverified", issues: v.issues };
    doc.metadata = Object.assign({}, doc.metadata, { origin: "ai", sourceIL: doc.metadata && typeof doc.metadata.sourceIL === "string" ? doc.metadata.sourceIL : null });
    return { ok: true, error: null, doc, issues: v.issues };
  }

  function validate(doc) {
    const issues = [], ids = new Set();
    const add = (path, msg, lvl) => issues.push({ path, msg, lvl: lvl || "error" });
    const useId = (o, path) => {
      if (!o || typeof o.id !== "string" || !o.id) return add(path, "missing id");
      if (ids.has(o.id)) add(path, "duplicate id " + o.id); else ids.add(o.id);
    };
    if (!doc || doc.documentType !== DOC_TYPE) return { ok: false, issues: [{ path: "", msg: "wrong documentType" }] };
    if (doc.schemaVersion !== SCHEMA_VERSION) add("", "unsupported schemaVersion");
    if (!Array.isArray(doc.networks) || !doc.networks.length) add("networks", "networks must be a non-empty array");
    if (!Array.isArray(doc.devices)) add("devices", "devices must be an array");
    else { const seen = new Set(); doc.devices.forEach((d, i) => { if (!d || typeof d.id !== "string" || typeof d.name !== "string" || !d.name) add("devices[" + i + "]", "device needs id and name"); else if (seen.has(d.id)) add("devices[" + i + "]", "duplicate device id " + d.id); else seen.add(d.id); }); }
    const devs = new Set((Array.isArray(doc.devices) ? doc.devices : []).map((d) => d && d.id));
    const chkRef = (o, path) => { if (o.deviceRef && !devs.has(o.deviceRef)) add(path, "unknown deviceRef " + o.deviceRef); };
    function walk(n, path) {
      if (!n || typeof n !== "object") return add(path, "empty node");
      useId(n, path);
      if (n.type === "contact") { if (!n.deviceRef && !n.edgeOp && !n.raw) add(path, "contact without device"); chkRef(n, path); }
      else if (n.type === "compare") { if (!Array.isArray(n.operands) || n.operands.length < 2) add(path, "compare needs 2 operands"); else n.operands.forEach((o) => chkRef(o, path)); }
      else if (n.type === "not") walk(n.child, path + ".child");
      else if (n.type === "series" || n.type === "parallel") {
        if (!Array.isArray(n.children) || n.children.length < 2) add(path, n.type + " needs 2+ children");
        else n.children.forEach((c, i) => walk(c, path + ".children[" + i + "]"));
      } else add(path, "unknown node type " + n.type);
    }
    (Array.isArray(doc.networks) ? doc.networks : []).forEach((net, i) => {
      const p = "networks[" + i + "]";
      if (!net || typeof net !== "object") return add(p, "network is not an object");
      useId(net, p);
      if (net.metadata && net.metadata.status === "invalid") {
        if (!net.metadata.readOnlyReason) add(p, "isolated network without reason");
        else if (!Array.isArray(net.metadata.rawLines) || !net.metadata.rawLines.length) add(p, "isolated network lost its raw lines");
        else add(p, "network isolated: " + net.metadata.readOnlyReason, "warn");
        return;
      }
      walk(net.logic, p + ".logic");
      if (!Array.isArray(net.outputs) || !net.outputs.length) add(p + ".outputs", "no outputs");
      else net.outputs.forEach((o, j) => {
        const op = p + ".outputs[" + j + "]";
        useId(o, op);
        if (["coil", "set", "rst", "timer", "counter", "apply", "raw"].indexOf(o.type) < 0) add(op, "unknown output type " + o.type);
        chkRef(o, op);
      });
    });
    const errs = issues.filter((i) => i.lvl === "error");
    const nets = Array.isArray(doc.networks) ? doc.networks : [];
    const valid = nets.filter((n) => n && typeof n === "object" && !(n.metadata && n.metadata.status === "invalid")).length;
    if (!errs.length && nets.length && !valid) { add("networks", "no valid network", "error"); return { ok: false, issues }; }
    return { ok: errs.length === 0, issues };
  }

  return { build, validate, extractJson, fromAI, SCHEMA_VERSION, DOC_TYPE };
})();
