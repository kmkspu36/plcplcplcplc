// TechElectricUI (P6-A): 전기·전자 설계 편집기 화면. Data/validation/storage live in electric.js (TechElectric).
// AI results are only ever added as a NEW design after the user approves a preview; nothing here claims electrical correctness.
const TechElectricUI = (() => {
  const E = () => window.TechElectric;
  const GRID = 10;
  const SCHEMA_HINT =
    '{"version":1,"name":"설계 이름","canvas":{"w":900,"h":600},"parts":[{"id":"p1","type":"source","name":"V1","x":40,"y":200,"w":50,"h":70,"props":{"value":"24V"}}],' +
    '"wires":[{"id":"w1","net":"24V","from":{"part":"p1","pin":"+"},"to":{"part":"p2","pin":"1"}}],"notes":[{"id":"n1","x":40,"y":40,"text":"메모"}]}';

  function mount(root, ctx) {
    const T = E(), esc = T.esc;
    ctx = ctx || {};
    const S = { store: null, design: null, base: 0, undo: [], redo: [], dirty: false, selPart: null, selWire: null, wireFrom: null, clip: null, msg: "", pending: null, unsub: null, collect: null };
    const status = (m, bad) => { S.msg = m; const el = root.querySelector("#eeMsg"); if (el) { el.textContent = m; el.className = bad ? "tc-muted ee-bad" : "tc-muted"; } };
    const reason = (r) => T.REASON[r.reason] || "처리하지 못했습니다(" + esc(r.reason || "") + ").";
    const snap = () => JSON.stringify(S.design);
    const pushUndo = () => { S.undo.push(snap()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; S.dirty = true; };
    const restoreFrom = (s) => { S.design = JSON.parse(s); S.selPart = null; S.selWire = null; S.wireFrom = null; S.dirty = true; };
    const proj = () => (ctx.projects ? ctx.projects() : []);
    const projName = (id) => { const p = proj().find((x) => x.id === id); return p ? p.name : id ? "(없는 프로젝트)" : "연결 안 함"; };

    function list() {
      const r = T.read(); S.store = r;
      if (!r.ok) { root.innerHTML = '<div class="tc-safe">' + esc(T.REASON[r.reason] || "읽지 못했습니다.") + "</div>"; return; }
      T.expire();
      const d = r.data;
      root.innerHTML =
        '<div class="tc-card"><h2>내 설계</h2><p class="tc-muted">설계는 이 브라우저의 저장소(<code>' + T.KEY + '</code>)에만 저장됩니다. 서버에 올라가지 않습니다. 브라우저 데이터를 지우면 사라지므로 JSON 백업을 내려받아 두세요.</p>' +
        '<p><button class="tc-btn tc-primary" id="eeNew" type="button">새 설계</button> <button class="tc-btn" id="eeBackup" type="button">전체 JSON 백업</button> <label class="tc-btn" for="eeImport">JSON 가져오기</label><input type="file" id="eeImport" accept=".json,application/json" style="position:absolute;left:-9999px"></p>' +
        '<p class="tc-muted" id="eeMsg" role="status" aria-live="polite">' + esc(S.msg) + "</p>" +
        (d.designs.length ? '<div class="tc-tablewrap"><table class="tc-table"><tr><th>이름</th><th>프로젝트</th><th>부품/연결</th><th>수정</th><th>작업</th></tr>' +
          d.designs.map((x) => "<tr><td>" + esc(x.name) + "</td><td>" + esc(projName(x.projectId)) + "</td><td>" + x.parts.length + " / " + x.wires.length + "</td><td>" + new Date(x.updated).toLocaleString("ko-KR") + '</td><td><button class="tc-btn" data-open="' + esc(x.id) + '" type="button">열기</button> <button class="tc-btn" data-del="' + esc(x.id) + '" type="button">휴지통으로</button></td></tr>').join("") + "</table></div>" : '<p class="tc-muted">아직 설계가 없습니다. [새 설계]를 누르거나 AI에게 초안을 요청하세요.</p>') +
        "</div>" +
        '<div class="tc-card"><h2>설계 휴지통 (30일)</h2><p class="tc-muted">삭제한 설계는 30일간 이 화면에서 복원할 수 있고, 이후 자동 삭제됩니다(PC 시계가 이상하면 자동 삭제를 건너뜁니다). 프로젝트 휴지통과는 별도입니다.</p>' +
        (d.trash.length ? '<ul class="tc-list">' + d.trash.map((t) => "<li><span><b>" + esc(t.name) + "</b> <span class='tc-muted'>만료 " + new Date(t.expiresAt).toLocaleDateString("ko-KR") + '</span></span><span><button class="tc-btn" data-rest="' + esc(t.trashId) + '" type="button">복원</button> <button class="tc-btn" data-purge="' + esc(t.trashId) + '" type="button">영구 삭제</button></span></li>').join("") + "</ul>" : '<p class="tc-muted">비어 있습니다.</p>') + "</div>";
      root.querySelector("#eeNew").onclick = () => { const n = window.prompt("설계 이름", "새 설계"); if (n === null) return; const dsg = T.newDesign(n, ""); const w = T.create(dsg); if (!w.ok) { status(reason(w), true); return; } edit(dsg.id); };
      root.querySelector("#eeBackup").onclick = () => { const b = T.backup(); if (!b) return status("백업할 수 없습니다.", true); download("techcore-electric-backup.json", JSON.stringify(b, null, 1), "application/json"); status("백업을 내려받았습니다."); };
      root.querySelector("#eeImport").onchange = (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        if (f.size > 4e6) { status("파일이 너무 큽니다(4MB 초과).", true); return; }
        f.text().then((t) => { let o; try { o = JSON.parse(t); } catch { status("JSON 형식이 아닙니다.", true); return; } const w = T.importAny(o); if (!w.ok) { status(w.reason === "format" ? "전기·전자 설계 JSON이 아닙니다." : reason(w), true); return; } S.msg = w.count + "개 설계를 새 설계로 가져왔습니다(기존 설계는 덮어쓰지 않음, 알 수 없는 값 " + w.warnings + "건 보정/제거)."; list(); });
      };
      root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => edit(b.dataset.open)));
      root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { if (!window.confirm("이 설계를 휴지통으로 옮깁니다. 30일 안에 복원할 수 있습니다.")) return; const w = T.trash(b.dataset.del); S.msg = w.ok ? "휴지통으로 옮겼습니다." : reason(w); list(); }));
      root.querySelectorAll("[data-rest]").forEach((b) => (b.onclick = () => { const w = T.restore(b.dataset.rest); S.msg = w.ok ? "복원했습니다." : reason(w); list(); }));
      root.querySelectorAll("[data-purge]").forEach((b) => (b.onclick = () => { if (!window.confirm("영구 삭제하면 되돌릴 수 없습니다.")) return; const w = T.purge(b.dataset.purge); S.msg = w.ok ? "영구 삭제했습니다." : reason(w); list(); }));
    }

    function download(name, text, type) {
      const url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function edit(id) {
      const r = T.read(); if (!r.ok) { list(); return; }
      const d = r.data.designs.find((x) => x.id === id); if (!d) { list(); return; }
      S.design = JSON.parse(JSON.stringify(d)); S.base = d.updated; S.undo = []; S.redo = []; S.dirty = false; S.selPart = null; S.selWire = null; S.wireFrom = null; S.pending = null;
      draw();
    }
    const leave = () => { if (S.dirty && !window.confirm("저장하지 않은 변경이 있습니다. 버리고 목록으로 돌아갈까요?")) return; stopCollect(); list(); };

    function draw() {
      const d = S.design;
      root.innerHTML =
        '<p><button class="tc-btn" id="eeBack" type="button">← 설계 목록</button> <b>' + esc(d.name) + '</b> <span class="tc-muted" id="eeDirty"></span></p>' +
        '<div class="tc-card"><div class="ee-bar">' +
        '<label for="eeType" class="tc-muted">부품</label><select id="eeType">' + Object.keys(T.TYPES).map((k) => '<option value="' + k + '">' + esc(T.TYPES[k].label) + "</option>").join("") + "</select>" +
        '<button class="tc-btn" id="eeAdd" type="button">추가</button><button class="tc-btn" id="eeUndo" type="button">실행 취소</button><button class="tc-btn" id="eeRedo" type="button">다시 실행</button>' +
        '<button class="tc-btn" id="eeCopy" type="button">복사</button><button class="tc-btn" id="eePaste" type="button">붙여넣기</button><button class="tc-btn" id="eeDelete" type="button">선택 삭제</button>' +
        '<button class="tc-btn" id="eeNote" type="button">메모 추가</button><button class="tc-btn tc-primary" id="eeSave" type="button">저장</button></div>' +
        '<p class="tc-muted">부품을 누르거나 Tab으로 이동해 Enter로 선택하고, 방향키로 이동(Shift는 1px)합니다. 연결: 한 핀을 누른 뒤 다른 핀을 누르세요(Esc 취소). 아래 속성 칸에서 숫자로도 바꿀 수 있습니다.</p>' +
        '<div class="ee-wrap"><svg id="eeSvg" class="ee-svg" viewBox="0 0 ' + d.canvas.w + " " + d.canvas.h + '" width="' + d.canvas.w + '" height="' + d.canvas.h + '" role="group" aria-label="회로 편집 캔버스" font-family="sans-serif"></svg></div>' +
        '<p class="tc-muted" id="eeMsg" role="status" aria-live="polite">' + esc(S.msg) + "</p>" +
        '<div id="eeProps" class="ee-props"></div></div>' +
        '<div class="tc-card"><h2>설계 정보</h2><p><label for="eeName">이름</label> <input id="eeName" class="tc-search" maxlength="60" value="' + esc(d.name) + '"> ' +
        '<label for="eeProj">프로젝트 연결</label> <select id="eeProj"><option value="">연결 안 함</option>' + proj().map((p) => '<option value="' + esc(p.id) + '"' + (p.id === d.projectId ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select></p>" +
        '<p><button class="tc-btn" id="eeSvgOut" type="button">SVG 내보내기</button> <button class="tc-btn" id="eeJsonOut" type="button">JSON 내보내기</button></p>' +
        '<p class="tc-muted">내보내기는 SVG와 JSON만 지원합니다. 다른 CAD/전기 설계 도구 형식은 만들지 않으며 호환 여부는 확인되지 않았습니다.</p></div>' +
        '<div class="tc-card"><h2>정적 점검 (사이트 자체 점검)</h2><div class="tc-safe">' + esc(T.DISCLAIMER) + '</div><p><button class="tc-btn" id="eeCheck" type="button">점검하기</button></p><div id="eeCheckOut" aria-live="polite"></div></div>' +
        '<div class="tc-card"><h2>스냅샷</h2><p><button class="tc-btn" id="eeSnap" type="button">현재 저장본으로 스냅샷</button></p><div id="eeSnaps"></div><p class="tc-muted">스냅샷은 저장된 설계를 기준으로 만들며, 최대 ' + T.MAX.snaps + "개입니다.</p></div>" +
        '<div class="tc-card"><h2>AI에게 설계 초안 요청</h2><p class="tc-muted">요청은 직접 [AGENT01에게 보내기]를 눌러야 전송됩니다. 입력한 내용은 외부 AI 에이전트로 전송되므로 기밀 자료는 넣지 마세요. 부품 선정·전기 계산은 AI가 말한 내용일 뿐 사이트가 검증한 것이 아닙니다.</p>' +
        '<label for="eeAiReq"><b>만들고 싶은 회로</b></label><textarea id="eeAiReq" class="tc-ta" rows="4" placeholder="예: 24V 전원, 푸시버튼 1개, 램프 1개로 구성된 단순 점등 회로"></textarea>' +
        '<p><button class="tc-btn tc-primary" id="eeAiSend" type="button">AGENT01에게 보내기</button> <span class="tc-muted" id="eeAiMsg" role="status" aria-live="polite"></span></p>' +
        '<label for="eeAiPaste"><b>AI 답변 붙여넣기</b> <span class="tc-muted">(자동 수집이 안 되면 직접 붙여넣으세요)</span></label><textarea id="eeAiPaste" class="tc-ta" rows="5"></textarea>' +
        '<p><button class="tc-btn" id="eeAiParse" type="button">JSON 검증·미리보기</button></p><div id="eeAiOut"></div></div>';
      bind(); paintSvg(); paintProps(); paintSnaps(); paintDirty();
    }

    const paintDirty = () => { const el = root.querySelector("#eeDirty"); if (el) el.textContent = S.dirty ? "(저장 안 됨)" : "(저장됨)"; };
    const svgEl = () => root.querySelector("#eeSvg");
    function paintSvg() {
      const svg = svgEl(); if (!svg) return;
      const had = document.activeElement && document.activeElement.closest && svg.contains(document.activeElement) ? document.activeElement.getAttribute("data-id") || "" : "";
      svg.innerHTML = T.inner(S.design, { interactive: true, selPart: S.selPart, selWire: S.selWire }) + (S.wireFrom ? "" : "");
      if (had) { const n = svg.querySelector('[data-id="' + had.replace(/"/g, "") + '"]'); if (n) n.focus(); }
      paintDirty();
    }
    const partById = (id) => S.design.parts.find((p) => p.id === id);
    function paintProps() {
      const el = root.querySelector("#eeProps"); if (!el) return;
      const p = S.selPart && partById(S.selPart), w = S.selWire && S.design.wires.find((x) => x.id === S.selWire);
      if (S.wireFrom) { el.innerHTML = '<p class="tc-muted">연결 중: ' + esc(S.wireFrom.label) + ' 핀에서 시작했습니다. 연결할 다른 핀을 누르세요(Esc 취소).</p>'; return; }
      if (w) { el.innerHTML = '<p><b>연결선</b> ' + esc(w.from.pin) + " ↔ " + esc(w.to.pin) + ' <label for="eeNet">넷 이름</label> <input id="eeNet" class="tc-search" maxlength="30" value="' + esc(w.net) + '"></p>'; el.querySelector("#eeNet").onchange = (e) => { pushUndo(); w.net = e.target.value.replace(/[^\w가-힣 +\-.]/g, "").slice(0, 30); paintSvg(); }; return; }
      if (!p) { el.innerHTML = '<p class="tc-muted">선택한 항목이 없습니다.</p>'; return; }
      const f = (k, label, v, extra) => '<label>' + label + ' <input data-prop="' + k + '" ' + (extra || 'type="number"') + ' value="' + esc(v) + '" style="width:5.5em"></label> ';
      el.innerHTML = "<p><b>속성: " + esc(T.typeOf(p.type).label) + "</b></p><p>" + f("name", "이름", p.name, 'type="text" maxlength="40" style="width:8em"') + f("value", "값/규격", p.props.value, 'type="text" maxlength="30" style="width:9em"') + "</p><p>" + f("x", "X", p.x) + f("y", "Y", p.y) + f("w", "너비", p.w) + f("h", "높이", p.h) + "</p>";
      el.querySelectorAll("[data-prop]").forEach((i) => (i.onchange = () => {
        pushUndo(); const k = i.dataset.prop, v = i.value;
        if (k === "name") p.name = v.trim().slice(0, 40) || p.name; else if (k === "value") p.props.value = v.trim().slice(0, 30);
        else { const n = Math.round(Number(v)); if (Number.isFinite(n)) p[k] = k === "w" || k === "h" ? Math.max(20, Math.min(300, n)) : Math.max(0, Math.min(k === "x" ? S.design.canvas.w - p.w : S.design.canvas.h - p.h, n)); }
        paintSvg(); paintProps();
      }));
    }
    function paintSnaps() {
      const el = root.querySelector("#eeSnaps"); if (!el) return;
      const a = T.snapshots(S.design.id);
      el.innerHTML = a.length ? '<ul class="tc-list">' + a.map((s) => "<li><span>" + esc(s.name) + "</span><span><button class='tc-btn' data-srest='" + esc(s.id) + "' type='button'>이 스냅샷으로 되돌리기</button> <button class='tc-btn' data-sdel='" + esc(s.id) + "' type='button'>삭제</button></span></li>").join("") + "</ul>" : '<p class="tc-muted">스냅샷이 없습니다.</p>';
      el.querySelectorAll("[data-srest]").forEach((b) => (b.onclick = () => { const s = a.find((x) => x.id === b.dataset.srest); if (!s || !window.confirm("현재 편집 내용 대신 이 스냅샷을 불러옵니다(실행 취소 가능, 저장 전에는 저장본이 바뀌지 않음).")) return; pushUndo(); const keepId = S.design.id; S.design = JSON.parse(JSON.stringify(s.design)); S.design.id = keepId; S.selPart = S.selWire = null; paintSvg(); paintProps(); status("스냅샷을 불러왔습니다. 마음에 들면 [저장]을 누르세요."); }));
      el.querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = () => { const w = T.deleteSnapshot(S.design.id, b.dataset.sdel); if (!w.ok) status(reason(w), true); paintSnaps(); }));
    }

    function bind() {
      const q = (s) => root.querySelector(s), svg = svgEl();
      q("#eeBack").onclick = leave;
      q("#eeAdd").onclick = () => { const p = T.newPart(q("#eeType").value, 40 + (S.design.parts.length % 8) * 20, 40 + (S.design.parts.length % 8) * 20, S.design.parts); if (!p) return; if (S.design.parts.length >= T.MAX.parts) { status("부품은 최대 " + T.MAX.parts + "개입니다.", true); return; } pushUndo(); S.design.parts.push(p); S.selPart = p.id; S.selWire = null; paintSvg(); paintProps(); };
      q("#eeUndo").onclick = undo; q("#eeRedo").onclick = redo;
      q("#eeCopy").onclick = () => { const p = S.selPart && partById(S.selPart); if (p) { S.clip = JSON.parse(JSON.stringify(p)); status("복사했습니다."); } else status("복사할 부품을 먼저 선택하세요.", true); };
      q("#eePaste").onclick = () => { if (!S.clip) return status("복사한 부품이 없습니다.", true); if (S.design.parts.length >= T.MAX.parts) return status("부품은 최대 " + T.MAX.parts + "개입니다.", true); pushUndo(); const c = JSON.parse(JSON.stringify(S.clip)); c.id = T.uid(); c.x = Math.min(S.design.canvas.w - c.w, c.x + 20); c.y = Math.min(S.design.canvas.h - c.h, c.y + 20); c.name = c.name + "_복사"; S.design.parts.push(c); S.selPart = c.id; paintSvg(); paintProps(); };
      q("#eeDelete").onclick = delSel;
      q("#eeNote").onclick = () => { const t = window.prompt("메모 내용(100자 이내)"); if (!t || !t.trim()) return; pushUndo(); S.design.notes.push({ id: T.uid(), x: 20, y: 24 + S.design.notes.length * 16, text: t.trim().slice(0, 100) }); paintSvg(); };
      q("#eeSave").onclick = save;
      q("#eeName").onchange = (e) => { pushUndo(); S.design.name = e.target.value.trim().slice(0, 60) || S.design.name; paintDirty(); };
      q("#eeProj").onchange = (e) => { pushUndo(); S.design.projectId = e.target.value; paintDirty(); };
      q("#eeSvgOut").onclick = () => download((S.design.name || "design").replace(/[^\w가-힣.-]+/g, "_") + ".svg", T.toSvg(S.design), "image/svg+xml");
      q("#eeJsonOut").onclick = () => download((S.design.name || "design").replace(/[^\w가-힣.-]+/g, "_") + ".json", T.toJson(S.design), "application/json");
      q("#eeCheck").onclick = () => { const r = T.staticCheck(S.design); q("#eeCheckOut").innerHTML = (r.length ? '<ul class="tc-list">' + r.map((x) => "<li><span>" + esc(x.msg) + '</span><span class="tc-badge ' + (x.sev === "warn" ? "err" : "") + '">' + (x.sev === "warn" ? "주의" : "참고") + "</span></li>").join("") + "</ul>" : '<p>형식 점검에서 발견된 항목이 없습니다.</p>') + '<p class="tc-muted">' + esc(T.DISCLAIMER) + "</p>"; };
      q("#eeSnap").onclick = () => { if (S.dirty) { status("먼저 [저장]한 뒤 스냅샷을 만드세요(스냅샷은 저장본 기준).", true); return; } const w = T.addSnapshot(S.design); if (!w.ok) status(reason(w), true); else status("스냅샷을 만들었습니다."); paintSnaps(); };
      q("#eeAiSend").onclick = aiSend; q("#eeAiParse").onclick = () => aiParse(q("#eeAiPaste").value);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("keydown", onKey);
    }
    function undo() { if (!S.undo.length) return; S.redo.push(snap()); restoreFrom(S.undo.pop()); paintSvg(); paintProps(); }
    function redo() { if (!S.redo.length) return; S.undo.push(snap()); restoreFrom(S.redo.pop()); paintSvg(); paintProps(); }
    function delSel() {
      if (S.selWire) { pushUndo(); S.design.wires = S.design.wires.filter((w) => w.id !== S.selWire); S.selWire = null; }
      else if (S.selPart) { pushUndo(); const id = S.selPart; S.design.parts = S.design.parts.filter((p) => p.id !== id); S.design.wires = S.design.wires.filter((w) => w.from.part !== id && w.to.part !== id); S.selPart = null; }
      else { status("삭제할 항목을 먼저 선택하세요.", true); return; }
      paintSvg(); paintProps();
    }
    function save() {
      const w = T.save(S.design, S.base);
      if (!w.ok) { status(reason(w), true); return; }
      S.base = w.updated; S.design.updated = w.updated; S.dirty = false; status("저장했습니다."); paintDirty();
    }
    const pt = (e) => { const svg = svgEl(), r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * (S.design.canvas.w / r.width), y: (e.clientY - r.top) * (S.design.canvas.h / r.height) }; };
    function onDown(e) {
      const pin = e.target.closest && e.target.closest("[data-pin]");
      if (pin) {
        const part = partById(pin.dataset.part), id = pin.dataset.pin; e.preventDefault();
        if (!S.wireFrom) { S.wireFrom = { part: part.id, pin: id, label: part.name + " " + id }; S.selPart = S.selWire = null; paintSvg(); paintProps(); return; }
        const f = S.wireFrom; S.wireFrom = null;
        if (f.part === part.id && f.pin === id) { paintProps(); return; }
        if (S.design.wires.length >= T.MAX.wires) { status("연결선은 최대 " + T.MAX.wires + "개입니다.", true); paintProps(); return; }
        pushUndo(); S.design.wires.push({ id: T.uid(), net: "", from: { part: f.part, pin: f.pin }, to: { part: part.id, pin: id } }); paintSvg(); paintProps(); return;
      }
      const wire = e.target.closest && e.target.closest("[data-wire]");
      if (wire) { S.selWire = wire.dataset.wire; S.selPart = null; S.wireFrom = null; paintSvg(); paintProps(); return; }
      const hd = e.target.closest && e.target.closest("[data-handle]");
      const g = e.target.closest && e.target.closest("[data-id]");
      if (hd && S.selPart) { startDrag(e, partById(S.selPart), "resize"); return; }
      if (g) { S.selPart = g.dataset.id; S.selWire = null; S.wireFrom = null; paintSvg(); paintProps(); startDrag(e, partById(S.selPart), "move"); return; }
      S.selPart = S.selWire = null; S.wireFrom = null; paintSvg(); paintProps();
    }
    function startDrag(e, p, mode) {
      const s0 = pt(e), o = { x: p.x, y: p.y, w: p.w, h: p.h }; let moved = false;
      const mv = (ev) => {
        const c = pt(ev), dx = c.x - s0.x, dy = c.y - s0.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!moved) { pushUndo(); moved = true; }
        if (mode === "move") { p.x = Math.max(0, Math.min(S.design.canvas.w - p.w, Math.round((o.x + dx) / GRID) * GRID)); p.y = Math.max(0, Math.min(S.design.canvas.h - p.h, Math.round((o.y + dy) / GRID) * GRID)); }
        else { p.w = Math.max(20, Math.min(300, Math.round((o.w + dx) / GRID) * GRID)); p.h = Math.max(20, Math.min(300, Math.round((o.h + dy) / GRID) * GRID)); }
        paintSvg();
      };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); paintProps(); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    }
    let lastKey = 0;
    function onKey(e) {
      if (e.key === "Escape" && S.wireFrom) { S.wireFrom = null; paintProps(); return; }
      const g = e.target.closest && e.target.closest("[data-id]"), wr = e.target.closest && e.target.closest("[data-wire]");
      if (wr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); S.selWire = wr.dataset.wire; S.selPart = null; paintSvg(); paintProps(); return; }
      if (!g) return;
      const p = partById(g.dataset.id); if (!p) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); S.selPart = p.id; S.selWire = null; paintSvg(); paintProps(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); S.selPart = p.id; delSel(); return; }
      const step = e.shiftKey ? 1 : GRID, dv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!dv) return;
      e.preventDefault();
      const now = Date.now(); if (now - lastKey > 800) pushUndo(); lastKey = now;
      p.x = Math.max(0, Math.min(S.design.canvas.w - p.w, p.x + dv[0])); p.y = Math.max(0, Math.min(S.design.canvas.h - p.h, p.y + dv[1]));
      S.selPart = p.id; paintSvg(); paintProps();
    }

    // ---- AI flow ----
    function stopCollect() { if (S.unsub) { S.unsub(); S.unsub = null; } if (S.collect) { clearTimeout(S.collect.timer); S.collect = null; } }
    function aiPrompt(req) {
      const kinds = Object.keys(T.TYPES).map((k) => k + "(" + T.TYPES[k].label + ": 핀 " + T.TYPES[k].pins.map((p) => p.id).join(",") + ")").join(", ");
      const hdr = ctx.header ? ctx.header(S.design.name) : "";
      return hdr + "\n[전기·전자 회로 설계 초안 요청]\n만들고 싶은 회로:\n" + req + "\n\n요청 사항:\n- 아래 JSON 형식으로만 설계 데이터를 ```json 코드 블록 하나에 담아 주세요. 형식 밖의 값은 사용자 화면에서 제거됩니다.\n- 허용 부품 종류(type)와 핀 id: " + kinds + "\n- 좌표는 캔버스(900x600) 안의 정수, 연결선(wires)의 part는 부품 id, pin은 위 핀 id입니다.\n- 부품 선정이나 전기 계산을 했다면 JSON 밖에 근거와 함께 설명해 주세요(사이트가 검증하지 않습니다).\n- 안전성은 보증하지 않으며 실제 설비는 자격 있는 담당자가 검토합니다.\n- PLC 코드는 제가 명시적으로 요청할 때만 작성해 주세요.\nJSON 형식 예:\n" + SCHEMA_HINT;
    }
    function aiSend() {
      const q = (s) => root.querySelector(s), req = q("#eeAiReq").value.trim(), msg = q("#eeAiMsg");
      if (!req) { msg.textContent = "만들고 싶은 회로를 먼저 입력하세요."; return; }
      if (!ctx.send) { msg.textContent = "채팅 연결 기능을 사용할 수 없습니다."; return; }
      const text = aiPrompt(req);
      ctx.send(text).then(() => {
        msg.textContent = "AGENT01에게 보냈습니다. 답변이 오면 아래에서 검증합니다(자동 수집이 안 되면 직접 붙여넣으세요).";
        stopCollect();
        if (ctx.onActivity) {
          let buf = "";
          S.collect = { timer: 0 };
          S.unsub = ctx.onActivity((a) => {
            if (!a || a.type !== "message" || !a.from || a.from.role === "user" || typeof a.text !== "string") return;
            buf += (buf ? "\n" : "") + a.text;
            clearTimeout(S.collect && S.collect.timer);
            if (S.collect) S.collect.timer = setTimeout(() => { const el = root.querySelector("#eeAiPaste"); if (el) { el.value = buf; aiParse(buf); } stopCollect(); }, 5000);
          });
        }
      }, (e) => {
        try { navigator.clipboard && navigator.clipboard.writeText(text); } catch {}
        msg.textContent = (e && e.message ? e.message : "전송하지 못했습니다.") + " 요청 내용은 지워지지 않았습니다. 연결 후 다시 보내거나 요청을 복사해 직접 사용하세요.";
      });
    }
    function aiParse(text) {
      const out = root.querySelector("#eeAiOut"), x = T.extractJson(text);
      if (!x.obj) { out.innerHTML = '<p class="tc-muted ee-bad">답변에서 설계 JSON을 찾지 못했습니다. 코드 블록 안의 JSON이 올바른지 확인해 주세요.</p>'; return; }
      const v = T.validate(x.obj, { defaultName: "AI 설계 초안" }), d = v.design;
      S.pending = d;
      out.innerHTML = '<div class="tc-tip"><b>미리보기 (아직 추가되지 않았습니다)</b> 부품 ' + d.parts.length + "개, 연결 " + d.wires.length + "개. 사이트는 형식만 확인했으며 회로가 맞는지는 확인하지 않았습니다.</div>" +
        (v.warnings.length ? '<p><b>제거·보정된 항목 ' + v.warnings.length + '건</b></p><ul class="tc-list">' + v.warnings.slice(0, 30).map((m) => "<li>" + esc(m) + "</li>").join("") + (v.warnings.length > 30 ? "<li>…외 " + (v.warnings.length - 30) + "건</li>" : "") + "</ul>" : "<p>형식 보정 없음.</p>") +
        '<div class="ee-wrap"><svg viewBox="0 0 ' + d.canvas.w + " " + d.canvas.h + '" width="' + Math.min(d.canvas.w, 600) + '" role="img" aria-label="AI 설계 미리보기" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>' + T.inner(d) + "</svg></div>" +
        (x.rest ? '<details><summary>JSON 밖 설명 (AI가 말한 내용, 사이트가 검증하지 않음)</summary><pre class="ee-pre">' + esc(x.rest.slice(0, 4000)) + "</pre></details>" : "") +
        '<p><button class="tc-btn tc-primary" id="eeAiAdd" type="button">새 설계로 추가</button> <button class="tc-btn" id="eeAiDrop" type="button">버리기</button></p>';
      out.querySelector("#eeAiDrop").onclick = () => { S.pending = null; out.innerHTML = ""; };
      out.querySelector("#eeAiAdd").onclick = () => {
        if (S.dirty && !window.confirm("현재 설계에 저장하지 않은 변경이 있습니다. 새 설계로 추가하고 이 설계는 저장본 그대로 둡니다. 계속할까요?")) return;
        const w = T.create(S.pending); if (!w.ok) { out.insertAdjacentHTML("beforeend", '<p class="ee-bad">' + esc(reason(w)) + "</p>"); return; }
        const id = S.pending.id; S.pending = null; S.msg = "AI 초안을 새 설계로 추가했습니다. 기존 설계는 바뀌지 않았습니다(삭제하면 휴지통에서 복원 가능)."; S.dirty = false; stopCollect(); edit(id);
      };
    }

    list();
    return { destroy() { stopCollect(); }, isDirty: () => S.dirty };
  }
  return { mount };
})();
window.TechElectricUI = TechElectricUI;
