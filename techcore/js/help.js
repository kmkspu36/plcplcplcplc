// TechHelp: help center pages (guides, GX Works2, agent roles, video library). Content only; nothing here claims a feature or video is verified.
const TechHelp = (() => {
  const TABS = [
    { id: "", t: "사용법" }, { id: "beginner", t: "초보자 가이드" }, { id: "expert", t: "전문가 가이드" },
    { id: "rooms", t: "작업실 안내" }, { id: "gxworks2", t: "GX Works2 안내" }, { id: "roles", t: "에이전트 역할" }, { id: "videos", t: "동영상" },
  ];
  const GX_SOURCE = "https://www.mitsubishielectric.com/fa/products/cnt/plceng/smerit/gx_works2/index.html";
  const GX_CHECKED = "2026-11-09";

  // kind "own": TECHCORE tutorial videos, none produced yet. kind "ext": external education; only a search link to the original site, no embed.
  const OWN = ["플랫폼 소개", "메뉴 사용법", "AI 작업실", "PLC 도면 분석", "래더 설계", "전문가 모드", "프로젝트 관리"];
  const EXT = [
    { t: "GX Works2 기초", f: "plc", q: "GX Works2 기초 사용법" },
    { t: "PLC 래더 기초", f: "plc", q: "PLC 래더 기초 강의" },
    { t: "전기 도면 읽기", f: "plc", q: "전기 도면 읽는 법" },
    { t: "HMI 기초", f: "hmi", q: "HMI 터치 화면 기초" },
    { t: "전기 기초", f: "elec", q: "전기 기초 강의" },
    { t: "전자 회로 기초", f: "elec", q: "전자 회로 기초 강의" },
  ];
  const FIELD = { plc: "PLC", hmi: "HMI", elec: "전기·전자", all: "공통" };
  const VIDEOS = OWN.map((t) => ({ kind: "own", t, f: "all", d: "TECHCORE AI 사용법 영상" }))
    .concat(EXT.map((x) => ({ kind: "ext", t: x.t, f: x.f, d: "외부 교육 자료 검색 바로가기", url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(x.q), provider: "YouTube 검색 결과" })));

  const li = (arr, esc) => "<ul>" + arr.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";

  function usage(c) {
    return "<h2>TECHCORE AI 사용법</h2><ol class='tc-steps'><li>왼쪽 메뉴에서 하고 싶은 일을 고릅니다.</li><li>PLC·HMI 작업은 <a href='#/tools/panellab'>AI 작업실 &gt; PLC·HMI 작업실</a>을 엽니다.</li><li>요청은 AGENT01 하나에게 합니다. 필요한 전문가는 AGENT01이 내부적으로 선택합니다.</li><li>AI 결과는 후보입니다. 내용을 확인한 뒤 직접 승인하세요.</li></ol>" +
      "<h2>메뉴 안내</h2><ul><li><b>홈</b>: 시작 화면, 최근 프로젝트</li><li><b>AI 작업실</b>: AGENT01 통합 채팅, PLC·HMI 작업실, 분야별 작업실</li><li><b>내 작업</b>: 프로젝트, 휴지통, 작업 이력, 문서</li><li><b>도움말</b>: 이 화면</li><li><b>설정</b>: 모드, PLC 기본 환경, 백업</li><li><b>소개</b>: 플랫폼 목적과 구조</li></ul>" +
      "<h2>용어 설명</h2><ul>" + Object.keys(TC_GLOSSARY).map((k) => "<li><b>" + c.esc(k) + "</b>: " + c.esc(TC_GLOSSARY[k]) + "</li>").join("") + "</ul>" +
      "<h2>자주 하는 일</h2><ul>" + TC_HELP_QA.map((x) => "<li><a href='" + x.route + "'>" + c.esc(x.q) + "</a> - " + c.esc(x.a) + "</li>").join("") + "</ul>";
  }

  function beginner(c) {
    return "<h2>초보자 가이드</h2><p class='tc-muted'>처음이어도 괜찮습니다. 아래 순서대로 따라 해 보세요.</p>" +
      "<h3>작업 순서</h3><ol class='tc-steps'><li>무엇을 만들거나 확인하고 싶은지 한 문장으로 적습니다. 예) 시작 버튼을 누르면 모터가 켜지게 하고 싶어요.</li><li>사용할 장치(버튼, 모터, 센서)와 동작 순서를 적습니다. 부족하면 AI가 질문합니다.</li><li>AI가 만든 결과 후보를 읽습니다.</li><li>모르는 말은 다시 물어봅니다.</li><li>맞다고 판단하면 직접 승인합니다. 승인 전에는 원본에 적용되지 않습니다.</li></ol>" +
      "<h3>올리면 좋은 자료</h3>" + li(["전기 도면 이미지나 PDF (읽기 어려운 부분은 AI가 추측하지 않고 확인을 요청합니다)", "장치 목록(입력·출력 이름과 번호)", "원하는 동작을 적은 글"], c.esc) +
      "<p class='tc-muted'>지원되는 파일 형식은 아직 확인되지 않았습니다. 업로드 방식은 작업실 화면의 안내를 따라 주세요.</p>" +
      "<h3>결과 읽는 법</h3>" + li(["핵심 요약을 먼저 읽습니다.", "문제와 해결 방향이 이해되는지 확인합니다.", "다음 작업 안내를 따라 진행합니다.", "'미확인'이라고 적힌 부분은 AI가 확인하지 못한 부분입니다."], c.esc) +
      "<h3>전기·전자 설계 편집기</h3>" + li(["전기·전자 작업실의 [설계 편집기] 탭에서 부품을 놓고 핀끼리 연결해 간단한 회로 그림을 그릴 수 있습니다.", "AI에게 초안을 요청할 수 있으며, 결과는 미리보기를 확인한 뒤 [새 설계로 추가]를 눌러야 들어옵니다. 기존 설계는 바뀌지 않습니다.", "[점검하기]는 사이트의 형식 점검(연결 안 된 핀 등)일 뿐 회로가 안전하거나 정상 동작한다는 보증이 아닙니다.", "내보내기는 SVG와 JSON만 지원합니다. 설계는 이 브라우저에만 저장되므로 JSON 백업을 내려받아 두세요."], c.esc);
  }

  function expert(c) {
    return "<h2>전문가 가이드</h2><p class='tc-muted'>전문가 모드는 설명이 길어지는 것이 아니라 요청하는 분석 항목이 늘어납니다.</p>" +
      "<h3>전문가 모드 분석 항목</h3><ol class='tc-list'>" + TechAnalysis.items("expert").map((x) => "<li><b>" + c.esc(x.t) + "</b> <span class='tc-muted'>" + c.esc(x.d) + "</span></li>").join("") + "</ol>" +
      "<p>항목마다 '수행 / 미수행 / 미확인'을 먼저 표시하게 요청합니다. 수행하지 않은 분석은 수행했다고 표시되지 않아야 하며, 실제 수행 여부는 답변의 근거로 직접 확인하세요.</p>" +
      "<h3>검증 단계 기준(L1~L5)</h3><ul><li><b>L1</b> AGENT01 내부 자체 검토</li><li><b>L2</b> 요구사항·체크리스트 대조</li><li><b>L3</b> 독립된 검토자 또는 독립 절차의 검토</li><li><b>L4</b> 실제 전문 도구 실행</li><li><b>L5</b> 통제된 실제 환경 시험</li></ul>" +
      "<p class='tc-muted'>증거 없이 완료로 표시하지 않습니다. 이 화면은 기준 설명이며 실제 수행 결과를 뜻하지 않습니다. 실제 근거는 '내 작업 > 작업 이력 및 검증'에서 기록한 것만 표시됩니다. GX Works2 가져오기 호환성은 실제 프로그램 시험 전이므로 " + c.badge("unverified") + " 입니다.</p>" +
      "<h3>검증 기록의 한계</h3>" + li(["L3 기록은 'AGENT01·자체·self·본인' 같은 단어가 든 이름만 문자열 패턴으로 막습니다. 다른 이름의 자체 검토는 걸러내지 못하므로 독립성은 사용자가 판단해야 합니다.", "기록은 사용자가 입력한 근거 기준이며 사이트가 직접 검증한 것이 아닙니다.", "L1~L5 기록은 프로젝트별이 아닌 공통 기록입니다."], c.esc);
  }

  function rooms(c) {
    return "<h2>작업실 안내</h2>" + TC_FIELDS.map((f) => "<div class='tc-card'><h3>" + c.esc(f.name) + "</h3><p class='tc-muted'>" + c.esc(f.intro) + "</p><p><a class='tc-btn' href='" + (f.tool === "panellab" ? "#/tools/panellab" : "#/field/" + f.id) + "'>" + (f.tool === "panellab" ? "PLC·HMI 작업실 열기" : "작업실 열기") + "</a></p></div>").join("") +
      "<p class='tc-muted'>모든 작업실의 요청은 AGENT01 하나의 채팅으로 처리합니다.</p>" +
      "<h3>작업실별 도구 현황</h3>" + li(["PLC·HMI: PanelLab(래더 직접 편집은 미구현, AI 요청·분석·HMI 편집 제공)", "전기·전자: 설계 편집기(SVG/JSON 내보내기, 정적 점검, 스냅샷)", "기계·소프트웨어: 전용 편집 도구 준비 중(요청 초안과 채팅만 제공)"], c.esc);
  }

  function gx(c) {
    return "<h2>GX Works2 안내</h2><div class='tc-safe'>이 페이지의 GX Works2 사실은 Mitsubishi Electric 공식 제품 페이지 기준입니다. 확인일: " + GX_CHECKED + ". <a href='" + GX_SOURCE + "' target='_blank' rel='noopener noreferrer'>공식 페이지 열기</a></div>" +
      "<h3>GX Works2란?</h3><p>Mitsubishi Electric의 MELSEC PLC용 엔지니어링 소프트웨어입니다. 공식 페이지는 시스템 설계, 프로그래밍, 디버그, 유지보수까지의 PLC 엔지니어링을 하나의 패키지로 지원한다고 설명합니다.</p>" +
      "<h3>공식 페이지에 적힌 주요 특징</h3>" + li(["지능형 기능 모듈 설정과 시뮬레이션 기능을 하나의 패키지에 통합", "고기능·고성능 CPU와 모듈을 활용할 수 있음", "기존 GX Developer 프로그램 자산을 수정 없이 사용할 수 있고, GX Works2로 쓴 프로그램은 GX Developer로 읽을 수 있음", "국제 표준 IEC 61131-3 준수, 래더·SFC·ST 등 언어 지원 및 한 프로그램 안에서 혼용 가능"], c.esc) +
      "<h3>PLC와 래더 기초</h3><p><b>PLC</b>: " + c.esc(TC_GLOSSARY.PLC) + "</p><p><b>래더</b>: " + c.esc(TC_GLOSSARY["래더"]) + "</p>" +
      "<h3>TECHCORE AI와 GX Works2의 차이</h3>" + li(["GX Works2는 PLC 프로그램을 실제로 작성·컴파일·전송하는 공식 도구입니다.", "TECHCORE AI는 설계와 분석을 돕는 후보를 만들며, GX Works2를 대체하지 않습니다.", "TECHCORE AI의 검사는 GX Works2 컴파일이나 실제 설비 검증이 아닙니다."], c.esc) +
      "<h3>TECHCORE AI의 PLC 기준</h3><ul><li>지원 대상: GX Works2만 (GX Works3은 지원 대상 아님)</li><li>CPU 모델: 미정 (설정에서 지정)</li><li>X/Y 디바이스 진수 표기, 32비트 카운터(C200 이상 등)의 설정 범위는 CPU별로 달라 사이트 검사에서는 '확인 필요'로만 표시합니다.</li><li>GX Works2 가져오기 호환성: " + c.badge("unverified") + " 실제 프로그램에서 시험하기 전까지 검증 완료가 아닙니다.</li></ul>" +
      "<p class='tc-muted'>위 목록 외의 사양(지원 CPU, 가격, 라이선스, 사용 방법 등)은 확인하지 않았습니다. 공식 매뉴얼과 페이지를 확인하세요.</p>";
  }

  function roles(c) {
    const rows = TC_AGENTS.map((a) => "<tr><td>" + c.esc(a.no) + "</td><td>" + c.esc(a.name) + "</td><td>" + c.esc(a.role) + "</td></tr>");
    return "<h2>에이전트 역할 안내</h2><div class='tc-safe'>사용자는 AGENT01 하나에게만 요청합니다. 전문 에이전트는 AGENT01이 내부적으로 선택하며 별도 관리 메뉴는 없습니다. 아래는 이 저장소에 등록된 역할 정보이고, 등록되지 않은 역할은 임의로 만들지 않았습니다.</div>" +
      "<div class='tc-card'><table class='tc-table'><tr><th>구분</th><th>이름</th><th>역할</th></tr>" + rows.join("") + "</table></div>" +
      "<p class='tc-muted'>전체 전문 에이전트 역할표는 아직 제공되지 않았습니다(확인 필요). 승인된 역할표를 받으면 이 표를 그에 맞춰 갱신해야 합니다.</p>";
  }

  function videos(c) {
    return "<h2>동영상 자료실</h2><div class='tc-safe'>현재 TECHCORE AI 자체 제작 영상은 없습니다(제작 예정). 외부 자료는 원본 사이트의 검색 결과로 이동하는 링크이며, 개별 영상의 재생·임베드 가능 여부와 이용 정책은 확인하지 않았습니다. 영상의 저작권은 각 제공처에 있습니다.</div>" +
      "<div class='tc-card'><label for='tcVidQ'><b>검색</b></label> <input id='tcVidQ' class='tc-in' type='search' placeholder='예: 래더, GX Works2'> " +
      "<label for='tcVidF'>분야</label> <select id='tcVidF'><option value=''>전체</option>" + Object.keys(FIELD).map((k) => "<option value='" + k + "'>" + FIELD[k] + "</option>").join("") + "</select> " +
      "<label for='tcVidK'>구분</label> <select id='tcVidK'><option value=''>전체</option><option value='own'>TECHCORE 자체</option><option value='ext'>외부</option></select></div>" +
      "<div id='tcVidList'></div>";
  }

  function bindVideos(root, c) {
    const q = root.querySelector("#tcVidQ"), f = root.querySelector("#tcVidF"), k = root.querySelector("#tcVidK"), box = root.querySelector("#tcVidList");
    if (!q) return;
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const rows = VIDEOS.filter((v) => (!f.value || v.f === f.value) && (!k.value || v.kind === k.value) && (!s || (v.t + " " + FIELD[v.f]).toLowerCase().includes(s)));
      box.innerHTML = rows.length ? "<div class='tc-grid'>" + rows.map((v) =>
        "<div class='tc-card'><b>" + c.esc(v.t) + "</b><p class='tc-muted'>" + c.esc(FIELD[v.f]) + " · " + (v.kind === "own" ? "TECHCORE 자체" : "외부") + "</p><p>" + c.esc(v.d) + "</p>" +
        (v.kind === "own"
          ? "<span class='tc-badge'>제작 예정</span>"
          : "<span class='tc-badge'>임베드 미확인</span> <span class='tc-badge'>재생 미확인</span><p class='tc-muted'>제공처: " + c.esc(v.provider) + "</p><a class='tc-btn' href='" + c.esc(v.url) + "' target='_blank' rel='noopener noreferrer'>원본 사이트에서 찾기</a>") +
        "</div>").join("") + "</div>" : "<p class='tc-muted'>조건에 맞는 항목이 없습니다.</p>";
    };
    [q, f, k].forEach((e) => e.addEventListener("input", draw));
    draw();
  }

  const PAGES = { "": usage, beginner, expert, rooms, gxworks2: gx, roles, videos };

  function render(arg, c) {
    const id = PAGES[arg || ""] ? arg || "" : "";
    return "<h1>도움말</h1><div class='tc-chips'>" + TABS.map((t) => "<a class='tc-chip" + (t.id === id ? " on" : "") + "' href='#/help" + (t.id ? "/" + t.id : "") + "'>" + c.esc(t.t) + "</a>").join("") + "</div>" + PAGES[id](c);
  }

  return { TABS, VIDEOS, render, bindVideos, title: (arg) => (TABS.find((t) => t.id === (arg || "")) || TABS[0]).t };
})();
window.TechHelp = TechHelp;
