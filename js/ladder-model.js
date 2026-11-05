// Ladder JSON model (schema v1): builds a document from IL using PanelLadder.parse and validates it.
// S1 scope: IL -> model only. Model -> IL is intentionally not provided until the conversion is verified.
const PanelLadderModel = (() => {
  const SCHEMA_VERSION = 1, DOC_TYPE = "panellab.ladder";
  const APPLY_OPS = new Set(["MOV", "DMOV", "ADD", "SUB", "MUL", "DIV", "DADD", "DSUB", "DMUL", "DDIV", "INC", "DEC", "CMP", "ZRST", "BMOV", "FMOV", "WAND", "WOR", "WXOR", "NEG", "SFTL", "SFTR"]);
  const LITERAL = /^(K-?\d+|H[0-9A-F]+|E-?[\d.]+(E[+-]?\d+)?|"[^"]*")$/i;
  const DEVICE = /^([A-Z]{1,2})([0-9A-F]+)/i;
  const TCRE = /^(S?T|S?C)\d/i;

  function build(code, opts) {
    opts = opts || {};
    const rungs = PanelLadder.parse(String(code || ""));
    if (!rungs) return { ok: false, error: "parse-failed", doc: null };
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

    const src = String(code).split("\n");
    const networks = rungs.map((r, i) => {
      const lines = src.slice(r.start - 1, r.end);
      const hasMps = lines.some((l) => /^\s*(MPS|MRD|MPP)\b/i.test(l));
      return {
        id: "net-" + String(i + 1).padStart(3, "0"),
        comment: "",
        logic: node(r.cond),
        outputs: r.outs.map((o) => output(o, r)),
        layout: { autoArrange: true },
        metadata: { source: opts.origin || "il", ilRange: { start: r.start, end: r.end }, readOnly: hasMps, readOnlyReason: hasMps ? "MPS/MRD/MPP" : null }
      };
    });
    // MPS/MRD/MPP also feed rungs after the group start, so any rung in a branch group is read-only.
    const anyMps = /^\s*(MPS|MRD|MPP)\b/im.test(String(code));
    if (anyMps) networks.forEach((n) => { n.metadata.readOnly = true; n.metadata.readOnlyReason = "MPS/MRD/MPP"; });

    const doc = {
      schemaVersion: SCHEMA_VERSION,
      documentType: DOC_TYPE,
      project: { plcBrand: "Mitsubishi", gxWorksVersion: "UNCONFIRMED", cpuModel: "UNCONFIRMED" },
      devices,
      networks,
      validation: { status: "unchecked", ilRoundTrip: "unverified", issues: [] },
      metadata: { sourceIL: String(code), origin: opts.origin || "il", createdAt: null, updatedAt: null }
    };
    const v = validate(doc);
    doc.validation = { status: v.ok ? "valid" : "invalid", ilRoundTrip: "unverified", issues: v.issues };
    return { ok: v.ok, error: v.ok ? null : "invalid-model", doc };
  }

  function validate(doc) {
    const issues = [], ids = new Set();
    const add = (path, msg) => issues.push({ path, msg });
    const useId = (o, path) => {
      if (!o || typeof o.id !== "string" || !o.id) return add(path, "missing id");
      if (ids.has(o.id)) add(path, "duplicate id " + o.id); else ids.add(o.id);
    };
    if (!doc || doc.documentType !== DOC_TYPE) return { ok: false, issues: [{ path: "", msg: "wrong documentType" }] };
    if (doc.schemaVersion !== SCHEMA_VERSION) add("", "unsupported schemaVersion");
    const devs = new Set((doc.devices || []).map((d) => d.id));
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
    (doc.networks || []).forEach((net, i) => {
      const p = "networks[" + i + "]";
      useId(net, p);
      walk(net.logic, p + ".logic");
      if (!Array.isArray(net.outputs) || !net.outputs.length) add(p + ".outputs", "no outputs");
      else net.outputs.forEach((o, j) => {
        const op = p + ".outputs[" + j + "]";
        useId(o, op);
        if (["coil", "set", "rst", "timer", "counter", "apply", "raw"].indexOf(o.type) < 0) add(op, "unknown output type " + o.type);
        chkRef(o, op);
      });
    });
    return { ok: issues.length === 0, issues };
  }

  return { build, validate, SCHEMA_VERSION, DOC_TYPE };
})();
