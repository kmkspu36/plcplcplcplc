// TechAnalysis: what the beginner / expert modes ask AGENT01 to analyse and how the answer should be structured.
// These are REQUESTED items. Whether an item was really performed is only known from the AI answer and its evidence,
// so every item must be reported as 수행 / 미수행 / 미확인 and nothing here is shown as a completed verification.
const TechAnalysis = (() => {
  const BEGINNER = [
    { id: "summary", t: "핵심 요약", d: "무엇을 확인했고 결론이 무엇인지 쉬운 말로 3줄 이내" },
    { id: "problem", t: "핵심 문제와 해결 방향", d: "가장 중요한 문제 1~3개와 해결 방향을 쉬운 용어로 설명" },
    { id: "terms", t: "용어 설명", d: "답변에 나온 전문 용어는 한 줄로 풀이" },
    { id: "next", t: "다음 작업 안내", d: "사용자가 다음에 할 일을 순서대로 안내" },
    { id: "missing", t: "필요한 자료", d: "부족한 정보와 올리면 좋은 자료를 알려 주기" },
  ];
  const EXPERT = [
    { id: "logic", t: "논리 관계 분석", d: "조건·인터록·자기유지·우선순위 등 논리 관계와 모순" },
    { id: "address", t: "주소·변수 충돌", d: "디바이스·라벨의 중복 사용, 이중 코일, 범위 충돌" },
    { id: "edge", t: "예외·경계 조건", d: "전원 투입/복귀, 비상정지, 타임아웃, 0·최대값, 동시 입력" },
    { id: "signal", t: "장치 간 신호 관계", d: "PLC–HMI–입출력 기기 사이 신호 방향·타이밍·라벨 일치" },
    { id: "impact", t: "오류 원인과 영향 범위", d: "각 문제의 원인, 영향받는 기능·장치, 심각도" },
    { id: "evidence", t: "검증 근거", d: "각 결론의 근거(입력 자료의 어느 부분인지)와 사용한 도구" },
    { id: "notdone", t: "미수행·미확인 항목", d: "수행하지 못한 분석과 확인되지 않은 가정을 반드시 명시" },
  ];
  const items = (mode) => (mode === "expert" ? BEGINNER.slice(0, 1).concat(EXPERT) : BEGINNER);

  function requestBlock(mode) {
    const list = items(mode);
    const head = mode === "expert"
      ? "[분석 요청 — 전문가 모드]\n아래 항목별로 구분해 답변해 주세요. 항목마다 '수행 / 미수행 / 미확인' 중 하나를 먼저 표시하고, 수행한 경우 근거(입력 자료의 위치)를 적어 주세요. 실제로 하지 않은 분석을 했다고 쓰지 마세요."
      : "[분석 요청 — 초보자 모드]\n아래 항목 순서대로, 전문 용어는 쉬운 말로 풀어서 답변해 주세요. 확실하지 않은 내용은 추측하지 말고 '확인이 필요합니다'라고 적어 주세요.";
    return head + "\n" + list.map((x, i) => (i + 1) + ". " + x.t + ": " + x.d).join("\n") +
      "\n전달받은 자료에 없는 내용은 추측하지 말고 '미확인'으로 표시해 주세요. GX Works3은 지원 대상이 아니며 PLC 코드는 제가 명시적으로 요청한 경우에만 작성해 주세요.";
  }

  function card(mode, esc) {
    const list = items(mode);
    const label = mode === "expert" ? "전문가" : "초보자";
    return '<div class="tc-card"><h2>' + label + " 모드 분석 항목</h2>" +
      '<p class="tc-muted">현재 모드에서 AGENT01에게 요청하는 분석 항목입니다. 요청 항목일 뿐이며, 실제로 수행되었는지는 답변의 [수행/미수행/미확인] 표시와 근거로 직접 확인해야 합니다.</p>' +
      '<ol class="tc-list">' + list.map((x) => "<li><b>" + esc(x.t) + "</b> <span class='tc-muted'>" + esc(x.d) + "</span></li>").join("") + "</ol>" +
      '<label for="tcAnTpl"><b>요청 문구</b> <span class="tc-muted">(작업 요청 뒤에 붙여 채팅창에 직접 보냅니다)</span></label>' +
      '<textarea id="tcAnTpl" class="tc-ta" rows="' + (mode === "expert" ? 12 : 8) + '" readonly>' + esc(requestBlock(mode)) + "</textarea>" +
      '<p><button class="tc-btn" id="tcAnCopy" type="button">요청 문구 복사</button> <span class="tc-muted" id="tcAnMsg" role="status" aria-live="polite"></span></p></div>';
  }

  function bindCard(root) {
    const b = root.querySelector("#tcAnCopy"), t = root.querySelector("#tcAnTpl"), m = root.querySelector("#tcAnMsg");
    if (!b || !t) return;
    b.addEventListener("click", () => {
      const done = (ok) => { m.textContent = ok ? "복사했습니다. 채팅창에 붙여 넣어 직접 보내세요." : "복사하지 못했습니다. 문구를 선택해 직접 복사해 주세요."; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(() => done(true), () => done(false));
      else { t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} done(ok); }
    });
  }

  return { items, requestBlock, card, bindCard };
})();
window.TechAnalysis = TechAnalysis;
