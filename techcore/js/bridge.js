// TechBridge: lets the embedded PanelLab use the single AGENT01 chat connection owned by TechCore.
// PanelLab requests are tagged (channelData.techbridge). Bot replies are routed to PanelLab only when they answer a tagged request,
// so normal AGENT01 chat replies are never saved as PanelLab results. Whether the real bot echoes channelData / replyToId is unverified;
// when it does not, routing falls back to "the most recent user message decides" and a late reply is dropped rather than misrouted.
const TechBridge = (() => {
  const VERSION = 1;
  const REPLY_TIMEOUT_MS = 240000;
  let load = null;
  let adapter = null;
  let cur = null; // outstanding PanelLab request: { id, timer }
  let lastOrigin = null; // origin of the most recent user message on the shared connection
  let wired = false;
  const origin = new Map(); // activity id -> request id ("" means the AGENT01 chat itself)
  const seen = new Set();

  const tagOf = (a) => (a && a.channelData && a.channelData.techbridge && a.channelData.techbridge.requestId) || "";
  const remember = (id, req) => { if (!id) return; origin.set(id, req); if (origin.size > 300) origin.delete(origin.keys().next().value); };

  function onPost(a) {
    if (!a || a.type !== "message") return;
    lastOrigin = tagOf(a);
    if (cur && cur.id !== lastOrigin) { clearTimeout(cur.timer); cur = null; }
  }

  function onActivity(a) {
    if (!a || a.type !== "message" || !a.from) return;
    if (a.from.role === "user") { remember(a.id, tagOf(a)); return; }
    const req = a.replyToId && origin.has(a.replyToId) ? origin.get(a.replyToId) : lastOrigin;
    if (!req || !cur || cur.id !== req || !adapter) return;
    const key = a.id || JSON.stringify([a.timestamp, a.text]);
    if (seen.has(key)) return;
    seen.add(key);
    clearTimeout(cur.timer);
    adapter.emit("typing", false);
    adapter.emit("bot", { id: key, text: a.text || "", attachments: a.attachments || [], ts: Date.now(), requestId: req });
  }

  function mapState(s) {
    if (s.state === "online") return ["online", ""];
    if (s.state === "connecting") return ["connecting", ""];
    if (s.state === "error") return ["offline", s.message || "연결에 실패했습니다."];
    return ["idle", ""];
  }
  function onState(s) { if (adapter) { const m = mapState(s); adapter.emit("status", m[0], m[1]); } }

  function wire() {
    if (wired || typeof TechChat === "undefined") return;
    wired = true;
    TechChat.onPost(onPost);
    TechChat.onActivity(onActivity);
    TechChat.subscribe(onState);
  }

  function detach() {
    if (adapter) { adapter.alive = false; adapter = null; }
    if (cur) { clearTimeout(cur.timer); cur = null; }
  }

  function attach(win) {
    detach();
    const h = { status: [], bot: [], typing: [], timeout: [] };
    const a = { alive: true };
    a.emit = (k, ...x) => { if (!a.alive) return; h[k].slice().forEach((fn) => { try { fn(...x); } catch (e) { console.error(e); } }); };
    adapter = a;
    try { win.addEventListener("pagehide", () => { if (adapter === a) detach(); }); } catch {}

    const status = () => (typeof TechChat === "undefined" ? "idle" : mapState(TechChat.getState())[0]);

    function connect() {
      return Promise.resolve(load ? load() : null).then(() => {
        wire();
        const s = TechChat.getState();
        TechChat.connect(s.state === "error");
        onState(TechChat.getState());
      }).catch(() => { a.emit("status", "offline", "AGENT01 채팅 구성 요소를 불러오지 못했습니다."); });
    }

    function send(text, attachments) {
      return new Promise((resolve, reject) => {
        if (!a.alive || adapter !== a || typeof TechChat === "undefined") { reject(new Error("AI에 연결되어 있지 않습니다.")); return; }
        const s = TechChat.getState();
        if (s.state !== "online") { reject(new Error("AI에 연결되어 있지 않습니다.")); return; }
        if (s.talk === "sending" || s.talk === "waiting" || s.talk === "slow") { reject(new Error("AGENT01 채팅이 다른 요청의 응답을 기다리는 중입니다. 응답이 끝난 뒤 다시 시도해 주세요.")); return; }
        const id = "pl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const activity = { type: "message", from: { id: "user" }, locale: "ko-KR", text, channelData: { techbridge: { source: "panellab", requestId: id } } };
        if (attachments && attachments.length) activity.attachments = attachments;
        const mine = { id, timer: 0 };
        cur = mine;
        TechChat.send(activity).then((actId) => {
          remember(actId, id);
          a.emit("typing", true);
          clearTimeout(mine.timer);
          mine.timer = setTimeout(() => { if (cur === mine) { a.emit("typing", false); a.emit("timeout"); } }, REPLY_TIMEOUT_MS);
          resolve();
        }, () => { if (cur === mine) cur = null; reject(new Error("메시지를 전송하지 못했습니다.")); });
      });
    }

    return { connect, send, on: (k, fn) => { if (h[k]) h[k].push(fn); }, getStatus: status };
  }

  return { version: VERSION, init: (o) => { load = o && o.load; }, attach };
})();
window.TechBridge = TechBridge;
