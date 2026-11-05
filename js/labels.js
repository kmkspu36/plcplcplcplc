// Normalizes the global-label tables returned by the AI (| 디바이스 | 라벨명 | 데이터형 | 설명 |) into structured data.
// Imported labels are AI-reported and unverified; only entries typed by the user are marked as such.
const PanelLabels = (() => {
  const DEV = /^(SM|SD|SW|SB|X|Y|M|L|S|B|F|T|C|D|W|R|V|Z)[0-9A-F.]*[0-9][0-9A-F.]*$/i;
  const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
  const isRow = (s) => /^\s*\|.*\|\s*$/.test(s);
  const isSep = (s) => /^\s*\|[\s:|-]+\|\s*$/.test(s);

  function kindOf(type) {
    const t = String(type || "").toLowerCase();
    if (/bit|bool|비트|접점/.test(t)) return "bit";
    if (/word|워드|int|float|real|실수|정수/.test(t)) return "word";
    return "unknown";
  }
  const validDevice = (d) => DEV.test(String(d || "").trim());

  function fromText(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n"), out = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      if (!isRow(lines[i]) || !isSep(lines[i + 1])) continue;
      const head = cells(lines[i]);
      const di = head.findIndex((h) => /디바이스|device|주소/i.test(h));
      const ni = head.findIndex((h, k) => k !== di && /라벨|label|이름/i.test(h));
      if (di < 0 || ni < 0) continue;
      const ti = head.findIndex((h, k) => k !== di && k !== ni && /데이터|타입|형|type/i.test(h));
      const xi = head.findIndex((h, k) => k !== di && k !== ni && k !== ti && /설명|비고|desc/i.test(h));
      let j = i + 2;
      while (j < lines.length && isRow(lines[j])) {
        const c = cells(lines[j++]);
        const device = (c[di] || "").toUpperCase();
        if (!device) continue;
        const type = ti >= 0 ? c[ti] || "" : "";
        out.push({ device, name: c[ni] || "", type, kind: kindOf(type), desc: xi >= 0 ? c[xi] || "" : "", source: "ai" });
      }
      i = j;
    }
    return out;
  }

  // Never overwrites existing entries; same device with a different name is reported as a conflict.
  function merge(existing, incoming) {
    const list = existing.slice();
    let added = 0, same = 0;
    const conflicts = [];
    incoming.forEach((l) => {
      const cur = list.find((x) => x.device === l.device);
      if (!cur) { list.push(l); added++; }
      else if (cur.name === l.name) same++;
      else conflicts.push(l.device + ": '" + cur.name + "' ≠ '" + l.name + "'");
    });
    return { list, added, same, conflicts };
  }

  function resolve(labels, bind) {
    const b = String(bind || "").trim();
    if (!b) return null;
    const u = b.toUpperCase();
    return labels.find((l) => l.device === u) || labels.find((l) => l.name && l.name === b) || null;
  }

  return { fromText, merge, resolve, kindOf, validDevice };
})();
