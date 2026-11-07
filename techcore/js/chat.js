// Direct Line connection for the TechCore chat agent ("AI Creative Agent").
// Connects only when the user presses the connect button; no token is requested on page load.
const TechChat = (() => {
  const BROKER_URL = "https://dl-broker-juwon-4jt3z.azurewebsites.net/api/directlineToken";
  const SEALED = "HhSgnCcdrzz1J2qZwZL8LkzWFluN9TcLuZXaif4rCfFjVZceVAQWAFI5TvDUqjQzxNi1IkgaQzbVNZuOVqYWpRxcGE1RG-KKIoyWtlOAx1bzxnTg51mk1BLgKOkUdeIaCZ9ILlTRKOX7dbuQqClMeUNZKoKL4Y0vYhNifR66t5Wdypd4v3kJcrHNHo5ahHPI1Rg9lw5sTtxux0mgOmNoWLySmfo-rpCQbdC0vXxiKLx6XrzffGaJmxBf6uBtB2VXSUAnOJLgkcUSQFwlvEMV0YVzqYI4i1F7WKD6Cqnqe1IwHTuD2sXhQk3OIQk4hBkS-LBcXAs9mrWMO76s81_JfMh_o8WdkA-fDlDkhg3iGGs9TcbPzy2dsv4NTy9UBci-7sJ69EMGVLdjyeUStAHrob4wMM-03b5vIG5OkiZin1W6WuGzooDBE6Ww718ip9nUWNrr6El60bqdyn30T_h-CrHQhZRDXPMihtQ4pJL5KorbjYI8Z30IWPI48M4796f0D7ZOcHFtalnxVbxrN3NuPkrEkBE9GhTESho3l6SOlBg3jkY9Kisqtg2dcPUOyfpVvP8iTTP72l4jsMcsftgl9-xiiGijUi6EjIuYoTKxV5aMq-0hINhuTqS22V2eJj3S3vEQEcNoqtAx5k9luMU";
  const WEBCHAT_SRC = "https://cdn.botframework.com/botframework-webchat/4.18.0/webchat.js";

  let directLine = null;
  let state = "idle"; // idle | connecting | online | error
  let message = "";
  const host = document.createElement("div");
  host.className = "tc-chat-host";
  host.style.height = "560px";
  let rendered = false;
  const listeners = [];

  const set = (s, m) => { state = s; message = m || ""; listeners.forEach((fn) => fn(state, message)); };

  function loadWebChat() {
    if (window.WebChat && typeof WebChat.createDirectLine === "function") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = WEBCHAT_SRC;
      s.onload = () => (window.WebChat ? resolve() : reject(new Error("x")));
      s.onerror = () => reject(new Error("x"));
      document.head.appendChild(s);
    });
  }

  async function connect() {
    if (state === "connecting" || state === "online") return;
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
    getState: () => ({ state, message, rendered }),
    onChange: (fn) => { listeners.length = 0; listeners.push(fn); },
  };
})();
