// PanelLab UI. All AI replies come from the real Copilot Studio connection (chat.js); nothing is simulated.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const MODES = {
    chat: { label: "AI 통합 작업실", hint: "", desc: "자유롭게 요청하세요" },
    code: { label: "PLC 코드 작성", hint: "PLC 코드 작성", desc: "요구사항으로 PLC 코드를 작성" },
    check: { label: "오류 검사", hint: "PLC 오류 검사", desc: "코드의 오류와 위험 요소 검사" },
    fix: { label: "자동 오류 수정", hint: "PLC 자동 오류 수정", desc: "오류를 수정한 전체 코드 제공" },
    ladder: { label: "래더 작화", hint: "래더 작화", desc: "코드를 래더 다이어그램으로" },
    drawing: { label: "도면 분석", hint: "도면 분석", desc: "첨부한 도면을 분석" },
    label: { label: "글로벌 라벨", hint: "글로벌 라벨 작성", desc: "글로벌 라벨과 I/O 표 작성" },
  };
  const TABS = [
    ["all", "전체 결과"], ["code", "PLC 코드"], ["check", "오류 검사"], ["fix", "자동 수정"],
    ["ladder", "래더 작화"], ["drawing", "도면 분석"], ["label", "글로벌 라벨"], ["versions", "코드 버전"], ["info", "프로젝트 정보"],
  ];
  const TEXT_EXT = /\.(txt|csv|st|il|xml|json|md|log|tsv|c|h)$/i;
  const INLINE_LIMIT = 150 * 1024;
  // Conservative cap for text attachments (inlined into the chat message). The real Direct Line/agent limit is unverified.
  const TEXT_LIMIT = 100 * 1024;
  const modeOf = (k) => (Object.prototype.hasOwnProperty.call(MODES, k) ? MODES[k] : { label: "알 수 없는 작업", desc: "", hint: "" });

  let view = "dashboard";
  let mode = "chat";
  let tab = "all";
  let pendingMode = "chat";
  let pendingBefore = "";
  let pendingMeta = null;
  let waitingReply = false;
  let files = [];
  let typingEl = null;
  let unseen = false;

  // ---------- markdown ----------
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }
  function codeBlockHtml(lang, code) {
    return PanelCode.html(code, lang);
  }
  function md(text) {
    const src = String(text).replace(/\r/g, "");
    const re = /(```|~~~)([^\n`~]*)\n([\s\S]*?)(?:\1|$)/g;
    let out = "", last = 0, m;
    const addText = (s) => { const t = mdText(s); if (t) out += '<div class="sec">' + t + "</div>"; };
    while ((m = re.exec(src))) {
      addText(src.slice(last, m.index));
      const code = m[3].replace(/\n+$/, "");
      if (code.trim()) out += codeBlockHtml(m[2].trim(), code);
      last = re.lastIndex;
    }
    addText(src.slice(last));
    return out;
  }
  function mdText(t) {
    const lines = t.split("\n");
    let html = "", list = null, para = [];
    const flushP = () => { if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } };
    const flushL = () => { if (list) { html += "</" + list + ">"; list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushP(); flushL();
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        html += "<table><thead><tr>" + cells(ln).map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { html += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; i++; }
        i--; html += "</tbody></table>";
        continue;
      }
      const h = ln.match(/^(#{1,4})\s+(.*)/);
      const li = ln.match(/^\s*([-*]|\d+\.)\s+(.*)/);
      if (h) { flushP(); flushL(); html += "<p><strong>" + inline(h[2]) + "</strong></p>"; }
      else if (li) {
        flushP();
        const kind = /\d/.test(li[1]) ? "ol" : "ul";
        if (list !== kind) { flushL(); html += "<" + kind + ">"; list = kind; }
        html += "<li>" + inline(li[2]) + "</li>";
      } else if (!ln.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(ln); }
    }
    flushP(); flushL();
    return html;
  }
  function codeBlocks(text) {
    const out = [];
    String(text).replace(/(```|~~~)([^\n`~]*)\r?\n([\s\S]*?)(?:\1|$)/g, (_, f, l, c) => {
      const code = c.replace(/\r/g, "").replace(/\n+$/, "");
      if (code.trim()) out.push({ lang: l.trim(), code });
      return "";
    });
    return out;
  }

  // ---------- helpers ----------
  const project = () => PanelStore.current();
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200);
  }
  const fmt = (ts) => new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function download(name, text, type) {
    const a = el("a"); a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function persist() {
    const p = project(); if (!p) return;
    const msgs = p.messages, ress = p.results;
    const dropM = msgs.length > 300 ? msgs.slice(0, msgs.length - 300) : [], dropR = ress.length > 200 ? ress.slice(0, ress.length - 200) : [];
    if (dropM.length) p.messages = msgs.slice(-300);
    if (dropR.length) p.results = ress.slice(-200);
    if (!PanelStore.touch(p)) {
      p.messages = msgs; p.results = ress;
      if (PanelStore.lastSaveError() === "conflict") return false;
      notice("브라우저 저장 공간이 부족하여 기록을 저장하지 못했습니다. 먼저 ‘백업 내려받기’로 저장한 뒤 오래된 프로젝트를 삭제해 주세요.", true); return false;
    }
    if (dropM.length || dropR.length) {
      try { download(p.name + "-오래된기록-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify({ app: "PanelLab", kind: "trimmed", project: p.name, messages: dropM, results: dropR }, null, 2), "application/json"); } catch (e) { /* download is best-effort */ }
      notice("기록이 많아 오래된 메시지 " + dropM.length + "건·결과 " + dropR.length + "건을 정리했고, 정리된 내용을 파일로 내려받았습니다. (최근 메시지 300건·결과 200건만 보관)", false);
    }
    return true;
  }
  function banner(msg) {
    let b = document.getElementById("globalAlert");
    if (!msg) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement("div"); b.id = "globalAlert"; b.className = "global-alert"; b.setAttribute("role", "alert");
      const s = document.createElement("span"); const x = document.createElement("button"); x.type = "button"; x.textContent = "닫기"; x.onclick = () => { b.hidden = true; };
      b.appendChild(s); b.appendChild(x); document.body.appendChild(b);
    }
    b.firstChild.textContent = msg; b.hidden = false;
  }
  const DEL_REASON = { quota: "브라우저 저장 공간이 부족합니다.", notfound: "프로젝트를 찾을 수 없습니다(다른 화면에서 이미 바뀌었을 수 있습니다).", "trash-corrupt": "휴지통 데이터를 읽을 수 없어 안전을 위해 중단했습니다.", conflict: "다른 화면의 저장 데이터를 읽을 수 없습니다.", verify: "저장 내용을 확인하지 못했습니다.", error: "저장 중 오류가 발생했습니다." };
  function notice(msg, err) {
    const n = $("#chatNotice");
    if (!msg) { n.hidden = true; return; }
    n.textContent = msg; n.className = "notice" + (err ? " err" : ""); n.hidden = false;
    if (err && view !== "workspace") banner(msg);
  }

  // ---------- navigation ----------
  function showView(v, m) {
    view = v;
    document.querySelectorAll(".view").forEach((x) => x.classList.toggle("active", x.id === "view-" + v));
    document.querySelectorAll("#nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === v && (v !== "workspace" || b.dataset.mode === (m || mode)));
    });
    if (v === "workspace") {
      if (m) setMode(m);
      renderMessages(); renderTabs(); $("#input").focus();
    }
    if (v === "dashboard") renderDashboard();
    if (v === "hmi") showHmi();
    if (v === "projects") renderProjects();
    if (v === "history") renderHistory();
    if (v === "settings") renderSettings();
    syncTabbar(v, m); updateSteps();
    closeSidebar();
  }
  function setMode(m) { mode = m; $("#modeSelect").value = m; }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }

  // ---------- projects ----------
  function ensureProject() {
    if (project()) return project();
    try { return PanelStore.createProject("기본 프로젝트", $("#softwareSelect").value); }
    catch (e) { notice(e.message, true); banner(e.message); return null; }
  }
  function newProject() {
    const name = prompt("프로젝트 이름을 입력하세요.");
    if (name === null) return;
    try { PanelStore.createProject(name, "GX Works2"); }
    catch (e) { notice(e.message, true); banner(e.message); alert(e.message); return; }
    afterProjectChange(); toast("프로젝트를 만들었습니다.");
  }
  function afterProjectChange() {
    renderProjectSelect(); renderMessages(); renderTabs(); renderDashboard(); renderProjects(); renderHistory();
    const p = project(); if (p) $("#softwareSelect").value = p.software;
    if (view === "hmi") showHmi();
  }
  function showHmi() {
    try { PanelHmi.show(); } catch (e) {
      console.error(e);
      const r = $("#hmiRoot");
      if (r) r.innerHTML = '<div class="pad"><p class="empty">HMI 화면을 불러오지 못했습니다: ' + String(e.message || e).replace(/[<>&]/g, "") + '<br>Ctrl+F5로 새로고침해 보세요.</p></div>';
    }
  }
  function renderProjectSelect() {
    const s = $("#projectSelect"); s.innerHTML = "";
    const ps = PanelStore.all();
    if (!ps.length) s.appendChild(new Option("프로젝트 없음", ""));
    ps.forEach((p) => s.appendChild(new Option(p.name, p.id)));
    const c = project(); if (c) s.value = c.id;
  }

  // ---------- dashboard ----------
  function renderDashboard() {
    renderBeginnerHome();
    const qc = $("#quickCards"); qc.innerHTML = "";
    ["code", "check", "fix", "ladder", "drawing", "label"].forEach((k) => {
      const b = el("button", "qcard", "<strong>" + esc(MODES[k].label) + "</strong><span>" + esc(MODES[k].desc) + "</span>");
      b.onclick = () => showView("workspace", k); qc.appendChild(b);
    });
    const ps = PanelStore.all();
    const none = (t) => '<p class="empty">' + t + "</p>";
    const allRes = ps.flatMap((p) => p.results.map((r) => ({ r, p })));
    const userMsgs = ps.reduce((a, p) => a + p.messages.filter((m) => m.role === "user").length, 0);
    const issues = allRes.filter((x) => x.r.mode === "check").flatMap((x) => parseIssues(x.r.text));
    const cnt = (s) => issues.filter((i) => i.sev === s).length;
    const stat = (n, l, cls) => '<div class="stat ' + (cls || "") + '"><b>' + n + "</b><span>" + l + "</span></div>";
    const hasData = ps.length > 0;
    $("#dashStats").innerHTML = hasData
      ? stat(ps.length, "프로젝트") + stat(userMsgs, "AI 요청") + stat(allRes.length, "AI 결과") +
        stat(issues.length ? cnt("err") : "–", "검사된 오류", issues.length && cnt("err") ? "err" : "") +
        stat(issues.length ? cnt("warn") : "–", "검사된 경고", issues.length && cnt("warn") ? "warn" : "")
      : '<p class="empty">아직 기록이 없습니다. 새 프로젝트를 만들고 AI에 요청하면 통계가 표시됩니다.</p>';
    const modeCounts = Object.keys(MODES).map((k) => [k, allRes.filter((x) => x.r.mode === k).length]).filter((x) => x[1]);
    const maxC = Math.max(1, ...modeCounts.map((x) => x[1]));
    $("#dashModes").innerHTML = modeCounts.length
      ? modeCounts.map(([k, n]) => '<div class="bar"><span>' + esc(MODES[k].label) + '</span><i style="width:' + Math.round((n / maxC) * 100) + '%"></i><b>' + n + "</b></div>").join("")
      : none("작업 기록이 없습니다.");
    const link = (cls, inner, attrs) => '<button type="button" class="item link ' + cls + '" ' + attrs + ">" + inner + "</button>";
    $("#dashProjects").innerHTML = ps.length
      ? ps.slice(0, 6).map((p) => link("", '<span class="grow"><strong>' + esc(p.name) + '</strong><small class="muted">' + esc(p.software) + " · 메시지 " + p.messages.length + '</small></span><span class="muted">' + fmt(p.updated) + "</span>", 'data-open-project="' + esc(p.id) + '"')).join("")
      : none("프로젝트가 없습니다. 오른쪽 위의 ‘새 프로젝트’로 시작하세요.");
    const p = project();
    const recent = p ? p.messages.filter((m) => m.role === "user").slice(-5).reverse() : [];
    $("#dashRecent").innerHTML = recent.length ? recent.map((m) => '<div class="item"><span class="grow">' + esc(m.text.slice(0, 70)) + '</span><span class="muted">' + fmt(m.ts) + "</span></div>").join("") : none("작업 내역이 없습니다.");
    const codes = p ? p.results.filter((r) => codeBlocks(r.text).length).slice(-4).reverse() : [];
    $("#dashCode").innerHTML = codes.length ? codes.map((r) => link("", '<span class="grow"><strong>' + esc(modeOf(r.mode).label) + '</strong><small class="mono">' + esc(codeBlocks(r.text)[0].code.split("\n")[0].slice(0, 50)) + '</small></span><span class="muted">' + fmt(r.ts) + "</span>", 'data-open-tab="code"')).join("") : none("저장된 코드가 없습니다.");
    const checks = p ? p.results.filter((r) => r.mode === "check").slice(-4).reverse() : [];
    $("#dashCheck").innerHTML = checks.length ? checks.map((r) => {
      const it = parseIssues(r.text), e = it.filter((x) => x.sev === "err").length, w = it.filter((x) => x.sev === "warn").length;
      return link("", '<span class="grow">' + (it.length ? '<span class="sev err">오류 ' + e + '</span><span class="sev warn">경고 ' + w + "</span>" : esc(r.text.slice(0, 50))) + '</span><span class="muted">' + fmt(r.ts) + "</span>", 'data-open-tab="check"');
    }).join("") : none("검사 결과가 없습니다.");
  }
  function renderProjects() {
    const box = $("#projectList"); box.innerHTML = "";
    const ps = PanelStore.all(), cur = project();
    if (!ps.length) { box.innerHTML = '<p class="empty">프로젝트가 없습니다.</p>'; return; }
    ps.forEach((p) => { try {
      const it = el("div", "item" + (cur && cur.id === p.id ? " sel" : ""));
      it.innerHTML = '<div class="grow"><strong>' + esc(p.name) + '</strong><div class="muted">' + esc(p.software) + " · 메시지 " + p.messages.length + " · 수정 " + fmt(p.updated) + "</div></div>";
      const mk = (t, fn, cls) => { const b = el("button", "btn sm " + (cls || ""), t); b.onclick = fn; it.appendChild(b); };
      mk("열기", () => { PanelStore.setCurrent(p.id); afterProjectChange(); showView("workspace", "chat"); });
      mk("이름 변경", () => { const n = prompt("새 이름", p.name); if (n) { PanelStore.renameProject(p.id, n); afterProjectChange(); } });
      mk("내보내기", () => download(p.name + ".panellab.json", JSON.stringify(p, null, 2), "application/json"));
      mk("삭제", () => {
        if (!confirm("‘" + p.name + "’ 프로젝트를 휴지통으로 이동(30일 보관)할까요?\n\n30일 안에는 TECHCORE ‘내 작업’의 휴지통에서 복원할 수 있고, 30일이 지나면 자동으로 영구 삭제됩니다.")) return;
        const r = PanelStore.deleteProject(p.id);
        afterProjectChange();
        if (r.ok) toast("휴지통으로 이동했습니다. (30일 보관)");
        else alert("삭제하지 못했습니다. " + (DEL_REASON[r.reason] || "알 수 없는 오류입니다.") + " 프로젝트는 그대로 남아 있습니다.");
      }, "danger");
      box.appendChild(it);
    } catch (e) { console.error(e); box.appendChild(el("p", "notice-inline", "프로젝트 한 건을 표시하지 못했습니다(데이터 형식 문제).")); } });
  }
  function renderHistory() {
    const box = $("#historyList"); box.innerHTML = "";
    const p = project();
    if (!p || !p.messages.length) { box.innerHTML = '<p class="empty">기록이 없습니다.</p>'; return; }
    p.messages.slice().reverse().forEach((m) => {
      box.appendChild(el("div", "item", '<span class="muted">' + fmt(m.ts) + "</span><strong>" + (m.role === "user" ? "나" : "AI") + '</strong><span class="grow">' + esc(m.text.slice(0, 140)) + "</span>"));
    });
  }
  function renderSettings() {
    const s = PanelChat.getStatus();
    $("#settingsStatus").textContent = { online: "연결됨", connecting: "연결 중…", offline: "연결 안 됨", idle: "대기" }[s] || s;
  }

  // ---------- chat ----------
  function nearBottom() { const m = $("#messages"); return m.scrollHeight - m.scrollTop - m.clientHeight < 80; }
  function scrollBottom() { const m = $("#messages"); m.scrollTop = m.scrollHeight; $("#btnJump").hidden = true; unseen = false; }
  function ladderBlock(text, full) {
    let svg = null, blk = null;
    for (const b of codeBlocks(text)) { svg = PanelLadder.render(b.code); if (svg) { blk = b; break; } }
    if (!svg) return null;
    const box = el("div");
    const bar = el("div", "row gap lad-bar");
    const wrap = el("div", "ladder", svg);
    let scale = 1;
    const sv = () => wrap.querySelector("svg");
    const apply = () => { const s = sv(); const w = parseFloat(s.dataset.w), h = parseFloat(s.getAttribute("viewBox").split(" ")[3]); s.setAttribute("width", w * scale); s.setAttribute("height", h * scale); zl.textContent = Math.round(scale * 100) + "%"; };
    const mk = (t, fn) => { const b = el("button", "btn sm", t); b.type = "button"; b.onclick = fn; bar.appendChild(b); return b; };
    mk("−", () => { scale = Math.max(0.3, scale - 0.2); apply(); });
    const zl = el("span", "muted", "100%"); bar.appendChild(zl);
    mk("+", () => { scale = Math.min(3, scale + 0.2); apply(); });
    mk("맞춤", () => { const w = parseFloat(sv().dataset.w); scale = Math.max(0.3, Math.min(1, (wrap.clientWidth - 4) / w)); apply(); });
    mk("100%", () => { scale = 1; apply(); });
    mk("SVG 저장", () => download("ladder.svg", svg, "image/svg+xml"));
    mk("PNG 저장", () => svgToPng(svg));
    mk("SVG 복사", () => (navigator.clipboard ? navigator.clipboard.writeText(svg) : Promise.reject()).then(() => toast("SVG를 복사했습니다."), () => toast("복사하지 못했습니다.")));
    box.appendChild(bar); box.appendChild(wrap);
    wrap.addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); scale = Math.min(3, Math.max(0.3, scale + (e.deltaY < 0 ? 0.1 : -0.1))); apply(); }, { passive: false });
    let drag = null, moved = false;
    wrap.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop }; moved = false; });
    wrap.addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; if (moved) { wrap.scrollLeft = drag.l - dx; wrap.scrollTop = drag.t - dy; wrap.classList.add("panning"); } });
    const end = () => { drag = null; wrap.classList.remove("panning"); };
    wrap.addEventListener("pointerup", end); wrap.addEventListener("pointerleave", end);

    const nets = PanelLadder.nets(blk.code) || [];
    let cvEl = null;
    const select = (i, jump) => {
      wrap.querySelectorAll(".net.sel").forEach((g) => g.classList.remove("sel"));
      const g = wrap.querySelector('.net[data-net="' + i + '"]'); if (g) g.classList.add("sel");
      box.querySelectorAll(".net-item").forEach((n) => n.classList.toggle("sel", n.dataset.net === String(i)));
      const n = nets[i];
      if (n && cvEl) PanelCode.goto(cvEl, n.start, n.end);
      if (jump && g) { const r = g.getBoundingClientRect(), w = wrap.getBoundingClientRect(); wrap.scrollTop += r.top - w.top - 8; }
    };
    wrap.addEventListener("click", (e) => { if (moved) return; const g = e.target.closest(".net"); if (g) select(parseInt(g.dataset.net, 10)); });
    if (full && nets.length) {
      box.appendChild(el("h4", null, "네트워크별 설명 (코드 구조에서 기계적으로 생성 · AI 설명 아님)"));
      const list = el("div", "net-list");
      nets.forEach((n) => {
        const it = el("button", "net-item", "<b>네트워크 " + n.i + "</b> <span class='muted'>(코드 " + n.start + (n.end > n.start ? "–" + n.end : "") + "줄)</span><div>" + esc(n.desc) + "</div>");
        it.type = "button"; it.dataset.net = n.i; it.onclick = () => select(n.i, true);
        list.appendChild(it);
      });
      box.appendChild(list);
      box.appendChild(el("h4", null, "원본 코드 (네트워크를 누르면 해당 줄이 강조됩니다)"));
      const cw = el("div", null, PanelCode.html(blk.code, "래더 코드"));
      box.appendChild(cw); cvEl = cw.querySelector(".cv");
    }
    return box;
  }
  function svgToPng(svg) {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = document.createElement("canvas"), k = 2;
      c.width = img.width * k; c.height = img.height * k;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.scale(k, k); g.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => { const a = el("a"); a.href = URL.createObjectURL(b); a.download = "ladder.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
    };
    img.onerror = () => toast("PNG로 변환하지 못했습니다. SVG로 저장해 주세요.");
    img.src = url;
  }
  function msgNode(m) {
    const w = el("div", "msg " + (m.role === "user" ? "user" : "bot"));
    const mm = m.mode !== "chat" && Object.prototype.hasOwnProperty.call(MODES, m.mode) ? " · " + MODES[m.mode].label : "";
    w.appendChild(el("div", "meta", (m.role === "user" ? "나" : "PanelLab AI") + mm + " · " + fmt(m.ts)));
    const b = el("div", "bubble", md(m.text || ""));
    if (m.role === "bot" && m.mode === "ladder") { const d = ladderBlock(m.text); if (d) b.insertBefore(d, b.firstChild); }
    if (m.files && m.files.length) b.appendChild(el("div", "muted", "첨부: " + m.files.map(esc).join(", ")));
    if (m._thumbs) m._thumbs.forEach((d) => { const i = el("img", "thumb"); i.src = d; i.alt = "첨부 이미지"; b.appendChild(i); });
    if (m.failed) b.appendChild(el("div", "fail", esc(m.failed)));
    w.appendChild(b);
    return w;
  }
  function renderMessages() {
    const box = $("#messages"); box.innerHTML = ""; typingEl = null;
    const p = project();
    if (!p || !p.messages.length) {
      box.appendChild(el("div", "welcome", "<strong>PanelLab AI 작업실</strong><p>작업 유형을 고르고 요청을 입력하세요. 예) “M0 누르면 Y0가 켜지고 5초 후 꺼지는 코드를 작성해 줘.”</p><p>응답은 연결된 Copilot Studio 에이전트에서 실제로 받아옵니다.</p>"));
    } else p.messages.forEach((m) => { try { box.appendChild(msgNode(m)); } catch (e) { console.error(e); box.appendChild(el("div", "notice-inline", "메시지 한 건을 표시하지 못했습니다(데이터 형식 문제).")); } });
    if (waitingReply) showTyping(true);
    scrollBottom();
  }
  function showTyping(on) {
    if (on && !typingEl) { typingEl = el("div", "typing", "AI가 응답하는 중…"); $("#messages").appendChild(typingEl); if (nearBottom()) scrollBottom(); }
    if (!on && typingEl) { typingEl.remove(); typingEl = null; }
  }
  function appendMessage(m) {
    const box = $("#messages"), stick = nearBottom();
    const w = box.querySelector(".welcome"); if (w) w.remove();
    const node = msgNode(m);
    if (typingEl) box.insertBefore(node, typingEl); else box.appendChild(node);
    if (stick || m.role === "user") scrollBottom(); else { unseen = true; $("#btnJump").hidden = false; }
    return node;
  }

  function extractInputCode(text, fileTexts) {
    const b = codeBlocks(text);
    if (b.length) return b.map((x) => x.code).join("\n");
    if (fileTexts.length) return fileTexts.join("\n");
    const p = project();
    for (let i = p.results.length - 1; i >= 0; i--) { const c = codeBlocks(p.results[i].text); if (c.length) return c[0].code; }
    return "";
  }

  function readFile(f, kind) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onerror = () => rej(new Error(f.name + " 파일을 읽지 못했습니다.")); r.onload = () => res(r.result); kind === "text" ? r.readAsText(f) : r.readAsDataURL(f); });
  }

  function compressImage(f) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(f), img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(f.name + " 이미지를 열지 못했습니다.")); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        let scale = Math.min(1, 1800 / Math.max(img.width, img.height));
        for (let attempt = 0; attempt < 8; attempt++) {
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          for (const q of [0.85, 0.7, 0.55]) {
            const d = c.toDataURL("image/jpeg", q);
            if (d.length * 0.75 <= INLINE_LIMIT) return res(d);
          }
          scale *= 0.75;
        }
        rej(new Error(f.name + " 이미지를 전송 가능한 크기로 줄이지 못했습니다."));
      };
      img.src = url;
    });
  }

  // Visible short request header (P3-C). Embedded: built by TechBridge.contextHeader so all workrooms share one format; standalone: same format locally.
  function ctxHeader(p, room) {
    const o = { room, project: p.name, software: "Mitsubishi " + p.software, mode: uiMode };
    try { const B = window.parent !== window && window.parent.TechBridge; if (B && B.contextHeader) return B.contextHeader(o); } catch {}
    return "[작업 맥락 - 작업실: " + room + " / 프로젝트: " + p.name + " / 소프트웨어: " + o.software + " / 모드: " + (uiMode === "expert" ? "전문가" : "초보자") + "]";
  }

  async function submit() {
    const input = $("#input"); const raw = input.value.trim();
    if (!raw && !files.length) return;
    if (waitingReply) { toast("이전 응답을 기다리는 중입니다."); return; }
    if (PanelPending.busy()) { toast("다른 AI 요청(" + PanelPending.label() + ")의 응답을 기다리는 중입니다."); return; }
    if (PanelChat.getStatus() !== "online") { notice("AI에 연결되어 있지 않습니다. ‘재연결’을 눌러 주세요.", true); return; }
    const p = ensureProject();
    if (!p) return;
    notice("");
    const fileTexts = [], dlAttachments = [], names = [], thumbs = [];
    let body = raw;
    try {
      for (const f of files) {
        names.push(f.name);
        if (TEXT_EXT.test(f.name) || f.type.startsWith("text/")) {
          if (f.size > TEXT_LIMIT) throw new Error(f.name + " 파일이 너무 큽니다. 텍스트 파일은 " + Math.round(TEXT_LIMIT / 1024) + "KB 이하만 보낼 수 있습니다. 필요한 부분만 잘라서 올려 주세요.");
          const t = await readFile(f, "text"); fileTexts.push(t);
          body += "\n\n[첨부 파일: " + f.name + "]\n```\n" + t + "\n```";
        } else if (f.type.startsWith("image/")) {
          const d = await compressImage(f);
          thumbs.push(d);
          dlAttachments.push({ contentType: "image/jpeg", contentUrl: d, name: f.name.replace(/\.\w+$/, "") + ".jpg" });
        } else {
          if (f.size > INLINE_LIMIT) throw new Error(f.name + " 파일이 너무 큽니다. (이미지·PDF는 " + Math.round(INLINE_LIMIT / 1024) + "KB 이하)");
          dlAttachments.push({ contentType: f.type || "application/octet-stream", contentUrl: await readFile(f, "data"), name: f.name });
        }
      }
    } catch (e) { notice(e.message, true); return; }

    const hint = modeOf(mode).hint + (mode === "check" ? " (결과는 | 심각도 | 위치 | 문제 | 수정 방법 | 형식의 표로 정리하고 심각도는 오류/경고/정보로 표기해 주세요.)" : "") + (mode === "label" ? " (글로벌 라벨과 I/O 표는 | 디바이스 | 라벨명 | 데이터형 | 설명 | 형식의 표로 제공해 주세요.)" : "") + (mode === "drawing" ? " (도면 분석 결과는 | 구분 | 항목 | 내용 | 형식의 표로 정리하고, 읽기 어려운 부분은 추측하지 말고 확인이 필요하다고 표시해 주세요.)" : "") + (mode === "ladder" ? " (래더는 파일 대신 Mitsubishi 명령어 리스트(LD, AND, OR, ANB, ORB, OUT 등)를 코드 블록 하나로 제공해 주세요. 화면에서 도식으로 그립니다.)" : "");
    const prefix = ctxHeader(p, "PanelLab · " + modeOf(mode).label) + "\n[PanelLab" + (hint ? " 작업: " + hint : "") + " / Mitsubishi " + p.software + "]\n";
    const um = { role: "user", text: raw || "(첨부 파일)", ts: Date.now(), mode, files: names };
    Object.defineProperty(um, "_thumbs", { value: thumbs, enumerable: false });
    p.messages.push(um); persist(); appendMessage(um);
    pendingMode = mode;
    pendingBefore = extractInputCode(body, fileTexts);
    pendingMeta = null;
    input.value = ""; autosize(); files = []; renderChips();
    pendingKind = mode === "chat" ? "chat" : "panellab";
    pendingId = PanelPending.begin(pendingKind);
    if (!pendingId) { um.failed = "다른 AI 요청의 응답을 기다리는 중이라 보내지 못했습니다. 다시 시도해 주세요."; persist(); renderMessages(); return; }
    waitingReply = true; updateSend(); showTyping(true);
    try { PanelPending.bind(pendingId, await PanelChat.send(prefix + body, dlAttachments, { kind: pendingKind })); }
    catch (e) {
      PanelPending.drop(pendingId);
      waitingReply = false; showTyping(false); updateSend();
      um.failed = e.message + " 다시 시도해 주세요."; persist(); renderMessages();
    }
  }

  // Only replies to this workroom's own request (chat / panellab / fix kinds in PanelPending) are saved here.
  // Replies owned by the HMI AI panels, stray messages, or late ones after another request began are never stored as chat results.
  let pendingKind = "chat", pendingId = "";
  function onBot(a) {
    if (!PanelPending.accept(pendingKind, a)) return;
    PanelPending.end(pendingId);
    waitingReply = false; updateSend(); notice("");
    const p = ensureProject();
    if (!p) return;
    let text = a.text || "";
    if (!text && a.attachments.length) text = "(첨부 응답: " + a.attachments.map((x) => x.name || x.contentType).join(", ") + ")";
    if (!text) return;
    const m = { role: "bot", text, ts: a.ts, mode: pendingMode };
    p.messages.push(m);
    const res = { id: PanelStore.uid(), mode: pendingMode, ts: a.ts, text, before: pendingBefore };
    if (pendingMeta) Object.assign(res, pendingMeta);
    p.results.push(res);
    if (!persist()) notice("프로젝트를 저장하지 못했습니다. 브라우저 저장 공간을 확인하고 백업을 내보내 주세요.", true);
    appendMessage(m); renderTabs();
  }

  // User-triggered fix request: sends the original code and the check results to the existing agent as a normal message.
  const ordIssues = (list) => LVL.reduce((a, [l]) => a.concat(list.filter((x) => x.lvl === l)), []);
  async function startFix(r, ai, st, extra) {
    if (waitingReply) { toast("이전 요청의 응답을 기다리는 중입니다."); return; }
    if (PanelPending.busy()) { toast("다른 AI 요청(" + PanelPending.label() + ")의 응답을 기다리는 중입니다."); return; }
    if (PanelChat.getStatus() !== "online") { notice("AI에 연결되어 있지 않습니다. ‘재연결’을 눌러 주세요.", true); return; }
    const p = ensureProject();
    if (!p) return;
    const items = [];
    ordIssues(ai).forEach((x, i) => items.push(Object.assign({ ref: "AI #" + (i + 1) }, x)));
    ordIssues(st).forEach((x, i) => items.push(Object.assign({ ref: "사이트 #" + (i + 1) }, x)));
    if (!items.length) { toast("수정할 오류가 없습니다."); return; }
    const lvlName = (l) => LVL.find((x) => x[0] === l)[1];
    const list = items.map((x) => "- " + x.ref + " [" + lvlName(x.lvl) + "] 유형: " + (x.type || "확인 필요") + " / 위치: " + (x.line ? "줄 " + x.line : x.loc || "확인 필요") +
      " / 문제 코드: " + (x.code || "확인 필요") + " / 원인: " + (x.desc || "확인 필요") + " / 기존 수정 제안: " + (x.fix || "확인 필요")).join("\n");
    const req = ctxHeader(p, "PanelLab · 자동 오류 수정") + "\n[PanelLab 작업: " + MODES.fix.hint + " / Mitsubishi " + p.software + " / CPU: " + (p.cpu || "확인 필요") + "]\n" +
      "아래 원본 코드와 오류 검사 결과를 바탕으로 코드를 수정해 주세요.\n\n## 오류 검사 결과\n" + list + "\n\n## 원본 코드\n```\n" + r.before + "\n```\n\n" +
      (extra ? "## 추가 요구사항\n" + extra + "\n\n" : "") +
      "수정된 **전체 코드**를 코드 블록 하나로 제공하고(일부만 제공하지 말 것), 변경 이유를 오류 번호별로 설명해 주세요. 확인되지 않은 정보는 추정하지 말고 확인 필요로 표시해 주세요.";
    const um = { role: "user", text: "[자동 수정 요청] 오류 " + items.length + "건 · 원본 " + r.before.split("\n").length + "줄" + (extra ? "\n추가 요구사항: " + extra : ""), ts: Date.now(), mode: "fix" };
    p.messages.push(um); persist();
    mode = "fix"; $("#modeSelect").value = "fix";
    showView("workspace", "fix"); $("#btnResBack").click();
    pendingMode = "fix"; pendingBefore = r.before;
    pendingMeta = { fixOf: r.id, issuesSent: items.map((x) => ({ ref: x.ref, type: x.type || "", line: x.line || 0, source: x.source, sig: x.type + "|" + (x.code || "") })) };
    pendingKind = "fix"; pendingId = PanelPending.begin("fix");
    if (!pendingId) { toast("다른 AI 요청의 응답을 기다리는 중입니다."); return; }
    waitingReply = true; updateSend(); showTyping(true);
    try { PanelPending.bind(pendingId, await PanelChat.send(req, [], { kind: "fix" })); }
    catch (e) {
      PanelPending.drop(pendingId);
      waitingReply = false; showTyping(false); updateSend();
      um.failed = e.message + " 원본 코드는 변경되지 않았습니다. 다시 시도해 주세요."; persist(); renderMessages();
    }
  }

  // ---------- results panel ----------
  const hasCode = (r) => codeBlocks(r.text).length > 0;
  // Classification uses the real response content; results without structure stay in the "all" tab with the raw text.
  const kindCache = new WeakMap();
  function kindsOf(r) {
    if (kindCache.has(r)) return kindCache.get(r);
    const k = new Set();
    if (r.mode !== "chat") k.add(r.mode);
    if ((r.mode === "chat" || r.mode === "code") && hasCode(r)) k.add("code");
    if (r.mode === "chat" || r.mode === "check") {
      if (parseIssues(r.text).length) k.add("check");
    }
    mdTables(r.text).forEach((rows) => {
      const h = (rows[0] || []).join(" ");
      if (/디바이스/.test(h) && /라벨/.test(h)) k.add("label");
      if (r.mode === "chat" && /구분/.test(h) && /항목/.test(h)) k.add("drawing");
    });
    kindCache.set(r, k);
    return k;
  }
  const inTab = (r, k) => k === "all" || kindsOf(r).has(k);
  const TAB_EMPTY = {
    all: "아직 AI 결과가 없습니다. AI에 요청하면 응답이 이곳에 정리됩니다.",
    code: "PLC 코드 결과가 없습니다. ‘PLC 코드 작성’ 작업으로 요청하세요.",
    check: "오류 검사 결과가 없습니다. 코드를 붙여넣고 ‘오류 검사’로 요청하세요.",
    fix: "자동 수정 결과가 없습니다. ‘자동 오류 수정’으로 코드를 보내세요.",
    ladder: "래더 작화 결과가 없습니다. ‘래더 작화’로 요청하세요.",
    drawing: "도면 분석 결과가 없습니다. 도면 이미지를 첨부해 ‘도면 분석’으로 요청하세요.",
    label: "글로벌 라벨 결과가 없습니다. ‘글로벌 라벨’로 요청하세요.",
  };
  function renderTabs() {
    const t = $("#tabs"); t.innerHTML = "";
    const p = project();
    TABS.forEach(([k, l]) => {
      const n = p && k === "versions" ? (p.codeVersions || []).length : p && k !== "info" ? p.results.filter((r) => inTab(r, k)).length : 0;
      const b = el("button", k === tab ? "active" : "", esc(l) + (n ? ' <span class="count">' + n + "</span>" : ""));
      b.type = "button"; b.onclick = () => { tab = k; renderTabs(); }; t.appendChild(b);
    });
    renderTabBody();
  }
  function lineDiff(a, b) {
    const x = a.split("\n"), y = b.split("\n");
    if (x.length * y.length > 400000) return null;
    const dp = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { out.push([" ", x[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["-", x[i++]]); else out.push(["+", y[j++]]);
    }
    while (i < x.length) out.push(["-", x[i++]]); while (j < y.length) out.push(["+", y[j++]]);
    return out;
  }
  const LVL = [["crit", "치명적", "err"], ["high", "높음", "err"], ["mid", "보통", "warn"], ["low", "낮음", "info"], ["chk", "확인 필요", "info"]];
  const lvlOf = (s) => /치명|critical/i.test(s) ? "crit" : /오류|error|심각|높음|high/i.test(s) ? "high" : /경고|warn|중간|보통|medium/i.test(s) ? "mid" : /확인|불명|미확인|unknown/i.test(s) ? "chk" : "low";
  const sevOfLvl = (l) => LVL.find((x) => x[0] === l)[2];
  function parseIssues(text) {
    const lines = String(text).split("\n"), out = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(lines[i]);
      const si = head.findIndex((h) => /심각도|수준|등급|severity/i.test(h));
      if (si < 0) continue;
      const col = (re) => head.findIndex((h, k) => k !== si && re.test(h));
      const ci = { loc: col(/위치|라인|줄|line/i), type: col(/유형|종류|type/i), code: col(/코드|code/i), desc: col(/문제|설명|내용|description/i), fix: col(/수정|제안|방법|fix/i) };
      const used = new Set(Object.values(ci).filter((k) => k >= 0).concat(si));
      let j = i + 2;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        const c = cells(lines[j]);
        c[si] = c[si] || "";
        const lvl = lvlOf(c[si]), g = (k) => (k >= 0 ? c[k] || "" : "");
        const lm = /\d+/.exec(g(ci.loc));
        out.push({
          source: "ai", lvl, sev: sevOfLvl(lvl), level: c[si], type: g(ci.type), loc: g(ci.loc), line: lm ? parseInt(lm[0], 10) : 0,
          code: g(ci.code), desc: g(ci.desc), fix: g(ci.fix),
          extra: head.map((h, k) => [h, c[k] || ""]).filter((_, k) => !used.has(k) && c[k]),
        });
        j++;
      }
      i = j;
    }
    return out;
  }
  function issuesHtml(issues, label) {
    const n = (l) => issues.filter((x) => x.lvl === l).length;
    let h = '<div class="sum">' + LVL.map(([l, t, s]) => '<span class="sev ' + l + '">' + t + " " + n(l) + "</span>").join("") + "</div>";
    let no = 0;
    LVL.forEach(([l, t]) => {
      const group = issues.filter((x) => x.lvl === l);
      if (!group.length) return;
      h += '<h4 class="grp">' + t + " (" + group.length + ")</h4>";
      group.forEach((x) => {
        no++;
        const src = x.source === "static" ? "사이트 정적 확인" : "AI 보고";
        const status = x.source === "static" ? "사이트에서 확인됨" : "AI 응답 기준 · 컴파일 미확인";
        const loc = x.line ? '<button type="button" class="loc" data-goto="' + x.line + '">줄 ' + x.line + " 이동</button>" : (x.loc ? esc(x.loc) : "위치 정보 없음");
        h += '<div class="issue ' + x.lvl + '"><div class="ih"><b>#' + no + "</b>" + (x.type ? '<span class="tag">' + esc(x.type) + "</span>" : "") +
          '<span class="sev ' + x.lvl + '">' + esc(t) + '</span><span class="tag src ' + x.source + '">' + src + '</span><span class="muted">' + status + "</span></div>" +
          "<div><b>위치:</b> " + loc + "</div>" +
          (x.code ? '<div><b>문제 코드:</b> <code class="inline">' + esc(x.code) + "</code></div>" : "") +
          (x.desc ? "<div><b>설명:</b> " + inline(x.desc) + "</div>" : "") +
          (x.fix ? "<div><b>수정 제안:</b> " + inline(x.fix) + "</div>" : "") +
          (x.extra || []).map(([k, v]) => "<div><b>" + esc(k) + ":</b> " + inline(v) + "</div>").join("") + "</div>";
      });
    });
    return h;
  }
  function mdTables(text) {
    const lines = String(text).split("\n"), out = [];
    const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    for (let i = 0; i + 1 < lines.length; i++) {
      if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
      const rows = [cells(lines[i])]; let j = i + 2;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) rows.push(cells(lines[j++]));
      out.push(rows); i = j;
    }
    return out;
  }
  function toCsv(rows) {
    return "\ufeff" + rows.map((r) => r.map((c) => '"' + c.replace(/"/g, '""') + '"').join(",")).join("\r\n");
  }
  const VKIND = { original: "원본", ai: "AI 생성", "ai-fix": "AI 수정(승인)", user: "사용자 수정", restore: "복원본" };
  function addVersion(p, kind, code, label, note) {
    p.codeVersions = p.codeVersions || [];
    const n = p.codeVersions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
    p.codeVersions.push({ id: PanelStore.uid(), n, ts: Date.now(), kind, label: label || "", note: note || "", code });
    return persist();
  }
  function compareNode(a, b) {
    const wrap = el("div");
    const d = lineDiff(a, b);
    const pair = el("div", "ba");
    pair.appendChild(el("div", null, "<h4>이전(A)</h4>" + PanelCode.html(a, "A")));
    pair.appendChild(el("div", null, "<h4>이후(B)</h4>" + PanelCode.html(b, "B")));
    wrap.appendChild(pair);
    if (!d) { wrap.appendChild(el("p", "muted", "코드가 너무 길어 줄 단위 비교를 생략했습니다.")); return wrap; }
    const cvs = pair.querySelectorAll(".cv");
    if (cvs.length === 2) {
      const bR = cvs[0].querySelectorAll(".ln"), aR = cvs[1].querySelectorAll(".ln");
      let bi = 0, ai = 0;
      d.forEach(([k]) => {
        if (k === "-") { if (bR[bi]) bR[bi].classList.add("chg-del"); bi++; }
        else if (k === "+") { if (aR[ai]) aR[ai].classList.add("chg-add"); ai++; }
        else { bi++; ai++; }
      });
    }
    const add = d.filter((x) => x[0] === "+").length, del = d.filter((x) => x[0] === "-").length;
    wrap.appendChild(el("h4", null, add || del ? "변경점 (추가 " + add + "줄 / 삭제 " + del + "줄)" : "두 버전의 코드가 동일합니다."));
    if (add || del) { const box = el("div", "diff"); d.forEach(([k, l]) => box.appendChild(el("div", k === "+" ? "add" : k === "-" ? "del" : "", esc(k + " " + l)))); wrap.appendChild(box); }
    return wrap;
  }
  function renderVersions(body, p) {
    if (!p) { body.innerHTML = '<p class="empty">프로젝트가 없습니다.</p>'; return; }
    const vs = p.codeVersions || [];
    const redraw = () => renderTabBody();
    const meta = el("div", "res-item", "<h4>프로젝트 설정</h4>");
    const row = el("div", "row gap");
    const cpu = el("input"); cpu.type = "text"; cpu.placeholder = "CPU 모델 (예: FX5U, Q03UDE)"; cpu.value = p.cpu || ""; cpu.className = "grow";
    const sc = el("button", "btn sm", "CPU 저장"); sc.type = "button";
    sc.onclick = () => { p.cpu = cpu.value.trim(); if (persist()) toast("CPU 모델을 저장했습니다."); };
    row.appendChild(cpu); row.appendChild(sc); meta.appendChild(row);
    meta.appendChild(el("p", "muted", "PLC: Mitsubishi " + esc(p.software) + " · 입력한 CPU 모델로 명령어 지원 여부를 판정하지는 않습니다."));
    body.appendChild(meta);

    const add = el("div", "res-item", "<h4>새 코드 버전 저장</h4>");
    const kind = el("select"); [["original", "원본(사용자 제공)"], ["user", "사용자 수정"]].forEach(([v, t]) => kind.appendChild(new Option(t, v)));
    const label = el("input"); label.type = "text"; label.placeholder = "버전 메모 (선택)";
    const ta = el("textarea"); ta.rows = 5; ta.placeholder = "저장할 PLC 코드를 붙여넣으세요."; ta.className = "vtext";
    const sb = el("button", "btn sm primary", "버전 저장"); sb.type = "button";
    sb.onclick = () => {
      if (!ta.value.trim()) { toast("저장할 코드를 입력하세요."); return; }
      if (addVersion(p, kind.value, ta.value.replace(/\r/g, ""), label.value.trim())) { toast("새 버전으로 저장했습니다. 기존 버전은 변경되지 않습니다."); redraw(); }
    };
    const r1 = el("div", "row gap"); r1.appendChild(kind); r1.appendChild(label); label.className = "grow";
    add.appendChild(r1); add.appendChild(ta); add.appendChild(sb);
    const aiCodes = [];
    p.results.slice().reverse().forEach((r) => { const c = r.mode !== "check" && r.mode !== "label" && r.mode !== "drawing" ? codeBlocks(r.text)[0] : null; if (c && aiCodes.length < 5) aiCodes.push({ r, c }); });
    if (aiCodes.length) {
      add.appendChild(el("h4", null, "최근 AI 응답 코드를 버전으로 저장"));
      aiCodes.forEach(({ r, c }) => {
        const b = el("button", "btn sm", fmt(r.ts) + " · " + modeOf(r.mode).label + " · " + c.code.split("\n").length + "줄 → AI 생성 버전으로 저장"); b.type = "button";
        b.onclick = () => { if (addVersion(p, "ai", c.code, modeOf(r.mode).label + " 응답", "결과 " + r.id)) { toast("AI 생성 버전으로 저장했습니다."); redraw(); } };
        add.appendChild(b);
      });
    }
    body.appendChild(add);

    const list = el("div", "res-item", "<h4>코드 버전 이력 (" + vs.length + ")</h4>");
    if (!vs.length) list.appendChild(el("p", "empty", "저장된 코드 버전이 없습니다. 위에서 저장하거나 자동 수정 결과를 승인하면 생성됩니다."));
    vs.slice().reverse().forEach((v) => {
      const it = el("div", "ver", '<div class="ih"><b>v' + v.n + '</b><span class="tag">' + esc(VKIND[v.kind] || v.kind) + '</span><span class="muted">' + fmt(v.ts) + " · " + v.code.split("\n").length + "줄</span></div>" + (v.label || v.note ? '<div class="muted">' + esc([v.label, v.note].filter(Boolean).join(" · ")) + "</div>" : ""));
      const bar = el("div", "row gap");
      const mk = (t, fn) => { const b = el("button", "btn sm", t); b.type = "button"; b.onclick = fn; bar.appendChild(b); };
      let view = null;
      mk("보기", () => { if (view) { view.remove(); view = null; } else { view = el("div", null, PanelCode.html(v.code, "v" + v.n)); it.appendChild(view); } });
      mk("복사", () => (navigator.clipboard ? navigator.clipboard.writeText(v.code) : Promise.reject()).then(() => toast("복사했습니다."), () => toast("복사하지 못했습니다.")));
      mk("복원", () => {
        if (!confirm("v" + v.n + " 코드를 복원 버전(새 버전)으로 저장할까요?\n기존 버전은 그대로 유지됩니다.")) return;
        if (addVersion(p, "restore", v.code, "v" + v.n + " 복원", "v" + v.n + "에서 복원")) { toast("복원본을 새 버전으로 저장했습니다."); redraw(); }
      });
      it.appendChild(bar); list.appendChild(it);
    });
    body.appendChild(list);

    if (vs.length >= 2) {
      const cmp = el("div", "res-item", "<h4>버전 비교</h4>");
      const mkSel = (def) => { const s = el("select"); vs.forEach((v) => s.appendChild(new Option("v" + v.n + " · " + (VKIND[v.kind] || v.kind), v.id))); s.value = def; return s; };
      const sa = mkSel(vs[vs.length - 2].id), sb2 = mkSel(vs[vs.length - 1].id);
      const out = el("div"); const go = el("button", "btn sm primary", "비교"); go.type = "button";
      go.onclick = () => { out.innerHTML = ""; out.appendChild(compareNode(vs.find((v) => v.id === sa.value).code, vs.find((v) => v.id === sb2.value).code)); };
      const rr = el("div", "row gap"); rr.appendChild(sa); rr.appendChild(el("span", null, "→")); rr.appendChild(sb2); rr.appendChild(go);
      cmp.appendChild(rr); cmp.appendChild(out); body.appendChild(cmp);
    }
  }
  function renderTabBody() {
    const body = $("#tabBody"); body.innerHTML = "";
    const p = project();
    if (tab === "versions") { renderVersions(body, p); return; }
    if (tab === "info") {
      if (!p) { body.innerHTML = '<p class="empty">프로젝트가 없습니다.</p>'; return; }
      body.innerHTML = "<p><strong>" + esc(p.name) + "</strong></p><p class='muted'>PLC: Mitsubishi " + esc(p.software) + (p.cpu ? " · CPU " + esc(p.cpu) : "") + "<br>생성 " + fmt(p.created) + "<br>수정 " + fmt(p.updated) + "<br>메시지 " + p.messages.length + "개 · 결과 " + p.results.length + "개 · 코드 버전 " + (p.codeVersions || []).length + "개" + (p.currentCode ? "<br>현재 코드: 승인된 AI 수정본 반영됨 (" + p.currentCode.split("\n").length + "줄)" : "") + "</p>";
      return;
    }
    const list = p ? p.results.filter((r) => inTab(r, tab)) : [];
    if (!list.length) { body.innerHTML = '<p class="empty">' + esc(TAB_EMPTY[tab] || "표시할 결과가 없습니다.") + "</p>"; return; }
    list.slice().reverse().forEach((r) => { try {
      if (tab === "fix" && r.mode === "fix" && !hasCode(r) && r.text.length < 400) {
        const d = el("details", "res-item muted", "<summary>AI 중간 메시지 (코드 없음) · " + fmt(r.ts) + "</summary>" + md(r.text));
        body.appendChild(d); return;
      }
      const card = el("div", "res-item", '<div class="res-h"><span class="tag">' + esc(modeOf(r.mode).label) + '</span><span class="muted">' + fmt(r.ts) + "</span></div>");
      let structured = false;
      const after = codeBlocks(r.text)[0];
      if (tab === "fix" && r.before && after) {
        structured = true;
        const pair = el("div", "ba");
        pair.appendChild(el("div", null, '<h4>수정 전</h4>' + PanelCode.html(r.before, "before")));
        pair.appendChild(el("div", null, '<h4>수정 후</h4>' + PanelCode.html(after.code, after.lang || "after")));
        card.appendChild(pair);
        const d = lineDiff(r.before, after.code);
        if (d) {
          const box = el("div", "diff");
          d.forEach(([k, l]) => box.appendChild(el("div", k === "+" ? "add" : k === "-" ? "del" : "", esc(k + " " + l))));
          const cvs = pair.querySelectorAll(".cv");
          if (cvs.length === 2) {
            const bRows = cvs[0].querySelectorAll(".ln"), aRows = cvs[1].querySelectorAll(".ln");
            let bi = 0, ai = 0;
            d.forEach(([k]) => {
              if (k === "-") { if (bRows[bi]) bRows[bi].classList.add("chg-del"); bi++; }
              else if (k === "+") { if (aRows[ai]) aRows[ai].classList.add("chg-add"); ai++; }
              else { bi++; ai++; }
            });
          }
          const nAdd = d.filter((x) => x[0] === "+").length, nDel = d.filter((x) => x[0] === "-").length;
          card.appendChild(el("h4", null, "변경점 (추가 " + nAdd + "줄 / 삭제 " + nDel + "줄)")); card.appendChild(box);
        }
        const reason = r.text.replace(/(```|~~~)[^\n`~]*\r?\n[\s\S]*?(?:\1|$)/g, "").trim();
        card.appendChild(el("h4", null, "변경 이유 (AI 설명)"));
        card.appendChild(el("div", null, reason ? md(reason) : '<p class="muted">AI 응답에 변경 이유 설명이 없습니다.</p>'));
        if (r.issuesSent && r.issuesSent.length) card.appendChild(el("details", "raw", "<summary>수정 요청에 포함된 오류 " + r.issuesSent.length + "건</summary><ul>" + r.issuesSent.map((x) => "<li><b>" + esc(x.ref) + "</b> " + esc(x.type || "유형 미확인") + (x.line ? " · 줄 " + x.line : "") + "</li>").join("") + "</ul>"));
        const bl = r.before.split("\n").length, al = after.code.split("\n").length;
        if (al < bl * 0.5 || (/\bEND\b/i.test(r.before) && !/\bEND\b/i.test(after.code))) card.appendChild(el("p", "notice-inline", "일부 코드만 반환된 것으로 보입니다(원본 " + bl + "줄 / 수정본 " + al + "줄" + (/\bEND\b/i.test(r.before) && !/\bEND\b/i.test(after.code) ? ", END 없음" : "") + "). 승인 전에 전체 코드인지 확인하세요. 원본은 그대로 보존됩니다."));
        {
          const sb = PanelAnalyzer.analyze(r.before), sa = PanelAnalyzer.analyze(after.code);
          const sig = (x) => x.type + "|" + (x.code || "").trim();
          const aSig = new Set(sa.findings.map(sig)), bSig = new Set(sb.findings.map(sig));
          const resolved = sb.findings.filter((x) => !aSig.has(sig(x))), remain = sa.findings.filter((x) => bSig.has(sig(x))), added = sa.findings.filter((x) => !bSig.has(sig(x)));
          card.appendChild(el("h4", null, "자동 재검사 (사이트 정적 검사 · GX Works 컴파일 아님)"));
          const rc = el("div", null, '<div class="sum"><span class="sev low">해결 ' + resolved.length + '</span><span class="sev high">남음 ' + remain.length + '</span><span class="sev crit">새로 발견 ' + added.length + "</span></div>" +
            (resolved.length ? "<p><b>해결된 항목</b></p><ul>" + resolved.map((x) => "<li>" + esc(x.type) + (x.line ? " (원본 줄 " + x.line + ")" : "") + "</li>").join("") + "</ul>" : "") +
            (remain.length ? "<p><b>남아 있는 오류</b></p>" + issuesHtml(remain) : "") +
            (added.length ? "<p><b>새로 발견된 오류</b></p>" + issuesHtml(added) : "") +
            '<p class="muted">정적으로 확인 가능한 항목만 비교한 결과이며, ‘해결’은 정상 동작이나 컴파일 성공을 의미하지 않습니다. 확인 불가 항목 ' + sa.notChecked.length + "개는 비교하지 못했습니다.</p>");
          card.appendChild(rc);
        }
        const bar = el("div", "fixbar");
        const mk = (t, fn, cls) => { const b = el("button", "btn sm" + (cls ? " " + cls : ""), t); b.type = "button"; b.onclick = fn; bar.appendChild(b); return b; };
        const status = el("p", "muted", "");
        const showStatus = () => {
          status.textContent = r.approved
            ? "승인됨 (" + fmt(r.approved) + ") — 수정본이 프로젝트 현재 코드로 반영되었고 원본은 코드 버전에 보존되었습니다. PLC 정상 작동은 확인되지 않았습니다."
            : r.kept ? "원본 코드 유지 선택됨 — 프로젝트 코드는 변경되지 않았습니다."
            : "미승인 — 승인 전까지 원본은 그대로 보존됩니다. 수정본의 정상 작동은 확인되지 않았습니다.";
          ap.disabled = !!r.approved; ap.textContent = r.approved ? "승인 완료" : "수정본 승인";
        };
        mk("수정본 복사", () => { (navigator.clipboard ? navigator.clipboard.writeText(after.code) : Promise.reject()).then(() => toast("수정본을 복사했습니다."), () => toast("복사하지 못했습니다.")); });
        const ap = mk("수정본 승인", () => {
          if (r.approved) return;
          if (!confirm("이 수정본을 프로젝트의 현재 코드로 반영할까요?\n(원본은 코드 버전으로 보존됩니다.)")) return;
          const pr = project(); if (!pr) return;
          pr.fixHistory = pr.fixHistory || [];
          r.approved = Date.now();
          pr.fixHistory.push({ id: PanelStore.uid(), resultId: r.id, ts: r.approved, status: "approved", before: r.before, after: after.code });
          if (!pr.codeVersions || !pr.codeVersions.some((v) => v.code === r.before)) addVersion(pr, "original", r.before, "수정 전 원본", "결과 " + r.id);
          pr.currentCode = after.code;
          addVersion(pr, "ai-fix", after.code, "AI 수정 승인", "결과 " + r.id);
          if (!persist()) { r.approved = 0; pr.fixHistory.pop(); delete pr.currentCode; notice("저장에 실패해 승인을 취소했습니다. 원본은 변경되지 않았습니다.", true); showStatus(); return; }
          showStatus(); toast("수정본을 현재 코드로 반영하고 원본 버전을 보존했습니다.");
        }, "primary");
        mk("재검사 요청", () => {
          showView("workspace", "check");
          $("#input").value = "아래 수정본 코드를 다시 검사해 주세요.\n```\n" + after.code + "\n```";
          autosize(); $("#btnResBack").click();
          toast("재검사 문장을 입력창에 넣었습니다. 전송을 눌러 요청하세요.");
        });
        mk("수정본 다시 수정", () => {
          showView("workspace", "fix");
          $("#input").value = "아래 수정본을 추가로 수정해 주세요. 수정 요구사항: \n```\n" + after.code + "\n```";
          autosize(); $("#btnResBack").click();
          toast("수정본을 입력창에 넣었습니다. 요구사항을 적고 전송하세요.");
        });
        mk("원본 코드 유지", () => {
          if (r.approved) { toast("이미 승인된 수정본입니다."); return; }
          r.kept = Date.now(); persist(); showStatus(); toast("원본 코드를 유지합니다.");
        });
        card.appendChild(bar); card.appendChild(status); showStatus();
        const hist = (p.fixHistory || []).filter((h) => h.resultId === r.id);
        if (hist.length) card.appendChild(el("p", "muted", "수정 이력: " + hist.map((h) => fmt(h.ts) + " 승인").join(", ")));
      }
      if (r.mode === "ladder" || tab === "ladder") {
        const d = ladderBlock(r.text, true);
        if (d) { structured = true; card.appendChild(el("h4", null, "래더 도식")); card.appendChild(d); }
        else card.appendChild(el("p", "muted", "응답에서 해석 가능한 명령어 리스트(LD/AND/OR/OUT…)를 찾지 못해 도식을 그리지 않았습니다."));
      }
      if (r.mode === "check" || (tab === "check" && kindsOf(r).has("check"))) {
        const iss = parseIssues(r.text);
        const stat = r.mode === "check" && r.before ? PanelAnalyzer.analyze(r.before) : null;
        if (stat) { card.appendChild(el("h4", null, "검사 대상 코드")); card.appendChild(el("div", null, PanelCode.html(r.before, "검사 대상"))); }
        if (iss.length) { structured = true; card.appendChild(el("h4", null, "AI 검사 결과 (AI 응답 기준, 컴파일 미확인)")); card.appendChild(el("div", null, issuesHtml(iss))); }
        if (stat) {
          card.appendChild(el("h4", null, "사이트 정적 검사 (AI와 별개)"));
          const sec = el("div", null, stat.findings.length ? issuesHtml(stat.findings) : '<p class="muted">정적으로 확인 가능한 항목(이중코일, 디바이스 표기, 접점 구성, 타이머·카운터 설정, END)에서 문제가 발견되지 않았습니다. 이는 컴파일 성공을 의미하지 않습니다.</p>');
          sec.appendChild(el("details", "raw", "<summary>확인 불가 항목 " + stat.notChecked.length + "개</summary><ul>" + stat.notChecked.map(([t, w]) => "<li><b>" + esc(t) + "</b> — " + esc(w) + "</li>").join("") + "</ul>"));
          card.appendChild(sec);
          structured = true;
        }
        if (r.mode === "check" && r.before) {
          const st = stat ? stat.findings : [];
          const total = iss.length + st.length;
          const box = el("div", "fixbar");
          const extra = el("input"); extra.type = "text"; extra.className = "grow"; extra.placeholder = "추가 요구사항 (선택)";
          const fb = el("button", "btn primary", "자동 수정"); fb.type = "button";
          fb.disabled = !total || waitingReply;
          fb.title = total ? "버튼을 눌러야 수정 요청이 전송됩니다." : "수정할 오류가 없습니다.";
          fb.onclick = () => {
            if (fb.disabled) return;
            fb.disabled = true; fb.textContent = "수정 요청 중…";
            startFix(r, iss, st, extra.value.trim());
          };
          box.appendChild(extra); box.appendChild(fb);
          card.appendChild(box);
          card.appendChild(el("p", "muted", total ? "오류 " + total + "건을 기존 AI에 전달합니다. 클릭 전에는 어떤 코드도 변경·전송되지 않습니다." : "자동 수정할 오류가 없습니다. (정적으로 확인되지 않은 항목은 수정 대상에 포함되지 않습니다.)"));
        }
      }
      if (r.mode === "label" || (tab === "label" && kindsOf(r).has("label"))) {
        mdTables(r.text).forEach((rows, i) => {
          const b = el("button", "btn sm", "표 " + (i + 1) + " CSV 저장"); b.type = "button";
          b.onclick = () => download("panellab-table" + (i + 1) + ".csv", toCsv(rows), "text/csv");
          card.appendChild(b);
        });
      }
      if (structured) {
        const det = el("details", "raw", "<summary>원본 AI 응답</summary>" + md(r.text));
        card.appendChild(det);
      } else {
        if (r.mode !== "chat" && tab !== "all" && !(tab === "code" && codeBlocks(r.text).length)) card.insertBefore(el("p", "notice-inline", "요청한 형식(표·코드)으로 해석되지 않아 원본 응답을 그대로 표시합니다."), card.children[1] || null);
        card.appendChild(el("div", null, md(r.text)));
      }
      body.appendChild(card);
    } catch (e) { console.error(e); body.appendChild(el("p", "notice-inline", "결과 한 건을 표시하지 못했습니다(데이터 형식 문제). 나머지는 정상 표시됩니다.")); } });
  }
  function exportMd() {
    const p = project();
    if (!p || !p.results.length) { toast("내보낼 결과가 없습니다."); return; }
    const txt = "# " + p.name + " (Mitsubishi " + p.software + ")\n\n" + p.results.map((r) => "## " + modeOf(r.mode).label + " — " + fmt(r.ts) + "\n\n" + r.text).join("\n\n---\n\n");
    download(p.name + ".md", txt, "text/markdown");
  }

  // ---------- composer ----------
  function autosize() { const i = $("#input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 180) + "px"; }
  function updateSend() { $("#btnSend").disabled = waitingReply || PanelChat.getStatus() !== "online"; updateSteps(); }
  function renderChips() {
    const c = $("#fileChips"); c.innerHTML = "";
    files.forEach((f, i) => { const chip = el("span", "chip", esc(f.name) + " "); const x = el("button", null, "✕"); x.type = "button"; x.onclick = () => { files.splice(i, 1); renderChips(); }; chip.appendChild(x); c.appendChild(chip); });
  }

  // ---------- connection UI ----------
  function onStatus(s, detail) {
    const label = { online: "AI 연결됨", connecting: "AI 연결 중…", offline: "AI 연결 안 됨", idle: "AI 연결 안 됨" }[s];
    ["#connDot", "#pillDot"].forEach((i) => { $(i).className = "dot " + s; });
    $("#connText").textContent = label; $("#pillText").textContent = label;
    $("#btnReconnect").hidden = s !== "offline";
    if (s === "offline") { waitingReply = false; showTyping(false); notice((detail || "연결되지 않았습니다.") + " ‘재연결’을 눌러 주세요.", true); }
    if (s === "online") notice("");
    updateSend(); if (view === "settings") renderSettings();
  }

  // ---------- beginner / expert UI (display only; every view stays reachable) ----------
  const UI_KEY = "panellab.ui.v1";
  const svg = (p) => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + p + "</svg>";
  const BTASKS = [
    { id: "new", title: "새 PLC 프로젝트 시작하기", desc: "프로젝트 이름을 정하고 PLC 코드를 만들기 시작합니다.", ex: "예) 컨베이어 시동·정지 제어", icon: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M12 12v4M10 14h4"/>' },
    { id: "ladder", title: "래더 만들기", desc: "래더는 PLC의 동작을 전기 회로처럼 표현한 그림입니다. 코드를 래더 그림으로 그려 줍니다.", ex: "예) 시작 버튼을 누르면 모터가 켜지게", icon: '<path d="M6 3v18M18 3v18M6 8h12M6 16h12"/>' },
    { id: "drawing", title: "전기 도면 분석하기", desc: "도면 파일을 첨부하면 AI가 내용을 읽고 설명합니다.", ex: "예) 전기 도면 이미지 올리기", icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>' },
    { id: "check", title: "PLC 오류 찾아보기", desc: "프로그램의 문제를 찾아봅니다. 고치는 일은 따로, 승인 후에만 진행됩니다.", ex: "예) 붙여넣은 코드의 문제 확인", icon: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>' },
    { id: "hmi", title: "HMI 화면 만들기", desc: "HMI는 설비 상태를 보고 조작하는 터치 화면입니다.", ex: "예) 모터 시작·정지 버튼 화면", icon: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 21h6M12 17v4"/>' },
  ];
  const STEPS = [
    ["작업 목적 입력", "무엇을 만들고 싶은지 입력창에 적어 주세요."],
    ["장치와 동작 순서 입력", "사용할 장치(버튼, 모터 등)와 동작 순서를 적어 주세요. 부족하면 AI가 질문합니다."],
    ["AI가 결과 후보 생성", "AI가 결과 후보를 만들 때까지 기다려 주세요."],
    ["결과 설명 및 확인", "결과와 설명을 읽고 맞는지 확인하세요. 모르는 부분은 다시 질문할 수 있습니다."],
    ["사용자 승인", "결과 패널에서 직접 승인하기 전에는 원본에 적용되지 않습니다."],
  ];
  const TERMS = [
    ["래더", "PLC의 동작을 전기 회로처럼 표현한 그림"],
    ["글로벌 라벨", "장치와 신호에 붙이는 이름"],
    ["HMI", "설비 상태를 보고 조작하는 터치 화면"],
    ["PLC 코드", "PLC가 실행할 명령"],
    ["오류 검사", "프로그램의 문제를 찾아보는 작업"],
  ];
  const SAFETY = "AI 결과는 참고용 후보입니다. 이 사이트의 검사는 GX Works 컴파일이나 실제 설비 검증이 아니며, 사용자 승인 전에는 원본에 적용되지 않습니다.";
  let uiMode = "beginner";
  try { const d = JSON.parse(localStorage.getItem(UI_KEY)); if (d && d.mode === "expert") uiMode = "expert"; } catch {}
  let stepSig = "";

  function applyUi() {
    document.body.classList.toggle("ui-beginner", uiMode === "beginner");
    document.body.classList.toggle("ui-expert", uiMode === "expert");
    $("#uiBeginner").setAttribute("aria-pressed", String(uiMode === "beginner"));
    $("#uiExpert").setAttribute("aria-pressed", String(uiMode === "expert"));
    stepSig = ""; updateSteps();
  }
  function setUi(m) {
    uiMode = m;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ mode: m })); } catch {}
    applyUi();
  }
  function startTask(id) {
    if (id === "new") {
      const before = PanelStore.all().length;
      newProject();
      if (PanelStore.all().length > before) showView("workspace", "code");
    } else if (id === "hmi") showView("hmi");
    else showView("workspace", id);
  }
  function renderBeginnerHome() {
    const box = $("#beginnerHome"); if (!box) return;
    const ps = PanelStore.all().slice(0, 3);
    box.innerHTML =
      "<h1>어떤 작업을 도와드릴까요?</h1>" +
      '<p class="muted lead">처음 사용해도 괜찮습니다. 하고 싶은 작업을 고르면 AI가 쉬운 말로 질문하며 안내합니다.</p>' +
      '<div class="btasks">' + BTASKS.map((t, i) =>
        '<button type="button" class="btask' + (i === 0 ? " main" : "") + '" data-bt="' + t.id + '">' + svg(t.icon) +
        "<strong>" + esc(t.title) + "</strong><span>" + esc(t.desc) + "</span><em>" + esc(t.ex) + "</em></button>").join("") + "</div>" +
      '<div class="safety">' + esc(SAFETY) + "</div>" +
      '<div class="grid2"><div class="card"><h3>진행 순서</h3><ol class="bsteps">' + STEPS.map((s) => "<li><strong>" + esc(s[0]) + "</strong><span>" + esc(s[1]) + "</span></li>").join("") + "</ol></div>" +
      '<div class="card"><h3>최근 프로젝트</h3>' + (ps.length
        ? ps.map((p) => '<button type="button" class="item link" data-open-project="' + esc(p.id) + '"><span class="grow"><strong>' + esc(p.name) + '</strong><small class="muted">' + esc(p.software) + "</small></span><span class=\"muted\">" + fmt(p.updated) + "</span></button>").join("")
        : '<p class="empty">아직 프로젝트가 없습니다. 위의 ‘새 PLC 프로젝트 시작하기’로 시작해 보세요.</p>') +
      '<h3 class="gap-top">용어 쉽게 보기</h3><dl class="terms">' + TERMS.map((t) => "<dt>" + esc(t[0]) + "</dt><dd>" + esc(t[1]) + "</dd>").join("") + "</dl></div></div>" +
      '<p class="muted">PLC 소프트웨어 기준은 GX Works2입니다. GX Works3은 지원 대상이 아니며 CPU 모델은 정해지지 않았습니다.</p>';
    box.querySelectorAll("[data-bt]").forEach((b) => { b.onclick = () => startTask(b.dataset.bt); });
  }
  function updateSteps() {
    const bar = $("#stepBar"); if (!bar || uiMode !== "beginner") return;
    const p = project(), last = p && p.messages.length ? p.messages[p.messages.length - 1] : null;
    let cur = 1;
    if (waitingReply || (last && last.role === "user")) cur = 3;
    else if (last) cur = 4;
    else if ($("#input").value.trim()) cur = 2;
    const sig = cur + "|" + (last ? last.role : "");
    if (sig === stepSig) return;
    stepSig = sig;
    bar.innerHTML = '<ol class="steps5">' + STEPS.map((s, i) => '<li class="' + (i + 1 < cur ? "done" : i + 1 === cur ? "cur" : "") + '"' + (i + 1 === cur ? ' aria-current="step"' : "") + "><b>" + (i + 1) + "</b><span>" + esc(s[0]) + "</span></li>").join("") + "</ol>" +
      '<p class="stepnow"><strong>지금 할 일:</strong> ' + esc(STEPS[cur - 1][1]) + (cur < 5 ? " <span class=\"muted\">다음: " + esc(STEPS[cur][0]) + "</span>" : "") + '</p><p class="safety sm">' + esc(SAFETY) + "</p>";
  }
  function syncTabbar(v) {
    document.querySelectorAll("#tabbar button[data-view]").forEach((b) => { b.classList.toggle("active", b.dataset.view === v); });
  }

  // ---------- init ----------
  function init() {
    applyUi();
    $("#uiBeginner").onclick = () => setUi("beginner");
    $("#uiExpert").onclick = () => setUi("expert");
    $("#btnMoreExpert").onclick = () => setUi("expert");
    $("#tabMore").onclick = () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); };
    document.querySelectorAll("#tabbar button[data-view]").forEach((b) => { b.onclick = () => showView(b.dataset.view, b.dataset.mode); });
    $("#input").addEventListener("input", updateSteps);
    new MutationObserver(updateSteps).observe($("#messages"), { childList: true });
    const ms = $("#modeSelect");
    Object.entries(MODES).forEach(([k, v]) => ms.appendChild(new Option(v.label, k)));
    ms.value = mode;
    ms.onchange = () => { mode = ms.value; document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === "workspace" && b.dataset.mode === mode)); };
    $("#softwareSelect").onchange = (e) => { const p = project(); if (p) { p.software = e.target.value; persist(); renderTabBody(); } };

    document.querySelectorAll("#nav button").forEach((b) => { b.onclick = () => showView(b.dataset.view, b.dataset.mode); });
    $("#btnNewWork").onclick = () => { mode = "chat"; showView("workspace", "chat"); $("#input").focus(); };
    $("#btnNewProject").onclick = $("#btnNewProject2").onclick = newProject;
    $("#projectSelect").onchange = (e) => { PanelStore.setCurrent(e.target.value); afterProjectChange(); };
    $("#btnMenu").onclick = () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); };
    $("#scrim").onclick = closeSidebar;
    $("#helpLink").onclick = (e) => { e.preventDefault(); alert("1) 작업 유형을 선택하고 요청을 입력합니다.\n2) 코드나 파일을 첨부할 수 있습니다.\n3) AI 응답은 오른쪽 결과 패널에 정리됩니다.\n4) 프로젝트는 이 브라우저에 저장되며 내보내기·불러오기를 지원합니다."); };

    const reconnect = () => { PanelChat.connect(); };
    $("#btnReconnect").onclick = $("#btnReconnect2").onclick = reconnect;
    $("#btnClearAll").onclick = () => {
      const n = PanelStore.all().length;
      if (!n) { toast("삭제할 프로젝트가 없습니다."); return; }
      // 1) backup first; if it cannot be built, nothing is deleted.
      try { download("panellab-backup-before-clear-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(PanelStore.exportAll(), null, 2), "application/json"); }
      catch (e) { alert("백업 파일을 만들지 못해 삭제하지 않았습니다. 프로젝트는 그대로입니다."); return; }
      // 2) warning with the project count, 3) typed confirmation
      const typed = prompt("【영구 삭제】 프로젝트 " + n + "개와 모든 기록이 영구 삭제됩니다. 휴지통으로 이동하지 않으며 복구할 수 없습니다.\n방금 내려받은 백업 파일이 저장됐는지 먼저 확인하세요.\n\n계속하려면 ‘모두 삭제’를 입력하세요.");
      if (typed !== "모두 삭제") { toast("취소했습니다. 삭제하지 않았습니다."); return; }
      if (PanelStore.clearAll()) { afterProjectChange(); toast("모두 영구 삭제했습니다."); }
      else alert("삭제하지 못했습니다. " + (DEL_REASON[PanelStore.lastSaveError()] || "") + " 데이터는 그대로입니다.");
    };
    $("#btnImport").onclick = () => $("#importInput").click();
    $("#importInput").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try { PanelStore.importProject(JSON.parse(await readFile(f, "text"))); afterProjectChange(); toast("프로젝트를 불러왔습니다."); }
      catch (err) { toast(err.message || "불러오기에 실패했습니다."); }
    };

    const res = $("#results"), rz = $("#resizer");
    $("#btnToggleResults").onclick = () => { if (view !== "workspace") showView("workspace"); res.classList.toggle("collapsed"); rz.classList.toggle("hide", res.classList.contains("collapsed")); };
    rz.onpointerdown = (e) => {
      rz.setPointerCapture(e.pointerId);
      const move = (ev) => { const w = Math.min(Math.max(window.innerWidth - ev.clientX, 260), window.innerWidth * 0.7); document.documentElement.style.setProperty("--results-w", w + "px"); };
      const up = () => { rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up); };
      rz.addEventListener("pointermove", move); rz.addEventListener("pointerup", up);
    };
    if (window.innerWidth <= 900) { res.classList.add("collapsed"); }
    $("#btnExportMd").onclick = exportMd;
    $("#btnBackup").onclick = () => download("panellab-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(PanelStore.exportAll(), null, 2), "application/json");
    $("#btnRestore").onclick = () => $("#restoreInput").click();
    $("#restoreInput").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try { const n = PanelStore.importAll(JSON.parse(await readFile(f, "text"))); afterProjectChange(); const sk = PanelStore.importAll.skipped || 0; toast(n + "개 프로젝트를 추가로 불러왔습니다." + (sk ? " (형식이 맞지 않아 " + sk + "개는 건너뜀)" : "")); }
      catch (err) { toast(err.message || "백업 파일을 불러오지 못했습니다."); }
    };

    $("#composer").onsubmit = (e) => { e.preventDefault(); submit(); };
    $("#input").addEventListener("input", autosize);
    $("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    $("#btnAttach").onclick = () => $("#fileInput").click();
    $("#fileInput").onchange = (e) => { files.push(...e.target.files); e.target.value = ""; renderChips(); };
    const comp = $("#composer");
    comp.addEventListener("paste", (e) => { const imgs = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith("image/")); if (imgs.length) { files.push(...imgs); renderChips(); } });
    comp.addEventListener("dragover", (e) => e.preventDefault());
    comp.addEventListener("drop", (e) => { e.preventDefault(); files.push(...e.dataTransfer.files); renderChips(); });
    $("#btnJump").onclick = scrollBottom;
    $("#messages").addEventListener("scroll", () => { if (nearBottom()) { $("#btnJump").hidden = true; unseen = false; } });
    PanelCode.bind({ toast, download });
    document.addEventListener("click", (e) => {
      const op = e.target.closest("[data-open-project]");
      if (op) { PanelStore.setCurrent(op.dataset.openProject); afterProjectChange(); showView("workspace", "chat"); return; }
      const ot = e.target.closest("[data-open-tab]");
      if (ot) { tab = ot.dataset.openTab; showView("workspace", "chat"); res.classList.remove("collapsed"); rz.classList.remove("hide"); renderTabs(); }
    });
    $("#btnShowResults").onclick = () => { res.classList.remove("collapsed"); rz.classList.remove("hide"); };
    $("#btnResBack").onclick = () => { res.classList.add("collapsed"); };

    PanelChat.on("status", onStatus);
    PanelChat.on("typing", (on) => { if (waitingReply) showTyping(on); });
    PanelChat.on("bot", onBot);
    PanelPending.subscribe((ev, kind) => {
      if (kind !== "chat" && kind !== "panellab" && kind !== "fix") return;
      if (ev === "cancel") { waitingReply = false; showTyping(false); updateSend(); notice("다른 채팅 요청으로 이 요청이 취소되었습니다. 다시 요청해 주세요.", false); }
      else if (ev === "timeout") { waitingReply = false; showTyping(false); updateSend(); notice("AI 응답이 지연되고 있습니다. 응답이 도착하면 자동으로 표시됩니다. 계속 오지 않으면 재연결해 주세요.", false); }
    });

    // Data changed by another tab or by TECHCORE (trash/restore): redraw from the re-read data.
    PanelStore.onExternalChange((info) => {
      if (info.type === "reloaded" || info.type === "merged") afterProjectChange();
      if (info.type === "blocked" || info.type === "corrupt" || info.type === "savefail") notice(info.message, true); else toast(info.message);
    });
    // "storage" events do not reach the same tab, so also check on focus and on a slow timer (cheap string compare).
    window.addEventListener("focus", () => PanelStore.refresh());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) PanelStore.refresh(); });
    setInterval(() => PanelStore.refresh(), 2000);

    renderProjectSelect(); const p = project(); if (p) $("#softwareSelect").value = p.software;
    PanelHmi.init({ chat: PanelChat, project, persist, toast, download, ensureProject: () => { const p = ensureProject(); renderProjectSelect(); return p; } });
    renderDashboard(); renderTabs(); updateSend();
    PanelChat.connect();
  }
  init();
})();
