// TechWorkflow: display-only data-transfer flow (request -> AGENT01 -> specialist -> ... -> user confirmation).
// It READS TechLedger (browser-observed calls, evidence levels) and never writes, sends, stores or verifies anything.
// Steps that have no implementation are NOT_CONNECTED; steps that cannot be observed are UNVERIFIED. COMPLETED needs observed evidence.
const TechWorkflow = (() => {
  const ST = {
    NOT_STARTED: { label: "시작 전", en: "NOT_STARTED", cls: "" },
    IN_PROGRESS: { label: "진행 중", en: "IN_PROGRESS", cls: "warn" },
    COMPLETED: { label: "완료(근거 있음)", en: "COMPLETED", cls: "ok" },
    UNVERIFIED: { label: "미확인", en: "UNVERIFIED", cls: "" },
    FAILED: { label: "실패", en: "FAILED", cls: "err" },
    NOT_CONNECTED: { label: "미연결", en: "NOT_CONNECTED", cls: "" },
  };
  const ORDER = Object.keys(ST);
  const TIMEOUT_MS = 240000;

  // d: easy explanation shown to beginners. t: expert detail (what evidence is read).
  const STEPS = [
    { id: "request", t: "사용자 요청", d: "AGENT01 채팅에 요청을 보냅니다.", x: "채팅 연결에서 요청 전송이 관측되면 근거로 봅니다." },
    { id: "agent01", t: "AGENT01", d: "요청을 받는 통합 운영 에이전트입니다.", x: "채팅 대상이 AGENT01인지는 확인된 근거가 있을 때만 완료로 봅니다." },
    { id: "specialist", t: "전문 에이전트 호출", d: "필요한 전문가를 AGENT01이 고릅니다. 사용자가 고르지 않습니다.", x: "채팅 연결만으로는 호출 여부를 관측할 수 없습니다." },
    { id: "response", t: "응답", d: "AGENT01의 답변이 도착합니다.", x: "요청에 연관된 응답 메시지가 관측되면 근거로 봅니다. 240초 동안 없으면 실패로 봅니다." },
    { id: "keep", t: "원본 보관", d: "받은 답변의 원본을 그대로 보관합니다.", x: "응답 저장소가 없습니다(서버 저장소 미구현)." },
    { id: "forward", t: "후속 전달", d: "결과를 다음 전문가에게 넘깁니다.", x: "자동 전달은 구현하지 않았습니다." },
    { id: "integrity", t: "무결성 확인", d: "전달 중 내용이 바뀌지 않았는지 확인합니다.", x: "SHA-256 등 무결성 검사는 구현하지 않았습니다." },
    { id: "review", t: "결과 검토", d: "AI 결과를 사람이 또는 도구로 검토합니다.", x: "검증 단계 L1~L5 중 근거가 기록된 단계가 있으면 진행 중으로 봅니다." },
    { id: "merge", t: "통합 결과", d: "여러 결과를 하나의 보고서로 합칩니다.", x: "결과 취합 기능은 구현하지 않았습니다." },
    { id: "confirm", t: "사용자 확인", d: "마지막으로 사용자가 결과를 확인합니다.", x: "사용자가 '검토 완료 기록'을 누른 호출이 있으면 사용자 기록으로 봅니다." },
  ];

  function evidence() {
    let calls = [], levels = [];
    try { calls = TechLedger.calls(); } catch {}
    try { levels = TechLedger.levels(); } catch {}
    return { calls, last: calls[0] || null, levels };
  }

  // Returns [{...step, st, why}] where why states the evidence (or its absence).
  function compute() {
    const e = evidence(), L = e.last, now = Date.now();
    const answered = e.calls.filter((c) => c.responseAt).length;
    const reviewed = e.calls.filter((c) => c.reviewedAt).length;
    const rec = e.levels.filter((l) => l.status && l.status.s === "recorded").length;
    let a01 = "UNVERIFIED";
    try { if (tcEffectiveStatus(TC_CHAT_TARGET.agent01) === "pass") a01 = "COMPLETED"; } catch {}
    const r = {
      request: e.calls.length ? ["COMPLETED", "이 브라우저에서 요청 전송 " + e.calls.length + "건 관측"] : ["NOT_STARTED", "관측된 요청 없음"],
      agent01: [a01, a01 === "COMPLETED" ? "확인 근거 기록됨" : "채팅 대상이 AGENT01인지 확인된 근거 없음"],
      specialist: ["UNVERIFIED", "채팅 연결로 호출 여부를 관측할 수 없음"],
      response: !L ? ["NOT_STARTED", "응답을 기다릴 요청 없음"]
        : L.responseAt ? ["COMPLETED", "연관된 응답 수신 관측 " + answered + "건"]
          : now - L.requestedAt > TIMEOUT_MS ? ["FAILED", "최근 요청 후 240초 동안 연관된 응답 없음"] : ["IN_PROGRESS", "최근 요청의 응답 대기 중"],
      keep: ["NOT_CONNECTED", "응답 원본 저장소 미구현"],
      forward: ["NOT_CONNECTED", "자동 전달 미구현"],
      integrity: ["NOT_CONNECTED", "무결성 검사 미구현"],
      review: rec ? ["IN_PROGRESS", "검증 단계 " + rec + "개에 사용자 근거 기록(전체 완료 아님)"] : ["NOT_STARTED", "기록된 검증 근거 없음"],
      merge: ["NOT_CONNECTED", "통합 결과 생성 미구현"],
      confirm: reviewed ? ["COMPLETED", "사용자 검토 완료 기록 " + reviewed + "건(사용자 입력 기준)"] : ["NOT_STARTED", "사용자 검토 기록 없음"],
    };
    return STEPS.map((s) => Object.assign({}, s, { st: r[s.id][0], why: r[s.id][1] }));
  }

  const badge = (k) => { const s = ST[k] || ST.UNVERIFIED; return '<span class="tc-badge ' + s.cls + '">' + s.label + " <small>" + s.en + "</small></span>"; };

  // c: { esc, beginner }
  function render(c) {
    const esc = c.esc, steps = compute();
    const cnt = ORDER.map((k) => [k, steps.filter((s) => s.st === k).length]).filter((x) => x[1]);
    return "<h1>데이터 전달 관리</h1>" +
      "<p class='tc-lead'>요청이 어떤 순서로 처리되는지 보여 주는 <b>표시 전용</b> 화면입니다. 이 화면은 아무것도 전송하거나 저장하지 않습니다.</p>" +
      (c.beginner ? "<div class='tc-tip'><b>보는 법</b> 아래 10단계는 위에서 아래로 진행됩니다. '미연결'은 아직 만들지 않은 기능이고, '미확인'은 확인할 방법이 없는 단계입니다. 근거가 없으면 '완료'로 표시하지 않습니다.</div>" : "") +
      "<div class='tc-safe'><b>안전 안내</b> 전문 에이전트는 AGENT01이 내부적으로 선택합니다. 사용자는 전문가를 고르지 않으며, 결과는 사용자 확인 전에 적용되지 않습니다.</div>" +
      "<ol class='tc-flow' aria-label='데이터 전달 10단계'>" +
      steps.map((s, i) => "<li class='tc-step " + s.st.toLowerCase() + "'><span class='tc-stepno' aria-hidden='true'>" + (i + 1) + "</span><div><b>" + esc(s.t) + "</b> " + badge(s.st) +
        "<br><span class='tc-muted'>" + esc(s.d) + "</span><br><span class='tc-muted'>근거: " + esc(s.why) + "</span>" +
        (c.beginner ? "" : "<br><span class='tc-muted'>판정 기준: " + esc(s.x) + "</span>") + "</div></li>").join("") + "</ol>" +
      "<p class='tc-muted'>상태 요약: " + cnt.map((x) => esc(ST[x[0]].label) + " " + x[1]).join(" · ") + "</p>" +
      "<div class='tc-card'><h2>상태 뜻</h2><ul class='tc-list'>" + ORDER.map((k) => "<li><span>" + badge(k) + "</span></li>").join("") + "</ul>" +
      "<p class='tc-muted'>근거는 이 브라우저가 관측한 채팅 요청·응답 기록(localStorage 'techcore.ledger.v1')과 사용자가 입력한 검증 근거입니다. 브라우저 내부에만 저장되며, 다른 기기나 서버와 공유되지 않습니다.</p></div>" +
      "<p><a class='tc-btn' href='#/history'>작업 이력 및 검증 열기</a> <a class='tc-btn' href='#/results'>통합 결과실 열기</a></p>";
  }

  return { ST, STEPS, compute, badge, render };
})();
window.TechWorkflow = TechWorkflow;
