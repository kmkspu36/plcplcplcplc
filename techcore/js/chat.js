// Direct Line connection for the TechCore chat agent ("AI Creative Agent").
// Connects only when the user presses the connect button; no token is requested on page load.
const TechChat = (() => {
  const BROKER_URL = "https://dl-broker-juwon-4jt3z.azurewebsites.net/api/directlineToken";
  const SEALED = "HhSgnCcdrzz1J2qZwZL8LkzWFluN9TcLuZXaif4rCfFjVZceVAQWAFI5TvDUqjQzxNi1IkgaQzbVNZuOVqYWpRxcGE1RG-KKIoyWtlOAx1bzxnTg51mk1BLgKOkUdeIaCZ9ILlTRKOX7dbuQqClMeUNZKoKL4Y0vYhNifR66t5Wdypd4v3kJcrHNHo5ahHPI1Rg9lw5sTtxux0mgOmNoWLySmfo-rpCQbdC0vXxiKLx6XrzffGaJmxBf6uBtB2VXSUAnOJLgkcUSQFwlvEMV0YVzqYI4i1F7WKD6Cqnqe1IwHTuD2sXhQk3OIQk4hBkS-LBcXAs9mrWMO76s81_JfMh_o8WdkA-fDlDkhg3iGGs9TcbPzy2dsv4NTy9UBci-7sJ69EMGVLdjyeUStAHrob4wMM-03b5vIG5OkiZin1W6WuGzooDBE6Ww718ip9nUWNrr6El60bqdyn30T_h-CrHQhZRDXPMihtQ4pJL5KorbjYI8Z30IWPI48M4796f0D7ZOcHFtalnxVbxrN3NuPkrEkBE9GhTESho3l6SOlBg3jkY9Kisqtg2dcPUOyfpVvP8iTTP72l4jsMcsftgl9-xiiGijUi6EjIuYoTKxV5aMq-0hINhuTqS22V2eJj3S3vEQEcNoqtAx5k9luMU";
  const WEBCHAT_SRC = "https://cdn.botframework.com/botframework-webchat/4.18.0/webchat.js";
  const WEBCHAT_SRI = "sha384-YCF4860lf811lnrrIBL4pfZ+UqiNit+8lXEhSY3R+dSc+C1rg6UnEQR5avdOTbj0";

  const SLOW_MS = 20000;
  const TIMEOUT_MS = 240000;
  const LOAD_MS = 15000;

  let directLine = null;
  let subs = [];
  let state = "idle"; // connection: idle | connecting | online | error
  let talk = "idle"; // conversation: idle | sending | waiting | slow | timeout | done
  let message = "";
  const host = document.createElement("div");
  host.className = "tc-chat-host";
  let rendered = false;
  let slowTimer = 0, endTimer = 0;
  const listeners = new Set();

  const snapshot = () => ({ state, talk, message, rendered });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  const set = (s, m) => { state = s; message = m || ""; emit(); };
  const setTalk = (t) => { talk = t; emit(); };
  const clearTimers = () => { clearTimeout(slowTimer); clearTimeout(endTimer); };

  // The reply timers only observe Direct Line traffic; they do not prove any specialist agent was called.
  function startWait() {
    clearTimers();
    setTalk("waiting");
    slowTimer = setTimeout(() => { if (talk === "waiting") setTalk("slow"); }, SLOW_MS);
    endTimer = setTimeout(() => { if (talk === "waiting" || talk === "slow") setTalk("timeout"); }, TIMEOUT_MS);
  }

  function watch(dl) {
    subs.forEach((s) => s.unsubscribe());
    subs = [];
    const orig = dl.postActivity.bind(dl);
    dl.postActivity = (a) => { if (a && a.type === "message") { clearTimers(); setTalk("sending"); } return orig(a); };
    subs.push(dl.activity$.subscribe((a) => {
      if (!a || a.type !== "message" || !a.from) return;
      if (a.from.role === "user") startWait();
      else if (talk === "sending" || talk === "waiting" || talk === "slow" || talk === "timeout") { clearTimers(); setTalk("done"); }
    }));
    subs.push(dl.connectionStatus$.subscribe((c) => {
      if (c === 4) { clearTimers(); set("error", "채팅 서버에 연결하지 못했습니다. 다시 연결해 주세요."); }
      else if (c === 3) { clearTimers(); set("error", "연결 시간이 만료되었습니다. 다시 연결해 주세요."); }
      else if (c === 5) { clearTimers(); set("error", "대화가 종료되었습니다. 다시 연결해 주세요."); }
    }));
  }

  function loadWebChat() {
    if (window.WebChat && typeof WebChat.createDirectLine === "function") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const fail = () => { s.remove(); reject(new Error("x")); };
      const t = setTimeout(fail, LOAD_MS);
      s.src = WEBCHAT_SRC;
      s.integrity = WEBCHAT_SRI;
      s.crossOrigin = "anonymous";
      s.onload = () => { clearTimeout(t); window.WebChat ? resolve() : fail(); };
      s.onerror = () => { clearTimeout(t); fail(); };
      document.head.appendChild(s);
    });
  }

  function reset() {
    clearTimers();
    subs.forEach((s) => s.unsubscribe());
    subs = [];
    if (directLine) { try { directLine.end(); } catch {} directLine = null; }
    host.textContent = "";
    rendered = false;
    talk = "idle";
  }

  async function connect(force) {
    if (state === "connecting" || (state === "online" && !force)) return;
    reset();
    set("connecting");
    try {
      await loadWebChat();
    } catch {
      set("error", "채팅 구성 요소를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
      return;
    }
    let response;
    try {
      // Simple CORS request on purpose; the broker may not support preflight.
      response = await fetch(BROKER_URL, { method: "POST", body: JSON.stringify({ sealed: SEALED }) });
    } catch {
      set("error", "서버에 연결하지 못했습니다. 네트워크와 배포 주소를 확인해 주세요.");
      return;
    }
    if (!response.ok) { set("error", "서버가 연결 요청을 처리하지 못했습니다 (HTTP " + response.status + ")."); return; }
    let data;
    try { data = await response.json(); } catch { set("error", "서버 응답을 읽을 수 없습니다."); return; }
    if (!data || typeof data.token !== "string" || !data.token.trim()) {
      set("error", "서버에서 연결 토큰을 받지 못했습니다.");
      return;
    }
    try {
      directLine = WebChat.createDirectLine({ token: data.token });
      directLine.postActivity({ type: "event", name: "startConversation", from: { id: "user" } })
        .subscribe({ error: () => {} });
      watch(directLine);
      WebChat.renderWebChat({ directLine, locale: "ko-KR" }, host);
      rendered = true;
      set("online");
    } catch {
      set("error", "채팅을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    }
  }

  return {
    host,
    connect,
    getState: snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
