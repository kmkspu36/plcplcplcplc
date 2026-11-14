// TechResults: display-only results room (raw responses, integrated result, verification, user confirmation).
// Answer text is NOT stored anywhere by TECHCORE, so nothing is shown as stored. Only browser-observed facts from TechLedger are read.
const TechResults = (() => {
  const fmt = (t) => (t ? new Date(t).toLocaleString("ko-KR") : "");

  // c: { esc, beginner }
  function render(c) {
    const esc = c.esc, W = TechWorkflow;
    let calls = [], levels = [];
    try { calls = TechLedger.calls(); } catch {}
    try { levels = TechLedger.levels(); } catch {}
    const answered = calls.filter((x) => x.responseAt);
    const reviewed = calls.filter((x) => x.reviewedAt);
    const sec = (title, st, body) => "<section class='tc-card tc-result'><h2>" + esc(title) + " " + W.badge(st) + "</h2>" + body + "</section>";
    const lv = levels.map((L) => {
      const s = L.status.s;
      return "<li><span><b>" + L.id + "</b> " + esc(L.t) + "</span>" + (s === "recorded" ? "<span class='tc-badge ok'>근거 기록됨</span>" : s === "invalid" ? "<span class='tc-badge err'>근거 부족</span>" : "<span class='tc-badge'>미수행</span>") + "</li>";
    }).join("");
    return "<h1>통합 결과실</h1>" +
      "<p class='tc-lead'>AI 결과를 모아 검토하는 <b>표시 전용</b> 화면입니다. 결과는 사용자가 확인하기 전에는 어디에도 적용되지 않습니다.</p>" +
      (c.beginner ? "<div class='tc-tip'><b>지금 할 일</b> AGENT01 채팅에서 요청을 보내고, 답변을 읽은 뒤 '작업 이력 및 검증'에서 검토 완료를 직접 기록하세요.</div>" : "") +
      "<div class='tc-safe'><b>안전 안내</b> AI 결과는 참고용 후보입니다. 수행하지 않은 검증은 완료로 표시하지 않으며, 실제 설비 적용은 자격을 갖춘 담당자의 검토가 필요합니다.</div>" +
      "<div class='tc-grid'>" +
      sec("원본 응답", "NOT_CONNECTED", "<p class='tc-muted'>응답 원본 저장 기능은 구현되지 않았습니다. 답변은 AGENT01 채팅 화면에서만 볼 수 있고 새로고침하면 사라질 수 있습니다.</p><p>이 브라우저에서 관측된 응답: <b>" + answered.length + "건</b> (내용 없이 도착 시각만 기록)</p>" +
        (answered[0] ? "<p class='tc-muted'>가장 최근: " + esc(fmt(answered[0].responseAt)) + "</p>" : "")) +
      sec("통합 결과", "NOT_CONNECTED", "<p class='tc-muted'>여러 전문가 결과를 하나로 합치는 기능은 구현되지 않았습니다. 전문 에이전트별 결과는 구분하지 않고 AGENT01의 통합 답변만 채팅에 표시됩니다.</p>") +
      sec("검증 결과", levels.some((L) => L.status.s === "recorded") ? "IN_PROGRESS" : "NOT_STARTED", "<ul class='tc-list'>" + lv + "</ul><p class='tc-muted'>사용자가 입력한 근거 기준입니다. TECHCORE AI가 직접 검증한 것이 아닙니다.</p>") +
      sec("사용자 확인", reviewed.length ? "COMPLETED" : "NOT_STARTED", reviewed.length ? "<p>사용자가 검토 완료를 기록한 호출 <b>" + reviewed.length + "건</b> (사용자 입력 기준)</p><p class='tc-muted'>가장 최근: " + esc(fmt(reviewed[0].reviewedAt)) + "</p>" : "<p class='tc-muted'>검토 완료로 기록된 호출이 없습니다.</p>") +
      "</div>" +
      "<p class='tc-muted'>기록은 이 브라우저(localStorage)에만 저장되며, 다른 기기와 공유되지 않습니다.</p>" +
      "<p><a class='tc-btn' href='#/history'>작업 이력 및 검증</a> <a class='tc-btn' href='#/transfer'>데이터 전달 관리</a></p>";
  }

  return { render };
})();
window.TechResults = TechResults;
