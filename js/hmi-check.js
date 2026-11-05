// Static PLC<->HMI cross check. Uses only the project's label list and HMI bindings; it does not talk to a PLC or compile anything.
const PanelHmiCheck = (() => {
  function run(p) {
    const f = [];
    const labels = p.labels || [];
    const screens = (p.hmi && p.hmi.screens) || [];
    const add = (lvl, type, o, s, desc, fix) => f.push({ lvl, type, screen: s ? s.name : "", object: o ? o.name + " (" + PanelHmiObjects.TYPES[o.type].label + ")" : "", desc, fix });

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
  return { run };
})();
