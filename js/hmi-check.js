// Static PLC<->HMI cross check. Uses only the project's label list and HMI bindings; it does not talk to a PLC or compile anything.
const PanelHmiCheck = (() => {
  const MIN_SIZE = 20, MIN_FONT = 12, OVERLAP = 0.1;
  const overlapRatio = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
  };
  const outOfCanvas = (o, s) => o.x < 0 || o.y < 0 || o.x + o.w > s.w || o.y + o.h > s.h;

  // Geometry and readability checks for one screen. Text labels are excluded from overlap checks (they legitimately sit on equipment).
  function layout(s) {
    const r = [], T = PanelHmiObjects.TYPES;
    if (!s.objects.length) return [{ lvl: "low", type: "빈 화면", o: null, desc: "이 화면에는 오브젝트가 없습니다.", fix: "오브젝트를 추가하거나 사용하지 않는 화면이면 삭제하세요." }];
    s.objects.forEach((o) => {
      const p = o.props || {};
      if (outOfCanvas(o, s)) r.push({ lvl: "high", type: "캔버스 범위 초과", o, desc: "오브젝트가 화면(" + s.w + "×" + s.h + ") 밖으로 나가 있습니다.", fix: "화면 안으로 옮기거나 ‘수정본 만들기’를 사용하세요." });
      if (o.w < MIN_SIZE || o.h < MIN_SIZE) r.push({ lvl: "low", type: "너무 작은 오브젝트", o, desc: "크기가 " + MIN_SIZE + "px 미만이라 터치·식별이 어렵습니다.", fix: "크기를 키우세요." });
      if (Number.isFinite(Number(p.fontSize)) && Number(p.fontSize) < MIN_FONT) r.push({ lvl: "low", type: "글자 크기 작음", o, desc: "글꼴 크기가 " + MIN_FONT + " 미만입니다.", fix: "글꼴 크기를 " + MIN_FONT + " 이상으로 올리세요." });
      if (p.onColor && p.offColor && String(p.onColor).toLowerCase() === String(p.offColor).toLowerCase()) r.push({ lvl: "mid", type: "상태 색 구분 없음", o, desc: "ON 색과 OFF 색이 같아 상태를 구분할 수 없습니다.", fix: "서로 다른 색을 지정하세요." });
    });
    const body = s.objects.filter((o) => o.type !== "text");
    for (let i = 0; i < body.length; i++) for (let j = i + 1; j < body.length; j++) {
      if (overlapRatio(body[i], body[j]) > OVERLAP) r.push({ lvl: "mid", type: "오브젝트 겹침", o: body[i], desc: "‘" + body[j].name + "’와(과) 겹쳐 있습니다.", fix: "위치를 조정하거나 ‘수정본 만들기’를 사용하세요." });
    }
    return r;
  }

  // Builds a corrected copy of the screen (the original is untouched). Returns { screen, changes, remaining }.
  function fixLayout(s) {
    const copy = JSON.parse(JSON.stringify(s)), changes = [];
    copy.id = PanelStore.uid(); copy.name = (s.name + " (수정본)").slice(0, 40);
    copy.objects.forEach((o) => {
      const before = o.x + "," + o.y + "," + o.w + "," + o.h;
      o.w = Math.max(MIN_SIZE, Math.min(copy.w, o.w)); o.h = Math.max(MIN_SIZE, Math.min(copy.h, o.h));
      o.x = Math.max(0, Math.min(copy.w - o.w, o.x)); o.y = Math.max(0, Math.min(copy.h - o.h, o.y));
      if (before !== o.x + "," + o.y + "," + o.w + "," + o.h) changes.push("‘" + o.name + "’ 크기·위치를 화면 안으로 조정");
      const p = o.props || {};
      if (Number.isFinite(Number(p.fontSize)) && Number(p.fontSize) < MIN_FONT) { p.fontSize = MIN_FONT; changes.push("‘" + o.name + "’ 글꼴 크기를 " + MIN_FONT + "로 변경"); }
    });
    const placed = [], unresolved = [];
    copy.objects.filter((o) => o.type !== "text").forEach((o) => {
      if (!placed.some((q) => overlapRatio(o, q) > OVERLAP)) { placed.push(o); return; }
      let best = null;
      for (let y = 0; y <= copy.h - o.h; y += 10) for (let x = 0; x <= copy.w - o.w; x += 10) {
        const t = { x, y, w: o.w, h: o.h };
        if (placed.some((q) => overlapRatio(t, q) > OVERLAP)) continue;
        const d = (x - o.x) * (x - o.x) + (y - o.y) * (y - o.y);
        if (!best || d < best.d) best = { x, y, d };
      }
      if (best) { changes.push("‘" + o.name + "’ 겹침 해소를 위해 (" + o.x + "," + o.y + ") → (" + best.x + "," + best.y + ") 이동"); o.x = best.x; o.y = best.y; }
      else unresolved.push(o.name);
      placed.push(o);
    });
    const remaining = layout(copy).filter((x) => x.type !== "빈 화면");
    return { screen: copy, changes, remaining, unresolved };
  }

  function run(p) {
    const f = [];
    const labels = p.labels || [];
    const screens = (p.hmi && p.hmi.screens) || [];
    const add = (lvl, type, o, s, desc, fix) => f.push({ lvl, type, screen: s ? s.name : "", object: o ? o.name + " (" + PanelHmiObjects.TYPES[o.type].label + ")" : "", desc, fix });
    screens.forEach((s) => layout(s).forEach((x) => add(x.lvl, x.type, x.o, s, x.desc, x.fix)));

    const dev = new Map();
    labels.forEach((l) => {
      if (!PanelLabels.validDevice(l.device)) add("high", "잘못된 디바이스 표기", null, null, "라벨 목록의 '" + l.device + "'은(는) 디바이스 주소 형식이 아닙니다.", "디바이스 표기를 확인하세요.");
      if (dev.has(l.device)) add("mid", "라벨 중복 주소", null, null, l.device + " 주소가 라벨 목록에 두 번 이상 있습니다.", "중복 항목을 정리하세요.");
      dev.set(l.device, true);
    });

    const writers = new Map(), used = new Set();
    let bindCount = 0;
    screens.forEach((s) => s.objects.forEach((o) => {
      const t = PanelHmiObjects.TYPES[o.type];
      if (!t || !t.bind) return;
      const b = String(o.bind || "").trim();
      if (!b) { add("mid", "연결되지 않은 오브젝트", o, s, "PLC 주소 또는 라벨이 연결되어 있지 않습니다.", "속성 패널에서 연결할 라벨/주소를 지정하세요."); return; }
      bindCount++;
      const looksDevice = PanelLabels.validDevice(b);
      if (!looksDevice && !labels.some((l) => l.name === b)) {
        if (!labels.length) { add("chk", "확인 필요", o, s, "'" + b + "'이(가) 주소인지 라벨명인지 판단할 수 없습니다.", "라벨을 가져오거나 주소 형식으로 입력하세요."); return; }
      }
      if (!labels.length) { return; }
      const l = PanelLabels.resolve(labels, b);
      if (!l) { add("high", "존재하지 않는 주소", o, s, "'" + b + "'이(가) 글로벌 라벨 목록에 없습니다.", "라벨 목록에 추가하거나 연결을 수정하세요."); return; }
      used.add(l.device);
      if (l.kind === "unknown") add("chk", "데이터형 확인 필요", o, s, l.device + "의 데이터형('" + (l.type || "없음") + "')을 비트/워드로 판별할 수 없습니다.", "라벨의 데이터형을 확인하세요.");
      else if (l.kind !== t.bind) add("high", "데이터형 불일치", o, s, t.label + "에는 " + (t.bind === "bit" ? "비트" : "워드") + " 데이터가 필요하지만 " + l.device + "은(는) '" + l.type + "'입니다.", "형식에 맞는 주소로 바꾸세요.");
      if (t.write) {
        if (writers.has(l.device)) add("mid", "중복 주소 연결", o, s, l.device + "에 쓰는 버튼이 여러 개입니다. (" + writers.get(l.device) + " / " + o.name + ")", "의도한 중복인지 확인하세요.");
        else writers.set(l.device, o.name);
      }
    }));

    if (labels.length && bindCount) {
      const unused = labels.filter((l) => !used.has(l.device));
      if (unused.length) add("low", "HMI에 연결되지 않은 라벨", null, null, unused.length + "개 라벨이 HMI에서 사용되지 않습니다: " + unused.slice(0, 8).map((l) => l.device).join(", ") + (unused.length > 8 ? " …" : ""), "필요한 경우에만 연결하세요.");
    }
    if (!labels.length && bindCount) add("chk", "라벨 정보 없음", null, null, "글로벌 라벨이 없어 주소 존재 여부와 데이터형을 확인하지 못했습니다.", "‘글로벌 라벨’ 작업 결과를 가져오세요.");
    return f;
  }
  return { run, layout, fixLayout };
})();
