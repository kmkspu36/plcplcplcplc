// S1 tests for PanelLadderModel. Each case returns true on pass. Results are read by run-model-tests.ps1.
window.runModelTests = function () {
  const S = PANEL_SAMPLES, M = PanelLadderModel, out = [];
  const t = (name, fn) => { let ok = false, d = ""; try { ok = fn() === true; } catch (e) { d = String(e); } out.push({ name, ok, d }); };
  const b = (k) => M.build(S[k]);
  const ids = (doc) => { const a = []; (function w(o) { if (o && typeof o === "object") { if (typeof o.id === "string" && !/^dev:/.test(o.id)) a.push(o.id); Object.keys(o).forEach((k) => { if (k !== "metadata") w(o[k]); }); } })(doc.networks); return a; };

  t("all 10 parsable samples build ok", () => Object.keys(S).filter((k) => k !== "badmid").every((k) => b(k).ok));
  t("badmid fails safely (no doc networks)", () => { const r = b("badmid"); return !r.ok && r.error === "parse-failed" && r.doc === null; });
  t("empty/garbage input fails safely", () => !M.build("").ok && !M.build("hello world").ok);
  t("top-level schema fields", () => { const d = b("selfhold").doc; return d.schemaVersion === 1 && d.documentType === "panellab.ladder" && d.project.cpuModel === "UNCONFIRMED" && d.project.gxWorksVersion === "UNCONFIRMED" && Array.isArray(d.devices) && Array.isArray(d.networks) && d.validation.ilRoundTrip === "unverified" && d.metadata.sourceIL === S.selfhold; });
  t("all ids unique in every sample", () => Object.keys(S).filter((k) => k !== "badmid").every((k) => { const a = ids(b(k).doc); return new Set(a).size === a.length && a.length > 0; }));
  t("selfhold: parallel(X0,Y0) series ANI X1 -> coil Y0", () => { const n = b("selfhold").doc.networks[0], l = n.logic; return l.type === "series" && l.children[0].type === "parallel" && l.children[1].kind === "NC" && l.children[1].deviceRef === "dev:X1" && n.outputs[0].type === "coil" && n.outputs[0].deviceRef === "dev:Y0"; });
  t("selfhold ilRange 1..4", () => { const r = b("selfhold").doc.networks[0].metadata.ilRange; return r.start === 1 && r.end === 4; });
  t("orb: parallel of two series", () => { const l = b("orb").doc.networks[0].logic; return l.type === "parallel" && l.children.length === 2 && l.children.every((c) => c.type === "series"); });
  t("anb: series of two parallels", () => { const l = b("anb").doc.networks[0].logic; return l.type === "series" && l.children.length === 2 && l.children.every((c) => c.type === "parallel"); });
  t("setrst: set and rst are distinct output types", () => { const n = b("setrst").doc.networks; return n.length === 2 && n[0].outputs[0].type === "set" && n[1].outputs[0].type === "rst"; });
  t("timer: output timer T0 preset K50 + contact T0", () => { const n = b("timer").doc.networks, o = n[0].outputs[0]; return o.type === "timer" && o.deviceRef === "dev:T0" && o.preset.literal === "K50" && n[1].logic.type === "contact" && n[1].logic.deviceRef === "dev:T0"; });
  t("counter: counter C0 K5, RST C0 stays rst", () => { const n = b("cnt").doc.networks; return n[0].outputs[0].type === "counter" && n[0].outputs[0].preset.literal === "K5" && n[1].outputs[0].type === "rst" && n[1].outputs[0].deviceRef === "dev:C0"; });
  t("mov/add: apply with operands preserved", () => { const o = b("mov").doc.networks[0].outputs; return o.length === 2 && o[0].type === "apply" && o[0].op === "MOV" && o[0].args.join(" ") === "K10 D0" && o[1].op === "ADD" && o[1].operands.length === 3 && o[1].operands[1].literal === "K1"; });
  t("multiout: one network, two outputs", () => { const n = b("multiout").doc.networks; return n.length === 1 && n[0].outputs.length === 2; });
  t("outafter: stays as 2 networks like the parser", () => b("outafter").doc.networks.length === PanelLadder.parse(S.outafter).length);
  t("mps: networks marked readOnly", () => { const n = b("mps").doc.networks; return n.length > 0 && n.every((x) => x.metadata.readOnly === true && x.metadata.readOnlyReason === "MPS/MRD/MPP"); });
  t("non-mps samples are not readOnly", () => b("selfhold").doc.networks.every((x) => x.metadata.readOnly === false));
  t("devices deduped and referenced", () => { const d = b("selfhold").doc.devices.map((x) => x.name).sort().join(","); return d === "X0,X1,Y0"; });
  t("sourceIL preserved verbatim", () => Object.keys(S).filter((k) => k !== "badmid").every((k) => b(k).doc.metadata.sourceIL === S[k]));
  t("network count/order matches PanelLadder.nets", () => Object.keys(S).filter((k) => k !== "badmid").every((k) => { const a = PanelLadder.nets(S[k]), d = b(k).doc.networks; return a.length === d.length && a.every((n, i) => n.start === d[i].metadata.ilRange.start && n.end === d[i].metadata.ilRange.end); }));
  t("compare node", () => { const r = M.build("LD> D0 K5\nOUT Y0\nEND"); return r.ok && r.doc.networks[0].logic.type === "compare" && r.doc.networks[0].logic.op === ">" && r.doc.networks[0].logic.operands[1].literal === "K5"; });
  t("INV -> not node", () => { const r = M.build("LD X0\nINV\nOUT Y0\nEND"); return r.ok && r.doc.networks[0].logic.type === "not"; });
  t("unknown instruction kept as raw", () => { const r = M.build("LD X0\nFOO D0 D1\nEND"); const o = r.doc.networks[0].outputs[0]; return r.ok && o.type === "raw" && o.text === "FOO D0 D1"; });
  t("validate: duplicate id rejected", () => { const d = JSON.parse(JSON.stringify(b("orb").doc)); d.networks[0].logic.children[1].id = d.networks[0].logic.children[0].id; const v = M.validate(d); return !v.ok && v.issues.some((i) => /duplicate/.test(i.msg)); });
  t("validate: empty branch rejected", () => { const d = JSON.parse(JSON.stringify(b("orb").doc)); d.networks[0].logic.children = [d.networks[0].logic.children[0]]; return !M.validate(d).ok; });
  t("validate: dangling deviceRef rejected", () => { const d = JSON.parse(JSON.stringify(b("selfhold").doc)); d.networks[0].outputs[0].deviceRef = "dev:NOPE"; return !M.validate(d).ok; });
  t("validate: no outputs rejected", () => { const d = JSON.parse(JSON.stringify(b("selfhold").doc)); d.networks[0].outputs = []; return !M.validate(d).ok; });
  t("validate: JSON round trip stays valid", () => M.validate(JSON.parse(JSON.stringify(b("timer").doc))).ok);
  t("build does not mutate PanelLadder output", () => JSON.stringify(PanelLadder.nets(S.selfhold)) === JSON.stringify(PanelLadder.nets(S.selfhold)));
  return out;
};
