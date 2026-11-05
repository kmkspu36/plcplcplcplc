// Draws ladder diagrams from Mitsubishi instruction-list (IL) code. The app renders the SVG itself, so the AI only needs to return text.
const PanelLadder = (() => {
  const W = 100, H = 56, COIL_W = 150;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KIND = { "": "NO", I: "NC", P: "P", F: "F", PI: "PN", FI: "FN" };
  const CMP = /^(LD|AND|OR)(D|E)?(=|<>|>=|<=|>|<)$/;
  const BASIC = /^(LD|AND|OR)(I|P|F|PI|FI)?$/;

  function parse(code) {
    const rungs = [];
    let stack = [], mps = [], lastOut = false, grp = 1;
    const top = () => stack[stack.length - 1];
    const combine = (type, a, b) => ({ t: type, n: [a, b] });
    const src = code.split("\n");
    for (let li = 0; li < src.length; li++) {
      let raw = src[li];
      raw = raw.replace(/;.*$/, "").replace(/\/\/.*$/, "").trim();
      if (!raw) continue;
      let t = raw.split(/\s+/);
      if (/^\d+$/.test(t[0]) && t.length > 1) t.shift();
      const op = ({ ANI: "ANDI" }[t[0].toUpperCase()] || t[0].toUpperCase()), args = t.slice(1);
      if (op === "END") break;
      if (op === "NOP") continue;
      let leaf = null, base = null;
      const m = BASIC.exec(op), c = CMP.exec(op);
      if (m) { base = m[1]; leaf = { t: "c", k: KIND[m[2] || ""], d: args[0] || "?" }; }
      else if (c) { base = c[1]; leaf = { t: "c", k: "CMP", d: args.join(" ") + " " + c[3], sym: c[3], args }; leaf.d = args[0] + " " + c[3] + " " + (args[1] || "?"); }
      if (base) {
        if (base === "LD") {
          if (lastOut && !mps.length) stack = [];
          if (!stack.length) grp = li + 1;
          lastOut = false;
          stack.push(leaf);
        } else {
          const a = stack.pop(); if (!a) return null;
          stack.push(combine(base === "AND" ? "s" : "p", a, leaf));
        }
      } else if (op === "ANB" || op === "ORB") {
        const b = stack.pop(), a = stack.pop(); if (!a || !b) return null;
        stack.push(combine(op === "ANB" ? "s" : "p", a, b));
      } else if (op === "INV") {
        const a = stack.pop(); if (!a) return null;
        stack.push({ t: "i", n: [a] });
      } else if (op === "MEP" || op === "MEF") {
        const a = stack.pop(); if (!a) return null;
        stack.push(combine("s", a, { t: "c", k: op === "MEP" ? "P" : "F", d: op }));
      } else if (op === "MPS") {
        if (!top()) return null; mps.push(top());
      } else if (op === "MRD") {
        if (!mps.length) return null; stack[stack.length - 1] = mps[mps.length - 1];
      } else if (op === "MPP") {
        if (!mps.length) return null; stack[stack.length - 1] = mps.pop();
      } else {
        const node = top(); if (!node) return null;
        const last = rungs[rungs.length - 1];
        if (last && last.cond === node) { last.outs.push({ op, args }); last.end = li + 1; } else rungs.push({ cond: node, outs: [{ op, args }], start: grp, end: li + 1 });
        lastOut = true;
      }
    }
    return rungs.length ? rungs : null;
  }

  const tw = (s) => Math.ceil(String(s).length * 7.4);
  const TCRE = /^(S?T|S?C)\d/i;
  // Output layout shared by measure and draw so box widths never disagree.
  function outLayout(o) {
    const op = o.op.toUpperCase(), a = o.args;
    if (op === "OUT" && a.length === 1 && !TCRE.test(a[0])) return { kind: "coil", w: Math.max(COIL_W - 34, tw(a[0]) + 56) };
    if ((op === "SET" || op === "RST") && a.length === 1) return { kind: "cmd", lines: [op + " " + a[0]], w: Math.max(COIL_W - 24, tw(op + " " + a[0]) + 24) };
    if ((op === "OUT" && a.length >= 2 && TCRE.test(a[0])) || ((op === "TIM" || op === "CNT") && a.length >= 2)) {
      const lines = [op + " " + a[0], a.slice(1).join(" ")];
      return { kind: "tc", lines, w: Math.max(COIL_W - 24, Math.max(...lines.map(tw)) + 24) };
    }
    const line = (op + " " + a.join(" ")).trim();
    return { kind: "app", lines: [line], w: Math.max(COIL_W - 24, tw(line) + 24) };
  }

  function measure(n) {
    if (n.t === "c") return (n.w = Math.max(W, tw(n.d) + (n.k === "CMP" ? 24 : 16)), n.h = H, n);
    n.n.forEach(measure);
    if (n.t === "i") { n.w = n.n[0].w + 40; n.h = n.n[0].h; }
    else if (n.t === "s") { n.w = n.n.reduce((a, c) => a + c.w, 0); n.h = Math.max(...n.n.map((c) => c.h)); }
    else { n.w = Math.max(...n.n.map((c) => c.w)); n.h = n.n.reduce((a, c) => a + c.h, 0); }
    return n;
  }
  // Every node's main line sits at y + H/2 of its first row; parallel children stack downward.
  // Hit areas are only emitted for the editor (ids flag); the default SVG stays byte-identical.
  let IDS = false;
  function draw(n, x, y, width, out) {
    if (IDS && n.t === "c" && n.id) {
      out.push(`<g class="nd" data-node="${esc(n.id)}"><rect class="hit" x="${x + 4}" y="${y + 4}" width="${Math.max(0, width - 8)}" height="${H - 8}" rx="4"/>`);
      drawNode(n, x, y, width, out);
      out.push("</g>");
    } else drawNode(n, x, y, width, out);
  }
  function drawNode(n, x, y, width, out) {
    const my = y + H / 2;
    if (n.t === "c") {
      const cx = x + width / 2;
      if (n.k === "CMP") {
        out.push(`<line x1="${x}" y1="${my}" x2="${x + 6}" y2="${my}"/><line x1="${x + width - 6}" y1="${my}" x2="${x + width}" y2="${my}"/>`);
        out.push(`<rect x="${x + 6}" y="${my - 14}" width="${width - 12}" height="28" class="box"/>`);
        out.push(`<text x="${cx}" y="${my + 4}" text-anchor="middle" class="t">${esc(n.d)}</text>`);
        return;
      }
      out.push(`<line x1="${x}" y1="${my}" x2="${cx - 8}" y2="${my}"/><line x1="${cx + 8}" y1="${my}" x2="${x + width}" y2="${my}"/>`);
      out.push(`<line x1="${cx - 8}" y1="${my - 14}" x2="${cx - 8}" y2="${my + 14}"/><line x1="${cx + 8}" y1="${my - 14}" x2="${cx + 8}" y2="${my + 14}"/>`);
      if (n.k === "NC" || n.k === "PN" || n.k === "FN") out.push(`<line x1="${cx - 12}" y1="${my + 12}" x2="${cx + 12}" y2="${my - 12}"/>`);
      if (n.k === "P" || n.k === "PN") out.push(`<text x="${cx}" y="${my + 4}" text-anchor="middle" class="s">↑</text>`);
      if (n.k === "F" || n.k === "FN") out.push(`<text x="${cx}" y="${my + 4}" text-anchor="middle" class="s">↓</text>`);
      out.push(`<text x="${cx}" y="${my - 20}" text-anchor="middle" class="t">${esc(n.d)}</text>`);
      return;
    }
    if (n.t === "i") {
      draw(n.n[0], x, y, width - 40, out);
      const bx = x + width - 40;
      out.push(`<line x1="${bx}" y1="${my}" x2="${bx + 6}" y2="${my}"/><rect x="${bx + 6}" y="${my - 12}" width="28" height="24" class="box"/><text x="${bx + 20}" y="${my + 4}" text-anchor="middle" class="s">¬</text><line x1="${bx + 34}" y1="${my}" x2="${bx + 40}" y2="${my}"/>`);
      return;
    }
    if (n.t === "s") {
      const extra = (width - n.w) / (n.n.length);
      let cx = x;
      n.n.forEach((c) => { const cw = c.w + extra; draw(c, cx, y, cw, out); cx += cw; });
      return;
    }
    let cy = y;
    n.n.forEach((c) => { draw(c, x, cy, width, out); cy += c.h; });
    const lastMy = y + n.h - n.n[n.n.length - 1].h + H / 2;
    out.push(`<line x1="${x}" y1="${my}" x2="${x}" y2="${lastMy}"/><line x1="${x + width}" y1="${my}" x2="${x + width}" y2="${lastMy}"/>`);
  }

  function render(code) {
    const rungs = parse(code);
    return rungs ? renderRungs(rungs) : null;
  }

  // Shared drawing path for IL (render) and the JSON model (renderModel). A rung with invalid:true is drawn as an unverified placeholder, never as a circuit.
  function renderRungs(rungs) {
    const out = [];
    const rails = 16;
    let y = 10, maxW = 0, hasUnv = false;
    const UNV = { "parse-failed": "해석 실패", "no-output": "출력 없음" };
    const blocks = rungs.map((r) => {
      if (r.invalid) { hasUnv = true; r.label = "검증되지 않은 네트워크 (줄 " + r.start + "-" + r.end + ") · " + (UNV[r.reason] || r.reason || "확인 불가"); return { r, invalid: true, h: H, w: tw(r.label) + 20, lay: [] }; }
      const cond = measure(r.cond);
      const h = Math.max(cond.h, r.outs.length * H);
      return { r, cond, h, w: cond.w };
    });
    blocks.forEach((b) => { if (!b.invalid) b.lay = b.r.outs.map(outLayout); });
    const coilW = Math.max(COIL_W, ...blocks.flatMap((b) => b.lay.map((l) => l.w + 24)));
    maxW = Math.max(...blocks.map((b) => b.w)) + rails * 2 + coilW + 30;
    blocks.forEach((b, i) => {
      out.push(`<g class="net" data-net="${i}"><rect class="nbg" x="0" y="${y - 4}" width="${maxW}" height="${b.h + 12}"/>`);
      out.push(`<text x="2" y="${y + H / 2 + 4}" class="n">${i}</text><text x="${rails + 6}" y="${y + 1}" class="nl">Net ${i}</text>`);
      if (b.invalid) {
        const raw = (b.r.rawLines || []).join("\n");
        out.push(`<rect x="${rails + 10}" y="${y + 8}" width="${maxW - rails * 2 - 20}" height="${H - 16}" rx="4" class="unv"><title>${esc(raw)}</title></rect><text x="${maxW / 2}" y="${y + H / 2 + 4}" text-anchor="middle" class="t">${esc(b.r.label)}</text></g>`);
        y += b.h + 14;
        return;
      }
      const cw = maxW - rails * 2 - coilW - 30;
      draw(b.cond, rails + 10, y, cw, out);
      const ox = rails + 10 + cw, my = y + H / 2;
      out.push(`<line x1="${ox}" y1="${my}" x2="${ox + 20}" y2="${my}"/>`);
      b.r.outs.forEach((o, j) => {
        const oy = y + j * H + H / 2;
        if (j) out.push(`<line x1="${ox + 20}" y1="${my}" x2="${ox + 20}" y2="${oy}"/>`);
        out.push(`<line x1="${ox + 20}" y1="${oy}" x2="${ox + 34}" y2="${oy}"/>`);
        const bx = ox + 34, L = b.lay[j], bw = coilW - 10, cx = bx + bw / 2;
        if (IDS && o.id) out.push(`<g class="nd" data-node="${esc(o.id)}"><rect class="hit" x="${bx}" y="${oy - H / 2 + 4}" width="${bw}" height="${H - 8}" rx="4"/>`);
        if (L.kind === "coil") {
          out.push(`<line x1="${bx}" y1="${oy}" x2="${cx - 14}" y2="${oy}"/><path d="M${cx - 8} ${oy - 14} Q${cx - 20} ${oy} ${cx - 8} ${oy + 14}" class="coil"/><path d="M${cx + 8} ${oy - 14} Q${cx + 20} ${oy} ${cx + 8} ${oy + 14}" class="coil"/><line x1="${cx + 14}" y1="${oy}" x2="${bx + bw}" y2="${oy}"/>`);
          out.push(`<text x="${cx}" y="${oy - 20}" text-anchor="middle" class="t">${esc(o.args[0])}</text>`);
        } else {
          const bxw = L.w, bx0 = bx, bh = L.lines.length > 1 ? 40 : 30;
          out.push(`<rect x="${bx0}" y="${oy - bh / 2}" width="${bxw}" height="${bh}" rx="4" class="box b${L.kind}"/>`);
          L.lines.forEach((ln, k) => out.push(`<text x="${bx0 + bxw / 2}" y="${L.lines.length > 1 ? oy - 3 + k * 16 : oy + 4}" text-anchor="middle" class="t">${esc(ln)}</text>`));
          if (bxw < bw) out.push(`<line x1="${bx0 + bxw}" y1="${oy}" x2="${bx + bw}" y2="${oy}"/>`);
        }
        out.push(`<line x1="${bx + bw}" y1="${oy}" x2="${maxW - rails}" y2="${oy}"/>`);
        if (IDS && o.id) out.push("</g>");
      });
      out.push("</g>");
      y += b.h + 14;
    });
    out.push(`<line x1="${rails}" y1="6" x2="${rails}" y2="${y - 8}" class="rail"/><line x1="${maxW - rails}" y1="6" x2="${maxW - rails}" y2="${y - 8}" class="rail"/>`);
    const css = "line{stroke:#20242b;stroke-width:1.6}.rail{stroke-width:3}.box{fill:#fff;stroke:#356ae6;stroke-width:1.6}.box.btc{fill:#f3f7ff;stroke:#0f7a4d}.box.bcmd{fill:#fff7ec;stroke:#c2570c}.box.bapp{fill:#f6f3ff;stroke:#6b46c1}.coil{fill:none;stroke:#20242b;stroke-width:1.6}.nbg{fill:transparent;stroke:#e3e6ec;stroke-width:1}.net.sel .nbg{fill:#fff8d6}.net{cursor:pointer}.t{font:12px Consolas,monospace;fill:#20242b}.s{font:14px sans-serif;fill:#356ae6}.n{font:11px sans-serif;fill:#747b87}.nl{font:bold 9px sans-serif;fill:#356ae6}" + (hasUnv ? ".unv{fill:#f4f4f6;stroke:#9aa1ad;stroke-width:1.4;stroke-dasharray:5 4}" : "") + (IDS ? ".nd{cursor:pointer}.nd .hit{fill:transparent;stroke:none}.nd:hover .hit{fill:rgba(53,106,230,.08)}.nd.sel .hit{fill:rgba(53,106,230,.18);stroke:#356ae6;stroke-width:1.4}" : "");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxW} ${y}" width="${maxW}" height="${y}" data-w="${maxW}" style="background:#fff"><style>${css}</style>${out.join("")}</svg>`;
  }

  // Converts one model network into the parse-tree shape that measure/draw already understand.
  function modelRung(net, names) {
    const md = net.metadata || {}, rg = md.ilRange || {};
    if (md.status === "invalid") return { invalid: true, start: rg.start, end: rg.end, reason: md.readOnlyReason, rawLines: md.rawLines };
    const opnd = (o) => (o.deviceRef ? names[o.deviceRef] || o.deviceRef : o.literal != null ? o.literal : o.raw != null ? o.raw : "?");
    const tree = (n) => {
      if (n.type === "contact") return { t: "c", k: n.kind, d: n.edgeOp || opnd(n), id: n.id };
      if (n.type === "compare") { const a = (n.operands || []).map(opnd); return { t: "c", k: "CMP", sym: n.op, args: a, d: a[0] + " " + n.op + " " + (a[1] || "?"), id: n.id }; }
      if (n.type === "not") return { t: "i", n: [tree(n.child)] };
      if (n.type === "series" || n.type === "parallel") return { t: n.type === "series" ? "s" : "p", n: n.children.map(tree) };
      throw new Error("unknown node " + n.type);
    };
    const outs = (net.outputs || []).map((o) => {
      let args;
      if (o.type === "timer" || o.type === "counter") args = [opnd(o), opnd(o.preset || {})];
      else if (o.type === "apply") args = (o.operands || []).map(opnd);
      else if (o.type === "raw") args = String(o.text || "").split(/\s+/).slice(1);
      else args = [opnd(o)];
      return { op: o.op, args, id: o.id };
    });
    return { cond: tree(net.logic), outs, start: rg.start, end: rg.end };
  }
  // Renders a PanelLadderModel document with the same SVG drawing path as render(code). Returns null for anything that cannot be drawn.
  function renderModel(doc, opts) {
    try {
      if (!doc || doc.documentType !== "panellab.ladder" || !Array.isArray(doc.networks) || !doc.networks.length) return null;
      const names = {};
      (doc.devices || []).forEach((d) => { names[d.id] = d.name; });
      const rungs = doc.networks.map((n) => modelRung(n, names));
      if (rungs.every((r) => r.invalid)) return null;
      IDS = !!(opts && opts.ids);
      return renderRungs(rungs);
    } catch (e) { return null; } finally { IDS = false; }
  }

  // Mechanical description of the code structure; nothing is inferred beyond the instructions.
  function condText(n) {
    if (n.t === "c") {
      if (n.k === "NO") return n.d + " ON";
      if (n.k === "NC") return n.d + " OFF";
      if (n.k === "P" || n.k === "PN") return n.d + (n.k === "P" ? " 상승 에지" : " 상승 에지 아님");
      if (n.k === "F" || n.k === "FN") return n.d + (n.k === "F" ? " 하강 에지" : " 하강 에지 아님");
      return n.d;
    }
    if (n.t === "i") return "NOT(" + condText(n.n[0]) + ")";
    const j = n.t === "s" ? " 그리고 " : " 또는 ";
    return "(" + n.n.map(condText).join(j) + ")";
  }
  function outText(o) {
    const op = o.op.toUpperCase(), d = o.args[0] || "?";
    if (op === "OUT" && o.args.length === 2 && /^(S?T|S?C)\d/i.test(d)) return d + " " + (/^S?T/i.test(d) ? "타이머" : "카운터") + " 설정 " + o.args[1];
    if (op === "OUT") return d + " 출력";
    if (op === "SET") return d + " SET(유지)";
    if (op === "RST") return d + " RST(해제)";
    if (op === "TIM" || op === "CNT") return d + " " + (op === "TIM" ? "타이머" : "카운터") + " 설정 " + (o.args[1] || "미지정");
    return op + " " + o.args.join(" ");
  }
  function nets(code) {
    const rungs = parse(code);
    if (!rungs) return null;
    return rungs.map((r, i) => ({ i, start: r.start, end: r.end, desc: condText(r.cond).replace(/^\((.*)\)$/, "$1") + " 일 때 → " + r.outs.map(outText).join(", ") }));
  }

  return { render, nets, parse, renderModel };
})();
