// HMI editor: SVG canvas + DOM property panel. Data lives in project.hmi / project.labels (browser localStorage via PanelStore).
const PanelHmi = (() => {
  const O = PanelHmiObjects;
  const esc = O.esc;
  const GRID = 10, UNDO_MAX = 50;
  let ctx = null, root = null, svg = null;
  let sel = null, screenId = null, preview = false, clip = null, drag = null, lastCheck = null, projId = null;
  let undo = [], redo = [], sim = {}, simRun = false, simTimer = null;

  const $ = (s) => root.querySelector(s);
  const snap = (v) => Math.round(v / GRID) * GRID;
  const key = (b) => String(b || "").trim().toUpperCase();
  const newScreen = (name) => ({ id: PanelStore.uid(), name, w: 800, h: 480, objects: [] });

  function hmi() {
    const p = ctx.project();
    if (!p) return null;
    if (!p.hmi || !Array.isArray(p.hmi.screens) || !p.hmi.screens.length) p.hmi = { screens: [newScreen("화면 1")] };
    return p.hmi;
  }
  const screen = () => { const h = hmi(); return h && (h.screens.find((s) => s.id === screenId) || h.screens[0]); };
  const find = (id) => { const s = screen(); return s && s.objects.find((o) => o.id === id); };
  const labels = () => { const p = ctx.project(); return (p && p.labels) || []; };

  function snapshot() {
    undo.push(JSON.stringify(hmi().screens)); if (undo.length > UNDO_MAX) undo.shift(); redo = [];
  }
  function save() { return ctx.persist(); }
  function restore(from, to) {
    const h = hmi(); if (!from.length) return;
    to.push(JSON.stringify(h.screens));
    h.screens = JSON.parse(from.pop());
    if (!h.screens.some((s) => s.id === screenId)) screenId = h.screens[0].id;
    if (!find(sel)) sel = null;
    save(); renderAll();
  }

  // ---------- shell ----------
  function build() {
    root.innerHTML =
      '<div class="hmi-bar">' +
        '<select id="hmiScreens" aria-label="화면"></select>' +
        '<button class="btn sm" data-a="addScreen">화면 추가</button><button class="btn sm" data-a="renScreen">이름 변경</button><button class="btn sm danger" data-a="delScreen">화면 삭제</button>' +
        '<span class="hmi-sep"></span>' +
        '<button class="btn sm" data-a="undo">실행 취소</button><button class="btn sm" data-a="redo">다시 실행</button>' +
        '<button class="btn sm" data-a="copy">복사</button><button class="btn sm" data-a="paste">붙여넣기</button><button class="btn sm danger" data-a="del">삭제</button>' +
        '<span class="hmi-sep"></span>' +
        '<button class="btn sm" data-a="preview" id="hmiPreview">미리보기</button><button class="btn sm" data-a="simvals" id="hmiSimV">값 변화</button><button class="btn sm" data-a="svg">SVG 저장</button>' +
      "</div>" +
      '<div class="hmi-body">' +
        '<div class="hmi-pal" id="hmiPal"></div>' +
        '<div class="hmi-stage"><svg id="hmiSvg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="HMI 화면"></svg><p class="muted" id="hmiHint"></p></div>' +
        '<aside class="hmi-side">' +
          '<div class="hmi-sec"><h4>AI 화면 설계</h4><div id="hmiAi"></div></div>' +
          '<div class="hmi-sec"><h4>속성</h4><div id="hmiProps"></div></div>' +
          '<div class="hmi-sec"><h4>오브젝트 목록</h4><div id="hmiList"></div></div>' +
          '<div class="hmi-sec"><h4>PLC↔HMI 검사</h4><button class="btn sm primary" data-a="check">검사 실행</button><div id="hmiCheck"></div></div>' +
          '<div class="hmi-sec"><h4>AI 검사 (Inspector)</h4><div id="hmiInsp"></div></div>' +
          '<div class="hmi-sec"><h4>저장 버전</h4><div id="hmiVer"></div></div>' +
          '<div class="hmi-sec"><h4>글로벌 라벨</h4><div id="hmiLabels"></div></div>' +
        "</aside>" +
      "</div>";
    svg = $("#hmiSvg");
    const pal = $("#hmiPal");
    Object.entries(O.TYPES).forEach(([k, t]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.textContent = "＋ " + t.label; b.dataset.add = k; pal.appendChild(b);
    });
    root.addEventListener("click", onClick);
    $("#hmiScreens").onchange = (e) => { screenId = e.target.value; sel = null; renderAll(); };
    svg.addEventListener("pointerdown", onDown); svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp); svg.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey);
    if (ctx.chat && typeof PanelHmiAi !== "undefined") {
      PanelHmiAi.mount($("#hmiAi"), {
        chat: ctx.chat, toast: ctx.toast, labels, connected: () => ctx.chat.getStatus() === "online",
        apply: (screens) => {
          snapshot(); hmi().screens.push(...screens); screenId = screens[0].id; sel = null; preview = false; save(); renderAll();
          ctx.toast("AI 설계를 새 화면 " + screens.length + "개로 추가했습니다.");
        },
      });
      PanelHmiAi.mountInspector($("#hmiInsp"), {
        chat: ctx.chat, toast: ctx.toast, labels, connected: () => ctx.chat.getStatus() === "online", screen: () => screen(),
        addScreen: (s) => { snapshot(); hmi().screens.push(s); screenId = s.id; sel = null; preview = false; save(); renderAll(); ctx.toast("수정본 화면을 추가했습니다. 원본은 그대로입니다."); },
      });
    }
  }

  function onClick(e) {
    const add = e.target.closest("[data-add]");
    if (add) { addObject(add.dataset.add); return; }
    const pick = e.target.closest("[data-pick]");
    if (pick) { sel = pick.dataset.pick; renderAll(); return; }
    const a = e.target.closest("[data-a]");
    if (!a) return;
    const act = a.dataset.a, h = hmi();
    if (act === "addScreen") { snapshot(); const s = newScreen("화면 " + (h.screens.length + 1)); h.screens.push(s); screenId = s.id; sel = null; save(); renderAll(); }
    else if (act === "renScreen") { const n = prompt("화면 이름", screen().name); if (n && n.trim()) { snapshot(); screen().name = n.trim(); save(); renderAll(); } }
    else if (act === "delScreen") {
      if (h.screens.length < 2) { ctx.toast("화면은 최소 1개가 필요합니다."); return; }
      if (!confirm("‘" + screen().name + "’ 화면을 삭제할까요? (실행 취소로 복구할 수 있습니다)")) return;
      snapshot(); h.screens = h.screens.filter((s) => s.id !== screen().id); screenId = h.screens[0].id; sel = null; save(); renderAll();
    }
    else if (act === "undo") restore(undo, redo);
    else if (act === "redo") restore(redo, undo);
    else if (act === "copy") copy();
    else if (act === "paste") paste();
    else if (act === "del") del();
    else if (act === "preview") { preview = !preview; sel = null; sim = {}; stopSim(); renderAll(); }
    else if (act === "simvals") toggleSim();
    else if (act === "saveVer") saveVersion();
    else if (act === "restoreVer") restoreVersion(a.dataset.id);
    else if (act === "delVer") { h.versions = (h.versions || []).filter((v) => v.id !== a.dataset.id); save(); renderVersions(); }
    else if (act === "svg") ctx.download((screen().name || "hmi") + ".svg", screenSvg(screen()), "image/svg+xml");
    else if (act === "check") { lastCheck = PanelHmiCheck.run(ctx.project()); renderCheck(); }
    else if (act === "importLabels") importLabels();
    else if (act === "addLabel") addLabel();
    else if (act === "delLabel") { const p = ctx.project(); p.labels = labels().filter((l) => l.device !== a.dataset.dev); save(); renderLabels(); }
  }

  function onKey(e) {
    if (!root || !document.getElementById("view-hmi").classList.contains("active")) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ""))) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); }
    else if (mod && k === "c") { copy(); }
    else if (mod && k === "v") { e.preventDefault(); paste(); }
    else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? restore(redo, undo) : restore(undo, redo); }
    else if (mod && k === "y") { e.preventDefault(); restore(redo, undo); }
  }

  // ---------- object operations ----------
  function addObject(type) {
    if (preview) { ctx.toast("미리보기를 끄고 편집하세요."); return; }
    const s = screen(), n = s.objects.length;
    snapshot();
    const o = O.create(type, snap(40 + (n % 8) * 20), snap(40 + (n % 8) * 20));
    s.objects.push(o); sel = o.id; save(); renderAll();
  }
  function copy() { const o = find(sel); if (o) { clip = JSON.parse(JSON.stringify(o)); ctx.toast("복사했습니다."); } }
  function paste() {
    if (!clip || preview) return;
    snapshot();
    const o = JSON.parse(JSON.stringify(clip)); o.id = PanelStore.uid(); o.x += 20; o.y += 20; o.name += " 복사";
    clip.x += 20; clip.y += 20;
    screen().objects.push(o); sel = o.id; save(); renderAll();
  }
  function del() {
    const o = find(sel); if (!o || preview) return;
    snapshot(); screen().objects = screen().objects.filter((x) => x.id !== o.id); sel = null; save(); renderAll();
  }

  // ---------- pointer editing ----------
  function toSvg(e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function onDown(e) {
    if (preview) {
      const g = e.target.closest("[data-id]"), o = g && find(g.dataset.id);
      if (o && o.type === "button" && o.bind) { sim[key(o.bind)] = !sim[key(o.bind)]; renderCanvas(); }
      else if (o && o.type === "nav") {
        const tg = o.props.target;
        if (tg && hmi().screens.some((s) => s.id === tg)) { screenId = tg; sel = null; renderAll(); }
        else ctx.toast("이동할 화면이 지정되지 않았거나 존재하지 않습니다.");
      }
      return;
    }
    const handle = e.target.closest("[data-handle]"), g = e.target.closest("[data-id]");
    const o = handle ? find(sel) : g && find(g.dataset.id);
    if (!o) { sel = null; renderAll(); return; }
    sel = o.id;
    const pt = toSvg(e);
    drag = { mode: handle ? "resize" : "move", sx: pt.x, sy: pt.y, ox: o.x, oy: o.y, ow: o.w, oh: o.h, moved: false };
    svg.setPointerCapture(e.pointerId);
    renderAll();
  }
  function onMove(e) {
    if (!drag) return;
    const o = find(sel); if (!o) return;
    const pt = toSvg(e), dx = pt.x - drag.sx, dy = pt.y - drag.sy, s = screen();
    if (!drag.moved) { if (Math.abs(dx) + Math.abs(dy) < 3) return; snapshot(); drag.moved = true; }
    if (drag.mode === "move") {
      o.x = Math.max(0, Math.min(s.w - o.w, snap(drag.ox + dx))); o.y = Math.max(0, Math.min(s.h - o.h, snap(drag.oy + dy)));
    } else {
      o.w = Math.max(20, Math.min(s.w - o.x, snap(drag.ow + dx))); o.h = Math.max(20, Math.min(s.h - o.y, snap(drag.oh + dy)));
    }
    renderCanvas();
  }
  function onUp() {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    if (moved) { save(); renderAll(); }
  }

  // ---------- rendering ----------
  const stateOf = (o) => ({ on: preview && !!sim[key(o.bind)] });
  // Offline value simulation: word objects swing within their range. Visual only, not PLC data.
  function simObj(o) {
    const t = O.TYPES[o.type];
    if (!simRun || !preview || !t || t.bind !== "word") return o;
    const p = o.props || {};
    let lo = Number(p.min), hi = Number(p.max);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) { lo = 0; hi = (Math.abs(Number(p.sample)) || 50) * 2; }
    const ph = Date.now() / 1500 + [...o.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    return Object.assign({}, o, { props: Object.assign({}, p, { sample: Math.round((lo + (hi - lo) * (0.5 + 0.4 * Math.sin(ph))) * 10) / 10 }) });
  }
  function stopSim() { simRun = false; if (simTimer) { clearInterval(simTimer); simTimer = null; } }
  function toggleSim() {
    if (!preview) { ctx.toast("미리보기에서만 사용할 수 있습니다."); return; }
    if (simRun) { stopSim(); renderAll(); return; }
    simRun = true;
    simTimer = setInterval(() => {
      const v = document.getElementById("view-hmi");
      if (!simRun || !preview || !svg || !root.contains(svg) || !v || !v.classList.contains("active")) { stopSim(); if (root && svg && root.contains(svg)) renderBar(); return; }
      renderCanvas();
    }, 400);
    renderAll();
  }
  function objectsSvg(s, withState) {
    return s.objects.map((o) =>
      '<g data-id="' + esc(o.id) + '" transform="translate(' + o.x + "," + o.y + ')"' + (preview && (o.type === "button" || o.type === "nav") ? ' style="cursor:pointer"' : "") + '><rect width="' + o.w + '" height="' + o.h + '" fill="transparent"/>' + O.svg(withState ? simObj(o) : o, withState ? stateOf(o) : { on: false }) + "</g>").join("");
  }
  function screenSvg(s) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s.w + " " + s.h + '" width="' + s.w + '" height="' + s.h + '"><rect width="' + s.w + '" height="' + s.h + '" fill="#fff"/>' + objectsSvg(s, false) + "</svg>";
  }
  function renderCanvas() {
    const s = screen();
    svg.setAttribute("viewBox", "0 0 " + s.w + " " + s.h);
    svg.style.maxWidth = s.w + "px";
    let out = '<rect width="' + s.w + '" height="' + s.h + '" fill="#fff"/>';
    if (!preview) out += '<defs><pattern id="hmiGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#eef0f3"/></pattern></defs><rect width="' + s.w + '" height="' + s.h + '" fill="url(#hmiGrid)"/>';
    out += objectsSvg(s, preview);
    const o = !preview && find(sel);
    if (o) out += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" fill="none" stroke="#356ae6" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>' +
      '<rect data-handle="se" x="' + (o.x + o.w - 7) + '" y="' + (o.y + o.h - 7) + '" width="14" height="14" fill="#356ae6" style="cursor:nwse-resize"/>';
    svg.innerHTML = out;
  }
  function renderBar() {
    const h = hmi(), sc = $("#hmiScreens");
    sc.innerHTML = ""; h.screens.forEach((s) => sc.appendChild(new Option(s.name, s.id))); sc.value = screen().id;
    const pv = $("#hmiPreview"); pv.textContent = preview ? "편집으로 돌아가기" : "미리보기"; pv.classList.toggle("primary", preview);
    const sv = $("#hmiSimV"); sv.textContent = simRun ? "값 변화 멈춤" : "값 변화"; sv.classList.toggle("primary", simRun); sv.disabled = !preview;
    $("#hmiHint").textContent = preview
      ? "미리보기: 버튼을 누르면 같은 주소에 연결된 램프·모터·펌프가 켜지고, 화면 이동 버튼으로 다른 화면을 볼 수 있습니다. ‘값 변화’는 가상 값을 흔들어 보여 줍니다. 모두 화면 내 가상 동작이며 실제 PLC와 연결되어 있지 않습니다."
      : "오브젝트를 끌어 이동하고 오른쪽 아래 파란 점으로 크기를 조절합니다. Ctrl+C/V/Z/Y, Delete 지원. 저장은 이 브라우저에만 됩니다.";
    root.querySelectorAll("[data-add]").forEach((b) => { b.disabled = preview; });
  }
  function renderProps() {
    const box = $("#hmiProps"), o = find(sel);
    if (!o) { box.innerHTML = '<p class="empty">오브젝트를 선택하세요.</p>'; return; }
    const t = O.TYPES[o.type];
    const f = (k, label, kind, val, attr) => '<label class="hmi-f"><span>' + esc(label) + '</span><input ' + (kind === "color" ? 'type="color"' : kind === "num" ? 'type="number" step="any"' : 'type="text"') + ' data-k="' + esc(k) + '" ' + (attr || "") + ' value="' + esc(val) + '"></label>';
    let h = f("name", "이름", "text", o.name, 'data-t="top"') + '<div class="hmi-grid4">' + ["x", "y", "w", "h"].map((k) => f(k, k.toUpperCase(), "num", o[k], 'data-t="top"')).join("") + "</div>";
    h += O.FIELDS[o.type].map(([k, l, kind]) => kind === "screen"
      ? '<label class="hmi-f"><span>' + esc(l) + '</span><select data-k="' + esc(k) + '" data-t="prop"><option value="">(미지정)</option>' + hmi().screens.map((s) => '<option value="' + esc(s.id) + '"' + (s.id === o.props[k] ? " selected" : "") + ">" + esc(s.name) + "</option>").join("") + "</select></label>"
      : f(k, l, kind, o.props[k] == null ? "" : o.props[k], 'data-t="prop"')).join("");
    if (t.bind) {
      const l = PanelLabels.resolve(labels(), o.bind);
      const st = !String(o.bind || "").trim() ? "연결되지 않음" : !labels().length ? "라벨 없음 — 존재 여부 확인 불가" : l ? "라벨: " + (l.name || "(이름 없음)") + " · " + (l.type || "데이터형 없음") : "라벨 목록에 없음";
      h += '<label class="hmi-f"><span>PLC 연결 (' + (t.bind === "bit" ? "비트" : "워드") + (t.write ? ", 쓰기" : ", 읽기") + ')</span><input type="text" list="hmiDevs" data-k="bind" data-t="top" value="' + esc(o.bind || "") + '" placeholder="예: M0 또는 라벨명"></label><p class="muted hmi-st">' + esc(st) + "</p>";
    }
    box.innerHTML = h;
    box.querySelectorAll("input,select").forEach((i) => { i.onchange = () => setProp(o.id, i); });
  }
  function setProp(id, input) {
    const o = find(id); if (!o) return;
    const k = input.dataset.k, isNum = input.type === "number", s = screen();
    let v = input.value;
    if (isNum) { v = Number(v); if (!Number.isFinite(v)) { renderProps(); return; } }
    snapshot();
    if (input.dataset.t === "prop") o.props[k] = v;
    else if (k === "x") o.x = Math.max(0, Math.min(s.w - o.w, v));
    else if (k === "y") o.y = Math.max(0, Math.min(s.h - o.h, v));
    else if (k === "w") o.w = Math.max(20, Math.min(s.w - o.x, v));
    else if (k === "h") o.h = Math.max(20, Math.min(s.h - o.y, v));
    else o[k] = k === "bind" ? String(v).trim() : v;
    save(); renderAll();
  }
  function renderList() {
    const s = screen(), box = $("#hmiList");
    box.innerHTML = s.objects.length ? s.objects.map((o) => {
      const t = O.TYPES[o.type];
      return '<button type="button" class="hmi-li' + (o.id === sel ? " sel" : "") + '" data-pick="' + esc(o.id) + '"><b>' + esc(o.name) + '</b><small>' + esc(t.label) + " · " + (t.bind ? (o.bind ? esc(o.bind) : "미연결") : "연결 없음") + "</small></button>";
    }).join("") : '<p class="empty">오브젝트가 없습니다. 왼쪽 팔레트에서 추가하세요.</p>';
  }
  function renderCheck() {
    const box = $("#hmiCheck");
    if (!lastCheck) { box.innerHTML = ""; return; }
    const N = { high: "높음", mid: "보통", low: "낮음", chk: "확인 필요" };
    box.innerHTML = lastCheck.length ? lastCheck.map((x) =>
      '<div class="issue ' + x.lvl + '"><div class="ih"><span class="sev ' + x.lvl + '">' + N[x.lvl] + '</span><span class="tag">' + esc(x.type) + "</span></div>" +
      (x.object ? "<div><b>위치:</b> " + esc(x.screen) + " / " + esc(x.object) + "</div>" : "") + "<div>" + esc(x.desc) + "</div><div><b>조치:</b> " + esc(x.fix) + "</div></div>").join("") +
      '<p class="muted">라벨 목록 기준 정적 검사입니다. 실제 PLC 프로그램·통신은 확인하지 않습니다.</p>'
      : '<p class="muted">검사 가능한 범위에서 문제가 발견되지 않았습니다. 이는 실제 동작을 보증하지 않습니다.</p>';
  }
  function renderLabels() {
    const L = labels(), box = $("#hmiLabels");
    $("#hmiDevsHolder").innerHTML = '<datalist id="hmiDevs">' + L.map((l) => '<option value="' + esc(l.device) + '">' + esc(l.name) + "</option>").join("") + "</datalist>";
    box.innerHTML = '<button class="btn sm" data-a="importLabels">AI 결과에서 라벨 가져오기</button>' +
      '<p class="muted">AI 응답 표(| 디바이스 | 라벨명 | 데이터형 | 설명 |)를 읽습니다. 가져온 값은 AI 보고 기준이며 검증되지 않았습니다.</p>' +
      (L.length ? '<div class="hmi-lt">' + L.map((l) => '<div><b>' + esc(l.device) + "</b> " + esc(l.name) + ' <small class="muted">' + esc(l.type) + " · " + (l.source === "user" ? "사용자 입력" : "AI 보고") + '</small> <button type="button" class="btn sm" data-a="delLabel" data-dev="' + esc(l.device) + '">삭제</button></div>').join("") + "</div>" : '<p class="empty">라벨이 없습니다.</p>') +
      '<div class="hmi-add"><input type="text" id="lbDev" placeholder="디바이스 (M0)"><input type="text" id="lbName" placeholder="라벨명"><select id="lbType"><option value="Bit">Bit</option><option value="Word [Signed]">Word</option></select><button class="btn sm" data-a="addLabel">추가</button></div>';
  }
  function importLabels() {
    const p = ctx.project();
    const inc = p.results.flatMap((r) => PanelLabels.fromText(r.text));
    if (!inc.length) { ctx.toast("가져올 라벨 표가 없습니다. ‘글로벌 라벨’ 작업을 먼저 실행하세요."); return; }
    const m = PanelLabels.merge(labels(), inc);
    p.labels = m.list; save(); renderAll();
    ctx.toast("추가 " + m.added + " · 동일 " + m.same + (m.conflicts.length ? " · 충돌 " + m.conflicts.length + "건(기존 유지): " + m.conflicts.slice(0, 2).join(", ") : ""));
  }
  function addLabel() {
    const dev = $("#lbDev").value.trim().toUpperCase(), name = $("#lbName").value.trim(), type = $("#lbType").value;
    if (!PanelLabels.validDevice(dev)) { ctx.toast("디바이스 주소 형식이 올바르지 않습니다."); return; }
    if (labels().some((l) => l.device === dev)) { ctx.toast("이미 있는 주소입니다."); return; }
    const p = ctx.project(); p.labels = labels().concat([{ device: dev, name, type, kind: PanelLabels.kindOf(type), desc: "", source: "user" }]);
    save(); renderAll();
  }
  const VER_MAX = 10;
  const fmt = (t) => { const d = new Date(t), z = (n) => String(n).padStart(2, "0"); return z(d.getMonth() + 1) + "/" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes()); };
  function renderVersions() {
    const V = (hmi().versions || []), box = $("#hmiVer");
    box.innerHTML = '<div class="hmi-add"><input type="text" id="verName" placeholder="버전 이름 (선택)" maxlength="30"><button class="btn sm primary" data-a="saveVer">현재 상태 저장</button></div>' +
      '<p class="muted">모든 화면을 이 브라우저에 스냅샷으로 저장합니다(최대 ' + VER_MAX + '개). 복원해도 실행 취소로 되돌릴 수 있습니다.</p>' +
      (V.length ? '<div class="hmi-lt">' + V.map((v) => "<div><b>" + esc(v.name) + '</b> <small class="muted">' + fmt(v.at) + " · 화면 " + v.screens.length + '개</small> <button type="button" class="btn sm" data-a="restoreVer" data-id="' + esc(v.id) + '">복원</button> <button type="button" class="btn sm" data-a="delVer" data-id="' + esc(v.id) + '">삭제</button></div>').join("") + "</div>" : '<p class="empty">저장된 버전이 없습니다.</p>');
  }
  function saveVersion() {
    const h = hmi(), inp = $("#verName");
    h.versions = h.versions || [];
    const name = (inp && inp.value.trim()) || "버전 " + (h.versions.length + 1);
    h.versions.unshift({ id: PanelStore.uid(), name: name.slice(0, 30), at: Date.now(), screens: JSON.parse(JSON.stringify(h.screens)) });
    if (h.versions.length > VER_MAX) { h.versions.length = VER_MAX; ctx.toast("가장 오래된 버전을 정리했습니다."); }
    save(); renderVersions();
  }
  function restoreVersion(id) {
    const h = hmi(), v = (h.versions || []).find((x) => x.id === id);
    if (!v || !confirm("‘" + v.name + "’ 버전으로 복원할까요? 현재 화면은 실행 취소로 되돌릴 수 있습니다.")) return;
    snapshot(); stopSim();
    h.screens = JSON.parse(JSON.stringify(v.screens)); screenId = h.screens[0].id; sel = null; preview = false;
    save(); renderAll(); ctx.toast("‘" + v.name + "’ 버전을 복원했습니다.");
  }
  function renderAll() { renderBar(); renderCanvas(); renderProps(); renderList(); renderLabels(); renderCheck(); renderVersions(); }

  // ---------- public ----------
  function init(c) { ctx = c; root = document.getElementById("hmiRoot"); }
  function show() {
    if (!ctx.project()) {
      root.innerHTML = '<div class="pad"><p class="empty">프로젝트가 없습니다.</p><button class="btn primary" id="hmiNewProj">프로젝트 만들기</button></div>';
      root.querySelector("#hmiNewProj").onclick = () => { ctx.ensureProject(); show(); };
      svg = null; return;
    }
    const p = ctx.project();
    if (!svg || !root.contains(svg)) { build(); root.insertAdjacentHTML("beforeend", '<span id="hmiDevsHolder" hidden></span>'); }
    if (projId !== p.id) { projId = p.id; undo = []; redo = []; sel = null; screenId = null; lastCheck = null; sim = {}; stopSim(); preview = false; }
    if (!screenId || !find(sel)) { screenId = (screen() || {}).id; }
    renderAll();
  }
  return { init, show };
})();
