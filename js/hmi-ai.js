// HMI Designer AI: builds the request, extracts and validates the AI's JSON design, and previews it before it is applied.
// AI output is never trusted: types, geometry, colors and PLC addresses are re-checked here against the project's labels.
const PanelHmiAi = (() => {
  const O = PanelHmiObjects;
  const SCREEN_W = 800, SCREEN_H = 480, MAX_SCREENS = 8, MAX_OBJECTS = 100;
  const esc = O.esc;
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };

  const SCHEMA = '{"version":1,"screens":[{"name":"화면 이름","objects":[{"type":"button|lamp|number|gauge|motor|pump|tank|text","name":"오브젝트 이름","x":40,"y":40,"w":120,"h":48,"bind":"X0","props":{"text":"시작"}}]}]}';

  function buildPrompt(request, labels) {
    const L = labels.slice(0, 200).map((l) => "| " + l.device + " | " + l.name + " | " + l.type + " |").join("\n");
    return "[HMI 설계 요청]\n" +
      "당신은 HMI Designer입니다. 아래 요구사항으로 HMI 화면 설계를 만들어 주세요.\n" +
      "규칙:\n" +
      "- 응답에는 설명 없이 ```json 코드 블록 하나만 출력합니다.\n" +
      "- 화면 크기는 " + SCREEN_W + "x" + SCREEN_H + "이며 오브젝트는 이 범위 안에 겹치지 않게 배치합니다.\n" +
      "- type은 button(비트 쓰기), lamp(비트), number(워드), gauge(워드), motor(비트), pump(비트), tank(워드), text 중에서만 고릅니다.\n" +
      "- bind에는 아래 글로벌 라벨 목록에 있는 디바이스 주소만 씁니다. 목록에 없거나 확실하지 않으면 bind를 빈 문자열로 두고 임의의 주소를 만들지 않습니다.\n" +
      "- 버튼·램프·모터·펌프는 Bit 주소, 숫자 표시기·게이지·탱크는 Word 주소에 연결합니다.\n" +
      "- 색상은 #rrggbb 형식만 씁니다.\n" +
      "형식: " + SCHEMA + "\n\n" +
      "[글로벌 라벨 | 디바이스 | 라벨명 | 데이터형 |]\n" + (L || "(라벨 없음 - 모든 bind를 비워 두세요)") + "\n\n" +
      "[요구사항]\n" + request;
  }

  // Finds the first JSON object in the reply (fenced block preferred). Returns null when none parses.
  function extractJson(text) {
    const cands = [];
    const re = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(text))) cands.push(m[1]);
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) cands.push(text.slice(a, b + 1));
    for (const c of cands) { try { const v = JSON.parse(c); if (v && typeof v === "object") return v; } catch { /* try next */ } }
    return null;
  }

  function cleanProps(type, src, warn) {
    const t = O.TYPES[type], out = Object.assign({}, t.props), s = src && typeof src === "object" ? src : {};
    Object.keys(t.props).forEach((k) => {
      if (!(k in s)) return;
      const d = t.props[k], v = s[k];
      if (typeof d === "number") { const n = Number(v); if (Number.isFinite(n)) out[k] = Math.max(-1e6, Math.min(1e6, n)); else warn("숫자가 아닌 속성값 무시: " + k); }
      else if (/color|fill/i.test(k) || /^#/.test(d)) { if (typeof v === "string" && HEX.test(v)) out[k] = v; else warn("잘못된 색상 무시: " + k); }
      else out[k] = String(v).slice(0, 60);
    });
    return out;
  }

  // Returns { screens, warnings } or { error }. Only addresses present in `labels` with a matching data kind are kept.
  function validate(raw, labels) {
    const warnings = [], warn = (s) => { if (warnings.length < 60) warnings.push(s); };
    if (!raw || !Array.isArray(raw.screens) || !raw.screens.length) return { error: "설계 데이터에 screens 배열이 없습니다." };
    const screens = [];
    raw.screens.slice(0, MAX_SCREENS).forEach((rs, si) => {
      const sname = String((rs && rs.name) || "AI 화면 " + (si + 1)).slice(0, 40);
      const s = { id: PanelStore.uid(), name: sname, w: SCREEN_W, h: SCREEN_H, objects: [] };
      const list = rs && Array.isArray(rs.objects) ? rs.objects : [];
      if (list.length > MAX_OBJECTS) warn(sname + ": 오브젝트 " + MAX_OBJECTS + "개 초과분은 제외했습니다.");
      list.slice(0, MAX_OBJECTS).forEach((ro) => {
        const t = ro && O.TYPES[ro.type];
        if (!t) { warn(sname + ": 지원하지 않는 type '" + String(ro && ro.type).slice(0, 20) + "' 제외"); return; }
        const w = clampNum(ro.w, 20, SCREEN_W, t.w), h = clampNum(ro.h, 20, SCREEN_H, t.h);
        const o = {
          id: PanelStore.uid(), type: ro.type, name: String(ro.name || t.label).slice(0, 40),
          x: clampNum(ro.x, 0, SCREEN_W - w, 0), y: clampNum(ro.y, 0, SCREEN_H - h, 0), w, h, bind: "",
          props: cleanProps(ro.type, ro.props, (m) => warn(sname + "/" + (ro.name || t.label) + ": " + m)),
        };
        const want = String(ro.bind || "").trim();
        if (want) {
          if (!t.bind) warn(sname + "/" + o.name + ": 연결이 필요 없는 오브젝트의 bind 제거");
          else {
            const l = PanelLabels.resolve(labels, want);
            if (!l) warn(sname + "/" + o.name + ": '" + want.slice(0, 20) + "'은(는) 라벨에 없어 미연결로 둠");
            else if (l.kind !== "unknown" && l.kind !== t.bind) warn(sname + "/" + o.name + ": " + l.device + "의 데이터형이 맞지 않아 미연결로 둠");
            else o.bind = l.device;
          }
        }
        s.objects.push(o);
      });
      screens.push(s);
    });
    return { screens, warnings };
  }

  const thumb = (s) => '<svg viewBox="0 0 ' + s.w + " " + s.h + '" class="hmi-thumb"><rect width="' + s.w + '" height="' + s.h + '" fill="#fff"/>' +
    s.objects.map((o) => '<g transform="translate(' + o.x + "," + o.y + ')">' + O.svg(o, { on: false }) + "</g>").join("") + "</svg>";

  // api: { chat, labels(), apply(screens), toast(msg), connected() }
  function mount(box, api) {
    let pending = false, result = null;
    box.innerHTML =
      '<textarea id="aiReq" rows="4" placeholder="예) 컨베이어 운전 화면: 시작·정지 버튼, 운전 램프, 속도 표시"></textarea>' +
      '<div class="hmi-add"><button class="btn sm primary" type="button" id="aiGo">AI 설계 요청</button><button class="btn sm" type="button" id="aiCancel" hidden>대기 취소</button></div>' +
      '<div id="aiOut"></div>';
    const $ = (s) => box.querySelector(s), out = $("#aiOut");
    const status = (html) => { out.innerHTML = html; };

    function show(r) {
      result = r;
      status('<p class="muted">AI 설계 결과 미리보기 (' + r.screens.length + "개 화면, 오브젝트 " + r.screens.reduce((n, s) => n + s.objects.length, 0) + "개)</p>" +
        r.screens.map((s) => "<div><b>" + esc(s.name) + "</b>" + thumb(s) + "</div>").join("") +
        (r.warnings.length ? '<div class="issue chk"><div class="ih"><span class="sev chk">확인 필요</span></div><ul class="hmi-warn">' + r.warnings.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul></div>" : "") +
        '<p class="muted">적용하면 새 화면으로 추가됩니다. 기존 화면은 바뀌지 않으며 실행 취소로 되돌릴 수 있습니다. 적용 후 ‘검사 실행’으로 확인하세요.</p>' +
        '<div class="hmi-add"><button class="btn sm primary" type="button" id="aiApply">편집기에 적용</button><button class="btn sm" type="button" id="aiDiscard">버리기</button></div>');
    }

    function finish() { pending = false; $("#aiGo").disabled = false; $("#aiCancel").hidden = true; }

    $("#aiGo").onclick = async () => {
      const req = $("#aiReq").value.trim();
      if (!req) { api.toast("요구사항을 입력하세요."); return; }
      if (!api.connected()) { api.toast("AI에 연결되어 있지 않습니다. ‘재연결’을 눌러 주세요."); return; }
      const L = api.labels();
      pending = true; result = null; $("#aiGo").disabled = true; $("#aiCancel").hidden = false;
      status('<p class="muted">AI 응답을 기다리는 중입니다…' + (L.length ? "" : " (라벨이 없어 주소 연결 없이 배치만 만듭니다)") + "</p>");
      try { await api.chat.send(buildPrompt(req, L), []); }
      catch (e) { finish(); status('<p class="muted">' + esc(e.message) + "</p>"); }
    };
    $("#aiCancel").onclick = () => { finish(); status(""); };
    out.addEventListener("click", (e) => {
      if (e.target.id === "aiApply" && result) { api.apply(result.screens); result = null; status('<p class="muted">적용했습니다.</p>'); }
      else if (e.target.id === "aiDiscard") { result = null; status(""); }
    });

    api.chat.on("bot", (a) => {
      if (!pending) return;
      const raw = extractJson(a.text || "");
      if (!raw) { status('<p class="muted">AI 응답에 설계 데이터(JSON)가 없어 계속 기다립니다. 형식이 계속 틀리면 ‘대기 취소’ 후 다시 요청하세요.</p>'); return; }
      const r = validate(raw, api.labels());
      finish();
      if (r.error) status('<p class="muted">' + esc(r.error) + " 다시 요청해 보세요.</p>"); else show(r);
    });
    api.chat.on("timeout", () => { if (pending) { finish(); status('<p class="muted">AI 응답이 지연되고 있습니다. 다시 요청해 주세요.</p>'); } });
  }

  return { mount, buildPrompt, extractJson, validate };
})();
