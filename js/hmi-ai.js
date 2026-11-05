// HMI Designer AI: builds the request, extracts and validates the AI's JSON design, and previews it before it is applied.
// AI output is never trusted: types, geometry, colors and PLC addresses are re-checked here against the project's labels.
const PanelHmiAi = (() => {
  const O = PanelHmiObjects;
  const SCREEN_W = 800, SCREEN_H = 480, MAX_SCREENS = 8, MAX_OBJECTS = 100;
  const esc = O.esc;
  let active = null; // "design" | "inspect": only one AI request may wait for a reply at a time
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };

  const SCHEMA = '{"version":1,"screens":[{"name":"화면 이름","objects":[{"type":"button|lamp|number|gauge|motor|pump|tank|text|valve|cylinder|conveyor|pipe|alarm|comm|level|temp|pressure|flow|trend","name":"오브젝트 이름","x":40,"y":40,"w":120,"h":48,"bind":"X0","props":{"text":"시작"}}]}]}';

  function buildPrompt(request, labels) {
    const L = labels.slice(0, 200).map((l) => "| " + l.device + " | " + l.name + " | " + l.type + " |").join("\n");
    return "[HMI 설계 요청]\n" +
      "당신은 HMI Designer입니다. 아래 요구사항으로 HMI 화면 설계를 만들어 주세요.\n" +
      "규칙:\n" +
      "- 응답에는 설명 없이 ```json 코드 블록 하나만 출력합니다.\n" +
      "- 화면 크기는 " + SCREEN_W + "x" + SCREEN_H + "이며 오브젝트는 이 범위 안에 겹치지 않게 배치합니다.\n" +
      "- type은 button(비트 쓰기), lamp(비트), number(워드), gauge(워드), motor(비트), pump(비트), tank(워드), text, valve(비트), cylinder(비트), conveyor(비트), pipe(바인딩 없음), alarm(비트, 고장 램프), comm(비트, 통신 상태), level/temp/pressure/flow(워드, 수위/온도/압력/유량 표시), trend(워드, 샘플 곡선) 중에서만 고릅니다.\n" +
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

    function finish() { pending = false; active = null; $("#aiGo").disabled = false; $("#aiCancel").hidden = true; }

    $("#aiGo").onclick = async () => {
      const req = $("#aiReq").value.trim();
      if (!req) { api.toast("요구사항을 입력하세요."); return; }
      if (active) { api.toast("다른 AI 요청의 응답을 기다리는 중입니다."); return; }
      if (!api.connected()) { api.toast("AI에 연결되어 있지 않습니다. ‘재연결’을 눌러 주세요."); return; }
      const L = api.labels();
      pending = true; active = "design"; result = null; $("#aiGo").disabled = true; $("#aiCancel").hidden = false;
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
      if (!pending || active !== "design") return;
      const raw = extractJson(a.text || "");
      if (!raw) { status('<p class="muted">AI 응답에 설계 데이터(JSON)가 없어 계속 기다립니다. 형식이 계속 틀리면 ‘대기 취소’ 후 다시 요청하세요.</p>'); return; }
      const r = validate(raw, api.labels());
      finish();
      if (r.error) status('<p class="muted">' + esc(r.error) + " 다시 요청해 보세요.</p>"); else show(r);
    });
    api.chat.on("timeout", () => { if (pending) { finish(); status('<p class="muted">AI 응답이 지연되고 있습니다. 다시 요청해 주세요.</p>'); } });
  }

  // ---------- Inspector ----------
  const SEV = { critical: ["치명적", "high"], high: ["높음", "high"], mid: ["보통", "mid"], low: ["개선 권장", "low"] };
  const cut = (v, n) => String(v == null ? "" : v).slice(0, n);

  function buildInspectPrompt(screen, labels) {
    const objs = screen.objects.map((o) => ({ id: o.id, type: o.type, name: o.name, x: o.x, y: o.y, w: o.w, h: o.h, bind: o.bind || "", props: o.props }));
    const L = labels.slice(0, 200).map((l) => "| " + l.device + " | " + l.name + " | " + l.type + " |").join("\n");
    return "[HMI 검사 요청]\n" +
      "당신은 HMI Inspector입니다. 아래 HMI 화면을 검사해 문제를 찾아 주세요. 확인할 수 없는 항목은 추측하지 말고 확인 불가로 표시합니다. 화면을 직접 고치지 말고 제안만 합니다.\n" +
      "검사 항목: 오브젝트 누락, 겹침, 캔버스(" + screen.w + "x" + screen.h + ") 범위 초과, 버튼 속성, 램프 표시 조건, 숫자 데이터형, PLC 주소 연결(아래 라벨 목록 기준), 중복 주소, 글자 크기·가독성, 색상·상태 구분.\n" +
      "응답에는 설명 없이 ```json 코드 블록 하나만 출력합니다. 형식:\n" +
      '{"findings":[{"severity":"critical|high|mid|low","object":"오브젝트 이름 또는 빈 문자열","problem":"문제","cause":"원인","impact":"영향","fix":"해결 제안"}]}\n\n' +
      "[화면] " + screen.name + "\n" + JSON.stringify(objs) + "\n\n[글로벌 라벨 | 디바이스 | 라벨명 | 데이터형 |]\n" + (L || "(라벨 없음)");
  }

  function validateFindings(raw) {
    if (!raw || !Array.isArray(raw.findings)) return null;
    return raw.findings.slice(0, 50).map((f) => {
      const s = SEV[f && f.severity] || ["확인 불가", "chk"];
      return { label: s[0], cls: s[1], object: cut(f && f.object, 60), problem: cut(f && f.problem, 300), cause: cut(f && f.cause, 300), impact: cut(f && f.impact, 300), fix: cut(f && f.fix, 300) };
    }).filter((f) => f.problem);
  }

  // api: { chat, labels(), screen(), addScreen(s), toast(msg), connected() }
  function mountInspector(box, api) {
    let pending = false, fix = null;
    box.innerHTML =
      '<div class="hmi-add"><button class="btn sm primary" type="button" id="inGo">AI 검사 요청 (현재 화면)</button><button class="btn sm" type="button" id="inCancel" hidden>대기 취소</button>' +
      '<button class="btn sm" type="button" id="inFix">수정본 만들기</button></div>' +
      '<p class="muted">AI 검사는 AI 보고 기준이며 검증되지 않았습니다. 수정본은 레이아웃(범위·겹침·글자 크기)만 고치며 원본 화면은 그대로 둡니다.</p><div id="inOut"></div>';
    const $ = (s) => box.querySelector(s), out = $("#inOut");
    const status = (h) => { out.innerHTML = h; };
    const done = () => { pending = false; active = null; $("#inGo").disabled = false; $("#inCancel").hidden = true; };

    $("#inGo").onclick = async () => {
      if (active) { api.toast("다른 AI 요청의 응답을 기다리는 중입니다."); return; }
      if (!api.connected()) { api.toast("AI에 연결되어 있지 않습니다. ‘재연결’을 눌러 주세요."); return; }
      const s = api.screen();
      if (!s.objects.length) { api.toast("검사할 오브젝트가 없습니다."); return; }
      pending = true; active = "inspect"; $("#inGo").disabled = true; $("#inCancel").hidden = false; fix = null;
      status('<p class="muted">AI 검사 응답을 기다리는 중입니다…</p>');
      try { await api.chat.send(buildInspectPrompt(s, api.labels()), []); }
      catch (e) { done(); status('<p class="muted">' + esc(e.message) + "</p>"); }
    };
    $("#inCancel").onclick = () => { done(); status(""); };
    $("#inFix").onclick = () => {
      const r = PanelHmiCheck.fixLayout(api.screen());
      if (!r.changes.length && !r.unresolved.length) { status('<p class="muted">고칠 레이아웃 문제가 없습니다.</p>'); fix = null; return; }
      fix = r;
      status('<p class="muted">수정 전/후 비교</p><div class="hmi-cmp"><div><b>수정 전</b>' + thumb(api.screen()) + "</div><div><b>수정 후</b>" + thumb(r.screen) + "</div></div>" +
        '<ul class="hmi-warn">' + r.changes.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul>" +
        '<p class="muted">재검사: 남은 레이아웃 문제 ' + r.remaining.length + "건" + (r.unresolved.length ? " · 자리를 찾지 못한 오브젝트: " + esc(r.unresolved.join(", ")) : "") + "</p>" +
        '<div class="hmi-add"><button class="btn sm primary" type="button" id="inApply">수정본을 새 화면으로 추가</button><button class="btn sm" type="button" id="inDiscard">버리기</button></div>');
    };
    out.addEventListener("click", (e) => {
      if (e.target.id === "inApply" && fix) { api.addScreen(fix.screen); fix = null; status('<p class="muted">수정본 화면을 추가했습니다. ‘검사 실행’으로 다시 확인하세요.</p>'); }
      else if (e.target.id === "inDiscard") { fix = null; status(""); }
    });

    api.chat.on("bot", (a) => {
      if (!pending || active !== "inspect") return;
      const f = validateFindings(extractJson(a.text || ""));
      if (!f) { status('<p class="muted">AI 응답에 검사 결과(JSON)가 없어 계속 기다립니다. 계속 틀리면 ‘대기 취소’ 후 다시 요청하세요.</p>'); return; }
      done();
      status('<p class="muted">AI 검사 결과 ' + f.length + "건 (AI 보고, 미검증)</p>" + (f.length ? f.map((x) =>
        '<div class="issue ' + x.cls + '"><div class="ih"><span class="sev ' + x.cls + '">' + x.label + "</span></div>" +
        (x.object ? "<div><b>위치:</b> " + esc(x.object) + "</div>" : "") + "<div><b>문제:</b> " + esc(x.problem) + "</div>" +
        (x.cause ? "<div><b>원인:</b> " + esc(x.cause) + "</div>" : "") + (x.impact ? "<div><b>영향:</b> " + esc(x.impact) + "</div>" : "") +
        (x.fix ? "<div><b>제안:</b> " + esc(x.fix) + "</div>" : "") + "</div>").join("") : '<p class="muted">AI가 문제를 보고하지 않았습니다. 이는 실제 동작을 보증하지 않습니다.</p>'));
    });
    api.chat.on("timeout", () => { if (pending) { done(); status('<p class="muted">AI 응답이 지연되고 있습니다. 다시 요청해 주세요.</p>'); } });
  }

  return { mount, mountInspector, buildPrompt, buildInspectPrompt, extractJson, validate, validateFindings };
})();
