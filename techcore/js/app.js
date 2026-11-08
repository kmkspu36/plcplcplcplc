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
  const term = (t) => TC_GLOSSARY[t] ? '<span class="tc-term" title="' + esc(TC_GLOSSARY[t]) + '">' + esc(t) + "</span>" : esc(t);
  const safety = () => '<div class="tc-safe"><b>안전 안내</b> AI 결과는 참고용 후보입니다. 사용자 승인 없이 자동으로 적용되지 않으며, 수행하지 않은 검증은 완료로 표시하지 않습니다.</div>';
  const tip = (t) => beginner() ? '<div class="tc-tip">' + t + "</div>" : "";

  function panellabProjects() {
    try {
      const d = JSON.parse(localStorage.getItem("panellab.v1"));
      return d && Array.isArray(d.projects) ? d.projects : [];
    } catch { return []; }
  }

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

  // Five visible menus. Existing hash routes are all kept; only the grouping changes.
  const TOP = [
    { id: "home", t: "홈", s: "홈", i: "home", r: "dashboard", match: ["dashboard"] },
    { id: "new", t: "새 작업", s: "새 작업", i: "plus", r: "workroom", match: ["workroom", "field"] },
    { id: "mine", t: "내 작업", s: "내 작업", i: "folder", r: "projects", match: ["projects", "history", "docs"] },
    { id: "tools", t: "엔지니어링 도구", s: "도구", i: "tool", r: "tools", match: ["tools"] },
    { id: "help", t: "도움말", s: "도움말", i: "help", r: "help", match: ["help"] },
  ];
  const SUBS = {
    new: [{ r: "workroom", t: "통합 AI 작업실" }].concat(TC_FIELDS.map((f) => ({ r: "field/" + f.id, t: f.name }))),
    mine: [{ r: "projects", t: "프로젝트" }, { r: "history", t: "작업 이력 및 검증" }, { r: "docs", t: "도면 및 문서" }],
  };
  const EXPERT = [{ r: "agents", t: "에이전트 관리" }, { r: "settings", t: "시스템 설정" }];

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
    if (!beginner()) {
      html += '<div class="grp">전문가 영역</div>' + EXPERT.map((e) => link(e.r, ICONS.expert + '<span class="t">' + esc(e.t) + "</span>", e.r === name ? "active" : "", e.t)).join("");
    }
    $("#tcNav").innerHTML = html;
    $("#tcTabs").innerHTML = tabs;
  }

  function info(title, body) { $("#tcInfo").innerHTML = "<section><h3>" + esc(title) + "</h3>" + body + "</section>"; }

  let seq = 0, cleanup = null, lastKey = "", chatLoading = null;
  // chat.js is loaded only when the work room is opened.
  function loadChat() {
    if (typeof TechChat !== "undefined") return Promise.resolve();
    if (!chatLoading) {
      chatLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "./js/chat.js?v=2";
        s.onload = resolve;
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
      "<h2 class='tc-sec'>1단계. 작업 고르기</h2>" + group("전기") + group("전자") +
      '<div id="elStep2"></div>' +
      '<h2 class="tc-sec">채팅 (AGENT01 확인 전)</h2>' +
      '<div class="tc-card"><p class="tc-muted">대상: ' + esc(TC_CHAT_TARGET.label) + ' — AGENT01 여부 미확인. 전기·전자 전용 채팅은 없으며, 이 채팅 하나만 사용합니다.</p>' +
      '<p><button class="tc-btn tc-primary" id="elConnect" type="button">AI 연결</button> <span class="tc-muted" id="elStatus" role="status" aria-live="polite"></span></p>' +
      '<p class="tc-muted" id="elTalk" aria-live="polite"></p><div id="elSlot"></div></div>' +
      "<h2 class='tc-sec'>결과 (검토용)</h2>" +
      '<div class="tc-card"><p class="tc-muted">AI 답변은 위 채팅창에 표시됩니다. 아래 항목은 답변에서 직접 확인할 수 있을 때만 사용자가 판단합니다. 이 화면은 자동으로 채우지 않습니다.</p>' +
      "<ul class='tc-list'><li>요청 내용: 위 요청 초안과 채팅창의 보낸 메시지</li>" +
      "<li>호출이 확인된 전문 에이전트: <span class='tc-muted'>확인 불가(응답 데이터 구조 미확인)</span></li>" +
      "<li>전문 에이전트별 결과: <span class='tc-muted'>구분하지 않음. AGENT01의 통합 답변만 표시</span></li>" +
      "<li>결과 간 충돌·미해결 사항: <span class='tc-muted'>답변 내용을 직접 읽고 확인</span></li>" +
      "<li>최종 통합 보고서: <span class='tc-muted'>준비 중</span></li></ul>" +
      "<h3>검증 단계</h3><ul class='tc-list'>" + TC_VALIDATION_STAGES.map((s) => "<li>" + esc(s) + " " + '<span class="tc-badge">미수행</span></li>').join("") + "</ul>" +
      "<p class='tc-muted'>사용자 승인 전에는 결과를 원본에 적용하지 않습니다. 이 화면에는 승인 후 적용 기능이 없습니다.</p></div>";

    const draftText = () => {
      const v = $("#elInput") ? $("#elInput").value.trim() : "";
      return "[전기·전자 작업 요청]\n작업: " + sel.t + " (" + sel.g + ")\n\n목적과 조건:\n" + (v || "(아직 입력하지 않았습니다)") +
        "\n\n첨부 파일(이름만 기재, 파일 내용은 전달되지 않음):\n" + (files.length ? files.map((n) => "- " + n).join("\n") : "- 없음") +
        "\n\n요청 사항:\n- 이 요청에 필요한 전문가는 AGENT01이 선택해 주세요.\n- 부족한 정보는 먼저 질문해 주세요. 예: " + sel.ask +
        "\n- 결과는 적용 후보로만 제시하고, 적용은 제가 확인하고 승인한 뒤에 합니다. 원본은 변경하지 않습니다.\n- PLC 작업이 필요하면 AGENT01이 조정해 주세요.\n- 실제 설비 작업은 자격을 갖춘 담당자가 검토합니다.";
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
        '<p><button class="tc-btn tc-primary" id="elCopy" type="button">초안 복사</button> <span class="tc-muted" id="elCopyMsg" role="status" aria-live="polite"></span></p>' +
        '<p class="tc-muted">자동으로 전송되지 않습니다. 내용을 읽고 필요하면 고친 뒤, 복사해서 채팅창에 직접 붙여 넣어 보내세요.</p></div>';
      refreshDraft();
      $("#elInput").addEventListener("input", refreshDraft);
      $("#elFile").addEventListener("change", (e) => { files = Array.from(e.target.files || []).map((f) => f.name); refreshDraft(); });
      $("#elCopy").addEventListener("click", () => {
        const t = $("#elDraft").value, msg = $("#elCopyMsg");
        const done = (ok) => { msg.textContent = ok ? "복사했습니다. 채팅창에 붙여 넣어 직접 보내세요." : "복사하지 못했습니다. 초안을 선택해 직접 복사해 주세요."; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => done(true), () => done(false));
        else { $("#elDraft").select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} done(ok); }
      });
      $("#elStep2").scrollIntoView({ block: "nearest" });
    };
    document.querySelectorAll("[data-el]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.el)));

    const btn = $("#elConnect"), st = $("#elStatus"), tk = $("#elTalk"), slot = $("#elSlot");
    const TALKS = { idle: "대기", sending: "전송 중", waiting: "응답 대기", slow: "지연", timeout: "시간 초과", done: "응답 도착" };
    const paint = (s) => {
      btn.disabled = s.state === "connecting" || s.state === "online";
      btn.textContent = s.state === "error" || s.talk === "timeout" ? "다시 연결" : "AI 연결";
      if (s.talk === "timeout") btn.disabled = false;
      st.textContent = s.state === "connecting" ? "연결하는 중입니다..." : s.state === "online" ? "채팅 연결됨 (접속 성공만 뜻합니다)" : s.state === "error" ? s.message + " (잠시 후 [다시 연결]을 눌러 주세요)" : "아직 연결하지 않았습니다.";
      tk.textContent = s.talk === "slow" ? "응답이 오래 걸립니다. 계속 기다리거나 다시 요청할 수 있습니다." : s.talk === "timeout" ? "4분 동안 응답이 없었습니다. 요청을 다시 보내거나 [다시 연결]을 눌러 주세요." : s.talk === "done" ? "응답이 도착했습니다. 내용은 직접 확인한 뒤 승인해 주세요." : "";
      if (s.rendered && slot.firstChild !== TechChat.host) slot.appendChild(TechChat.host);
      const a01 = tcEffectiveStatus(TC_CHAT_TARGET.agent01);
      info("상태 (3가지 구분)",
        "<p><b>연결</b> " + (s.state === "online" ? badge("pass") + " 채팅 접속 성공" : s.state === "error" ? badge("fail") : badge("unverified") + " " + (s.state === "connecting" ? "연결 중" : "미연결")) + "</p>" +
        "<p><b>응답</b> " + esc(TALKS[s.talk] || "대기") + "</p>" +
        "<p><b>대상</b> " + esc(TC_CHAT_TARGET.label) + "<br>AGENT01 여부 " + badge(a01) + "</p>" +
        "<p><b>전문 에이전트 호출</b> " + badge("unverified") + "<br><span class='tc-muted'>확인 불가. 호출된 에이전트는 수집하지 않으며 추측해 표시하지 않습니다.</span></p>");
    };
    info("상태 (3가지 구분)", "<p class='tc-muted'>채팅 구성 요소를 불러오는 중입니다...</p>");
    btn.disabled = true;
    loadChat().then(() => {
      if (mine !== seq) return;
      btn.onclick = () => TechChat.connect(TechChat.getState().talk === "timeout");
      cleanup = TechChat.subscribe(paint);
      paint(TechChat.getState());
    }).catch(() => {
      if (mine !== seq) return;
      st.textContent = "채팅 구성 요소를 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.";
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
          (k.ready ? '<small class="tc-muted">PanelLab의 "' + esc(k.menu) + '" 메뉴에서 시작합니다.</small>' : "<small>" + badge("unverified") + " 준비 중 · 기능 미확인</small>") + "</a>";
      };
      $("#tcWork").innerHTML =
        "<h1>무엇을 작업할까요?</h1><p class='tc-lead'>처음 사용해도 괜찮습니다. 원하는 작업을 선택하면 AI가 안내합니다.</p>" +
        '<div class="tc-home">' +
        '<a class="tc-plc" href="#/tools/panellab"><span class="tc-tag">핵심 분야</span><div class="tc-plc-h">' + ICONS.ladder + "<h2>PLC 엔지니어링</h2></div>" +
        "<p>PLC 프로그램과 설비 자동화 작업을 PanelLab에서 시작합니다. 기존 작업은 그대로 유지됩니다.</p>" +
        '<ul class="tc-fn"><li>래더 작화</li><li>도면 분석</li><li>오류 검사</li><li>글로벌 라벨 관리</li><li>프로그램 검증 <small>미확인</small></li></ul>' +
        '<p class="tc-plc-note">기준: Mitsubishi GX Works2 · GX Works3은 검증 전 · CPU 모델 미정</p>' +
        '<span class="tc-btn tc-light">PLC 작업 시작하기</span></a>' +
        '<a class="tc-side-card" href="#/tools/panellab">' + ICONS.hmi + "<b>HMI 설계</b><span>터치 화면을 설계하고 PLC와 맞는지 검사합니다.</span><small>PanelLab의 HMI 작업실에서 시작</small></a>" +
        '<a class="tc-side-card" href="#/workroom">' + ICONS.ai + "<b>AGENT01 통합 AI 작업실</b><span>자연어로 요청하면 필요한 전문가 연결을 AGENT01이 맡도록 설계되었습니다.</span><small>" + badge("unverified") + " 채팅 대상·전문가 호출 미확인</small></a>" +
        "</div>" +
        "<h2 class='tc-sec'>대표 분야</h2><div class='tc-fields'>" +
        TC_FIELDS.map((f) => '<a class="tc-field' + (f.id === "plc-hmi" ? " main" : "") + '" href="#/field/' + f.id + '"><b>' + esc(f.name) + "</b>" + (f.id === "plc-hmi" ? "<small>핵심 분야</small>" : "") + "</a>").join("") + "</div>" +
        "<h2 class='tc-sec'>PLC 작업 바로 가기</h2><div class='tc-tasks'>" + TC_TASKS.map(task).join("") + "</div>" +
        "<h2 class='tc-sec'>처음 사용하시나요?</h2><ol class='tc-steps3'><li><b>1</b> 원하는 작업을 선택합니다.</li><li><b>2</b> AI가 필요한 내용을 쉬운 말로 질문합니다.</li><li><b>3</b> 결과를 확인하고 직접 승인합니다.</li></ol>" +
        "<h2 class='tc-sec'>최근 작업</h2>" +
        (ps.length ? '<ul class="tc-list">' + ps.map((p) => "<li><span>" + esc(p.name) + "</span><span class='tc-muted'>" + esc(p.updated ? new Date(p.updated).toLocaleDateString("ko-KR") : "") + " · PanelLab · 검증 전</span></li>").join("") + "</ul>"
          : "<p class='tc-muted'>표시할 작업이 없습니다. (이 브라우저에 저장된 PanelLab 프로젝트만 읽습니다.)</p>") +
        "<h2 class='tc-sec'>시스템 상태</h2><ul class='tc-list'>" +
        "<li><span>PanelLab 프로젝트(이 브라우저 저장분)</span><span>" + all.length + "개</span></li>" +
        "<li><span>AI 채팅 연결</span><span>" + badge("unverified") + "</span></li>" +
        "<li><span>채팅 대상이 AGENT01인지</span><span>" + badge("unverified") + "</span></li>" +
        "<li><span>전문 에이전트 호출</span><span>" + badge("unverified") + "</span></li></ul>" +
        (beginner() ? "" : '<p class="tc-muted">전문 에이전트 계획 ' + TC_PLANNED_AGENTS + "개 / 연결 확인됨 " + linked + "개 / 사용자 보고 분야 " + reported + "개(미확인)</p>") +
        safety();
      info("빠른 도움말", "<ul class='tc-list'><li><a href='#/help'>처음 사용 가이드</a></li><li><a href='#/field/plc-hmi'>PLC 작업 순서</a></li><li><a href='#/help'>용어 설명</a></li></ul>");
    },

    workroom() {
      const mine = seq;
      $("#tcWork").innerHTML =
        "<h1>통합 AI 작업실</h1><p class='tc-muted'>AI 에이전트에게 자연어로 업무를 요청하는 공간입니다.</p>" +
        '<div class="tc-safe"><b>연결 대상: AI Creative Agent</b> 이 에이전트가 AGENT 01인지, 전문 에이전트를 호출하는지는 확인되지 않았습니다. 응답은 참고용 후보이며 사용자 승인 없이 적용되지 않습니다.</div>' +
        tip("아래 [AI 연결] 버튼을 누르면 채팅이 시작됩니다. 하고 싶은 일을 문장으로 적어 보세요.") +
        '<div class="tc-chips">' + TC_FIELDS.map((f) => '<a class="tc-chip" href="#/field/' + f.id + '">' + esc(f.name) + "</a>").join("") + "</div>" +
        '<div class="tc-card"><p><button class="tc-btn tc-primary" id="tcChatConnect" type="button">AI 연결</button> <span class="tc-muted" id="tcChatStatus" role="status" aria-live="polite"></span></p>' +
        '<p class="tc-muted" id="tcChatTalk" aria-live="polite"></p><div id="tcChatSlot"></div></div>';
      const btn = $("#tcChatConnect"), st = $("#tcChatStatus"), tk = $("#tcChatTalk"), slot = $("#tcChatSlot");
      const TALK = {
        sending: "요청을 보내는 중입니다...",
        waiting: "에이전트 응답을 기다리는 중입니다...",
        slow: "응답이 오래 걸리고 있습니다. 계속 기다리거나, 4분이 지나면 다시 요청해 주세요.",
        timeout: "4분 동안 응답이 없었습니다. 채팅창에 요청을 다시 입력해 주세요. 계속되면 [다시 연결]을 눌러 주세요.",
        done: "응답이 도착했습니다. 내용은 직접 확인한 뒤 승인해 주세요.",
      };
      const paint = (s) => {
        btn.disabled = s.state === "connecting" || s.state === "online";
        btn.textContent = s.state === "error" || s.talk === "timeout" ? "다시 연결" : "AI 연결";
        if (s.talk === "timeout") btn.disabled = false;
        st.textContent = s.state === "connecting" ? "연결하는 중입니다..." : s.state === "online" ? "연결됨 (이 세션에서 연결 성공)" : s.state === "error" ? s.message + " (잠시 후 [다시 연결]을 눌러 주세요)" : "아직 연결하지 않았습니다.";
        tk.textContent = TALK[s.talk] || "";
        if (s.rendered && slot.firstChild !== TechChat.host) slot.appendChild(TechChat.host);
        info("연결 상태",
          "<p>연결 " + (s.state === "online" ? badge("pass") : badge("unverified")) + "<br><span class='tc-muted'>토큰 발급과 채팅 연결 성공 여부만 뜻합니다.</span></p>" +
          "<p>에이전트 호출 " + badge("unverified") + "<br><span class='tc-muted'>호출된 전문 에이전트는 확인할 수 없어 표시하지 않습니다.</span></p>");
      };
      info("연결 상태", "<p class='tc-muted'>채팅 구성 요소를 불러오는 중입니다...</p>");
      btn.disabled = true;
      loadChat().then(() => {
        if (mine !== seq) return;
        btn.onclick = () => TechChat.connect(TechChat.getState().talk === "timeout");
        cleanup = TechChat.subscribe(paint);
        paint(TechChat.getState());
      }).catch(() => {
        if (mine !== seq) return;
        st.textContent = "채팅 구성 요소를 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.";
      });
    },

    projects() {
      const ps = panellabProjects();
      $("#tcWork").innerHTML =
        "<h1>프로젝트 관리</h1><p class='tc-muted'>프로젝트 개요, 요구사항, 참여 분야·에이전트, 진행, 설계 자료, 검사 결과, 변경 이력, 최종 산출물을 관리할 예정입니다.</p>" +
        '<div class="tc-tip">TECHCORE 프로젝트 기능은 서버 저장소 도입 후 제공됩니다. 아래는 이 브라우저에 저장된 PanelLab 프로젝트(읽기 전용)입니다.</div>' +
        "<h2>PanelLab 프로젝트</h2>" +
        (ps.length ? '<div class="tc-tablewrap"><table class="tc-table"><tr><th>이름</th><th>소프트웨어</th><th>수정일</th></tr>' +
          ps.map((p) => "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.software || "") + "</td><td>" + esc(p.updated ? new Date(p.updated).toLocaleString("ko-KR") : "") + "</td></tr>").join("") + "</table></div>"
          : "<p class='tc-muted'>표시할 프로젝트가 없습니다.</p>") +
        '<p><a class="tc-btn" href="#/tools/panellab">PanelLab에서 프로젝트 편집</a></p>';
      info("안내", "<p class='tc-muted'>프로젝트 편집은 PanelLab에서만 합니다. 여기서는 데이터를 수정하지 않습니다.</p>");
    },

    field(id) {
      const old = TC_FIELD_ALIAS[id];
      const f = TC_FIELDS.find((x) => x.id === (old ? old.to : id));
      if (!f) { $("#tcWork").innerHTML = "<h1>분야를 찾을 수 없습니다.</h1>"; return; }
      id = f.id;
      if (id === "electric") { elecRoom(old); return; }
      const agents = TC_AGENTS.filter((a) => a.field === f.name);
      const guide = (title, steps) => "<h2 class='tc-sec'>" + title + "</h2><ol class='tc-list tc-num'>" +
        steps.map((s) => "<li><span><b>" + esc(s.t) + "</b><br><span class='tc-muted'>" + esc(s.d) + "</span></span>" + (s.ready ? "" : badge("unverified")) + "</li>").join("") + "</ol>";
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
        '<div class="tc-card"><h2>전문 에이전트</h2>' + (agents.length ? agents.map((a) => esc(a.name)).join("<br>") : "<span class='tc-muted'>확인된 에이전트가 없습니다.</span>") + "</div>" +
        '<div class="tc-card"><h2>새 작업 시작</h2><button class="tc-btn tc-primary" disabled title="AGENT 01 연결 후 사용 가능">새 작업</button></div>' +
        '<div class="tc-card"><h2>프로젝트 · 결과 · 파일</h2><span class="tc-muted">서버 저장소 도입 후 제공됩니다.</span></div>' +
        '<div class="tc-card"><h2>전문 도구</h2>' + (f.tool === "panellab" ? '<a class="tc-btn" href="#/tools/panellab">PanelLab 열기</a>' : "<span class='tc-muted'>등록된 도구가 없습니다.</span>") + "</div>" +
        "</div>" + safety();
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
        "<h1>에이전트 관리</h1><p class='tc-muted'>계획 " + TC_PLANNED_AGENTS + "개 중 이 목록에는 등록된 항목만 표시됩니다.</p>" +
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
        "<h1>작업 이력 및 검증</h1><p class='tc-muted'>검증은 5단계로 구분합니다. 수행하지 않은 단계는 완료로 표시하지 않습니다.</p>" +
        '<div class="tc-tablewrap"><table class="tc-table"><tr><th>단계</th><th>상태</th></tr>' +
        TC_VALIDATION_STAGES.map((s) => "<tr><td>" + esc(s) + "</td><td><span class='tc-badge'>미수행</span></td></tr>").join("") + "</table></div>" +
        "<p class='tc-muted'>기록된 작업 이력이 없습니다.</p>" + safety();
      info("안내", "<p class='tc-muted'>시뮬레이션과 실제 환경 검증은 별도 환경에서 사용자가 수행해야 합니다.</p>");
    },

    tools(sub) {
      if (sub === "panellab") {
        const narrow = window.matchMedia("(max-width:900px)").matches;
        $("#tcWork").innerHTML =
          "<h1>PanelLab</h1><p class='tc-muted'>PLC · HMI 전문 작업실입니다. 기존 PanelLab이 그대로 열립니다. <a href='" + PANELLAB_URL + "' target='_blank' rel='noopener'>새 창에서 열기</a></p>" +
          (narrow
            ? '<div class="tc-card"><p>화면이 좁아 PanelLab을 여기에 함께 표시하지 않습니다. 새 탭에서 열면 더 편하게 작업할 수 있습니다.</p><a class="tc-btn tc-primary" href="' + PANELLAB_URL + '" target="_blank" rel="noopener">PanelLab 새 탭에서 열기</a></div>'
            : '<iframe class="tc-frame" title="PanelLab" loading="lazy" src="' + PANELLAB_URL + '"></iframe>');
        info("PanelLab 안내", "<p class='tc-muted'>PanelLab의 작업과 데이터는 독립 주소에서도 동일하게 유지됩니다. 이 화면은 기존 PanelLab을 변경하지 않고 표시만 합니다.</p>");
        return;
      }
      $("#tcWork").innerHTML =
        "<h1>엔지니어링 도구</h1><div class='tc-grid'>" +
        '<div class="tc-card tc-click"><a class="tc-link" href="#/tools/panellab"><b>PanelLab</b><br><span class="tc-muted">' + term("PLC") + " 코드·" + term("래더") + "·" + term("HMI") + " 작업실</span></a></div></div>";
      info("안내", "<p class='tc-muted'>추가 도구는 확인 후 등록됩니다.</p>");
    },

    settings() {
      $("#tcWork").innerHTML =
        "<h1>시스템 설정</h1>" +
        '<div class="tc-card"><h2>로그인 (Microsoft Entra ID)</h2><p>' + (authConfigured() ? badge("unverified") + " 설정값 입력됨, 동작 미검증" : "<span class='tc-badge warn'>미설정</span>") +
        '</p><p class="tc-muted">다수 사용자 지원을 위해 Entra ID 로그인을 사용합니다. 앱 등록과 API 검증 서버가 준비되면 활성화됩니다. 정적 페이지 접근 자체는 인증으로 막을 수 없으며, 서버 API 호출 권한을 통제합니다.</p></div>' +
        '<div class="tc-card" style="margin-top:12px"><h2>사용 모드</h2><p class="tc-muted">현재: ' + (beginner() ? "초보자" : "전문가") + "</p></div>" +
        (beginner() ? "" : '<div class="tc-card" style="margin-top:12px"><h2>상세 정보</h2><p class="tc-muted">저장소 키 <code>techcore.v1</code>. PanelLab 데이터 키 <code>panellab.v1</code>은 읽기만 합니다. 브라우저에는 비밀키를 저장하지 않습니다.</p></div>');
      info("안내", "<p class='tc-muted'>인증 토큰과 API 키는 브라우저 코드에 저장하지 않습니다.</p>");
    },

    help() {
      $("#tcWork").innerHTML =
        "<h1>도움말</h1>" +
        "<h2>처음 시작하기</h2><ol class='tc-steps'><li>왼쪽 메뉴(모바일은 아래 탭)에서 하고 싶은 일을 고릅니다.</li><li>PLC · HMI 작업은 <a href='#/tools/panellab'>엔지니어링 도구 &gt; PanelLab</a>을 엽니다.</li><li>AI 결과는 후보입니다. 내용을 확인한 뒤 직접 승인하세요.</li></ol>" +
        "<h2>메뉴 안내</h2><ul><li><b>홈</b>: 시작 화면</li><li><b>새 작업</b>: AI 작업실과 4개 작업 분야</li><li><b>내 작업</b>: 프로젝트, 작업 이력·검증, 문서</li><li><b>엔지니어링 도구</b>: PanelLab</li><li><b>전문가 영역</b>: 에이전트 관리, 시스템 설정 (전문가 모드에서 메뉴에 표시, 주소로는 항상 접근 가능)</li></ul>" +
        "<h2>용어 설명</h2><ul>" + Object.keys(TC_GLOSSARY).map((k) => "<li><b>" + esc(k) + "</b>: " + esc(TC_GLOSSARY[k]) + "</li>").join("") + "</ul>" +
        "<h2>자주 하는 일</h2><ul>" + TC_HELP_QA.map((x) => "<li><a href='" + x.route + "'>" + esc(x.q) + "</a> - " + esc(x.a) + "</li>").join("") + "</ul>" + safety();
      info("도움말", "<p class='tc-muted'>상단 검색창에 하고 싶은 일을 적어도 됩니다.</p>");
    },
  };

  function route(force) {
    const r = (location.hash.replace(/^#\/?/, "") || "dashboard");
    const [name, arg] = r.split("/");
    const v = views[name] ? name : "dashboard";
    const key = views[name] ? r : "dashboard";
    if (!force && key === lastKey) return;
    lastKey = key;
    if (cleanup) { cleanup(); cleanup = null; }
    seq++;
    renderNav(TC_FIELD_ALIAS[arg] && name === "field" ? "field/" + TC_FIELD_ALIAS[arg].to : key);
    views[v](arg);
    $("#tcSide").classList.remove("open"); $("#tcScrim").classList.remove("open");
    $("#tcWork").scrollTop = 0;
  }

  function applyChrome() {
    $("#tcModeBeginner").classList.toggle("on", beginner());
    $("#tcModeExpert").classList.toggle("on", !beginner());
    $("#tcInfo").classList.toggle("closed", !state.panelOpen);
  }

  $("#tcModeBeginner").onclick = () => { state.mode = "beginner"; save(); applyChrome(); route(true); };
  $("#tcModeExpert").onclick = () => { state.mode = "expert"; save(); applyChrome(); route(true); };
  $("#tcPanelBtn").onclick = () => { state.panelOpen = !state.panelOpen; save(); applyChrome(); };
  $("#tcMenuBtn").onclick = () => { $("#tcSide").classList.add("open"); $("#tcScrim").classList.add("open"); };
  $("#tcScrim").onclick = () => { $("#tcSide").classList.remove("open"); $("#tcScrim").classList.remove("open"); };
  $("#tcHelpBtn").onclick = () => { location.hash = "#/help"; };
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
  route();
})();
