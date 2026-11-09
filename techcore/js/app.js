(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "techcore.v1";
  const PANELLAB_URL = "../panellab/";

  // Entra ID sign-in is not configured yet. Only public values (tenant/client id) may ever be placed here; never secrets.
  const AUTH_CONFIG = { tenantId: "", clientId: "", apiScope: "" };
  const authConfigured = () => !!(AUTH_CONFIG.tenantId && AUTH_CONFIG.clientId);

  let state = { mode: "beginner", panelOpen: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  const beginner = () => state.mode === "beginner";

  const badge = (k) => { const s = TC_STATUS[k] || TC_STATUS.unverified; return '<span class="tc-badge ' + s.cls + '">' + s.label + "</span>"; };
  let termSeq = 0;
  const term = (t) => {
    if (!TC_GLOSSARY[t]) return esc(t);
    const id = "tcTip" + (++termSeq);
    return '<span class="tc-term" tabindex="0" aria-describedby="' + id + '">' + esc(t) + '<span class="tc-tt" role="tooltip" id="' + id + '">' + esc(TC_GLOSSARY[t]) + "</span></span>";
  };
  const safety = () => '<div class="tc-safe"><b>안전 안내</b> AI 결과는 참고용 후보입니다. 사용자 승인 없이 자동으로 적용되지 않으며, 수행하지 않은 검증은 완료로 표시하지 않습니다.</div>';
  const tip = (t) => beginner() ? '<div class="tc-tip">' + t + "</div>" : "";

  function panellabProjects() { return TechProjects.readPanel().projects; }

  const ico = (d) => '<svg class="tc-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  const ICONS = {
    home: ico('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
    plus: ico('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    folder: ico('<path d="M3 6h6l2 2h10v11H3z"/>'),
    tool: ico('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'),
    help: ico('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>'),
    expert: ico('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
    ladder: ico('<path d="M6 3v18M18 3v18M6 8h12M6 16h12"/>'),
    drawing: ico('<path d="M5 3h9l4 4v14H5z"/><circle cx="11" cy="13" r="3"/><path d="M13.5 15.5L16 18"/>'),
    error: ico('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'),
    hmi: ico('<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>'),
    review: ico('<path d="M5 4h14v16H5z"/><path d="M8 9l2 2 3-3M8 15h8"/>'),
    ai: ico('<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M9 11v2M15 11v2M12 3v3"/>'),
  };

  // Six visible menus (PC sidebar). Existing hash routes are all kept; only the grouping changes.
  const TOP = [
    { id: "home", t: "홈", s: "홈", i: "home", r: "dashboard", match: ["dashboard"] },
    { id: "work", t: "AI 작업실", s: "AI 작업실", i: "ai", r: "workroom", match: ["workroom", "field", "tools"] },
    { id: "mine", t: "내 작업", s: "내 작업", i: "folder", r: "projects", match: ["projects", "history", "docs"] },
    { id: "help", t: "도움말", s: "도움말", i: "help", r: "help", match: ["help"] },
    { id: "set", t: "설정", s: "설정", i: "tool", r: "settings", match: ["settings"] },
    { id: "about", t: "소개", s: "소개", i: "expert", r: "about", match: ["about"] },
  ];
  const SUBS = {
    work: [{ r: "workroom", t: "AGENT01 통합 채팅" }, { r: "tools/panellab", t: "PLC·HMI 작업실 (PanelLab)" }].concat(TC_FIELDS.map((f) => ({ r: "field/" + f.id, t: f.name }))),
    mine: [{ r: "projects", t: "프로젝트·휴지통" }, { r: "history", t: "작업 이력 및 검증" }, { r: "docs", t: "도면 및 문서" }],
    help: TechHelp.TABS.map((t) => ({ r: "help" + (t.id ? "/" + t.id : ""), t: t.t })),
  };
  function renderNav(route) {
    const name = route.split("/")[0];
    const link = (r, inner, cls, title) => '<a href="#/' + r + '"' + (cls ? ' class="' + cls + '"' : "") + (title ? ' title="' + esc(title) + '"' : "") + (cls && cls.indexOf("active") >= 0 ? ' aria-current="page"' : "") + ">" + inner + "</a>";
    let html = "", tabs = "";
    TOP.forEach((m) => {
      const on = m.match.indexOf(name) >= 0;
      html += link(m.r, ICONS[m.i] + '<span class="t">' + esc(m.t) + "</span>", on ? "active" : "", m.t);
      tabs += link(m.r, ICONS[m.i] + "<span>" + esc(m.s) + "</span>", on ? "active" : "", m.t);
      if (on && SUBS[m.id]) {
        html += '<div class="sub">' + SUBS[m.id].map((s) => link(s.r, esc(s.t), route === s.r ? "active" : "")).join("") + "</div>";
      }
    });
    $("#tcNav").innerHTML = html;
    $("#tcTabs").innerHTML = tabs;
  }

  function info(title, body) { $("#tcInfo").innerHTML = "<section><h3>" + esc(title) + "</h3>" + body + "</section>"; }

  let seq = 0, cleanup = null, lastKey = "", chatLoading = null;
  // Header connection pill. "접속됨" only means the Direct Line connection succeeded; it does not prove the agent replies.
  // Header: ONE shared AGENT01 status pill + the ONE connect button (P3-E/F). "접속됨" only means the Direct Line connection is online;
  // it does not prove the agent replies, that it is AGENT01, or that a specialist agent is called.
  let connWatched = false;
  const connBtn = () => $("#tcConnBtn");
  function paintConn(s) {
    const pill = $("#tcConn"), btn = connBtn(); if (!pill) return;
    s = s || { state: "idle", talk: "idle" };
    let m;
    if (s.state === "connecting") m = ["warn", "AGENT01 연결 중"];
    else if (s.state === "error") m = ["err", "AGENT01 연결 실패"];
    else if (s.state === "online") m = s.talk === "sending" || s.talk === "waiting" ? ["warn", "AGENT01 응답 대기"] : s.talk === "slow" ? ["warn", "AGENT01 응답 지연"] : s.talk === "timeout" ? ["err", "AGENT01 응답 시간 초과"] : ["ok", "AGENT01 접속됨"];
    else m = ["", "AGENT01 미연결"];
    pill.className = "tc-conn " + m[0]; pill.textContent = m[1];
    pill.title = s.state === "error" ? (s.message || "") : "";
    if (btn) {
      const again = s.state === "error" || s.talk === "timeout";
      btn.hidden = s.state === "online" && !again;
      btn.disabled = s.state === "connecting";
      btn.textContent = s.state === "connecting" ? "연결 중..." : again ? "다시 연결" : "AGENT01 연결";
    }
  }
  function watchConn() {
    if (connWatched || typeof TechChat === "undefined") return;
    connWatched = true;
    TechChat.subscribe(paintConn); paintConn(TechChat.getState());
  }
  // The connect button loads chat.js if needed and then connects; nothing connects on page load.
  function initConnBtn() {
    const btn = connBtn(); if (!btn) return;
    btn.addEventListener("click", () => {
      btn.disabled = true;
      loadChat().then(() => { watchConn(); TechChat.connect(TechChat.getState().talk === "timeout"); paintConn(TechChat.getState()); })
        .catch(() => { btn.disabled = false; const pill = $("#tcConn"); pill.className = "tc-conn err"; pill.textContent = "AGENT01 연결 실패"; pill.title = "채팅 구성 요소를 불러오지 못했습니다. 네트워크를 확인해 주세요."; });
    });
  }
  // chat.js is loaded only when the work room is opened.
  function loadChat() {
    if (typeof TechChat !== "undefined") return Promise.resolve();
    if (!chatLoading) {
      chatLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "./js/chat.js?v=3";
        s.onload = () => { try { TechLedger.observe(); } catch {} try { watchConn(); } catch {} resolve(); };
        s.onerror = () => { s.remove(); chatLoading = null; reject(new Error("x")); };
        document.head.appendChild(s);
      });
    }
    return chatLoading;
  }

  function elecRoom(old) {
    const mine = seq;
    let sel = null, files = [];
    const card = (x) => '<button type="button" class="tc-card tc-click tc-task" data-el="' + x.id + '"><b>' + esc(x.t) + "</b><span class='tc-muted'>" + esc(x.d) + "</span><span class='tc-ex'>" + esc(x.ex) + "</span></button>";
    const group = (g) => "<h2 class='tc-sec'>" + g + " 작업</h2><div class='tc-grid'>" + TC_ELEC_TASKS.filter((x) => x.g === g).map(card).join("") + "</div>";
    $("#tcWork").innerHTML =
      "<h1>2. 전기·전자</h1>" +
      (old ? '<div class="tc-tip"><b>' + esc(old.name) + "</b> 분야는 <b>전기·전자</b> 그룹에 통합되었습니다. 기존 주소는 그대로 열립니다.</div>" : "") +
      "<p>" + esc(TC_FIELDS[1].intro) + "</p>" +
      '<div class="tc-safe"><b>안전 안내</b> AI 결과는 참고용 후보입니다. 실제 전기 설비의 작업과 제어는 자격을 갖춘 담당자의 검토와 승인이 필요하며, AI는 안전성을 보증하지 않습니다. 수행하지 않은 검증은 완료로 표시하지 않습니다.</div>' +
      tip("① 하고 싶은 작업을 고릅니다. ② 목적과 조건을 적으면 요청 초안이 만들어집니다. ③ 초안을 확인하고 채팅창에 직접 붙여 넣어 보냅니다. ④ AI 답변을 확인한 뒤 직접 승인합니다.") +
      '<div class="ee-tabs" role="group" aria-label="전기·전자 작업실 탭"><div class="tc-seg"><button type="button" id="elTabReq" aria-pressed="true" class="on">AI 요청</button><button type="button" id="elTabEdit" aria-pressed="false">설계 편집기</button></div></div>' +
      '<div id="elEdit" hidden></div><div id="elReq">' +
      "<h2 class='tc-sec'>1단계. 작업 고르기</h2>" + group("전기") + group("전자") +
      '<div id="elStep2"></div>' +
      '<h2 class="tc-sec">채팅 (AGENT01 확인 전)</h2>' +
      '<div class="tc-card"><p class="tc-muted">대상: ' + esc(TC_CHAT_TARGET.label) + ' — AGENT01 여부 미확인. 전기·전자 전용 채팅은 없으며, 이 채팅 하나만 사용합니다.</p>' +
      '<p><span class="tc-muted" id="elStatus" role="status" aria-live="polite"></span></p>' +
      '<p class="tc-muted">연결은 화면 위쪽의 [AGENT01 연결] 버튼 하나로 합니다. 연결하기 전에는 요청이 전송되지 않습니다.</p>' +
      '<p class="tc-muted">입력한 내용·코드·도면·첨부 파일은 외부 AI 에이전트(Copilot Studio 기반)로 전송됩니다. 기밀 자료는 올리지 마세요.</p>' +
      '<p class="tc-muted" id="elTalk" aria-live="polite"></p><div id="elSlot"></div></div>' +
      "<h2 class='tc-sec'>결과 (검토용)</h2>" +
      '<div class="tc-card"><p class="tc-muted">AI 답변은 위 채팅창에 표시됩니다. 아래 항목은 답변에서 직접 확인할 수 있을 때만 사용자가 판단합니다. 이 화면은 자동으로 채우지 않습니다.</p>' +
      "<ul class='tc-list'><li>요청 내용: 위 요청 초안과 채팅창의 보낸 메시지</li>" +
      "<li>호출이 확인된 전문 에이전트: <span class='tc-muted'>확인 불가(응답 데이터 구조 미확인)</span></li>" +
      "<li>전문 에이전트별 결과: <span class='tc-muted'>구분하지 않음. AGENT01의 통합 답변만 표시</span></li>" +
      "<li>결과 간 충돌·미해결 사항: <span class='tc-muted'>답변 내용을 직접 읽고 확인</span></li>" +
      "<li>최종 통합 보고서: <span class='tc-muted'>준비 중</span></li></ul>" +
      "<h3>검증 단계</h3><ul class='tc-list'>" + TC_VALIDATION_STAGES.map((s) => "<li>" + esc(s) + " " + '<span class="tc-badge">미수행</span></li>').join("") + "</ul>" +
      "<p class='tc-muted'>사용자 승인 전에는 결과를 원본에 적용하지 않습니다. 이 화면에는 승인 후 적용 기능이 없습니다.</p></div></div>";

    let editorMounted = false;
    const showTab = (edit) => {
      $("#elReq").hidden = edit; $("#elEdit").hidden = !edit;
      $("#elTabReq").classList.toggle("on", !edit); $("#elTabReq").setAttribute("aria-pressed", String(!edit));
      $("#elTabEdit").classList.toggle("on", edit); $("#elTabEdit").setAttribute("aria-pressed", String(edit));
      if (edit && !editorMounted) {
        editorMounted = true;
        TechElectricUI.mount($("#elEdit"), {
          projects: () => (TechProjects.list().projects || []),
          header: (name) => TechBridge.contextHeader({ room: "전기·전자 설계 편집기", project: name, software: "Mitsubishi GX Works2", mode: state.mode }),
          send: (t) => loadChat().then(() => TechBridge.sendUser(t)),
          onActivity: (fn) => (typeof TechChat !== "undefined" && TechChat.onActivity ? TechChat.onActivity(fn) : () => {}),
        });
      }
    };
    $("#elTabReq").addEventListener("click", () => showTab(false));
    $("#elTabEdit").addEventListener("click", () => showTab(true));

    const draftText = () => {
      const v = $("#elInput") ? $("#elInput").value.trim() : "";
      return TechBridge.contextHeader({ room: "전기·전자 (AGENT01 통합 AI 작업실)", project: "", software: "Mitsubishi GX Works2", mode: state.mode }) + "\n[전기·전자 작업 요청]\n작업: " + sel.t + " (" + sel.g + ")\n\n목적과 조건:\n" + (v || "(아직 입력하지 않았습니다)") +
        "\n\n첨부 파일(이름만 기재, 파일 내용은 전달되지 않음):\n" + (files.length ? files.map((n) => "- " + n).join("\n") : "- 없음") +
        "\n\n요청 사항:\n- 이 요청에 필요한 전문가는 AGENT01이 선택해 주세요.\n- 부족한 정보는 먼저 질문해 주세요. 예: " + sel.ask +
        "\n- 결과는 적용 후보로만 제시하고, 적용은 제가 확인하고 승인한 뒤에 합니다. 원본은 변경하지 않습니다.\n- PLC 코드는 제가 명시적으로 요청할 때만 작성해 주세요.\n- 실제 설비 작업은 자격을 갖춘 담당자가 검토합니다.\n\n" + TechAnalysis.requestBlock(state.mode);
    };
    const refreshDraft = () => { if (sel && $("#elDraft")) $("#elDraft").value = draftText(); };
    const pick = (id) => {
      sel = TC_ELEC_TASKS.find((x) => x.id === id);
      files = [];
      document.querySelectorAll("[data-el]").forEach((b) => b.classList.toggle("on", b.dataset.el === id));
      $("#elStep2").innerHTML =
        "<h2 class='tc-sec'>2단계. " + esc(sel.t) + "</h2><div class='tc-card'><p class='tc-muted'>" + esc(sel.d) + "</p>" +
        '<label for="elInput"><b>목적과 조건</b></label><textarea id="elInput" class="tc-ta" rows="4" placeholder="' + esc(sel.ex) + '"></textarea>' +
        '<p><label for="elFile"><b>도면·파일 첨부(선택)</b></label><br><input type="file" id="elFile" multiple></p>' +
        '<p class="tc-muted">파일은 읽거나 전송하거나 저장하지 않고, 이름만 요청 초안에 적습니다. 지원 형식은 확인되지 않았습니다.</p></div>' +
        "<h2 class='tc-sec'>3단계. 요청 초안 확인</h2><div class='tc-card'>" +
        '<label for="elDraft"><b>AGENT01에게 보낼 요청 초안</b></label><textarea id="elDraft" class="tc-ta" rows="12"></textarea>' +
        '<p><button class="tc-btn tc-primary" id="elSend" type="button">AGENT01에게 보내기</button> <button class="tc-btn" id="elCopy" type="button">초안 복사</button> <span class="tc-muted" id="elCopyMsg" role="status" aria-live="polite"></span></p>' +
        '<p class="tc-muted">자동으로 전송되지 않습니다. 내용을 읽고 필요하면 고친 뒤 [AGENT01에게 보내기]를 직접 누르세요. 연결되어 있지 않으면 복사만 됩니다. 맨 위 [작업 맥락…] 줄은 AGENT01이 이해하는지 확인되지 않았습니다.</p></div>';
      refreshDraft();
      $("#elInput").addEventListener("input", refreshDraft);
      $("#elFile").addEventListener("change", (e) => { files = Array.from(e.target.files || []).map((f) => f.name); refreshDraft(); });
      const copyDraft = (t, done) => {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => done(true), () => done(false));
        else { $("#elDraft").select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} done(ok); }
      };
      $("#elCopy").addEventListener("click", () => {
        const t = $("#elDraft").value, msg = $("#elCopyMsg");
        const done = (ok) => { msg.textContent = ok ? "복사했습니다. 채팅창에 붙여 넣어 직접 보내세요." : "복사하지 못했습니다. 초안을 선택해 직접 복사해 주세요."; if (ok) markSaved(); };
        copyDraft(t, done);
      });
      $("#elSend").addEventListener("click", () => {
        const t = $("#elDraft").value, msg = $("#elCopyMsg");
        if (!t.trim()) { msg.textContent = "보낼 내용이 없습니다."; return; }
        TechBridge.sendUser(t).then(() => {
          msg.textContent = "AGENT01 채팅으로 보냈습니다. 답변은 채팅창에서 확인하세요. (AGENT01이 맞는지·전문가 호출 여부는 확인되지 않았습니다)";
          markSaved();
        }, (e) => {
          copyDraft(t, (ok) => { msg.textContent = e.message + (ok ? " 대신 초안을 복사했습니다. 위쪽 [AGENT01 연결]로 연결한 뒤 붙여 넣어 보내세요." : " 초안을 선택해 직접 복사해 주세요."); if (ok) markSaved(); });
        });
      });
      $("#elStep2").scrollIntoView({ block: "nearest" });
    };
    document.querySelectorAll("[data-el]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.el)));

    const st = $("#elStatus"), tk = $("#elTalk"), slot = $("#elSlot");
    const TALKS = { idle: "대기", sending: "전송 중", waiting: "응답 대기", slow: "지연", timeout: "시간 초과", done: "응답 도착" };
    const paint = (s) => {
      st.textContent = s.state === "connecting" ? "연결하는 중입니다..." : s.state === "online" ? "채팅 연결됨 (접속 성공만 뜻합니다)" : s.state === "error" ? s.message + " (화면 위쪽의 [다시 연결]을 눌러 주세요)" : "아직 연결하지 않았습니다. 화면 위쪽의 [AGENT01 연결]을 눌러 주세요.";
      tk.textContent = s.talk === "slow" ? "응답이 오래 걸립니다. 계속 기다리거나 다시 요청할 수 있습니다." : s.talk === "timeout" ? "4분 동안 응답이 없었습니다. 요청을 다시 보내거나 위쪽의 [다시 연결]을 눌러 주세요." : s.talk === "done" ? "응답이 도착했습니다. 내용은 직접 확인한 뒤 승인해 주세요." : "";
      if (s.rendered && slot.firstChild !== TechChat.host) slot.appendChild(TechChat.host);
      const a01 = tcEffectiveStatus(TC_CHAT_TARGET.agent01);
      info("상태 (3가지 구분)",
        "<p><b>연결</b> " + (s.state === "online" ? badge("pass") + " 채팅 접속 성공" : s.state === "error" ? badge("fail") : badge("unverified") + " " + (s.state === "connecting" ? "연결 중" : "미연결")) + "</p>" +
        "<p><b>응답</b> " + esc(TALKS[s.talk] || "대기") + "</p>" +
        "<p><b>대상</b> " + esc(TC_CHAT_TARGET.label) + "<br>AGENT01 여부 " + badge(a01) + "</p>" +
        "<p><b>전문 에이전트 호출</b> " + badge("unverified") + "<br><span class='tc-muted'>확인 불가. 호출된 에이전트는 수집하지 않으며 추측해 표시하지 않습니다.</span></p>");
    };
    info("상태 (3가지 구분)", "<p class='tc-muted'>채팅 구성 요소를 불러오는 중입니다...</p>");
    loadChat().then(() => {
      if (mine !== seq) return;
      cleanup = TechChat.subscribe(paint);
      paint(TechChat.getState());
    }).catch(() => {
      if (mine !== seq) return;
      st.textContent = "채팅 구성 요소를 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.";
    });
  }

  TechBridge.init({ load: loadChat });

  // P6-B: common request room for fields without a dedicated editor. It only drafts a request the user sends manually.
  function commonRoom(f) {
    return '<div class="tc-card" id="cmRoom"><h2>' + esc(f.name) + ' 요청 작업실</h2>' +
      '<div class="tc-ph"><b>전용 편집 도구 준비 중</b> — 이 분야에는 전용 편집기·계산기·검증기가 아직 없습니다. 아래는 AGENT01에게 보낼 요청 초안을 만드는 기능뿐이며, 결과는 AI가 말한 내용일 뿐 사이트가 검증하지 않습니다.</div>' +
      '<label for="cmTask"><b>작업 종류</b></label><select id="cmTask" class="tc-search"><option>검토/조언</option><option>설계 초안</option><option>문서 작성</option><option>오류 원인 분석</option><option>기타</option></select>' +
      '<label for="cmInput"><b>목적과 조건</b></label><textarea id="cmInput" class="tc-ta" rows="4"></textarea>' +
      '<label for="cmDraft"><b>요청 초안</b></label><textarea id="cmDraft" class="tc-ta" rows="8"></textarea>' +
      '<p><button class="tc-btn tc-primary" id="cmSend" type="button">AGENT01에게 보내기</button> <button class="tc-btn" id="cmCopy" type="button">초안 복사</button> <span class="tc-muted" id="cmMsg" role="status" aria-live="polite"></span></p>' +
      '<p class="tc-muted">자동 전송되지 않습니다. 연결되어 있지 않으면 보내지 않고 초안을 복사합니다. 입력 내용은 외부 AI 에이전트로 전송되므로 기밀 자료는 넣지 마세요.</p>' +
      "<h3>결과 (AGENT01 채팅)</h3><p class='tc-muted'>AI 답변은 아래 채팅 영역에 표시되며, 연결 후에만 나타납니다. 연결은 화면 위쪽 [AGENT01 연결] 버튼으로 합니다. 이 화면은 결과를 자동으로 채우지 않습니다.</p><div id='cmSlot'></div>" +
      "<h3>검증 단계</h3><ul class='tc-list'>" + TC_VALIDATION_STAGES.map((s) => "<li>" + esc(s) + ' <span class="tc-badge">미수행</span></li>').join("") + "</ul></div>";
  }
  function bindCommonRoom(f) {
    const draft = () => {
      const v = $("#cmInput").value.trim();
      $("#cmDraft").value = TechBridge.contextHeader({ room: f.name + " (AGENT01 통합 AI 작업실)", project: "", software: "Mitsubishi GX Works2", mode: state.mode }) +
        "\n[" + f.name + " 작업 요청]\n작업: " + $("#cmTask").value + "\n\n목적과 조건:\n" + (v || "(아직 입력하지 않았습니다)") +
        "\n\n요청 사항:\n- 필요한 전문가는 AGENT01이 선택해 주세요.\n- 부족한 정보는 먼저 질문해 주세요.\n- 결과는 적용 후보로만 제시하고, 적용은 제가 확인하고 승인한 뒤에 합니다.\n- PLC 코드는 제가 명시적으로 요청할 때만 작성해 주세요.\n- 실제 설비 작업은 자격을 갖춘 담당자가 검토합니다.";
    };
    draft();
    $("#cmInput").addEventListener("input", draft); $("#cmTask").addEventListener("change", draft);
    if ($("#cmGo")) $("#cmGo").addEventListener("click", () => { $("#cmRoom").scrollIntoView({ block: "start" }); $("#cmInput").focus(); });
    const mine = seq;
    loadChat().then(() => { if (mine !== seq) return; cleanup = TechChat.subscribe((s) => { const sl = $("#cmSlot"); if (sl && s.rendered && sl.firstChild !== TechChat.host) sl.appendChild(TechChat.host); }); }, () => {});
    const copy = (t, done) => { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => done(true), () => done(false)); else done(false); };
    $("#cmCopy").addEventListener("click", () => copy($("#cmDraft").value, (ok) => { $("#cmMsg").textContent = ok ? "복사했습니다." : "복사하지 못했습니다. 직접 선택해 복사해 주세요."; }));
    $("#cmSend").addEventListener("click", () => {
      const t = $("#cmDraft").value;
      loadChat().then(() => TechBridge.sendUser(t)).then(() => { $("#cmMsg").textContent = "AGENT01 채팅으로 보냈습니다. 답변은 아래 채팅 영역에서 확인하세요."; }, (e) => { const why = e && e.message ? e.message : "보내지 못했습니다."; $("#cmMsg").textContent = why + " 초안은 지워지지 않았습니다."; copy(t, (ok) => { $("#cmMsg").textContent = why + (ok ? " 대신 초안을 복사했습니다." : " 초안을 직접 복사해 주세요."); }); });
    });
  }

  const views = {
    dashboard() {
      const all = panellabProjects();
      const ps = all.slice().sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0)).slice(0, 3);
      const linked = TC_AGENTS.filter((a) => tcEffectiveStatus(a.states.linked) === "pass").length;
      const reported = TC_FIELDS.filter((f) => f.reported).length;
      const task = (k) => {
        const href = k.ready ? "#/tools/panellab" : "#/field/plc-hmi";
        return '<a class="tc-tile' + (k.ready ? "" : " off") + '" href="' + href + '">' + ICONS[k.id] + "<b>" + esc(k.t) + "</b><span>" + esc(k.d) + "</span>" +
          (k.ready ? '<small class="tc-muted">PanelLab의 "' + esc(k.menu) + '" 메뉴에서 시작합니다.</small>' : "<small>" + badge("soon") + " 아직 제공되지 않습니다</small>") + "</a>";
      };
      $("#tcWork").innerHTML =
        "<h1>무엇을 작업할까요?</h1><p class='tc-lead'>처음 사용해도 괜찮습니다. 원하는 작업을 선택하면 AI가 안내합니다.</p>" +
        '<div class="tc-home">' +
        '<a class="tc-plc" href="#/tools/panellab"><span class="tc-tag">핵심 분야</span><div class="tc-plc-h">' + ICONS.ladder + "<h2>PLC 엔지니어링</h2></div>" +
        "<p>PLC 프로그램과 설비 자동화 작업을 PanelLab에서 시작합니다. 기존 작업은 그대로 유지됩니다.</p>" +
        '<ul class="tc-fn"><li>래더 작화</li><li>도면 분석</li><li>오류 검사</li><li>글로벌 라벨 관리</li><li>프로그램 검증 <small>준비 중</small></li></ul>' +
        '<p class="tc-plc-note">기준: Mitsubishi GX Works2 · GX Works3은 지원 대상 아님 · CPU 모델 미정</p>' +
        '<span class="tc-btn tc-light">PLC 작업 시작하기</span></a>' +
        '<p class="tc-muted tc-termline">용어: ' + term("래더") + " · " + term("HMI") + " · " + term("GX Works2") + " · " + term("CPU 모델") + "</p>" +
        "</div>" +
        '<details class="tc-fold"><summary>다른 작업 보기 (HMI 설계 · AGENT01 통합 AI 작업실)</summary><div class="tc-home tc-home2">' +
        '<a class="tc-side-card" href="#/tools/panellab">' + ICONS.hmi + "<b>HMI 설계</b><span>터치 화면을 설계하고 PLC와 맞는지 검사합니다.</span><small>PanelLab의 HMI 작업실에서 시작</small></a>" +
        '<a class="tc-side-card" href="#/workroom">' + ICONS.ai + "<b>AGENT01 통합 AI 작업실</b><span>자연어로 요청하면 필요한 전문가 연결을 AGENT01이 맡도록 설계되었습니다.</span><small>" + badge("unverified") + " 채팅 대상·전문가 호출 미확인</small></a>" +
        "</div></details>" +
        '<details class="tc-fold"><summary>대표 분야 보기</summary><div class="tc-fields">' +
        TC_FIELDS.map((f) => '<a class="tc-field' + (f.id === "plc-hmi" ? " main" : "") + '" href="#/field/' + f.id + '"><b>' + esc(f.name) + "</b>" + (f.id === "plc-hmi" ? "<small>핵심 분야</small>" : "") + "</a>").join("") + "</div></details>" +
        '<details class="tc-fold"><summary>PLC 작업 바로 가기</summary><div class="tc-tasks">' + TC_TASKS.map(task).join("") + "</div></details>" +
        "<h2 class='tc-sec'>처음 사용하시나요?</h2><ol class='tc-steps3'><li><b>1</b> 원하는 작업을 선택합니다.</li><li><b>2</b> AI가 필요한 내용을 쉬운 말로 질문합니다.</li><li><b>3</b> 결과를 확인하고 직접 승인합니다.</li></ol>" +
        "<h2 class='tc-sec'>최근 작업</h2>" +
        (ps.length ? '<ul class="tc-list">' + ps.map((p) => "<li><span>" + esc(p.name) + "</span><span class='tc-muted'>" + esc(p.updated ? new Date(p.updated).toLocaleDateString("ko-KR") : "") + " · PanelLab · 검증 전</span></li>").join("") + "</ul>"
          : "<p class='tc-muted'>표시할 작업이 없습니다. (이 브라우저에 저장된 PanelLab 프로젝트만 읽습니다.)</p>") +
        '<details class="tc-fold"><summary>시스템 상태 (확인이 필요한 항목)</summary><ul class="tc-list">' +
        "<li><span>PanelLab 프로젝트(이 브라우저 저장분)</span><span>" + all.length + "개</span></li>" +
        "<li><span>AI 채팅 연결</span><span>" + badge("unverified") + "</span></li>" +
        "<li><span>채팅 대상이 AGENT01인지</span><span>" + badge("unverified") + "</span></li>" +
        "<li><span>전문 에이전트 호출</span><span>" + badge("unverified") + "</span></li>" +
        "<li><span>아직 제공되지 않는 기능</span><span>" + badge("soon") + "</span></li></ul>" +
        (beginner() ? "" : '<p class="tc-muted">전문 에이전트 계획 ' + TC_PLANNED_AGENTS + "개 / 연결 확인됨 " + linked + "개 / 사용자 보고 분야 " + reported + "개(미확인)</p>") + "</details>" +
        safety();
      info("빠른 도움말", "<ul class='tc-list'><li><a href='#/help'>처음 사용 가이드</a></li><li><a href='#/field/plc-hmi'>PLC 작업 순서</a></li><li><a href='#/help'>용어 설명</a></li></ul>");
    },

    workroom() {
      const mine = seq;
      $("#tcWork").innerHTML =
        "<h1>통합 AI 작업실</h1><p class='tc-muted'>AI 에이전트에게 자연어로 업무를 요청하는 공간입니다.</p>" +
        '<div class="tc-safe"><b>연결 대상: AI Creative Agent</b> 이 에이전트가 AGENT 01인지, 전문 에이전트를 호출하는지는 확인되지 않았습니다. 응답은 참고용 후보이며 사용자 승인 없이 적용되지 않습니다.</div>' +
        tip("화면 위쪽의 [AGENT01 연결] 버튼을 누르면 채팅이 시작됩니다. 하고 싶은 일을 문장으로 적어 보세요.") +
        '<div class="tc-chips">' + TC_FIELDS.map((f) => '<a class="tc-chip" href="#/field/' + f.id + '">' + esc(f.name) + "</a>").join("") + "</div>" +
        '<div class="tc-card"><p><span class="tc-muted" id="tcChatStatus" role="status" aria-live="polite"></span></p>' +
        '<p class="tc-muted">입력한 내용·코드·도면·첨부 파일은 외부 AI 에이전트(Copilot Studio 기반)로 전송됩니다. 기밀 자료는 올리지 마세요.</p>' +
        '<p class="tc-muted" id="tcChatTalk" aria-live="polite"></p><div id="tcChatSlot"></div></div>' +
                TechAnalysis.card(state.mode, esc);
              TechAnalysis.bindCard($("#tcWork"));
              const st = $("#tcChatStatus"), tk = $("#tcChatTalk"), slot = $("#tcChatSlot");
      const TALK = {
        sending: "요청을 보내는 중입니다...",
        waiting: "에이전트 응답을 기다리는 중입니다...",
        slow: "응답이 오래 걸리고 있습니다. 계속 기다리거나, 4분이 지나면 다시 요청해 주세요.",
        timeout: "4분 동안 응답이 없었습니다. 채팅창에 요청을 다시 입력해 주세요. 계속되면 위쪽의 [다시 연결]을 눌러 주세요.",
        done: "응답이 도착했습니다. 내용은 직접 확인한 뒤 승인해 주세요.",
      };
      const paint = (s) => {
        st.textContent = s.state === "connecting" ? "연결하는 중입니다..." : s.state === "online" ? "연결됨 (이 세션에서 연결 성공)" : s.state === "error" ? s.message + " (화면 위쪽의 [다시 연결]을 눌러 주세요)" : "아직 연결하지 않았습니다. 화면 위쪽의 [AGENT01 연결]을 눌러 주세요.";
        tk.textContent = TALK[s.talk] || "";
        if (s.rendered && slot.firstChild !== TechChat.host) slot.appendChild(TechChat.host);
        info("연결 상태",
          "<p>연결 " + (s.state === "online" ? badge("pass") : badge("unverified")) + "<br><span class='tc-muted'>토큰 발급과 채팅 연결 성공 여부만 뜻합니다.</span></p>" +
          "<p>에이전트 호출 " + badge("unverified") + "<br><span class='tc-muted'>호출된 전문 에이전트는 확인할 수 없어 표시하지 않습니다.</span></p>");
      };
      info("연결 상태", "<p class='tc-muted'>채팅 구성 요소를 불러오는 중입니다...</p>");
      loadChat().then(() => {
        if (mine !== seq) return;
        cleanup = TechChat.subscribe(paint);
        paint(TechChat.getState());
      }).catch(() => {
        if (mine !== seq) return;
        st.textContent = "채팅 구성 요소를 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.";
      });
    },

    projects() {
      const ex = TechProjects.expireDue();
      const r = TechProjects.list();
      const trash = TechProjects.trashList();
      const fmtD = (t) => (t ? new Date(t).toLocaleString("ko-KR") : "");
      const kb = (n) => (n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB");
      const rows = (items) => items.length
        ? items.map((p) => { const s = p.summary; return "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.software) + "</td><td>" + s.messages + " / " + s.results + "</td><td>" + (s.ladderCode ? "있음" : "없음") + " · 버전 " + s.codeVersions + "</td><td>" + s.hmiScreens + " · 버전 " + s.hmiVersions + "</td><td>" + s.labels + "</td><td>" + kb(s.bytes) + "</td><td>" + esc(fmtD(p.updated)) + '</td><td><button class="tc-btn" type="button" data-del="' + esc(p.id) + '">삭제</button></td></tr>'; }).join("")
        : "<tr><td colspan='9' class='tc-muted'>조건에 맞는 프로젝트가 없습니다.</td></tr>";
      const contents = (s) => "메시지 " + s.messages + "개, 결과 " + s.results + "개, 래더 코드 " + (s.ladderCode ? "있음" : "없음") + ", 코드 버전 " + s.codeVersions + "개, 오류 수정 이력 " + s.fixHistory + "개, 글로벌 라벨 " + s.labels + "개, HMI 화면 " + s.hmiScreens + "개(HMI 버전 " + s.hmiVersions + "개)";
      const u = TechProjects.usage();
      const used = Object.keys(u).reduce((a, k) => a + u[k], 0);
      const trashRows = trash.length ? trash.map((t) => "<tr><td>" + esc(t.name) + "</td><td>" + esc(fmtD(t.deletedAt)) + "</td><td>" + (t.soon ? '<b class="tc-warnTxt">만료 임박</b> ' : "") + esc(fmtD(t.expiresAt)) + " (" + t.daysLeft + "일 남음)</td><td>" + esc(contents(t.summary)) + '</td><td><button class="tc-btn" type="button" data-restore="' + esc(t.trashId) + '">복구</button> <button class="tc-btn" type="button" data-purge="' + esc(t.trashId) + '">영구 삭제</button></td></tr>').join("")
        : "<tr><td colspan='5' class='tc-muted'>휴지통이 비어 있습니다.</td></tr>";
      const hist = TechProjects.history().slice(0, 15);
      const LOGT = { delete: "휴지통으로 이동", restore: "복구", purge: "영구 삭제(수동)", "auto-expire": "보관 기간 만료로 자동 삭제" };
      $("#tcWork").innerHTML =
        "<h1>프로젝트 관리</h1><p class='tc-muted'>이 브라우저에 저장된 PanelLab 프로젝트입니다. 삭제하면 먼저 휴지통에 사본이 보관된 뒤 PanelLab 목록에서 빠집니다. 프로젝트 생성·이름 변경은 PanelLab에서 합니다.</p>" +
        (TechProjects.trashDamaged() ? '<div class="tc-safe" role="alert"><b>휴지통 데이터를 읽지 못했습니다.</b> 손상된 원본은 지우지 않고 "techcore.trash.v1.corrupt" 항목에 따로 보관했습니다. 안전을 위해 삭제·복구·영구 삭제를 막습니다. 개발자 도구에서 해당 항목을 복사해 두고 지원을 요청해 주세요.</div>' : "") +
        (r.ok ? "" : '<div class="tc-safe"><b>저장 데이터를 읽지 못했습니다.</b> 저장된 PanelLab 데이터가 손상되었거나 접근할 수 없습니다(' + esc(r.error) + "). 원본은 변경하지 않았습니다. 이 상태에서는 삭제를 막습니다.</div>") +
        '<div class="tc-safe"><b>데이터 손실 안내</b> 프로젝트와 휴지통은 이 브라우저(localStorage)에만 저장됩니다. 브라우저 데이터 삭제, 시크릿 모드, 다른 브라우저·PC에서는 사라지거나 보이지 않습니다. 중요한 작업은 [전체 백업 내려받기]로 파일을 보관해 주세요. 백업 파일은 PanelLab의 기존 백업 불러오기로 복원할 수 있습니다.</div>' +
        '<div class="tc-toolbar"><input class="tc-search" id="tcProjSearch" type="search" placeholder="프로젝트 이름 검색" aria-label="프로젝트 검색">' +
        '<button class="tc-btn" id="tcBackup" type="button">전체 백업 내려받기</button> <span class="tc-muted" id="tcBackupMsg" role="status" aria-live="polite"></span></div>' +
        '<div class="tc-tablewrap"><table class="tc-table"><thead><tr><th>이름</th><th>소프트웨어</th><th>메시지 / 결과</th><th>래더 코드</th><th>HMI 화면</th><th>라벨</th><th>크기</th><th>수정일</th><th>삭제</th></tr></thead><tbody id="tcProjRows">' + rows(r.projects) + "</tbody></table></div>" +
        '<div id="tcDelBox" aria-live="polite"></div>' +
        "<p class='tc-muted'>프로젝트 수 " + r.projects.length + "개 · 사용 중인 저장 공간(추정) " + kb(used) + ". 브라우저별 한도는 확인되지 않았습니다.</p>" +
        '<p><a class="tc-btn" href="#/tools/panellab">PanelLab에서 프로젝트 편집</a></p>' +
        "<h2 class='tc-sec'>휴지통</h2><p class='tc-muted'>휴지통 보관 기간은 " + TechProjects.RETENTION_DAYS + "일입니다. 기간이 지나면 이 화면을 열 때 <b>자동으로 삭제</b>됩니다(수동 영구 삭제와는 다른 동작이며 둘 다 이력에 기록됩니다).</p>" +
        '<div class="tc-toolbar"><button class="tc-btn" id="tcTrashBackup" type="button">휴지통 백업 내려받기</button> <span class="tc-muted" id="tcTrashMsg" role="status" aria-live="polite"></span></div>' +
        '<div class="tc-tablewrap"><table class="tc-table"><thead><tr><th>이름</th><th>삭제일</th><th>자동 삭제 예정일</th><th>포함 데이터</th><th>작업</th></tr></thead><tbody id="tcTrashRows">' + trashRows + "</tbody></table></div>" +
        '<div id="tcTrashBox" aria-live="polite"></div>' +
        "<h2 class='tc-sec'>삭제·복구 이력</h2>" + (hist.length ? "<ul class='tc-list'>" + hist.map((h) => "<li><span>" + esc(h.name) + " — " + esc(LOGT[h.type] || h.type) + "</span><span class='tc-muted'>" + esc(fmtD(h.at)) + "</span></li>").join("") + "</ul>" : "<p class='tc-muted'>기록이 없습니다.</p>");
      const REASON = { quota: "저장 공간이 부족합니다. 먼저 [전체 백업 내려받기]와 [휴지통 백업 내려받기]로 파일을 보관한 뒤, 휴지통에서 영구 삭제해 공간을 확보하세요.", verify: "저장 내용을 확인하지 못했습니다.", error: "저장에 실패했습니다.", parse: "저장된 데이터를 읽을 수 없습니다.", shape: "저장된 데이터 형식이 올바르지 않습니다.", empty: "저장된 데이터가 없습니다.", notfound: "대상을 찾지 못했습니다(다른 탭에서 변경됐을 수 있습니다).", name: "프로젝트 이름이 일치하지 않습니다.", storage: "브라우저 저장소에 접근할 수 없습니다.", "trash-corrupt": "휴지통 데이터를 읽을 수 없어 안전을 위해 중단했습니다.", conflict: "다른 탭에서 휴지통이 바뀌었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." };
      if (ex && ex.skipped === "clock") {
        $("#tcTrashBox").innerHTML = '<div class="tc-safe" role="alert"><b>자동 삭제를 건너뛰었습니다.</b> 컴퓨터 시계가 크게 바뀐 것 같아(만료 대상 ' + (ex.pending || 0) + '개) 휴지통 자동 삭제를 하지 않았습니다. 날짜가 맞다면 <button class="tc-btn" type="button" id="tcClockOk">날짜가 맞습니다</button> 를 누르세요.</div>';
        $("#tcClockOk").onclick = () => { TechProjects.confirmClock(); views.projects(); };
      } else if (ex && ex.failed) {
        $("#tcTrashBox").innerHTML = '<div class="tc-safe" role="alert"><b>만료된 휴지통 항목을 정리하지 못했습니다.</b> 저장 공간 또는 다른 탭의 변경 때문일 수 있습니다. 데이터는 그대로이며 다음에 다시 시도합니다.</div>';
      }
      const again = (msgHtml) => { views.projects(); if (msgHtml) $("#tcTrashBox").innerHTML = msgHtml; };
      const sIn = $("#tcProjSearch");
      sIn.addEventListener("input", () => { $("#tcProjRows").innerHTML = rows(TechProjects.search(r.projects, sIn.value)); });
      $("#tcBackup").onclick = () => {
        const res = TechProjects.downloadBackup();
        $("#tcBackupMsg").textContent = res.ok ? res.count + "개 프로젝트의 백업 파일을 만들었습니다. 저장 위치는 브라우저 다운로드 설정을 확인해 주세요." : res.reason === "empty" ? "백업할 프로젝트가 없습니다." : "백업 파일을 만들지 못했습니다. 원본 데이터는 변경되지 않았습니다.";
      };
      $("#tcTrashBackup").onclick = () => {
        const res = TechProjects.downloadTrashBackup();
        $("#tcTrashMsg").textContent = res.ok ? res.count + "개 프로젝트의 휴지통 백업 파일을 만들었습니다." : res.reason === "empty" ? "휴지통이 비어 있습니다." : "백업 파일을 만들지 못했습니다.";
      };
      $("#tcProjRows").addEventListener("click", (e) => {
        const b = e.target.closest("[data-del]");
        if (!b || !r.ok) return;
        const p = r.projects.find((x) => x.id === b.dataset.del);
        if (!p) return;
        const framed = !!document.querySelector("#tcFrameHost iframe");
        $("#tcDelBox").innerHTML = '<div class="tc-card tc-confirm"><h2>프로젝트를 휴지통으로 이동할까요?</h2><p><b>' + esc(p.name) + "</b> (" + esc(p.software) + ")</p>" +
          "<p>포함 데이터: " + esc(contents(p.summary)) + "</p>" +
          "<ul class='tc-list'><li>영구 삭제가 아닙니다. 사본이 휴지통에 " + TechProjects.RETENTION_DAYS + "일 보관되며 그 안에 복구할 수 있습니다.</li><li>PanelLab 프로젝트 목록에서는 즉시 사라집니다. 이 브라우저 밖에 따로 저장한 파일은 영향받지 않습니다.</li><li>프로젝트는 각각 독립적으로 저장되어 있어 다른 프로젝트와 공유되는 자료는 확인되지 않았습니다.</li><li>다른 탭에서 PanelLab을 열어 두었다면 먼저 닫아 주세요. 열린 PanelLab이 저장하면 삭제가 되돌려질 수 있습니다.</li></ul>" +
          (framed ? "<p class='tc-warnTxt'>이 화면에 PanelLab이 열려 있습니다. 삭제 전에 닫아야 합니다(저장되지 않은 편집은 PanelLab에서 먼저 저장하세요).</p>" : "") +
          '<p><button class="tc-btn tc-primary" type="button" id="tcDelGo">' + (framed ? "PanelLab 닫고 휴지통으로 이동" : "휴지통으로 이동") + '</button> <button class="tc-btn" type="button" id="tcDelCancel">취소</button> <span class="tc-muted" id="tcDelMsg"></span></p></div>';
        $("#tcDelCancel").onclick = () => { $("#tcDelBox").innerHTML = ""; };
        $("#tcDelGo").onclick = () => {
          const fh = $("#tcFrameHost");
          if (fh.firstChild) fh.innerHTML = "";
          const res = TechProjects.moveToTrash(p.id);
          if (res.ok) { views.projects(); $("#tcDelBox").innerHTML = '<div class="tc-tip">"' + esc(p.name) + '" 프로젝트를 휴지통으로 옮겼습니다.</div>'; }
          else $("#tcDelMsg").textContent = "이동하지 못했습니다. " + (REASON[res.reason] || "") + " 원본 데이터는 그대로입니다.";
        };
      });
      $("#tcTrashRows").addEventListener("click", (e) => {
        const rb = e.target.closest("[data-restore]"), pb = e.target.closest("[data-purge]");
        if (rb) {
          const res = TechProjects.restore(rb.dataset.restore);
          if (res.ok) again('<div class="tc-tip">프로젝트를 복구했습니다.' + (res.idChanged ? " 같은 ID가 이미 있어 새 ID로 복구했습니다." : "") + (res.trashCleanupFailed ? " 다만 휴지통 사본을 지우지 못해 휴지통에도 남아 있습니다(중복). 확인 후 휴지통에서 직접 영구 삭제하세요." : "") + " PanelLab에서 확인하세요.</div>");
          else $("#tcTrashBox").innerHTML = '<div class="tc-safe">복구하지 못했습니다. ' + esc(REASON[res.reason] || "") + " 휴지통의 사본은 그대로입니다.</div>";
        } else if (pb) {
          const it = trash.find((x) => x.trashId === pb.dataset.purge);
          if (!it) return;
          $("#tcTrashBox").innerHTML = '<div class="tc-card tc-confirm"><h2>영구 삭제</h2><p><b>' + esc(it.name) + "</b>: " + esc(contents(it.summary)) + "</p><p class='tc-warnTxt'>복구할 수 없습니다. 필요하면 먼저 [휴지통 백업 내려받기]로 파일을 보관하세요. 계속하려면 프로젝트 이름을 똑같이 입력하세요.</p>" +
            '<p><input class="tc-search" id="tcPurgeName" type="text" aria-label="프로젝트 이름 확인" placeholder="프로젝트 이름 입력"> <button class="tc-btn tc-primary" type="button" id="tcPurgeGo" disabled>영구 삭제</button> <button class="tc-btn" type="button" id="tcPurgeCancel">취소</button> <span class="tc-muted" id="tcPurgeMsg"></span></p></div>';
          const nin = $("#tcPurgeName"), go = $("#tcPurgeGo");
          nin.addEventListener("input", () => { go.disabled = nin.value !== it.name; });
          $("#tcPurgeCancel").onclick = () => { $("#tcTrashBox").innerHTML = ""; };
          go.onclick = () => {
            const res = TechProjects.purge(it.trashId, nin.value);
            if (res.ok) again('<div class="tc-tip">영구 삭제했습니다.</div>');
            else $("#tcPurgeMsg").textContent = REASON[res.reason] || "삭제하지 못했습니다.";
          };
        }
      });
      info("안내", "<p class='tc-muted'>삭제는 휴지통 이동입니다. 영구 삭제와 자동 만료는 별도 동작이며, 모든 삭제·복구는 이력에 남습니다.</p>");
    },

    field(id) {
      const old = aliasOf(id);
      const f = TC_FIELDS.find((x) => x.id === (old ? old.to : id));
      if (!f) { $("#tcWork").innerHTML = "<h1>분야를 찾을 수 없습니다.</h1>"; return; }
      id = f.id;
      if (id === "electric") { elecRoom(old); return; }
      const agents = TC_AGENTS.filter((a) => a.field === f.name);
      const guide = (title, steps) => "<h2 class='tc-sec'>" + title + "</h2><ol class='tc-list tc-num'>" +
        steps.map((s) => "<li><span><b>" + esc(s.t) + "</b><br><span class='tc-muted'>" + esc(s.d) + "</span></span>" + (s.ready ? "" : badge("soon")) + "</li>").join("") + "</ol>";
      const plc = id === "plc-hmi"
        ? guide("PLC 작업 순서", TC_PLC_STEPS) + guide("HMI 작업", TC_HMI_STEPS) +
          '<p><a class="tc-btn tc-primary" href="#/tools/panellab">PanelLab에서 작업하기</a></p>' +
          "<p class='tc-muted'>HMI의 제조사 프로젝트 파일 출력은 검증되지 않아 지원한다고 표시하지 않습니다.</p>"
        : "";
      $("#tcWork").innerHTML =
        "<h1>" + f.no + ". " + esc(f.name) + "</h1>" +
        (old ? '<div class="tc-tip"><b>' + esc(old.name) + "</b> 분야는 <b>" + esc(f.name) + "</b> 그룹에 통합되었습니다. 기존 주소는 그대로 열립니다.</div>" : "") +
        "<p>" + esc(f.intro) + "</p>" +
        (f.reported ? '<p>' + badge("reported") + '<span class="tc-muted"> 이 분야의 에이전트는 구축된 것으로 보고되었으나, 실제 연결은 확인되지 않았습니다.</span></p>' : "<p>" + badge("unverified") + "</p>") +
        tip("이 분야의 업무는 PLC와 관계없이 독립적으로 시작할 수 있습니다.") + plc +
        '<div class="tc-grid">' +
        '<div class="tc-card"><h2>AGENT01 연결</h2><span class="tc-muted">이 분야에 필요한 전문가는 AGENT01이 내부적으로 선택합니다. 실제 호출은 아직 확인되지 않았습니다.</span> ' + badge("unverified") + "</div>" +
        '<div class="tc-card"><h2>새 작업 시작</h2>' + (id === "plc-hmi" ? '<a class="tc-btn tc-primary" href="#/tools/panellab">PanelLab에서 시작</a>' : '<button class="tc-btn tc-primary" type="button" id="cmGo">아래 요청 작업실로 이동</button>') + "</div>" +
        '<div class="tc-card"><h2>프로젝트 · 결과 · 파일</h2><span class="tc-muted">서버 저장소 도입 후 제공됩니다.</span></div>' +
        '<div class="tc-card"><h2>전문 도구</h2>' + (f.tool === "panellab" ? '<a class="tc-btn" href="#/tools/panellab">PanelLab 열기</a><p class="tc-muted">PLC 작업실 진입 경로: 이 화면 · 도구 메뉴의 PanelLab · AI 작업실 화면의 PanelLab 안내. 래더를 화면에서 직접 편집하는 기능은 <b>미구현</b>입니다(AI 요청과 PanelLab의 기존 기능만 제공).</p>' : "<span class='tc-muted'>전용 편집 도구 준비 중입니다. 현재는 아래 AI 요청 작업실만 사용할 수 있으며, 이 분야용 편집기·계산기·검증기는 없습니다.</span>") + "</div>" +
        "</div>" + (id === "plc-hmi" ? "" : commonRoom(f)) + safety();
      if (id !== "plc-hmi") bindCommonRoom(f);
      info(f.name, "<p class='tc-muted'>" + esc(f.intro) + "</p>");
    },

    agents() {
      const cell = (s) => {
        const eff = tcEffectiveStatus(s);
        const meta = [s.source ? TC_SOURCES[s.source] : "", s.checkedAt || "", s.evidenceRef || ""].filter(Boolean).map(esc).join(" · ");
        return "<td>" + badge(eff) + (meta ? "<br><span class='tc-muted'>" + meta + "</span>" : "") + "</td>";
      };
      const row = (a) => "<tr><td>" + esc(a.no) + "</td><td>" + esc(a.name) + "</td><td>" + esc(a.role) + "</td><td>" + esc(a.field) + "</td>" + TC_STATE_FIELDS.map((f) => cell(a.states[f.key])).join("") + "</tr>";
      $("#tcWork").innerHTML =
        "<h1>에이전트 상태 (내부 진단)</h1><div class='tc-safe'><b>일반 메뉴에서 제외된 내부 진단 화면입니다.</b> 사용자는 AGENT01 하나만 이용하며, 전문 에이전트는 AGENT01이 내부적으로 선택합니다. 이 화면은 에이전트를 만들거나 바꾸지 않고 상태만 보여 줍니다.</div><p class='tc-muted'>계획 " + TC_PLANNED_AGENTS + "개 중 이 목록에는 등록된 항목만 표시됩니다.</p>" +
        tip("<b>생성</b>(만들어졌는지), <b>연결</b>(AGENT 01과 이어졌는지), <b>호출 테스트</b>, <b>역할 확인</b>, <b>업무 테스트</b>, <b>결과 검증</b>은 서로 다른 단계입니다. 사용자 보고만으로는 확인됨으로 표시하지 않습니다.") +
        '<div class="tc-tablewrap"><table class="tc-table"><tr><th>번호</th><th>이름</th><th>역할</th><th>분야</th>' + TC_STATE_FIELDS.map((f) => "<th>" + esc(f.label) + "</th>").join("") + "</tr>" +
        TC_AGENTS.map(row).join("") + "</table></div>" +
        '<p class="tc-muted">각 상태에는 출처·확인일·근거를 함께 기록합니다. MCP·도구 연결 상태는 아직 확인되지 않았습니다.</p>';
      info("상태 설명", "<p>" + badge("unverified") + " 확인한 적 없음<br>" + badge("reported") + " 사용자 보고만 있음<br>" + badge("pass") + " 로그·검토 근거로 확인됨<br>" + badge("fail") + " 실패</p>");
    },

    docs() {
      $("#tcWork").innerHTML =
        "<h1>도면 및 문서 관리</h1><p class='tc-muted'>파일 형식별 지원 여부입니다. 확인하지 않은 형식은 지원한다고 표시하지 않습니다.</p>" +
        '<div class="tc-tablewrap"><table class="tc-table"><tr><th>형식</th><th>지원 상태</th><th>비고</th></tr>' +
        TC_FILE_TYPES.map((t) => "<tr><td>" + esc(t.type) + "</td><td>" + badge(t.status) + "</td><td>" + esc(t.note) + "</td></tr>").join("") + "</table></div>" +
        '<div class="tc-safe"><b>원본 보존</b> 업로드한 원본은 수정하지 않고, 수정 후보와 최종본은 분리해 보관할 예정입니다.</div>';
      info("안내", "<p class='tc-muted'>파일 저장 기능은 아직 제공되지 않습니다.</p>");
    },

    history() {
      $("#tcWork").innerHTML =
        "<h1>작업 이력 및 검증</h1><div id='tcLedger'></div>" + safety();
      const draw = () => { const r = $("#tcLedger"); r.innerHTML = TechLedger.render({ esc }); TechLedger.bind(r, draw); };
      draw();
      info("안내", "<p class='tc-muted'>L4·L5는 별도 도구·환경에서 사용자가 수행한 뒤 근거를 기록해야 합니다.</p>");
    },

    tools(sub) {
      if (sub === "panellab") {
        const narrow = window.matchMedia("(max-width:900px)").matches;
        const head = "<h1>PanelLab</h1><p class='tc-muted'>PLC · HMI 전문 작업실입니다. 기존 PanelLab이 그대로 열립니다. <a href='" + PANELLAB_URL + "' target='_blank' rel='noopener'>새 창에서 열기</a></p>";
        if (!narrow) {
          // The frame is created once and only hidden when leaving, so PanelLab's editing state survives screen changes.
          const host = $("#tcFrameHost");
          if (!host.firstChild) host.innerHTML = head + '<iframe class="tc-frame" title="PanelLab" src="' + PANELLAB_URL + '"></iframe>';
          $("#tcWork").hidden = true;
          host.hidden = false;
        } else {
          $("#tcWork").innerHTML = head + '<div class="tc-card"><p>화면이 좁아 PanelLab을 여기에 함께 표시하지 않습니다. 새 탭에서 열면 더 편하게 작업할 수 있습니다.</p><a class="tc-btn tc-primary" href="' + PANELLAB_URL + '" target="_blank" rel="noopener">PanelLab 새 탭에서 열기</a></div>';
        }
        info("PanelLab 안내", "<p class='tc-muted'>PanelLab의 작업과 데이터는 독립 주소에서도 동일하게 유지됩니다. 이 화면은 기존 PanelLab을 변경하지 않고 표시만 합니다.</p>");
        return;
      }
      $("#tcWork").innerHTML =
        "<h1>엔지니어링 도구</h1><div class='tc-grid'>" +
        '<div class="tc-card tc-click"><a class="tc-link" href="#/tools/panellab"><b>PanelLab</b><br><span class="tc-muted">' + term("PLC") + " 코드·" + term("래더") + "·" + term("HMI") + " 작업실</span></a></div></div>";
      info("안내", "<p class='tc-muted'>추가 도구는 확인 후 등록됩니다.</p>");
    },

    settings() {
      const cpu = state.cpu || "";
      $("#tcWork").innerHTML =
        "<h1>설정</h1>" +
        '<div class="tc-card"><h2>사용 모드</h2><p class="tc-muted">모드를 바꿔도 입력 중인 내용, 프로젝트, 채팅 연결은 유지됩니다. 상단의 모드 버튼으로도 바꿀 수 있습니다.</p>' +
        '<div class="tc-seg" role="group" aria-label="사용 모드 설정"><button id="tcSetBeginner" type="button" aria-pressed="' + beginner() + '" class="' + (beginner() ? "on" : "") + '">초보자</button><button id="tcSetExpert" type="button" aria-pressed="' + !beginner() + '" class="' + (beginner() ? "" : "on") + '">전문가</button></div>' +
        '<p class="tc-muted">현재: ' + (beginner() ? "초보자" : "전문가") + "</p></div>" +
        '<div class="tc-card" style="margin-top:12px"><h2>화면 설정</h2><label><input type="checkbox" id="tcSetPanel"' + (state.panelOpen ? " checked" : "") + '> 오른쪽 정보 패널 표시</label><p class="tc-muted">PC 화면 기준 설정입니다. 모바일 화면은 지원하지 않습니다.</p></div>' +
        '<div class="tc-card" style="margin-top:12px"><h2>작업 환경 · PLC 기본 환경</h2><p><b>PLC 소프트웨어</b>: Mitsubishi ' + term("GX Works2") + ' (고정)</p><p class="tc-muted">GX Works3는 지원 대상이 아닙니다. GX Works2 호환성과 가져오기 성공 여부는 실제 프로그램에서 시험하기 전까지 <span class="tc-badge">미검증</span>입니다.</p>' +
        '<p><label for="tcSetCpu"><b>' + term("CPU 모델") + '</b></label> <input class="tc-search" id="tcSetCpu" type="text" maxlength="60" value="' + esc(cpu) + '" placeholder="미정 (지정하기 전까지 비워 두세요)"> <button class="tc-btn" id="tcSetCpuSave" type="button">저장</button> <span class="tc-muted" id="tcSetCpuMsg" role="status" aria-live="polite">' + (cpu ? "" : "현재: 미정") + "</span></p>" +
        '<p class="tc-muted">이 값은 이 브라우저에만 저장되며 AI 요청에 자동으로 적용되지는 않습니다. PanelLab 프로젝트마다 따로 지정한 CPU 모델이 있으면 PanelLab 안에서는 그 값이 우선합니다(이 설정은 참고용 기본값이며, 서로 자동으로 바뀌지 않습니다).</p></div>' +
        '<div class="tc-card" style="margin-top:12px"><h2>백업 및 데이터 관리</h2><p class="tc-muted">프로젝트와 휴지통은 이 브라우저(localStorage)에만 저장됩니다. 브라우저 데이터를 지우면 사라질 수 있으니 정기적으로 백업 파일을 내려받으세요.</p><p><a class="tc-btn" href="#/projects">프로젝트 백업 · 휴지통 열기</a></p></div>' +
        '<div class="tc-card" style="margin-top:12px"><h2>로그인 (Microsoft Entra ID)</h2><p>' + (authConfigured() ? badge("unverified") + " 설정값 입력됨, 동작 미검증" : "<span class='tc-badge warn'>미설정</span>") +
        '</p><p class="tc-muted">다수 사용자 지원을 위해 Entra ID 로그인을 사용합니다. 앱 등록과 API 검증 서버가 준비되면 활성화됩니다. 정적 페이지 접근 자체는 인증으로 막을 수 없으며, 서버 API 호출 권한을 통제합니다.</p></div>' +
        (beginner() ? "" : '<div class="tc-card" style="margin-top:12px"><h2>상세 정보</h2><p class="tc-muted">저장소 키 <code>techcore.v1</code>(설정), <code>techcore.projects.v1</code>(프로젝트 관리 기록), <code>techcore.trash.v1</code>(휴지통). PanelLab 데이터 키 <code>panellab.v1</code>은 삭제·복구 때만 변경합니다. 공개 정적 코드에는 AI 연결용 봉인값(SEALED)과 브로커 주소가 들어 있습니다. 이 브라우저 저장소에는 비밀키를 저장하지 않으며, 연결용 토큰은 연결할 때 브로커에서 받습니다.</p></div>');
      $("#tcSetBeginner").onclick = () => setMode("beginner");
      $("#tcSetExpert").onclick = () => setMode("expert");
      $("#tcSetPanel").onchange = (e) => { state.panelOpen = e.target.checked; save(); applyChrome(); };
      $("#tcSetCpuSave").onclick = () => {
        const v = $("#tcSetCpu").value.trim();
        if (v) state.cpu = v; else delete state.cpu;
        save();
        $("#tcSetCpuMsg").textContent = v ? "저장했습니다: " + v : "현재: 미정";
      };
      info("안내", "<p class='tc-muted'>공개 정적 코드에는 AI 연결용 봉인값(SEALED)과 브로커 주소가 들어 있어 완전한 비밀은 아닙니다. 연결 토큰은 연결할 때 브로커에서 받으며 이 브라우저 저장소에는 저장하지 않습니다.</p>");
    },

    about() {
      $("#tcWork").innerHTML =
        "<h1>TECHCORE AI 소개</h1>" +
        "<h2 class='tc-sec'>플랫폼 목적</h2><p>TECHCORE AI는 초보자부터 전문가까지 사용할 수 있는 PLC 중심의 통합 엔지니어링 플랫폼입니다. 사용자는 AGENT01 하나를 중심으로 작업을 요청합니다.</p>" +
        "<h2 class='tc-sec'>지원 기술 분야</h2><ul class='tc-list'>" + TC_FIELDS.map((f) => "<li><span><b>" + esc(f.name) + "</b><br><span class='tc-muted'>" + esc(f.intro) + "</span></span></li>").join("") + "</ul>" +
        "<p class='tc-muted'>PLC는 Mitsubishi GX Works2만 지원합니다. GX Works3는 지원 대상이 아닙니다.</p>" +
        "<h2 class='tc-sec'>주요 기능</h2><ul><li>AGENT01 통합 채팅 " + badge("unverified") + "</li><li>PLC·HMI 작업실(PanelLab): 래더 작화, 도면 분석, 오류 검사, 글로벌 라벨, HMI 설계·검사</li><li>프로젝트 관리: 검색, 백업, 휴지통(30일 보관), 복구</li><li>초보자·전문가 모드</li></ul>" +
        "<h2 class='tc-sec'>통합 운영 구조</h2><p>모든 요청은 AGENT01이 받아 필요한 전문 에이전트를 내부적으로 선택하고 중계합니다. 전문 에이전트끼리 직접 호출하지 않으며, 사용자 화면에는 에이전트 관리 메뉴가 없습니다.</p>" +
        "<p class='tc-muted'>호출 요청, 실제 호출, 응답 수신, 결과 검토, 전달은 서로 다른 단계이며, 증거가 없는 단계는 완료로 표시하지 않습니다. 실제 전문 에이전트 호출 여부는 현재 확인되지 않았습니다.</p>" + safety();
      info("소개", "<p class='tc-muted'>PC 화면에 맞춰 설계되었습니다.</p>");
    },

    help(arg) {
      const c = { esc, badge };
      $("#tcWork").innerHTML = TechHelp.render(arg, c) + safety();
      TechHelp.bindVideos($("#tcWork"), c);
      info("도움말", "<p class='tc-muted'>상단 검색창에 하고 싶은 일을 적어도 됩니다.</p>");
    },
  };

  // ---- stage 1: in-app history, breadcrumb, input protection ----
  const DRAFT_KEY = "techcore.draft.v1";
  const drafts = (() => { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; } })();
  const persistDrafts = () => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch {} };
  // Captures text typed into the current work screen (not the file pickers) so it survives mode switches and screen changes.
  function captureDraft() {
    if (!lastKey || $("#tcWork").hidden) return;
    const fields = {};
    document.querySelectorAll("#tcWork textarea[id], #tcWork input[id]").forEach((el) => {
      if (el.type === "file" || el.type === "button" || el.readOnly) return;
      if (el.value) fields[el.id] = el.value;
    });
    const on = document.querySelector("#tcWork [data-el].on");
    if (Object.keys(fields).length || on) drafts[lastKey] = { sel: on ? on.dataset.el : null, fields };
    else delete drafts[lastKey];
    persistDrafts();
  }
  function restoreDraft(key) {
    const d = drafts[key];
    if (!d) return;
    if (d.sel) { const b = document.querySelector('#tcWork [data-el="' + d.sel + '"]'); if (b) b.click(); }
    const modeNow = state.mode === "expert" ? "전문가" : "초보자";
    const stale = ["beginner", "expert"].filter((m) => m !== state.mode);
    Object.keys(d.fields).sort((a, b) => (a === "elInput" ? -1 : 0) - (b === "elInput" ? -1 : 0)).forEach((id) => {
      const el = document.querySelector("#tcWork #" + id);
      if (!el || el.type === "file") return;
      let v = d.fields[id];
      // P4-F: a draft saved in the other mode must not keep that mode's wording.
      stale.forEach((m) => { v = v.split(TechAnalysis.requestBlock(m)).join(TechAnalysis.requestBlock(state.mode)); });
      v = v.replace(/(\[작업 맥락 - [^\]]*모드: )(초보자|전문가)\]/, "$1" + modeNow + "]");
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  // P4-F: drafts that were already copied/sent (and not edited since) must not trigger the leave-page warning.
  const saved = {};
  const markSaved = () => { captureDraft(); if (lastKey && drafts[lastKey]) saved[lastKey] = JSON.stringify(drafts[lastKey].fields); };
  const hasDraft = () => Object.keys(drafts).some((k) => drafts[k] && Object.keys(drafts[k].fields).length && saved[k] !== JSON.stringify(drafts[k].fields));

  // Stack of screens visited inside the app. The back button is disabled on the first screen.
  const navStack = [];
  function trackNav(key) {
    if (navStack.length >= 2 && navStack[navStack.length - 2] === key) navStack.pop();
    else if (navStack[navStack.length - 1] !== key) navStack.push(key);
    $("#tcBackBtn").disabled = navStack.length < 2;
  }

  function renderCrumb(key) {
    const [name, arg] = key.split("/");
    const nm = { workroom: "AGENT01 통합 채팅", projects: "프로젝트·휴지통", history: "작업 이력 및 검증", docs: "도면 및 문서", agents: "에이전트 상태", settings: "설정", about: "소개", help: "도움말" };
    const trail = [{ t: "홈", r: "dashboard" }];
    if (name === "workroom") trail.push({ t: "AI 작업실", r: "workroom" }, { t: nm.workroom });
    else if (name === "field") {
      const f = TC_FIELDS.find((x) => x.id === (aliasOf(arg) ? aliasOf(arg).to : arg));
      trail.push({ t: "AI 작업실", r: "workroom" }, { t: f ? f.name : "분야" });
    } else if (name === "projects" || name === "history" || name === "docs") trail.push({ t: "내 작업", r: "projects" }, { t: nm[name] });
    else if (name === "tools") trail.push({ t: "AI 작업실", r: "workroom" }, { t: "PLC·HMI 작업실 (PanelLab)" });
    else if (name === "agents") trail.push({ t: "내부 진단" }, { t: nm.agents });
    else if (name === "settings" || name === "about") trail.push({ t: nm[name] });
    else if (name === "help") trail.push({ t: nm.help, r: arg ? "help" : "" }, ...(arg ? [{ t: TechHelp.title(arg) }] : []));
    $("#tcCrumb").innerHTML = trail.map((x, i) => {
      const last = i === trail.length - 1;
      return (i ? '<span class="sep" aria-hidden="true">›</span>' : "") + (last ? '<span aria-current="page">' + esc(x.t) + "</span>" : x.r ? '<a href="#/' + x.r + '">' + esc(x.t) + "</a>" : "<span>" + esc(x.t) + "</span>");
    }).join("");
  }

  const aliasOf = (k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(TC_FIELD_ALIAS, k) ? TC_FIELD_ALIAS[k] : undefined);
  const hasView = (k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(views, k);
  function route(force, navOnly) {
    const r = (location.hash.replace(/^#\/?/, "") || "dashboard");
    const [name, arg] = r.split("/");
    const v = hasView(name) ? name : "dashboard";
    const key = hasView(name) ? r : "dashboard";
    if (!force && key === lastKey) return;
    if (!navOnly) captureDraft();
    const changed = key !== lastKey;
    lastKey = key;
    if (changed) trackNav(key);
    renderNav(aliasOf(arg) && name === "field" ? "field/" + aliasOf(arg).to : key);
    renderCrumb(key);
    if (navOnly) return;
    if (cleanup) { cleanup(); cleanup = null; }
    seq++;
    $("#tcWork").hidden = false; $("#tcFrameHost").hidden = true;
    try { views[v](arg); } catch (e) { console.error(e); $("#tcWork").innerHTML = "<h1>화면을 표시하지 못했습니다</h1><p class='tc-muted'>저장된 데이터 형식 문제일 수 있습니다. 다른 메뉴를 눌러 이동하거나 새로고침해 보세요. (" + esc(String(e && e.message || e)) + ")</p>"; }
    restoreDraft(key);
    // P5: announce the new screen — title + move focus to its h1 (only on real navigation, not on mode re-render).
    const h1 = ($("#tcWork").hidden ? $("#tcFrameHost") : $("#tcWork")).querySelector("h1");
    document.title = (h1 ? h1.textContent.replace(/\s+/g, " ").trim() + " · " : "") + "TECHCORE AI";
    if (changed && h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    $("#tcSide").classList.remove("open"); $("#tcScrim").classList.remove("open");
    $("#tcWork").scrollTop = 0;
  }

  const onPanellab = () => lastKey === "tools/panellab" && !$("#tcFrameHost").hidden;

  function applyChrome() {
    $("#tcModeBeginner").classList.toggle("on", beginner());
    $("#tcModeExpert").classList.toggle("on", !beginner()); $("#tcModeBeginner").setAttribute("aria-pressed", String(beginner())); $("#tcModeExpert").setAttribute("aria-pressed", String(!beginner()));
    $("#tcModeLabel").textContent = "현재 모드: " + (beginner() ? "초보자" : "전문가");
    $("#tcInfo").classList.toggle("closed", !state.panelOpen);
  }

  // Switching mode keeps typed input, the connected chat and the open PanelLab frame.
  const setMode = (m) => { captureDraft(); state.mode = m; save(); applyChrome(); route(true, onPanellab()); TechBridge.notifyMode(m); };
  TechBridge.setModeApi({ get: () => state.mode, set: (m) => setMode(m) });
  $("#tcModeBeginner").onclick = () => setMode("beginner");
  $("#tcModeExpert").onclick = () => setMode("expert");
  $("#tcBackBtn").onclick = () => { if (navStack.length > 1) history.back(); };
  $("#tcHomeBtn").onclick = () => { location.hash = "#/dashboard"; };
  $("#tcWork").addEventListener("input", captureDraft);
  window.addEventListener("beforeunload", (e) => { captureDraft(); if (hasDraft()) { e.preventDefault(); e.returnValue = ""; } });
  $("#tcPanelBtn").onclick = () => { state.panelOpen = !state.panelOpen; save(); applyChrome(); };
  $("#tcMenuBtn").onclick = () => { $("#tcSide").classList.add("open"); $("#tcScrim").classList.add("open"); };
  $("#tcScrim").onclick = () => { $("#tcSide").classList.remove("open"); $("#tcScrim").classList.remove("open"); };
  $("#tcHelpBtn").onclick = () => { location.hash = "#/help"; };
  initConnBtn();
  document.addEventListener("keydown", (e) => { const a = document.activeElement; if (e.key === "Escape" && a && a.classList && a.classList.contains("tc-term")) a.blur(); });
  $("#tcAuthBtn").onclick = () => { location.hash = "#/settings"; };

  $("#tcSearchList").innerHTML = TC_HELP_QA.map((x) => '<option value="' + esc(x.q) + '"></option>').join("");
  $("#tcSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const hit = TC_HELP_QA.find((x) => x.q.toLowerCase().includes(q) || q.includes(x.q.toLowerCase()))
      || TC_FIELDS.map((f) => ({ route: "#/field/" + f.id, q: f.name })).find((x) => x.q.toLowerCase().includes(q));
    location.hash = hit ? hit.route : "#/help";
  });

  window.addEventListener("hashchange", () => route());
  const skip = document.getElementById("tcSkip");
  if (skip) skip.addEventListener("click", (e) => { e.preventDefault(); document.getElementById("tcWork").focus(); });
  if (window.innerWidth <= 1199) state.panelOpen = false;
  applyChrome();
  TechProjects.expireDue();
  route();
})();
