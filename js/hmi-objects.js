// HMI object definitions and SVG rendering. Objects are drawn at local coordinates (0,0)-(w,h).
const PanelHmiObjects = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const col = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  // bind: "bit" | "word" | null (no PLC binding). write: object sends a value to the PLC.
  const TYPES = {
    button: { label: "버튼", w: 120, h: 48, bind: "bit", write: true, props: { text: "버튼", fill: "#356ae6", color: "#ffffff", fontSize: 16 } },
    lamp: { label: "램프", w: 48, h: 48, bind: "bit", props: { text: "", onColor: "#16a36a", offColor: "#c9cdd4", fontSize: 12 } },
    number: { label: "숫자 표시기", w: 120, h: 40, bind: "word", props: { unit: "", sample: 0, fontSize: 18, fill: "#ffffff", color: "#20242b" } },
    gauge: { label: "게이지", w: 140, h: 100, bind: "word", props: { min: 0, max: 100, sample: 50, unit: "" } },
    motor: { label: "모터", w: 80, h: 80, bind: "bit", props: { onColor: "#16a36a", offColor: "#c9cdd4" } },
    pump: { label: "펌프", w: 80, h: 80, bind: "bit", props: { onColor: "#16a36a", offColor: "#c9cdd4" } },
    tank: { label: "탱크", w: 90, h: 140, bind: "word", props: { min: 0, max: 100, sample: 60, fill: "#4f8df5" } },
    text: { label: "텍스트", w: 140, h: 32, bind: null, props: { text: "텍스트", fontSize: 16, color: "#20242b" } },
    valve: { label: "밸브", w: 64, h: 48, bind: "bit", props: { onColor: "#16a36a", offColor: "#c9cdd4" } },
    cylinder: { label: "실린더", w: 160, h: 48, bind: "bit", props: { onColor: "#16a36a", offColor: "#c9cdd4" } },
    conveyor: { label: "컨베이어", w: 240, h: 40, bind: "bit", props: { onColor: "#16a36a", offColor: "#c9cdd4" } },
    pipe: { label: "배관", w: 160, h: 12, bind: null, props: { fill: "#8a94a6" } },
    alarm: { label: "고장 램프", w: 48, h: 48, bind: "bit", props: { text: "고장", onColor: "#dc4545", offColor: "#c9cdd4", fontSize: 11 } },
    comm: { label: "통신 상태", w: 48, h: 48, bind: "bit", props: { text: "통신", onColor: "#16a36a", offColor: "#dc4545", fontSize: 11 } },
    level: { label: "수위 표시", w: 120, h: 56, bind: "word", props: { sample: 50, unit: "%", fontSize: 18 } },
    temp: { label: "온도 표시", w: 120, h: 56, bind: "word", props: { sample: 25, unit: "℃", fontSize: 18 } },
    pressure: { label: "압력 표시", w: 120, h: 56, bind: "word", props: { sample: 5, unit: "bar", fontSize: 18 } },
    flow: { label: "유량 표시", w: 120, h: 56, bind: "word", props: { sample: 10, unit: "L/min", fontSize: 18 } },
    trend: { label: "트렌드 그래프", w: 200, h: 100, bind: "word", props: { min: 0, max: 100, sample: 50, color: "#356ae6" } },
  };
  const METER = { level: "수위", temp: "온도", pressure: "압력", flow: "유량" };
  ["level", "temp", "pressure", "flow"].forEach((k) => { TYPES[k].meter = true; });

  const FIELDS = {
    button: [["text", "문구", "text"], ["fill", "배경색", "color"], ["color", "글자색", "color"], ["fontSize", "글꼴 크기", "num"]],
    lamp: [["text", "문구", "text"], ["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"], ["fontSize", "글꼴 크기", "num"]],
    number: [["unit", "단위", "text"], ["sample", "미리보기 값", "num"], ["fontSize", "글꼴 크기", "num"], ["fill", "배경색", "color"], ["color", "글자색", "color"]],
    gauge: [["min", "최소", "num"], ["max", "최대", "num"], ["sample", "미리보기 값", "num"], ["unit", "단위", "text"]],
    motor: [["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"]],
    pump: [["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"]],
    tank: [["min", "최소", "num"], ["max", "최대", "num"], ["sample", "미리보기 값", "num"], ["fill", "액체 색", "color"]],
    text: [["text", "문구", "text"], ["fontSize", "글꼴 크기", "num"], ["color", "글자색", "color"]],
    valve: [["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"]],
    cylinder: [["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"]],
    conveyor: [["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"]],
    pipe: [["fill", "색", "color"]],
    alarm: [["text", "문구", "text"], ["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"], ["fontSize", "글꼴 크기", "num"]],
    comm: [["text", "문구", "text"], ["onColor", "ON 색", "color"], ["offColor", "OFF 색", "color"], ["fontSize", "글꼴 크기", "num"]],
    level: [["sample", "미리보기 값", "num"], ["unit", "단위", "text"], ["fontSize", "글꼴 크기", "num"]],
    temp: [["sample", "미리보기 값", "num"], ["unit", "단위", "text"], ["fontSize", "글꼴 크기", "num"]],
    pressure: [["sample", "미리보기 값", "num"], ["unit", "단위", "text"], ["fontSize", "글꼴 크기", "num"]],
    flow: [["sample", "미리보기 값", "num"], ["unit", "단위", "text"], ["fontSize", "글꼴 크기", "num"]],
    trend: [["min", "최소", "num"], ["max", "최대", "num"], ["sample", "미리보기 값", "num"], ["color", "선 색", "color"]],
  };

  function create(type, x, y) {
    const t = TYPES[type];
    return { id: PanelStore.uid(), type, name: t.label, x, y, w: t.w, h: t.h, bind: "", props: Object.assign({}, t.props) };
  }

  const txt = (x, y, s, size, color, anchor) =>
    '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '" text-anchor="' + (anchor || "middle") + '" dominant-baseline="middle" font-family="sans-serif">' + esc(s) + "</text>";

  // state.on: simulated bit value (preview only).
  function svg(o, state) {
    const p = o.props || {}, w = o.w, h = o.h, on = !!(state && state.on);
    const onC = col(p.onColor, "#16a36a"), offC = col(p.offColor, "#c9cdd4");
    switch (o.type) {
      case "button": {
        const f = col(p.fill, "#356ae6");
        return '<rect width="' + w + '" height="' + h + '" rx="8" fill="' + f + '"' + (on ? ' stroke="#20242b" stroke-width="3"' : "") + "/>" +
          txt(w / 2, h / 2, p.text || "", num(p.fontSize, 16), col(p.color, "#ffffff"));
      }
      case "lamp": {
        const r = Math.max(4, Math.min(w, h) / 2 - 2);
        return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + r + '" fill="' + (on ? onC : offC) + '" stroke="#555" stroke-width="2"/>' +
          (p.text ? txt(w / 2, h / 2, p.text, num(p.fontSize, 12), "#20242b") : "");
      }
      case "number":
        return '<rect width="' + w + '" height="' + h + '" rx="4" fill="' + col(p.fill, "#ffffff") + '" stroke="#9aa1ad"/>' +
          txt(w - 8, h / 2, num(p.sample, 0) + (p.unit ? " " + p.unit : ""), num(p.fontSize, 18), col(p.color, "#20242b"), "end");
      case "gauge": {
        const cx = w / 2, cy = h * 0.8, r = Math.max(10, Math.min(w / 2, h * 0.75) - 4);
        const min = num(p.min, 0), max = num(p.max, 100), v = num(p.sample, 0);
        const ratio = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
        const a = Math.PI - ratio * Math.PI;
        return '<path d="M' + (cx - r) + " " + cy + " A" + r + " " + r + " 0 0 1 " + (cx + r) + " " + cy + '" fill="none" stroke="#c9cdd4" stroke-width="8"/>' +
          '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + (r - 6) * Math.cos(a)).toFixed(1) + '" y2="' + (cy - (r - 6) * Math.sin(a)).toFixed(1) + '" stroke="#dc4545" stroke-width="3"/>' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#20242b"/>' + txt(cx, Math.min(h - 6, cy + 14), v + (p.unit ? " " + p.unit : ""), 12, "#20242b");
      }
      case "motor": {
        const r = Math.max(8, Math.min(w, h) / 2 - 3);
        return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + r + '" fill="' + (on ? onC : offC) + '" stroke="#20242b" stroke-width="3"/>' + txt(w / 2, h / 2, "M", Math.round(r), "#20242b");
      }
      case "pump": {
        const r = Math.max(8, Math.min(w, h) / 2 - 3), cx = w / 2, cy = h / 2;
        return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + (on ? onC : offC) + '" stroke="#20242b" stroke-width="3"/>' +
          '<path d="M' + (cx - r * 0.5) + " " + (cy - r * 0.6) + " L" + (cx + r) + " " + cy + " L" + (cx - r * 0.5) + " " + (cy + r * 0.6) + ' Z" fill="none" stroke="#20242b" stroke-width="3"/>';
      }
      case "tank": {
        const min = num(p.min, 0), max = num(p.max, 100), v = num(p.sample, 0);
        const ratio = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
        const lh = (h - 6) * ratio;
        return '<rect x="1" y="' + (h - 3 - lh).toFixed(1) + '" width="' + (w - 2) + '" height="' + lh.toFixed(1) + '" fill="' + col(p.fill, "#4f8df5") + '" opacity=".75"/>' +
          '<rect x="1" y="1" width="' + (w - 2) + '" height="' + (h - 2) + '" rx="6" fill="none" stroke="#20242b" stroke-width="3"/>' +
          txt(w / 2, h / 2, Math.round(ratio * 100) + "%", 14, "#20242b");
      }
      case "alarm":
      case "comm": {
        const r = Math.max(4, Math.min(w, h) / 2 - 2);
        return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + r + '" fill="' + (on ? onC : offC) + '" stroke="#555" stroke-width="2"/>' +
          (p.text ? txt(w / 2, h / 2, p.text, num(p.fontSize, 11), "#ffffff") : "");
      }
      case "valve": {
        const c = on ? onC : offC;
        return '<path d="M2 4 L' + w / 2 + " " + h / 2 + " L2 " + (h - 4) + ' Z M' + (w - 2) + " 4 L" + w / 2 + " " + h / 2 + " L" + (w - 2) + " " + (h - 4) + ' Z" fill="' + c + '" stroke="#20242b" stroke-width="3" stroke-linejoin="round"/>';
      }
      case "cylinder": {
        const c = on ? onC : offC, bw = w * 0.5, rod = on ? w * 0.9 : w * 0.55;
        return '<rect x="1" y="' + h * 0.15 + '" width="' + bw + '" height="' + h * 0.7 + '" rx="4" fill="' + c + '" stroke="#20242b" stroke-width="3"/>' +
          '<line x1="' + bw + '" y1="' + h / 2 + '" x2="' + rod + '" y2="' + h / 2 + '" stroke="#20242b" stroke-width="6"/>' +
          '<rect x="' + (rod - 2) + '" y="' + h * 0.3 + '" width="6" height="' + h * 0.4 + '" fill="#20242b"/>';
      }
      case "conveyor": {
        const c = on ? onC : offC, n = Math.max(2, Math.floor(w / 40));
        let s = '<rect x="1" y="' + h * 0.25 + '" width="' + (w - 2) + '" height="' + h * 0.5 + '" rx="' + h * 0.25 + '" fill="' + c + '" stroke="#20242b" stroke-width="3"/>';
        for (let i = 0; i <= n; i++) s += '<circle cx="' + (h * 0.4 + (i * (w - h * 0.8)) / n).toFixed(1) + '" cy="' + h / 2 + '" r="3" fill="#20242b"/>';
        return s;
      }
      case "pipe":
        return '<rect width="' + w + '" height="' + h + '" rx="' + Math.min(w, h) / 4 + '" fill="' + col(p.fill, "#8a94a6") + '" stroke="#20242b" stroke-width="2"/>';
      case "level":
      case "temp":
      case "pressure":
      case "flow":
        return '<rect width="' + w + '" height="' + h + '" rx="6" fill="#ffffff" stroke="#9aa1ad"/>' +
          txt(8, 12, METER[o.type], 11, "#6b7280", "start") +
          txt(w - 8, h * 0.65, num(p.sample, 0) + (p.unit ? " " + p.unit : ""), num(p.fontSize, 18), "#20242b", "end");
      case "trend": {
        const min = num(p.min, 0), max = num(p.max, 100), v = num(p.sample, 0), n = 12;
        const rng = max > min ? max - min : 1;
        let d = "";
        for (let i = 0; i < n; i++) {
          const val = v + Math.sin(i * 0.9) * rng * 0.15, y = h - 6 - Math.min(1, Math.max(0, (val - min) / rng)) * (h - 12);
          d += (i ? "L" : "M") + (6 + (i * (w - 12)) / (n - 1)).toFixed(1) + " " + y.toFixed(1);
        }
        return '<rect width="' + w + '" height="' + h + '" rx="4" fill="#ffffff" stroke="#9aa1ad"/><path d="' + d + '" fill="none" stroke="' + col(p.color, "#356ae6") + '" stroke-width="2"/>' + txt(w - 6, 10, "샘플 곡선", 9, "#9aa1ad", "end");
      }
      case "text":
        return txt(0, h / 2, p.text || "", num(p.fontSize, 16), col(p.color, "#20242b"), "start");
      default:
        return '<rect width="' + w + '" height="' + h + '" fill="none" stroke="#dc4545"/>';
    }
  }

  return { TYPES, FIELDS, create, svg, esc };
})();
