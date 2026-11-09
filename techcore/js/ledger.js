// TechLedger: evidence records for AGENT01 exchanges and the L1~L5 verification levels.
// Only what the browser actually observed (a request was posted, a bot message arrived) or what the user entered with evidence is recorded.
// Whether a specialist agent was really invoked cannot be observed from the chat connection, so it always stays "미확인".
const TechLedger = (() => {
  const KEY = "techcore.ledger.v1";
  const MAX_CALLS = 100;

  // Each level accepts exactly one evidence source, so a self review can never be recorded as L3 or higher.
  const LEVELS = [
    { id: "L1", t: "AGENT01 내부 자체 검토", src: "self_review", srcLabel: "자체 검토", extra: null },
    { id: "L2", t: "요구사항·체크리스트 대조", src: "checklist", srcLabel: "체크리스트 대조", extra: null },
    { id: "L3", t: "독립 검토자·독립 절차 검토", src: "independent_review", srcLabel: "독립 검토", extra: { key: "reviewer", label: "독립 검토자(이름 또는 절차)" } },
    { id: "L4", t: "실제 전문 도구 실행", src: "tool_run", srcLabel: "도구 실행", extra: { key: "tool", label: "실행한 도구 이름" } },
    { id: "L5", t: "통제된 실제 환경 시험", src: "env_test", srcLabel: "환경 시험", extra: { key: "environment", label: "시험 환경" } },
  ];
  const SELF = /agent\s*-?0?1|자체|self|ai\s*creative|본인/i;

  const read = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && typeof d === "object") return { calls: Array.isArray(d.calls) ? d.calls : [], levels: d.levels && typeof d.levels === "object" ? d.levels : {} }; } catch {} return { calls: [], levels: {} }; };
  const write = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch { return false; } };

  function validLevel(id, rec) {
    const L = LEVELS.find((x) => x.id === id);
    if (!L || !rec || typeof rec !== "object") return { ok: false, reason: "기록이 없습니다." };
    if (rec.source !== L.src) return { ok: false, reason: id + "에는 '" + L.srcLabel + "' 근거만 기록할 수 있습니다." };
    if (!String(rec.evidenceRef || "").trim()) return { ok: false, reason: "근거 내용이 비어 있습니다." };
    if (!rec.checkedAt) return { ok: false, reason: "확인 일시가 없습니다." };
    if (L.extra && !String(rec[L.extra.key] || "").trim()) return { ok: false, reason: L.extra.label + "을(를) 입력해야 합니다." };
    if (id === "L3" && SELF.test(String(rec.reviewer))) return { ok: false, reason: "L3는 AGENT01 자체 검토가 아닌 독립 검토자여야 합니다." };
    return { ok: true };
  }

  function recordLevel(id, input) {
    const L = LEVELS.find((x) => x.id === id);
    if (!L) return { ok: false, reason: "알 수 없는 단계입니다." };
    const rec = { source: L.src, evidenceRef: String(input.evidenceRef || "").trim(), checkedAt: new Date().toISOString() };
    if (L.extra) rec[L.extra.key] = String(input[L.extra.key] || "").trim();
    const v = validLevel(id, rec);
    if (!v.ok) return v;
    const d = read(); d.levels[id] = rec;
    return write(d) ? { ok: true } : { ok: false, reason: "저장하지 못했습니다. 기존 기록은 그대로입니다." };
  }
  function clearLevel(id) { const d = read(); delete d.levels[id]; return write(d); }
  // Re-validated on every read, so a hand-edited or incomplete stored record is shown as "근거 부족", never as recorded.
  function levelStatus(id) {
    const rec = read().levels[id];
    if (!rec) return { s: "none" };
    const v = validLevel(id, rec);
    return v.ok ? { s: "recorded", rec } : { s: "invalid", reason: v.reason };
  }
  const levels = () => LEVELS.map((L) => Object.assign({}, L, { status: levelStatus(L.id) }));

  let attached = false;
  // Correlation lives in memory only (no storage change): a bot message counts as the reply to a call only when its replyToId
  // (or the techbridge requestId) points at a request posted on THIS connection. Anything else is labeled "연관 미확인" and not counted.
  const byAct = new Map(), byReq = new Map(), seenBot = new Set();
  let awaitEcho = [], connStart = 0, callsThisConn = 0, prevState = "";
  const tagOf = (a) => (a && a.channelData && a.channelData.techbridge && a.channelData.techbridge.requestId) || "";
  const cap = (m) => { if (m.size > 400) m.delete(m.keys().next().value); };
  function observe() {
    if (attached || typeof TechChat === "undefined") return;
    attached = true;
    TechChat.subscribe((s) => {
      if (s.state === "connecting" && prevState !== "connecting" && prevState !== "online") { connStart = Date.now(); callsThisConn = 0; awaitEcho = []; byAct.clear(); byReq.clear(); seenBot.clear(); }
      prevState = s.state;
    });
    TechChat.onPost((a) => {
      if (!a || a.type !== "message") return;
      const d = read();
      const tag = tagOf(a);
      const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      d.calls.push({ id, origin: tag ? "panellab" : "chat", requestedAt: Date.now(), responseAt: null, responses: 0, reviewedAt: null });
      if (d.calls.length > MAX_CALLS) d.calls.splice(0, d.calls.length - MAX_CALLS);
      write(d);
      callsThisConn++;
      if (tag) { byReq.set(tag, id); cap(byReq); }
      awaitEcho.push(id);
    });
    TechChat.onActivity((a) => {
      if (!a || a.type !== "message" || !a.from) return;
      if (a.from.role === "user") {
        const t = tagOf(a);
        const cid = t && byReq.has(t) ? byReq.get(t) : awaitEcho[0];
        awaitEcho = awaitEcho.filter((x) => x !== cid);
        if (cid && a.id) { byAct.set(a.id, cid); cap(byAct); }
        return;
      }
      if (a.from.role !== "bot") return;
      const key = a.id || JSON.stringify([a.timestamp, a.text]);
      if (seenBot.has(key)) return;
      seenBot.add(key); if (seenBot.size > 400) seenBot.delete(seenBot.values().next().value);
      // Messages from before this connection (replayed history) or with no request posted on it are not counted.
      const ts = a.timestamp ? Date.parse(a.timestamp) : NaN;
      if (!callsThisConn || (Number.isFinite(ts) && ts < connStart - 2000)) return;
      const cid = (a.replyToId && byAct.get(a.replyToId)) || byReq.get(tagOf(a));
      const d = read();
      const c = cid ? d.calls.find((x) => x.id === cid) : d.calls[d.calls.length - 1];
      if (!c) return;
      if (cid) { c.responses = (c.responses || 0) + 1; if (!c.responseAt) c.responseAt = Date.now(); }
      else c.unlinked = (c.unlinked || 0) + 1;
      write(d);
    });
  }

  function markReviewed(id) {
    const d = read(); const c = d.calls.find((x) => x.id === id);
    if (!c || !c.responseAt) return false;
    c.reviewedAt = Date.now();
    return write(d);
  }
  const calls = () => read().calls.slice().reverse();

  const fmt = (t) => (t ? new Date(t).toLocaleString("ko-KR") : "");

  function render(c) {
    const esc = c.esc;
    const lv = levels().map((L) => {
      const st = L.status;
      const badge = st.s === "recorded" ? "<span class='tc-badge ok'>근거 기록됨</span>" : st.s === "invalid" ? "<span class='tc-badge err'>근거 부족</span>" : "<span class='tc-badge'>미수행</span>";
      const meta = st.s === "recorded" ? "<br><span class='tc-muted'>" + esc(L.srcLabel) + " · " + esc(fmt(Date.parse(st.rec.checkedAt))) + (L.extra ? " · " + esc(st.rec[L.extra.key]) : "") + " · 근거: " + esc(st.rec.evidenceRef) + "</span>" : st.s === "invalid" ? "<br><span class='tc-muted'>" + esc(st.reason) + "</span>" : "";
      return "<tr><td><b>" + L.id + "</b> " + esc(L.t) + "</td><td>" + badge + meta + "</td></tr>";
    }).join("");
    const cl = calls().slice(0, 20).map((x) => {
      const ob = (t) => "<span class='tc-badge ok'>관측됨</span><br><span class='tc-muted'>" + esc(fmt(t)) + "</span>";
      return "<tr><td>" + (x.origin === "panellab" ? "PLC·HMI 작업실" : "AGENT01 채팅") + "</td><td>" + ob(x.requestedAt) + "</td><td><span class='tc-badge'>미확인</span></td><td>" +
        (x.responseAt ? ob(x.responseAt) + "<br><span class='tc-muted'>연관 확인된 메시지 " + x.responses + "개</span>" : "<span class='tc-badge'>" + (x.unlinked ? "연관된 응답 없음" : "수신 없음") + "</span>") +
        (x.unlinked ? "<br><span class='tc-badge warn'>연관 미확인</span> <span class='tc-muted'>메시지 " + x.unlinked + "개 (이 요청의 응답인지 확인할 수 없어 응답 수에 넣지 않음)</span>" : "") + "</td><td>" +
        (x.reviewedAt ? "<span class='tc-badge ok'>사용자 기록</span><br><span class='tc-muted'>" + esc(fmt(x.reviewedAt)) + "</span>" : x.responseAt ? "<button class='tc-btn' type='button' data-review='" + esc(x.id) + "'>검토 완료 기록</button>" : "<span class='tc-badge'>미수행</span>") + "</td></tr>";
    }).join("");
    return "<h2>검증 단계 (L1~L5)</h2><p class='tc-muted'>각 단계는 실제 근거가 입력된 경우에만 '근거 기록됨'으로 표시합니다. 이 표시는 사용자가 입력한 근거 기준이며, TECHCORE AI가 직접 검증했다는 뜻이 아닙니다. 자체 검토만으로는 L3 이상을 기록할 수 없습니다.</p>" +
      "<div class='tc-tablewrap'><table class='tc-table'><tr><th>단계</th><th>상태</th></tr>" + lv + "</table></div>" +
      "<div class='tc-card'><h3>근거 기록</h3><p class='tc-muted'>실제로 수행한 단계의 근거만 입력하세요. 입력 내용은 이 브라우저에만 저장됩니다.</p>" +
      "<label for='tcLvId'>단계</label> <select id='tcLvId'>" + LEVELS.map((L) => "<option value='" + L.id + "'>" + L.id + " " + esc(L.t) + "</option>").join("") + "</select> " +
      "<div id='tcLvExtraWrap'></div><label for='tcLvEv'>근거 내용 (예: 문서명, 로그 위치, 시험 기록)</label><input id='tcLvEv' class='tc-in' type='text' maxlength='300'> " +
      "<p><button class='tc-btn tc-primary' id='tcLvSave' type='button'>기록</button> <button class='tc-btn' id='tcLvClear' type='button'>선택 단계 기록 지우기</button> <span class='tc-muted' id='tcLvMsg' role='status' aria-live='polite'></span></p></div>" +
      "<h2>AGENT01 호출 기록</h2><p class='tc-muted'>이 브라우저에서 관측한 채팅 연결의 요청·응답만 기록합니다(내용은 저장하지 않음). 전문 에이전트가 실제로 호출되었는지는 채팅 연결로 확인할 수 없어 '미확인'입니다. 사용자 전달·최종 완료는 자동으로 표시하지 않습니다.</p>" +
      (cl ? "<div class='tc-tablewrap'><table class='tc-table'><tr><th>출처</th><th>호출 요청</th><th>전문 에이전트 실제 호출</th><th>응답 수신</th><th>결과 검토</th></tr>" + cl + "</table></div>" : "<p class='tc-muted'>기록된 호출이 없습니다. AGENT01 채팅을 사용하면 요청과 응답이 여기에 기록됩니다.</p>");
  }

  function bind(root, redraw) {
    const sel = root.querySelector("#tcLvId"); if (!sel) return;
    const wrap = root.querySelector("#tcLvExtraWrap"), ev = root.querySelector("#tcLvEv"), msg = root.querySelector("#tcLvMsg");
    const drawExtra = () => {
      const L = LEVELS.find((x) => x.id === sel.value);
      wrap.innerHTML = L.extra ? "<label for='tcLvX'>" + L.extra.label + "</label> <input id='tcLvX' class='tc-in' type='text' maxlength='120'> " : "";
    };
    sel.addEventListener("change", drawExtra); drawExtra();
    root.querySelector("#tcLvSave").addEventListener("click", () => {
      const L = LEVELS.find((x) => x.id === sel.value), x = root.querySelector("#tcLvX");
      const r = recordLevel(L.id, { evidenceRef: ev.value, [L.extra ? L.extra.key : "_"]: x ? x.value : "" });
      if (r.ok) redraw(); else msg.textContent = r.reason;
    });
    root.querySelector("#tcLvClear").addEventListener("click", () => { clearLevel(sel.value); redraw(); });
    root.querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => { markReviewed(b.dataset.review); redraw(); }));
  }

  return { KEY, LEVELS, levels, levelStatus, recordLevel, clearLevel, observe, markReviewed, calls, render, bind };
})();
window.TechLedger = TechLedger;
