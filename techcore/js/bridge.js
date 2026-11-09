// TechBridge: lets the embedded PanelLab use the single AGENT01 chat connection owned by TechCore.
// PanelLab requests are tagged (channelData.techbridge). Bot replies are routed to PanelLab only when they answer a tagged request,
// so normal AGENT01 chat replies are never saved as PanelLab results. Whether the real bot echoes channelData / replyToId is unverified;
// when it does not, routing falls back to "the most recent user message decides" and a late reply is dropped rather than misrouted.
const TechBridge = (() => {
  const VERSION = 1;
  const REPLY_TIMEOUT_MS = 240000;
  // After the first bot reply to a PanelLab request, further bot messages for the same request are still forwarded for this long,
  // then the request is released so later bot messages are not saved into PanelLab. 5000 ms is an UNVERIFIED estimate:
  // the real bot's multi-message reply pattern has not been observed, so this value may need tuning.
  const REPLY_TAIL_MS = 5000;
  const SEEN_MAX = 500;
  let load = null;
  let adapter = null;
  let cur = null; // outstanding PanelLab request: { id, timer, replied, tail }
  let lastOrigin = null; // origin of the most recent user message on the shared connection
  let wired = false;
  const origin = new Map(); // activity id -> request id ("" means the AGENT01 chat itself)
  const seen = new Set();

  const tagOf = (a) => (a && a.channelData && a.channelData.techbridge && a.channelData.techbridge.requestId) || "";
  const remember = (id, req) => { if (!id) return; origin.set(id, req); if (origin.size > 300) origin.delete(origin.keys().next().value); };
  const release = () => { if (cur) { clearTimeout(cur.timer); clearTimeout(cur.tail); cur = null; } };

  function onPost(a) {
    if (!a || a.type !== "message") return;
    lastOrigin = tagOf(a);
    if (cur && cur.id !== lastOrigin) {
      const was = cur;
      release();
      // Tell PanelLab its pending request is cancelled so it does not stay in a waiting state. Skip if it already got a reply.
      if (adapter && !was.replied) { adapter.emit("typing", false); adapter.emit("cancel"); }
    }
  }

  function onActivity(a) {
    if (!a || a.type !== "message" || !a.from) return;
    if (a.from.role === "user") {
      // The echo may lack channelData; never overwrite an already known request id with "".
      const t = tagOf(a);
      if (t || !origin.get(a.id)) remember(a.id, t);
      return;
    }
    const req = a.replyToId && origin.has(a.replyToId) ? origin.get(a.replyToId) : lastOrigin;
    if (!req || !cur || cur.id !== req || !adapter) return;
    const key = a.id || JSON.stringify([a.timestamp, a.text]);
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    const mine = cur;
    clearTimeout(mine.timer);
    if (!mine.replied) {
      mine.replied = true;
      mine.tail = setTimeout(() => { if (cur === mine) cur = null; }, REPLY_TAIL_MS);
    }
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
    release();
  }

  function attach(win) {
    detach();
    const h = { status: [], bot: [], typing: [], timeout: [], cancel: [] };
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

    function send(text, attachments, meta) {
      return new Promise((resolve, reject) => {
        if (!a.alive || adapter !== a || typeof TechChat === "undefined") { reject(new Error("AI에 연결되어 있지 않습니다.")); return; }
        const s = TechChat.getState();
        if (s.state !== "online") { reject(new Error("AI에 연결되어 있지 않습니다.")); return; }
        if (s.talk === "sending" || s.talk === "waiting" || s.talk === "slow") { reject(new Error("AGENT01 채팅이 다른 요청의 응답을 기다리는 중입니다. 응답이 끝난 뒤 다시 시도해 주세요.")); return; }
        const id = "pl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const tag = { source: "panellab", requestId: id };
        if (meta && meta.kind) tag.kind = String(meta.kind).slice(0, 20);
        const activity = { type: "message", from: { id: "user" }, locale: "ko-KR", text, channelData: { techbridge: tag } };
        if (attachments && attachments.length) activity.attachments = attachments;
        const mine = { id, timer: 0 };
        cur = mine;
        TechChat.send(activity).then((actId) => {
          remember(actId, id);
          a.emit("typing", true);
          clearTimeout(mine.timer);
          mine.timer = setTimeout(() => { if (cur === mine) { a.emit("typing", false); a.emit("timeout"); } }, REPLY_TIMEOUT_MS);
          resolve(id);
        }, () => { if (cur === mine) cur = null; reject(new Error("메시지를 전송하지 못했습니다.")); });
      });
    }

    return { connect, send, on: (k, fn) => { if (h[k]) h[k].push(fn); }, getStatus: status };
  }

  // P3-C: one visible short header placed at the start of a request. It is plain text for the user to read;
  // whether AGENT01 understands or uses it is UNVERIFIED. room/project/software/mode are shown as given.
  function contextHeader(o) {
    o = o || {};
    const clean = (v) => String(v == null ? "" : v).replace(/[\r\n\[\]]+/g, " ").trim().slice(0, 60);
    const mode = o.mode === "expert" ? "전문가" : o.mode === "beginner" ? "초보자" : "";
    const parts = ["작업실: " + (clean(o.room) || "확인 필요"), "프로젝트: " + (clean(o.project) || "없음"), "소프트웨어: " + (clean(o.software) || "Mitsubishi GX Works2")];
    if (mode) parts.push("모드: " + mode);
    return "[작업 맥락 - " + parts.join(" / ") + "]";
  }

  // P4-C: sends the user's own text (never automatically) as a plain AGENT01 chat message on the shared connection.
  // Rejects with a reason when not connected or when another request is still waiting.
  // P3-G: if not connected, connects first (waiting up to ~15s) and then sends. Callers keep their text when it rejects.
  function sendUser(text) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    return Promise.resolve(typeof TechChat === "undefined" && load ? load() : null).catch(() => null).then(async () => {
      if (typeof TechChat === "undefined") throw new Error("AGENT01 채팅 구성 요소를 불러오지 못했습니다.");
      let s = TechChat.getState();
      if (s.state !== "online") {
        if (s.state !== "connecting") TechChat.connect(s.state === "error");
        for (let i = 0; i < 75; i++) { await wait(200); s = TechChat.getState(); if (s.state === "online" || s.state === "error") break; }
        if (s.state !== "online") throw new Error("AGENT01에 연결하지 못했습니다" + (s.message ? ": " + s.message : ".") + " 요청 내용은 그대로 남아 있습니다.");
      }
      if (s.talk === "sending" || s.talk === "waiting" || s.talk === "slow") throw new Error("다른 요청의 응답을 기다리는 중입니다. 응답이 끝난 뒤 다시 시도해 주세요.");
      try { await TechChat.send({ type: "message", from: { id: "user" }, locale: "ko-KR", text: String(text) }); }
      catch { throw new Error("메시지를 전송하지 못했습니다."); }
    });
  }

  // P4-D: the embedded PanelLab follows TechCore's beginner/expert mode through this small API (same-origin window.parent access).
  let modeApi = null;
  const modeSubs = new Set();
  const modeCtl = {
    setModeApi: (o) => { modeApi = o; },
    getMode: () => (modeApi ? modeApi.get() : null),
    requestMode: (m) => { if (modeApi && (m === "beginner" || m === "expert")) modeApi.set(m); },
    onMode: (fn) => { modeSubs.add(fn); return () => modeSubs.delete(fn); },
    notifyMode: (m) => { modeSubs.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } }); },
  };

  return Object.assign({ version: VERSION, init: (o) => { load = o && o.load; }, attach, contextHeader, sendUser }, modeCtl);
})();
window.TechBridge = TechBridge;
