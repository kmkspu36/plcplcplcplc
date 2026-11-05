// Draws ladder diagrams from Mitsubishi instruction-list (IL) code. The app renders the SVG itself, so the AI only needs to return text.
const PanelLadder = (() => {
  const W = 84, H = 56, COIL_W = 150;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CONTACT = { LD: ["NO"], LDI: ["NC"], AND: ["NO"], ANI: ["NC"], OR: ["NO"], ORI: ["NC"], LDP: ["P"], LDF: ["F"], ANDP: ["P"], ANDF: ["F"], ORP: ["P"], ORF: ["F"] };

  function parse(code) {
    const rungs = [];
    let stack = [], cur = null, outs = [];
    const flush = () => { if (cur && outs.length) rungs.push({ cond: cur, outs }); stack = []; cur = null; outs = []; };
    for (let raw of code.split("\n")) {
      raw = raw.replace(/;.*$/, "").replace(/\/\/.*$/, "").trim();
      if (!raw) continue;
      let t = raw.split(/\s+/);
      if (/^\d+$/.test(t[0]) && t.length > 1) t.shift();
      const op = t[0].toUpperCase(), args = t.slice(1);
      if (op === "END") break;
      if (op === "NOP" || op === "MPS" || op === "MRD" || op === "MPP") continue;
      const kind = op.replace(/^(LD|AND|OR)/, "$1");
      if (/^(LD|LDI|LDP|LDF)$/.test(op)) {
        if (outs.length) flush();
        stack.push({ t: "c", k: CONTACT[op][0], d: args[0] || "?" });
      } else if (/^(AND|ANI|ANDP|ANDF)$/.test(op)) {
        const a = stack.pop(); if (!a) return null;
        stack.push({ t: "s", n: [a, { t: "c", k: CONTACT[op][0], d: args[0] || "?" }] });
      } else if (/^(OR|ORI|ORP|ORF)$/.test(op)) {
        const a = stack.pop(); if (!a) return null;
        stack.push({ t: "p", n: [a, { t: "c", k: CONTACT[op][0], d: args[0] || "?" }] });
      } else if (op === "ANB" || op === "ORB") {
        const b = stack.pop(), a = stack.pop(); if (!a || !b) return null;
        stack.push({ t: op === "ANB" ? "s" : "p", n: [a, b] });
      } else {
        if (!cur) { if (!stack.length) return null; cur = stack.pop(); }
        outs.push({ op, args });
      }
    }
    flush();
    return rungs.length ? rungs : null;
  }

  function measure(n) {
    if (n.t === "c") return (n.w = W, n.h = H, n);
    n.n.forEach(measure);
    if (n.t === "s") { n.w = n.n.reduce((a, c) => a + c.w, 0); n.h = Math.max(...n.n.map((c) => c.h)); }
    else { n.w = Math.max(...n.n.map((c) => c.w)); n.h = n.n.reduce((a, c) => a + c.h, 0); }
    return n;
  }
  // Every node's main line sits at y + H/2 of its first row; parallel children stack downward.
  function draw(n, x, y, width, out) {
    const my = y + H / 2;
    if (n.t === "c") {
      const cx = x + width / 2;
      out.push(`<line x1="${x}" y1="${my}" x2="${cx - 8}" y2="${my}"/><line x1="${cx + 8}" y1="${my}" x2="${x + width}" y2="${my}"/>`);
      out.push(`<line x1="${cx - 8}" y1="${my - 14}" x2="${cx - 8}" y2="${my + 14}"/><line x1="${cx + 8}" y1="${my - 14}" x2="${cx + 8}" y2="${my + 14}"/>`);
      if (n.k === "NC") out.push(`<line x1="${cx - 12}" y1="${my + 12}" x2="${cx + 12}" y2="${my - 12}"/>`);
      if (n.k === "P") out.push(`<text x="${cx}" y="${my + 4}" text-anchor="middle" class="s">↑</text>`);
      if (n.k === "F") out.push(`<text x="${cx}" y="${my + 4}" text-anchor="middle" class="s">↓</text>`);
      out.push(`<text x="${cx}" y="${my - 20}" text-anchor="middle" class="t">${esc(n.d)}</text>`);
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
    if (!rungs) return null;
    const out = [];
    const rails = 16;
    let y = 10, maxW = 0;
    const blocks = rungs.map((r) => {
      const cond = measure(r.cond);
      const h = Math.max(cond.h, r.outs.length * H);
      return { r, cond, h, w: cond.w };
    });
    maxW = Math.max(...blocks.map((b) => b.w)) + rails * 2 + COIL_W + 30;
    blocks.forEach((b, i) => {
      out.push(`<text x="2" y="${y + H / 2 + 4}" class="n">${i}</text>`);
      const cw = maxW - rails * 2 - COIL_W - 30;
      draw(b.cond, rails + 10, y, cw, out);
      const ox = rails + 10 + cw, my = y + H / 2;
      out.push(`<line x1="${ox}" y1="${my}" x2="${ox + 20}" y2="${my}"/>`);
      b.r.outs.forEach((o, j) => {
        const oy = y + j * H + H / 2;
        if (j) out.push(`<line x1="${ox + 20}" y1="${my}" x2="${ox + 20}" y2="${oy}"/>`);
        out.push(`<line x1="${ox + 20}" y1="${oy}" x2="${ox + 34}" y2="${oy}"/>`);
        const label = o.op + " " + o.args.join(" ");
        const bx = ox + 34, bw = COIL_W - 10;
        out.push(`<rect x="${bx}" y="${oy - 15}" width="${bw}" height="30" rx="4" class="box"/><text x="${bx + bw / 2}" y="${oy + 4}" text-anchor="middle" class="t">${esc(label)}</text>`);
        out.push(`<line x1="${bx + bw}" y1="${oy}" x2="${maxW - rails}" y2="${oy}"/>`);
      });
      y += b.h + 14;
    });
    out.push(`<line x1="${rails}" y1="6" x2="${rails}" y2="${y - 8}" class="rail"/><line x1="${maxW - rails}" y1="6" x2="${maxW - rails}" y2="${y - 8}" class="rail"/>`);
    const css = "line{stroke:#20242b;stroke-width:1.6}.rail{stroke-width:3}.box{fill:#fff;stroke:#356ae6;stroke-width:1.6}.t{font:12px Consolas,monospace;fill:#20242b}.s{font:14px sans-serif;fill:#356ae6}.n{font:11px sans-serif;fill:#747b87}";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxW} ${y}" width="${maxW}" height="${y}" style="background:#fff"><style>${css}</style>${out.join("")}</svg>`;
  }

  return { render };
})();
