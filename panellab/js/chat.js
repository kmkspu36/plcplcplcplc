// Direct Line connection layer. Broker URL, sealed value and token flow are unchanged from the original index.html.
const PanelChat = (() => {
  // Embedded in TECHCORE AI: use the single AGENT01 chat through TechBridge instead of opening a second Direct Line connection.
  // Standalone (/panellab/ opened directly) keeps the original connection code below, unchanged.
  try {
    if (window.parent !== window && window.parent.TechBridge && window.parent.TechBridge.version === 1) return window.parent.TechBridge.attach(window);
  } catch {}
  const BROKER_URL = "https://dl-broker-juwon-4jt3z.azurewebsites.net/api/directlineToken";
  const SEALED = "YkWnmdPMMzCHzXOH_VFYs_HwSo9NR8_0HvKXWU2-OXm8ouUgKQGimLFrK0uFvRbq23Hn_NEQf30riPkohKKVosX2i9Eut-RtC5RYZ0inunMoLEvZheEQTyJaJBS-DPeauIpPM3KQX19Pl2_m04Io8cO74VtL1D6dE9Q3bimmsVssbhBY_c8D3tw66MqEytpD-DEIWo68laQzLk-s9PHTrF_yB_rPiYjxXKXN8by-_dHIujne1jlnjxKWI3hWBFo785gDtCkX8Gjr0rhGefo9w7QQBk4n2GAHOL56szCHR5gDJeubqebMwj1jkIIUkxG4zCEPSPuMvH07eov1fZwSjPiW4LG9xf8M3YLeIJ4fP1W7eeATCrz30b_4HUGURcpTCY984PQaqIA5gPmUK3lUn20RKRCZLfcKTX0wQf_vdkb4JvXzH6WJWtDl_Dhnnu8BDSs4kf7pVYjbDedZcT-Ixd5wuitYdLM3OQl9L8239MfAPG7-vp13F-wxGYUSpNSappcoaWoy29bzONzDzV7gUWqEUc5D9yYW73JFMrAGRgTf6AiLKpM12vzEZUpzzoOFX40A_lmgs_sDtBhmSZ_gsLuoTYqwB4IpCq_x2mr_CMYaGsXZz4hafhzuAT15RROrAXnWnomH1YVOoEVu9Zo";

  const REPLY_TIMEOUT_MS = 240000;
  let directLine = null;
  let subs = [];
  let connecting = false;
  let status = "idle"; // idle | connecting | online | offline
  let waitTimer = null;
  let autoRetried = false;
  const seen = new Set();
  const h = { status: [], bot: [], typing: [], timeout: [] };

  const emit = (k, ...a) => h[k].forEach((fn) => fn(...a));
  const on = (k, fn) => h[k].push(fn);

  function setStatus(s, detail) {
    status = s;
    emit("status", s, detail || "");
  }

  function cleanup() {
    subs.forEach((s) => { try { s.unsubscribe(); } catch {} });
    subs = [];
    if (directLine) { try { directLine.end(); } catch {} }
    directLine = null;
    clearTimeout(waitTimer);
  }

  async function fetchToken() {
    let response;
    try {
      // Simple CORS request on purpose; the broker may not support preflight.
      response = await fetch(BROKER_URL, { method: "POST", body: JSON.stringify({ sealed: SEALED }) });
    } catch {
      throw new Error("서버에 연결하지 못했습니다. 네트워크, CORS 설정 또는 배포 주소를 확인해 주세요.");
    }
    if (!response.ok) throw new Error("서버가 연결 요청을 처리하지 못했습니다 (HTTP " + response.status + ").");
    let data;
    try { data = await response.json(); } catch { throw new Error("서버 응답을 읽을 수 없습니다."); }
    if (!data || typeof data.token !== "string" || !data.token.trim()) {
      throw new Error("서버에서 연결 토큰을 받지 못했습니다.");
    }
    return data.token;
  }

  async function connect() {
    if (connecting) return;
    if (!window.WebChat || typeof WebChat.createDirectLine !== "function") {
      setStatus("offline", "Direct Line 구성 요소를 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.");
      return;
    }
    connecting = true;
    cleanup();
    setStatus("connecting");
    try {
      const token = await fetchToken();
      directLine = WebChat.createDirectLine({ token });
      subs.push(directLine.connectionStatus$.subscribe((cs) => {
        if (cs === 2) {
          connecting = false;
          autoRetried = false;
          setStatus("online");
          directLine.postActivity({ type: "event", name: "startConversation", from: { id: "user" } })
            .subscribe({ error: () => {} });
        } else if (cs === 3 || cs === 4 || cs === 5) {
          connecting = false;
          const msg = cs === 3 ? "연결 토큰이 만료되었습니다." : cs === 4 ? "연결에 실패했습니다." : "연결이 종료되었습니다.";
          setStatus("offline", msg);
          if (cs === 3 && !autoRetried) { autoRetried = true; connect(); }
        }
      }));
      subs.push(directLine.activity$.subscribe({
        next: (a) => {
          if (!a || (a.from && a.from.id === "user")) return;
          if (a.type === "typing") { emit("typing", true); return; }
          if (a.type !== "message") return;
          const key = a.id || JSON.stringify([a.timestamp, a.text]);
          if (seen.has(key)) return;
          seen.add(key);
          clearTimeout(waitTimer);
          emit("typing", false);
          emit("bot", { id: key, text: a.text || "", attachments: a.attachments || [], ts: Date.now() });
        },
        error: () => setStatus("offline", "연결이 끊어졌습니다."),
      }));
    } catch (e) {
      connecting = false;
      setStatus("offline", e.message);
    }
  }

  function send(text, attachments) {
    return new Promise((resolve, reject) => {
      if (status !== "online" || !directLine) { reject(new Error("AI에 연결되어 있지 않습니다.")); return; }
      const activity = { type: "message", from: { id: "user" }, locale: "ko-KR", text };
      if (attachments && attachments.length) activity.attachments = attachments;
      directLine.postActivity(activity).subscribe({
        next: () => {},
        error: () => reject(new Error("메시지를 전송하지 못했습니다.")),
        complete: () => {
          emit("typing", true);
          clearTimeout(waitTimer);
          waitTimer = setTimeout(() => { emit("typing", false); emit("timeout"); }, REPLY_TIMEOUT_MS);
          resolve();
        },
      });
    });
  }

  return { connect, send, on, getStatus: () => status };
})();
