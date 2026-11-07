(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "techcore.v1";
  const PANELLAB_URL = "../";

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

  const MENU = [
    { r: "dashboard", t: "대시보드" },
    { r: "workroom", t: "통합 AI 작업실" },
    { r: "projects", t: "프로젝트 관리" },
    { grp: "전문 분야" },
    ...TC_FIELDS.map((f) => ({ r: "field/" + f.id, t: f.name, sub: true })),
    { r: "agents", t: "에이전트 관리" },
    { r: "docs", t: "도면 및 문서 관리" },
    { r: "history", t: "작업 이력 및 검증" },
    { r: "tools", t: "엔지니어링 도구" },
    { r: "settings", t: "시스템 설정" },
  ];

  function renderNav(route) {
    let html = "", sub = "";
    const flush = () => { if (sub) { html += '<div class="sub">' + sub + "</div>"; sub = ""; } };
    MENU.forEach((m) => {
      if (m.grp) { flush(); html += '<div class="grp">' + m.grp + "</div>"; return; }
      const a = '<a href="#/' + m.r + '"' + (route === m.r || (m.r === "tools" && route.startsWith("tools/")) ? ' class="active"' : "") + ">" + esc(m.t) + "</a>";
      if (m.sub) sub += a; else { flush(); html += a; }
    });
    flush();
    $("#tcNav").innerHTML = html;
  }

  function info(title, body) { $("#tcInfo").innerHTML = "<section><h3>" + esc(title) + "</h3>" + body + "</section>"; }

  const views = {
    dashboard() {
      const ps = panellabProjects();
      const confirmed = TC_AGENTS.filter((a) => a.connection === "pass").length;
      const reported = TC_FIELDS.filter((f) => f.reported).length;
      $("#tcWork").innerHTML =
        "<h1>대시보드</h1><p class='tc-muted'>TECHCORE AI 현황입니다. 계획 수량과 실제 확인된 수량을 구분해서 보여 줍니다.</p>" +
        tip("처음이신가요? 왼쪽 메뉴의 <b>통합 AI 작업실</b>에서 하고 싶은 일을 문장으로 적어 보세요. PLC 작업은 <b>엔지니어링 도구</b>에서 PanelLab을 여세요.") +
        "<div class='tc-grid'>" +
        '<div class="tc-card tc-stat"><span class="tc-muted">에이전트 (계획)</span><b>' + TC_PLANNED_AGENTS + "</b></div>" +
        '<div class="tc-card tc-stat"><span class="tc-muted">에이전트 (연결 확인됨)</span><b>' + confirmed + "</b></div>" +
        '<div class="tc-card tc-stat"><span class="tc-muted">사용자 보고 분야 (미확인)</span><b>' + reported + "</b></div>" +
        '<div class="tc-card tc-stat"><span class="tc-muted">PanelLab 프로젝트 (이 브라우저)</span><b>' + ps.length + "</b></div>" +
        '<div class="tc-card tc-stat"><span class="tc-muted">승인 대기 작업</span><b>0</b></div>' +
        '<div class="tc-card tc-stat"><span class="tc-muted">오류·검토 필요</span><b>0</b></div>' +
        "</div>" +
        '<div class="tc-card"><h2>AGENT 01 상태</h2>' + badge("unverified") + '<span class="tc-muted"> 아직 연결이 확인되지 않았습니다.</span></div>' +
        "<h2 style='margin-top:20px'>기술 분야 바로가기</h2><div class='tc-grid'>" +
        TC_FIELDS.map((f) => '<div class="tc-card tc-click"><a class="tc-link" href="#/field/' + f.id + '"><b>' + f.no + ". " + esc(f.name) + "</b><br>" + (f.reported ? badge("reported") : badge("unverified")) + "</a></div>").join("") +
        "</div>" + safety();
      info("최근 작업", "<p class='tc-muted'>아직 TECHCORE에서 실행한 작업이 없습니다.</p>");
    },

    workroom() {
      $("#tcWork").innerHTML =
        "<h1>통합 AI 작업실</h1><p class='tc-muted'>AGENT 01에게 자연어로 업무를 요청하는 공간입니다.</p>" +
        '<div class="tc-safe"><b>AGENT 01 미연결</b> 연결이 확인되기 전까지 요청을 보낼 수 없습니다. 연결 방식(Copilot Studio 인증, 호출 한도)은 확인 후 적용합니다.</div>' +
        tip("연결되면 이렇게 사용합니다: ① 요청 입력 ② 호출된 전문 에이전트 확인 ③ 결과 검토 ④ 직접 승인.") +
        '<div class="tc-card"><textarea rows="4" style="width:100%" disabled placeholder="예: 컨베이어 2대 순차 기동 래더를 검토해 주세요."></textarea>' +
        '<p><button class="tc-btn" disabled title="AGENT 01 연결 전에는 사용할 수 없습니다">파일 첨부</button> <button class="tc-btn tc-primary" disabled title="AGENT 01 연결 전에는 사용할 수 없습니다">요청 보내기</button></p></div>';
      info("호출된 에이전트", "<p class='tc-muted'>아직 호출된 에이전트가 없습니다.</p>" + badge("unverified"));
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
      const f = TC_FIELDS.find((x) => x.id === id);
      if (!f) { $("#tcWork").innerHTML = "<h1>분야를 찾을 수 없습니다.</h1>"; return; }
      const agents = TC_AGENTS.filter((a) => a.field === f.name);
      $("#tcWork").innerHTML =
        "<h1>" + f.no + ". " + esc(f.name) + "</h1><p>" + esc(f.intro) + "</p>" +
        (f.reported ? '<p>' + badge("reported") + '<span class="tc-muted"> 이 분야의 에이전트는 구축된 것으로 보고되었으나, 실제 연결은 확인되지 않았습니다.</span></p>' : "<p>" + badge("unverified") + "</p>") +
        tip("이 분야의 업무는 PLC와 관계없이 독립적으로 시작할 수 있습니다.") +
        '<div class="tc-grid">' +
        '<div class="tc-card"><h2>전문 에이전트</h2>' + (agents.length ? agents.map((a) => esc(a.name)).join("<br>") : "<span class='tc-muted'>확인된 에이전트가 없습니다.</span>") + "</div>" +
        '<div class="tc-card"><h2>새 작업 시작</h2><button class="tc-btn tc-primary" disabled title="AGENT 01 연결 후 사용 가능">새 작업</button></div>' +
        '<div class="tc-card"><h2>프로젝트 · 결과 · 파일</h2><span class="tc-muted">서버 저장소 도입 후 제공됩니다.</span></div>' +
        '<div class="tc-card"><h2>전문 도구</h2>' + (f.tool === "panellab" ? '<a class="tc-btn" href="#/tools/panellab">PanelLab 열기</a>' : "<span class='tc-muted'>등록된 도구가 없습니다.</span>") + "</div>" +
        "</div>";
      info(f.name, "<p class='tc-muted'>" + esc(f.intro) + "</p>");
    },

    agents() {
      const row = (a) => "<tr><td>" + esc(a.no) + "</td><td>" + esc(a.name) + "</td><td>" + esc(a.role) + "</td><td>" + esc(a.field) + "</td><td>" + badge(a.connection) + "</td><td>" + badge(a.roleCheck) + "</td><td>" + badge(a.workTest) + "</td><td>" + badge(a.verification) + "</td><td class='tc-muted'>기록 없음</td></tr>";
      $("#tcWork").innerHTML =
        "<h1>에이전트 관리</h1><p class='tc-muted'>계획 " + TC_PLANNED_AGENTS + "개 중 이 목록에는 등록된 항목만 표시됩니다.</p>" +
        tip("<b>연결 확인</b>(호출이 되는지), <b>역할 확인</b>(맡은 일을 설명하는지), <b>업무 테스트</b>(샘플 업무 수행), <b>실제 검증</b>(현장·전문 프로그램 확인)은 서로 다른 단계입니다.") +
        '<div class="tc-tablewrap"><table class="tc-table"><tr><th>번호</th><th>이름</th><th>역할</th><th>분야</th><th>연결 확인</th><th>역할 확인</th><th>업무 테스트</th><th>실제 검증</th><th>호출 기록</th></tr>' +
        TC_AGENTS.map(row).join("") + "</table></div>" +
        '<p class="tc-muted">MCP·도구 연결 상태는 아직 확인되지 않았습니다.</p>';
      info("상태 설명", "<p>" + badge("unverified") + " 확인한 적 없음<br>" + badge("reported") + " 사용자 보고만 있음<br>" + badge("pass") + " 확인됨<br>" + badge("fail") + " 실패</p>");
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
        $("#tcWork").innerHTML =
          "<h1>PanelLab</h1><p class='tc-muted'>PLC · HMI 전문 작업실입니다. 기존 PanelLab이 그대로 열립니다. <a href='" + PANELLAB_URL + "' target='_blank' rel='noopener'>새 창에서 열기</a></p>" +
          '<iframe class="tc-frame" title="PanelLab" src="' + PANELLAB_URL + '"></iframe>';
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
        "<h2>처음 시작하기</h2><ol class='tc-steps'><li>왼쪽 메뉴에서 하고 싶은 일을 고릅니다.</li><li>PLC · HMI 작업은 <a href='#/tools/panellab'>엔지니어링 도구 &gt; PanelLab</a>을 엽니다.</li><li>AI 결과는 후보입니다. 내용을 확인한 뒤 직접 승인하세요.</li></ol>" +
        "<h2>용어 설명</h2><ul>" + Object.keys(TC_GLOSSARY).map((k) => "<li><b>" + esc(k) + "</b>: " + esc(TC_GLOSSARY[k]) + "</li>").join("") + "</ul>" +
        "<h2>자주 하는 일</h2><ul>" + TC_HELP_QA.map((x) => "<li><a href='" + x.route + "'>" + esc(x.q) + "</a> - " + esc(x.a) + "</li>").join("") + "</ul>" + safety();
      info("도움말", "<p class='tc-muted'>상단 검색창에 하고 싶은 일을 적어도 됩니다.</p>");
    },
  };

  function route() {
    const r = (location.hash.replace(/^#\/?/, "") || "dashboard");
    const [name, arg] = r.split("/");
    const v = views[name] ? name : "dashboard";
    renderNav(r in views ? r : r);
    views[v](arg);
    $("#tcSide").classList.remove("open"); $("#tcScrim").classList.remove("open");
    $("#tcWork").scrollTop = 0;
  }

  function applyChrome() {
    $("#tcModeBeginner").classList.toggle("on", beginner());
    $("#tcModeExpert").classList.toggle("on", !beginner());
    $("#tcInfo").classList.toggle("closed", !state.panelOpen);
  }

  $("#tcModeBeginner").onclick = () => { state.mode = "beginner"; save(); applyChrome(); route(); };
  $("#tcModeExpert").onclick = () => { state.mode = "expert"; save(); applyChrome(); route(); };
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

  window.addEventListener("hashchange", route);
  if (window.innerWidth <= 900) state.panelOpen = false;
  applyChrome();
  route();
})();
