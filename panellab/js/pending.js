// PanelPending: request ownership for the one AGENT01 chat. Only ONE request kind may wait at a time, and a bot reply is
// handed only to the UI that owns the waiting request, so HMI replies are never saved as general chat results.
// Kinds: chat | panellab | hmi-design | hmi-inspect | fix.
const PanelPending = (() => {
  const KINDS = { chat: 1, panellab: 1, "hmi-design": 1, "hmi-inspect": 1, fix: 1 };
  const LATE_KINDS = { chat: 1, panellab: 1, fix: 1 }; // after a timeout the notice promises a late reply for these kinds
  const TAIL_MS = 6000; // same unverified guess as REPLY_TAIL_MS in techcore/js/bridge.js
  let cur = null; // { kind, id, tid }
  let late = "";
  let tail = null; // { kind, until }
  let seq = 0;
  const subs = [];
  const fire = (ev, kind) => subs.slice().forEach((fn) => { try { fn(ev, kind); } catch (e) { console.error(e); } });

  const NAMES = { chat: "일반 채팅", panellab: "작업 요청", "hmi-design": "HMI AI 설계", "hmi-inspect": "HMI AI 검사", fix: "자동 오류 수정" };

  function begin(kind) {
    if (!KINDS[kind] || cur) return null;
    late = ""; tail = null;
    cur = { kind, id: "rq" + (++seq) + "-" + Date.now().toString(36), tid: "" };
    return cur.id;
  }
  // tid: the transport request id (TechBridge requestId) once the message is posted; replies carrying another id are not ours.
  function bind(id, tid) { if (cur && cur.id === id) cur.tid = tid || ""; }
  function owns(kind, a) {
    if (!cur || cur.kind !== kind) return false;
    return !(a && a.requestId && cur.tid && a.requestId !== cur.tid);
  }
  // true when a bot reply belongs to `kind`: the waiting request, a promised late reply, or the short multi-message tail.
  function accept(kind, a) {
    if (owns(kind, a)) return true;
    if (cur) return false;
    const now = Date.now();
    if (late === kind) { late = ""; tail = { kind, until: now + TAIL_MS }; return true; }
    if (tail && tail.kind === kind && now < tail.until) { tail.until = now + TAIL_MS; return true; }
    return false;
  }
  function end(id) { if (cur && (!id || cur.id === id)) { tail = { kind: cur.kind, until: Date.now() + TAIL_MS }; cur = null; } }
  function drop(id) { if (cur && (!id || cur.id === id)) { cur = null; tail = null; late = ""; } }
  function interrupt(ev, keepLate) {
    const k = cur && cur.kind;
    cur = null; tail = null; late = "";
    if (k) { if (keepLate && LATE_KINDS[k]) late = k; fire(ev, k); }
  }

  PanelChat.on("cancel", () => interrupt("cancel", false));
  PanelChat.on("timeout", () => interrupt("timeout", true));
  PanelChat.on("status", (s) => { if (s === "offline") interrupt("offline", false); });

  return {
    begin, bind, owns, accept, end, drop,
    busy: () => !!cur,
    owner: () => (cur ? cur.kind : ""),
    label: (k) => NAMES[k || (cur && cur.kind)] || "",
    subscribe: (fn) => { subs.push(fn); },
  };
})();
