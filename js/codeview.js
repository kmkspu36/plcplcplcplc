// PLC code viewer: line numbers, instruction/device highlighting, copy, download, fullscreen, search. No external dependencies.
const PanelCode = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const OPS = new Set("LD LDI LDP LDF AND ANI ANDP ANDF OR ORI ORP ORF ANB ORB MPS MRD MPP OUT SET RST PLS PLF MC MCR END FEND NOP MOV DMOV ADD SUB MUL DIV INC DEC CMP ZCP BCD BIN CALL RET FOR NEXT JMP CJ SFT SFTL FROM TO PLC".split(" "));
  const DEV = /^(SM|SD|SW|SB|X|Y|M|L|S|B|F|T|C|D|W|R|V|Z|P|I|N|U)[0-9A-F.]*[0-9][0-9A-F.]*$/i;
  const devClass = (d) => {
    const c = d.toUpperCase();
    if (c[0] === "X") return "dx";
    if (c[0] === "Y") return "dy";
    if (/^(M|L|S|SM|B|F)/.test(c)) return "dm";
    if (/^(T|C)/.test(c)) return "dt";
    return "dd";
  };

  function highlight(line) {
    const ci = line.search(/;|\/\//);
    const code = ci >= 0 ? line.slice(0, ci) : line;
    const cmt = ci >= 0 ? line.slice(ci) : "";
    const parts = code.split(/(\s+)/);
    let first = true, opSeen = false;
    const nonEmpty = parts.filter((p) => p && !/^\s+$/.test(p)).length;
    const out = parts.map((p) => {
      if (!p || /^\s+$/.test(p)) return esc(p);
      let cls = "";
      if (first && /^\d+$/.test(p) && nonEmpty > 1) cls = "st";
      else if (!opSeen && (OPS.has(p.toUpperCase()) || /^(LD|AND|OR)[=<>]+$/i.test(p))) { cls = "op"; opSeen = true; }
      else if (/^[KH][0-9A-F]+$/i.test(p) && /\d/.test(p)) cls = "kc";
      else if (DEV.test(p)) cls = devClass(p);
      first = false;
      return cls ? '<span class="' + cls + '">' + esc(p) + "</span>" : esc(p);
    }).join("");
    return out + (cmt ? '<span class="cm">' + esc(cmt) + "</span>" : "");
  }

  function html(code, lang) {
    const lines = String(code).split("\n");
    const rows = lines.map((l, i) => '<div class="ln"><span class="no">' + (i + 1) + '</span><span class="tx">' + highlight(l) + "</span></div>").join("");
    return '<div class="cv"><div class="cv-h"><span class="cv-l">' + esc(lang || "code") + " · " + lines.length +
      '줄</span><span class="cv-b"><button type="button" data-cv="search">검색</button><button type="button" data-cv="full">확대</button>' +
      '<button type="button" data-cv="dl">다운로드</button><button type="button" data-cv="copy">복사</button></span></div>' +
      '<div class="cv-s" hidden><input type="text" class="cv-q" placeholder="코드 검색" aria-label="코드 검색"><span class="cv-c"></span></div>' +
      '<div class="cv-body">' + rows + "</div></div>";
  }

  const rawOf = (cv) => [...cv.querySelectorAll(".tx")].map((t) => t.textContent).join("\n");
  const orig = new WeakMap();

  function search(cv, q) {
    const rows = [...cv.querySelectorAll(".tx")];
    let hits = 0, first = null;
    rows.forEach((t) => {
      if (!orig.has(t)) orig.set(t, t.innerHTML);
      if (!q) { t.innerHTML = orig.get(t); return; }
      const text = t.textContent, low = text.toLowerCase(), ql = q.toLowerCase();
      let i = 0, idx, out = "", n = 0;
      while ((idx = low.indexOf(ql, i)) >= 0) { out += esc(text.slice(i, idx)) + "<mark>" + esc(text.slice(idx, idx + q.length)) + "</mark>"; i = idx + q.length; n++; }
      if (n) { t.innerHTML = out + esc(text.slice(i)); hits += n; if (!first) first = t; } else t.innerHTML = orig.get(t);
    });
    cv.querySelector(".cv-c").textContent = q ? hits + "건" : "";
    if (first) first.scrollIntoView({ block: "nearest" });
  }

  function bind(api) {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cv]"); if (!b) return;
      const cv = b.closest(".cv"), act = b.dataset.cv;
      if (act === "copy") {
        const p = navigator.clipboard ? navigator.clipboard.writeText(rawOf(cv)) : Promise.reject();
        p.then(() => api.toast("복사했습니다."), () => api.toast("복사하지 못했습니다."));
      } else if (act === "dl") api.download("panellab-code.txt", rawOf(cv), "text/plain");
      else if (act === "full") { const on = cv.classList.toggle("full"); b.textContent = on ? "닫기" : "확대"; document.body.classList.toggle("noscroll", on); }
      else if (act === "search") { const s = cv.querySelector(".cv-s"); s.hidden = !s.hidden; if (!s.hidden) s.querySelector("input").focus(); else { s.querySelector("input").value = ""; search(cv, ""); } }
    });
    document.addEventListener("input", (e) => { if (e.target.classList.contains("cv-q")) search(e.target.closest(".cv"), e.target.value); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const f = document.querySelector(".cv.full");
      if (f) { f.classList.remove("full"); f.querySelector('[data-cv="full"]').textContent = "확대"; document.body.classList.remove("noscroll"); }
    });
  }

  return { html, bind };
})();
