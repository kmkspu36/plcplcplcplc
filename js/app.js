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
    ["ladder", "래더 작화"], ["drawing", "도면 분석"], ["label", "글로벌 라벨"], ["info", "프로젝트 정보"],
  ];
  const TEXT_EXT = /\.(txt|csv|st|il|gxw|gx3|gxw3|xml|json|md|log|tsv|c|h)$/i;
  const INLINE_LIMIT = 150 * 1024;

  let view = "dashboard";
  let mode = "chat";
  let tab = "all";
  let pendingMode = "chat";
  let pendingBefore = "";
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
    return '<div class="codeblock"><div class="ch"><span>' + esc(lang || "code") + '</span><button class="btn sm" data-copy>복사</button></div><pre>' + esc(code) + "</pre></div>";
  }
  function md(text) {
    const parts = String(text).split(/```([^\n`]*)\n([\s\S]*?)```/g);
    let out = "";
    for (let i = 0; i < parts.length; i += 3) {
      out += mdText(parts[i]);
      if (i + 2 < parts.length) out += codeBlockHtml(parts[i + 1].trim(), parts[i + 2].replace(/\n$/, ""));
    }
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
    String(text).replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, l, c) => { out.push({ lang: l.trim(), code: c.replace(/\n$/, "") }); return ""; });
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
    if (p.messages.length > 300) p.messages = p.messages.slice(-300);
    if (p.results.length > 200) p.results = p.results.slice(-200);
    if (!PanelStore.touch(p)) notice("브라우저 저장 공간이 부족하여 기록을 저장하지 못했습니다. 결과를 내보낸 뒤 오래된 프로젝트를 삭제해 주세요.", true);
  }
  function notice(msg, err) {
    const n = $("#chatNotice");
    if (!msg) { n.hidden = true; return; }
    n.textContent = msg; n.className = "notice" + (err ? " err" : ""); n.hidden = false;
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
    if (v === "projects") renderProjects();
    if (v === "history") renderHistory();
    if (v === "settings") renderSettings();
    closeSidebar();
  }
  function setMode(m) { mode = m; $("#modeSelect").value = m; }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }

  // ---------- projects ----------
  function ensureProject() {
    return project() || PanelStore.createProject("기본 프로젝트", $("#softwareSelect").value);
  }
  function newProject() {
    const name = prompt("프로젝트 이름을 입력하세요.");
    if (name === null) return;
    PanelStore.createProject(name, $("#softwareSelect").value);
    afterProjectChange(); toast("프로젝트를 만들었습니다.");
  }
  function afterProjectChange() {
    renderProjectSelect(); renderMessages(); renderTabs(); renderDashboard(); renderProjects(); renderHistory();
    const p = project(); if (p) $("#softwareSelect").value = p.software;
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
    const qc = $("#quickCards"); qc.innerHTML = "";
    ["code", "check", "fix", "ladder", "drawing", "label"].forEach((k) => {
      const b = el("button", "qcard", "<strong>" + esc(MODES[k].label) + "</strong><span>" + esc(MODES[k].desc) + "</span>");
      b.onclick = () => showView("workspace", k); qc.appendChild(b);
    });
    const ps = PanelStore.all();
    const none = (t) => '<p class="empty">' + t + "</p>";
    $("#dashProjects").innerHTML = ps.length ? ps.slice(0, 6).map((p) => '<div class="item"><span class="grow">' + esc(p.name) + '</span><span class="muted">' + fmt(p.updated) + "</span></div>").join("") : none("프로젝트가 없습니다. 오른쪽 위의 ‘새 프로젝트’로 시작하세요.");
    const p = project();
    const recent = p ? p.messages.filter((m) => m.role === "user").slice(-5).reverse() : [];
    $("#dashRecent").innerHTML = recent.length ? recent.map((m) => '<div class="item"><span class="grow">' + esc(m.text.slice(0, 60)) + '</span><span class="muted">' + fmt(m.ts) + "</span></div>").join("") : none("작업 내역이 없습니다.");
    const codes = p ? p.results.filter((r) => codeBlocks(r.text).length).slice(-3).reverse() : [];
    $("#dashCode").innerHTML = codes.length ? codes.map((r) => '<div class="item"><span class="grow">' + esc(MODES[r.mode].label) + '</span><span class="muted">' + fmt(r.ts) + "</span></div>").join("") : none("저장된 코드가 없습니다.");
    const checks = p ? p.results.filter((r) => r.mode === "check").slice(-3).reverse() : [];
    $("#dashCheck").innerHTML = checks.length ? checks.map((r) => '<div class="item"><span class="grow">' + esc(r.text.slice(0, 60)) + '</span><span class="muted">' + fmt(r.ts) + "</span></div>").join("") : none("검사 결과가 없습니다.");
  }
  function renderProjects() {
    const box = $("#projectList"); box.innerHTML = "";
    const ps = PanelStore.all(), cur = project();
    if (!ps.length) { box.innerHTML = '<p class="empty">프로젝트가 없습니다.</p>'; return; }
    ps.forEach((p) => {
      const it = el("div", "item" + (cur && cur.id === p.id ? " sel" : ""));
      it.innerHTML = '<div class="grow"><strong>' + esc(p.name) + '</strong><div class="muted">' + esc(p.software) + " · 메시지 " + p.messages.length + " · 수정 " + fmt(p.updated) + "</div></div>";
      const mk = (t, fn, cls) => { const b = el("button", "btn sm " + (cls || ""), t); b.onclick = fn; it.appendChild(b); };
      mk("열기", () => { PanelStore.setCurrent(p.id); afterProjectChange(); showView("workspace", "chat"); });
      mk("이름 변경", () => { const n = prompt("새 이름", p.name); if (n) { PanelStore.renameProject(p.id, n); afterProjectChange(); } });
      mk("내보내기", () => download(p.name + ".panellab.json", JSON.stringify(p, null, 2), "application/json"));
      mk("삭제", () => { if (confirm("‘" + p.name + "’ 프로젝트를 삭제할까요?")) { PanelStore.deleteProject(p.id); afterProjectChange(); } }, "danger");
      box.appendChild(it);
    });
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
  function msgNode(m) {
    const w = el("div", "msg " + (m.role === "user" ? "user" : "bot"));
    const mm = MODES[m.mode] && m.mode !== "chat" ? " · " + MODES[m.mode].label : "";
    w.appendChild(el("div", "meta", (m.role === "user" ? "나" : "PanelLab AI") + mm + " · " + fmt(m.ts)));
    const b = el("div", "bubble", md(m.text || ""));
    if (m.files && m.files.length) b.appendChild(el("div", "muted", "첨부: " + m.files.map(esc).join(", ")));
    if (m.failed) b.appendChild(el("div", "fail", esc(m.failed)));
    w.appendChild(b);
    return w;
  }
  function renderMessages() {
    const box = $("#messages"); box.innerHTML = ""; typingEl = null;
    const p = project();
    if (!p || !p.messages.length) {
      box.appendChild(el("div", "welcome", "<strong>PanelLab AI 작업실</strong><p>작업 유형을 고르고 요청을 입력하세요. 예) “M0 누르면 Y0가 켜지고 5초 후 꺼지는 코드를 작성해 줘.”</p><p>응답은 연결된 Copilot Studio 에이전트에서 실제로 받아옵니다.</p>"));
    } else p.messages.forEach((m) => box.appendChild(msgNode(m)));
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

  async function submit() {
    const input = $("#input"); const raw = input.value.trim();
    if (!raw && !files.length) return;
    if (waitingReply) { toast("이전 응답을 기다리는 중입니다."); return; }
    if (PanelChat.getStatus() !== "online") { notice("AI에 연결되어 있지 않습니다. ‘재연결’을 눌러 주세요.", true); return; }
    const p = ensureProject();
    notice("");
    const fileTexts = [], dlAttachments = [], names = [];
    let body = raw;
    try {
      for (const f of files) {
        names.push(f.name);
        if (TEXT_EXT.test(f.name) || f.type.startsWith("text/")) {
          const t = await readFile(f, "text"); fileTexts.push(t);
          body += "\n\n[첨부 파일: " + f.name + "]\n```\n" + t + "\n```";
        } else {
          if (f.size > INLINE_LIMIT) throw new Error(f.name + " 파일이 너무 큽니다. (이미지·PDF는 " + Math.round(INLINE_LIMIT / 1024) + "KB 이하)");
          dlAttachments.push({ contentType: f.type || "application/octet-stream", contentUrl: await readFile(f, "data"), name: f.name });
        }
      }
    } catch (e) { notice(e.message, true); return; }

    const hint = MODES[mode].hint;
    const prefix = "[PanelLab" + (hint ? " 작업: " + hint : "") + " / Mitsubishi " + p.software + "]\n";
    const um = { role: "user", text: raw || "(첨부 파일)", ts: Date.now(), mode, files: names };
    p.messages.push(um); persist(); appendMessage(um);
    pendingMode = mode;
    pendingBefore = extractInputCode(body, fileTexts);
    input.value = ""; autosize(); files = []; renderChips();
    waitingReply = true; updateSend(); showTyping(true);
    try { await PanelChat.send(prefix + body, dlAttachments); }
    catch (e) {
      waitingReply = false; showTyping(false); updateSend();
      um.failed = e.message + " 다시 시도해 주세요."; persist(); renderMessages();
    }
  }

  function onBot(a) {
    waitingReply = false; updateSend();
    const p = ensureProject();
    let text = a.text || "";
    if (!text && a.attachments.length) text = "(첨부 응답: " + a.attachments.map((x) => x.name || x.contentType).join(", ") + ")";
    if (!text) return;
    const m = { role: "bot", text, ts: a.ts, mode: pendingMode };
    p.messages.push(m);
    p.results.push({ id: PanelStore.uid(), mode: pendingMode, ts: a.ts, text, before: pendingBefore });
    persist(); appendMessage(m); renderTabs();
  }

  // ---------- results panel ----------
  function renderTabs() {
    const t = $("#tabs"); t.innerHTML = "";
    TABS.forEach(([k, l]) => { const b = el("button", k === tab ? "active" : "", l); b.onclick = () => { tab = k; renderTabs(); }; t.appendChild(b); });
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
  function renderTabBody() {
    const body = $("#tabBody"); body.innerHTML = "";
    const p = project();
    if (tab === "info") {
      if (!p) { body.innerHTML = '<p class="empty">프로젝트가 없습니다.</p>'; return; }
      body.innerHTML = "<p><strong>" + esc(p.name) + "</strong></p><p class='muted'>PLC: Mitsubishi " + esc(p.software) + "<br>생성 " + fmt(p.created) + "<br>수정 " + fmt(p.updated) + "<br>메시지 " + p.messages.length + "개 · 결과 " + p.results.length + "개</p>";
      return;
    }
    const list = p ? p.results.filter((r) => tab === "all" || r.mode === tab) : [];
    if (!list.length) { body.innerHTML = '<p class="empty">표시할 결과가 없습니다. AI 응답을 받으면 이곳에 정리됩니다.</p>'; return; }
    list.slice().reverse().forEach((r) => {
      const card = el("div", "res-item", "<h4>" + esc(MODES[r.mode].label) + " · " + fmt(r.ts) + "</h4>");
      if (tab === "fix" && r.before) {
        const after = codeBlocks(r.text)[0];
        if (after) {
          const d = lineDiff(r.before, after.code);
          if (d) {
            const box = el("div", "diff");
            d.forEach(([k, l]) => box.appendChild(el("div", k === "+" ? "add" : k === "-" ? "del" : "", esc(k + " " + l))));
            card.appendChild(el("h4", null, "수정 전 → 수정 후")); card.appendChild(box);
          }
        }
      }
      card.appendChild(el("div", null, md(r.text)));
      body.appendChild(card);
    });
  }
  function exportMd() {
    const p = project();
    if (!p || !p.results.length) { toast("내보낼 결과가 없습니다."); return; }
    const txt = "# " + p.name + " (Mitsubishi " + p.software + ")\n\n" + p.results.map((r) => "## " + MODES[r.mode].label + " — " + fmt(r.ts) + "\n\n" + r.text).join("\n\n---\n\n");
    download(p.name + ".md", txt, "text/markdown");
  }

  // ---------- composer ----------
  function autosize() { const i = $("#input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 180) + "px"; }
  function updateSend() { $("#btnSend").disabled = waitingReply || PanelChat.getStatus() !== "online"; }
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

  // ---------- init ----------
  function init() {
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
    $("#btnClearAll").onclick = () => { if (confirm("저장된 모든 프로젝트와 기록을 삭제할까요?")) { PanelStore.clearAll(); afterProjectChange(); toast("삭제했습니다."); } };
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

    $("#composer").onsubmit = (e) => { e.preventDefault(); submit(); };
    $("#input").addEventListener("input", autosize);
    $("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    $("#btnAttach").onclick = () => $("#fileInput").click();
    $("#fileInput").onchange = (e) => { files.push(...e.target.files); e.target.value = ""; renderChips(); };
    $("#btnJump").onclick = scrollBottom;
    $("#messages").addEventListener("scroll", () => { if (nearBottom()) { $("#btnJump").hidden = true; unseen = false; } });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-copy]"); if (!b) return;
      const code = b.closest(".codeblock").querySelector("pre").textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast("복사했습니다."), () => toast("복사하지 못했습니다."));
    });

    PanelChat.on("status", onStatus);
    PanelChat.on("typing", (on) => { if (waitingReply) showTyping(on); });
    PanelChat.on("bot", onBot);
    PanelChat.on("timeout", () => { waitingReply = false; showTyping(false); updateSend(); notice("AI 응답이 지연되고 있습니다. 잠시 후 다시 시도하거나 재연결해 주세요.", true); });

    renderProjectSelect(); const p = project(); if (p) $("#softwareSelect").value = p.software;
    renderDashboard(); renderTabs(); updateSend();
    PanelChat.connect();
  }
  init();
})();
