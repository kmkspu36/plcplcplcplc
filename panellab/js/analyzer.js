// Static checks on Mitsubishi instruction-list code. This is NOT a GX Works compile; it only reports what can be verified from the text.
const PanelAnalyzer = (() => {
  const HEX = new Set(["X", "Y", "B", "W", "SB", "SW"]);
  const DEV = /^(SM|SD|SW|SB|X|Y|M|L|S|B|F|T|C|D|W|R|V|Z)([0-9A-Za-z.]+)$/;
  const LOAD = /^LD(I|P|F|PI|FI)?$|^LD(D|E)?(=|<>|>=|<=|>|<)$/;
  const SERIES = /^(AND|OR)(I|P|F|PI|FI)?$|^(AND|OR)(D|E)?(=|<>|>=|<=|>|<)$|^ANI$|^ORI$|^INV$|^MEP$|^MEF$/;
  const NOT_CHECKED = [
    ["선언되지 않은 변수", "라벨 선언 정보(글로벌 라벨)가 없어 확인할 수 없습니다."],
    ["입출력 주소 불일치", "실제 I/O 구성 정보가 없어 확인할 수 없습니다."],
    ["데이터 타입 문제", "디바이스·라벨의 데이터 타입 정보가 없어 확인할 수 없습니다."],
    ["PLC 버전·CPU 호환성", "GX Works 버전과 CPU 모델별 지원 명령어 정보가 없어 확인할 수 없습니다."],
    ["자기유지·출력 논리 충돌", "회로 의도를 알 수 없어 자동 판정하지 않습니다."],
    ["컴파일 성공 여부", "이 검사는 GX Works 컴파일이 아닙니다."],
  ];

  function tokens(code) {
    return String(code).split("\n").map((raw, i) => {
      const s = raw.replace(/;.*$/, "").replace(/\/\/.*$/, "").trim();
      const t = s.split(/\s+/).filter(Boolean);
      if (t.length > 1 && /^\d+$/.test(t[0])) t.shift();
      return { no: i + 1, raw: raw.trim(), op: (t[0] || "").toUpperCase(), args: t.slice(1) };
    }).filter((l) => l.op);
  }

  function badAddress(arg) {
    const a = arg.toUpperCase().replace(/(Z|V)\d*$/, "");
    const m = DEV.exec(a);
    if (!m) return null;
    const body = m[2].replace(/\.[0-9A-F]$/, "");
    if (!/^\d/.test(body)) return null;
    if (HEX.has(m[1])) return /[^0-9A-F]/.test(body) ? "16진 디바이스(" + m[1] + ")에 사용할 수 없는 문자가 있습니다." : null;
    return /[^0-9]/.test(body) ? "10진 디바이스(" + m[1] + ")에 숫자가 아닌 문자가 있습니다." : null;
  }

  function analyze(code) {
    const lines = tokens(code), f = [];
    const add = (type, sev, l, desc, fix) => f.push({ source: "static", type, lvl: sev, line: l.no, code: l.raw, desc, fix });
    const coils = new Map();
    let depth = 0, mps = 0, afterOut = false, hasEnd = false;
    for (const l of lines) {
      if (l.op === "END") { hasEnd = true; break; }
      l.args.forEach((a) => {
        const why = badAddress(a);
        if (why) add("잘못된 디바이스 주소", "high", l, a + ": " + why, "디바이스 번호 표기를 확인하세요.");
      });
      if (LOAD.test(l.op)) { if (afterOut && !mps) depth = 0; afterOut = false; depth++; }
      else if (SERIES.test(l.op)) {
        if (depth < 1) add("잘못된 접점 구성", "high", l, l.op + " 앞에 연산 대상(LD 계열)이 없습니다.", "LD/LDI로 시작하도록 회로를 확인하세요.");
      } else if (l.op === "ANB" || l.op === "ORB") {
        if (depth < 2) add("잘못된 접점 구성", "high", l, l.op + "에 필요한 회로 블록이 부족합니다.", "블록 연결(LD…ORB/ANB) 구성을 확인하세요.");
        else depth--;
      } else if (l.op === "MPS") { if (depth < 1) add("잘못된 접점 구성", "high", l, "MPS 앞에 연산 결과가 없습니다.", "분기 앞의 조건을 확인하세요."); mps++; depth++; }
      else if (l.op === "MRD") { if (!mps) add("잘못된 접점 구성", "high", l, "MPS 없이 MRD를 사용했습니다.", "MPS/MRD/MPP 짝을 확인하세요."); }
      else if (l.op === "MPP") { if (!mps) add("잘못된 접점 구성", "high", l, "MPS 없이 MPP를 사용했습니다.", "MPS/MRD/MPP 짝을 확인하세요."); else { mps--; depth = Math.max(1, depth - 1); } }
      else if (l.op === "NOP") { /* no-op */ }
      else {
        if (depth < 1 && !/^(END|FEND|RET|CALL|FOR|NEXT|JMP|CJ|SCJ|STOP|P\d*|I\d*)$/.test(l.op) && !/^[A-Z]+\d+$/.test(l.op)) add("잘못된 접점 구성", "high", l, l.op + " 앞에 입력 조건(LD 계열)이 없습니다.", "조건 없이 실행하려면 SM400(상시 ON) 등을 사용할 수 있습니다.");
        afterOut = true;
        const dev = l.args[0];
        if (l.op === "OUT" && dev) {
          const key = dev.toUpperCase();
          if (coils.has(key)) add("이중코일", "high", l, key + "에 대한 OUT이 " + coils.get(key) + "행에도 있습니다.", "동일 디바이스의 OUT은 한 번만 사용하고 조건을 통합하세요.");
          else coils.set(key, l.no);
        }
        const timer = l.op === "TIM" || l.op === "CNT" || (l.op === "OUT" && /^[TC]\d/i.test(dev || ""));
        if (timer) {
          const kind = (l.op === "CNT" || /^C/i.test(dev || "")) ? "카운터" : "타이머";
          const setv = l.op === "OUT" ? l.args[1] : l.args[1];
          if (!setv) add(kind + " 설정 오류", "mid", l, kind + " 설정값이 없습니다.", "K 상수 또는 D 디바이스로 설정값을 지정하세요.");
          else if (/^K-?\d+$/i.test(setv)) {
            const n = parseInt(setv.slice(1), 10);
            if (n > 32767) add(kind + " 설정 오류", "high", l, "설정값 " + setv + "이(가) 일반 범위(32767)를 초과합니다.", "CPU별 설정 범위를 확인하세요.");
            else if (n <= 0) add(kind + " 설정 오류", "chk", l, "설정값이 " + setv + " 입니다.", "의도한 값인지 확인하세요.");
          }
        }
      }
    }
    if (lines.length && !hasEnd) {
      const last = lines[lines.length - 1];
      add("프로그램 구성", "chk", last, "END 명령이 없습니다.", "전체 프로그램이라면 END를 추가하세요. 일부 코드 조각이면 무시해도 됩니다.");
    }
    return { findings: f, notChecked: NOT_CHECKED, lineCount: lines.length };
  }

  return { analyze };
})();
