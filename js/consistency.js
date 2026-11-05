// Compares the IL code (source of truth) with the devices and values the AI explanation mentions. Reports only; it never edits code.
const PanelConsistency = (() => {
  const ST = { ok: "일치 확인", diff: "불일치 발견", unk: "확인 불가", none: "비교 대상 없음" };
  const DEVP = "(?:[XYBW][0-9A-F]{1,4}|(?:SM|SD|[MLSFTCDRZ])\\d{1,5})";
  const DEV = new RegExp("(?<![A-Za-z0-9_])(" + DEVP + ")(?![A-Za-z0-9_])", "g");
  const DEV1 = new RegExp("^" + DEVP + "$");
  const KV = /(?<![A-Za-z0-9_])K\s*(-?\d+)(?![A-Za-z0-9_])/g;
  const APPOP = "MOV|DMOV|ADD|SUB|MUL|DIV|INC|DEC|CMP|ZRST|BMOV|FMOV|WAND|WOR|WXOR|NEG|SFTL|SFTR|ROL|ROR";
  const OPD = "(?:[KH]-?\\d+|" + DEVP + ")";
  const APPRE = new RegExp("(?<![A-Za-z])(" + APPOP + ")(?![A-Za-z])[ \\t]*((?:" + OPD + ")(?:[ \\t]+" + OPD + "){0,3})", "g");
  const ASCII = /[─│┤├┬┴┼]|\|--|--\||\]--|--[\[(]|\+-{2,}/;
  const ILLINE = /^\s*(?:\d+\s+)?(?:LD|LDI|AND|ANI|OR|ORI|ANB|ORB|OUT|SET|RST|MPS|MRD|MPP|END|INV|TIM|CNT)\b/i;
  const isDev = (s) => DEV1.test(String(s).toUpperCase());
  const up = (s) => String(s).toUpperCase();
  const isTC = (d) => /^(T|C)\d/.test(d);

  function summarize(rungs) {
    const contacts = [], outs = [], tcs = [], apps = [], devs = new Map();
    const note = (d, net) => { if (!devs.has(d)) devs.set(d, net); };
    const walk = (n, net) => {
      if (n.t === "c") {
        if (n.k === "CMP") (n.args || []).forEach((a) => { if (isDev(a)) { contacts.push({ d: up(a), k: "CMP", net }); note(up(a), net); } });
        else if (isDev(n.d)) { contacts.push({ d: up(n.d), k: n.k, net }); note(up(n.d), net); }
      } else n.n.forEach((c) => walk(c, net));
    };
    rungs.forEach((r, net) => {
      walk(r.cond, net);
      r.outs.forEach((o) => {
        const op = up(o.op), a = o.args.map(up);
        if (((op === "OUT" && a.length >= 2) || ((op === "TIM" || op === "CNT") && a.length >= 2)) && /^(T|C)\d/.test(a[0])) {
          tcs.push({ d: a[0], op, val: a.slice(1).join(" "), net }); note(a[0], net);
        } else if ((op === "OUT" || op === "SET" || op === "RST") && a.length === 1) {
          outs.push({ d: a[0], op, net }); if (isDev(a[0])) note(a[0], net);
        } else {
          apps.push({ op, args: a, net }); a.forEach((x) => { if (isDev(x)) note(x, net); });
        }
      });
    });
    return { contacts, outs, tcs, apps, devs };
  }

  function splitText(text) {
    const asciiParts = [];
    let prose = String(text).replace(/```[^\n]*\n([\s\S]*?)```/g, (m, body) => { if (ASCII.test(body)) asciiParts.push(body); return "\n"; });
    prose = prose.split("\n").filter((l) => {
      if (ASCII.test(l)) { asciiParts.push(l); return false; }
      return !ILLINE.test(l);
    }).join("\n");
    return { prose, ascii: asciiParts.join("\n") };
  }

  const NOKW = { "a접점": "NO", "b접점": "NC", "NO": "NO", "NC": "NC", "N.O.": "NO", "N.C.": "NC", "상시열림": "NO", "평상시열림": "NO", "상시닫힘": "NC", "평상시닫힘": "NC", "ON": "NO", "OFF": "NC" };
  const OUTKW = { SET: "SET", "세트": "SET", "셋": "SET", "래치": "SET", RST: "RST", "리셋": "RST", "해제": "RST", OUT: "OUT" };
  function check(text, ilCode) {
    try { return run(text, ilCode); } catch (e) { return { error: "일치 검사 중 오류: " + (e && e.message || e), items: [], findings: [], counts: { ok: 0, diff: 0, unk: 0, none: 0 } }; }
  }

  function run(text, ilCode) {
    const rungs = typeof PanelLadder !== "undefined" && ilCode ? PanelLadder.parse(ilCode) : null;
    if (!rungs) return { error: "IL 코드를 해석할 수 없어 일치 검사를 수행하지 못했습니다.", items: [], findings: [], counts: { ok: 0, diff: 0, unk: 0, none: 0 } };
    const S = summarize(rungs), { prose, ascii } = splitText(text);
    const items = [], findings = [];
    const lineOf = (net) => (net != null && rungs[net] ? rungs[net].start : null);
    const fixTxt = "IL 코드를 기준으로 설명을 다시 확인하세요. 이 검사는 코드를 자동으로 수정하지 않습니다.";
    const add = (status, cat, label, detail, f) => {
      items.push({ status, cat, label, detail });
      if (status === "diff") findings.push({ source: "consistency", type: (f && f.type) || "mismatch", lvl: "mid", line: (f && f.line) || null, code: (f && f.code) || label, desc: detail, fix: fixTxt });
    };
    const used = [];
    const inUsed = (i) => used.some(([a, b]) => i >= a && i < b);

    // Network count
    const total = rungs.length;
    const cnt = /(\d+)\s*개\s*(?:의\s*)?(?:네트워크|랭|rung|network)/i.exec(prose) || /(?:네트워크|랭|rung|network)\s*(?:수|개수)?\s*[:：]?\s*(\d+)\s*개/i.exec(prose);
    const nums = new Set([...prose.matchAll(/(?:네트워크|network|net|랭|rung)\s*#?\s*(\d+)/gi)].map((m) => +m[1]));
    if (cnt) add(+cnt[1] === total ? "ok" : "diff", "네트워크", "네트워크 개수", "설명 " + cnt[1] + "개 / IL " + total + "개", { type: "network_count_mismatch", code: "네트워크 " + cnt[1] + "개 ≠ " + total + "개" });
    else if (nums.size) add("unk", "네트워크", "네트워크 개수", "설명에서 네트워크 번호 " + nums.size + "개가 언급되었지만 번호 체계(0/1 시작)와 전체 개수를 확인할 수 없습니다. IL " + total + "개");
    else add("none", "네트워크", "네트워크 개수", "설명에 네트워크 개수 서술이 없습니다. IL " + total + "개");

    // Applications
    const appMentions = [...prose.matchAll(APPRE)];
    appMentions.forEach((m) => { used.push([m.index, m.index + m[0].length]); });
    appMentions.forEach((m) => {
      const op = up(m[1]), opd = up(m[2]).split(/\s+/).join(" ");
      const same = S.apps.filter((a) => a.op === op);
      const hit = same.find((a) => a.args.join(" ") === opd);
      const label = op + " " + opd;
      if (hit) add("ok", "응용 명령어", label, "IL 줄 " + lineOf(hit.net) + " 근처 네트워크의 명령과 일치", { line: lineOf(hit.net) });
      else if (same.length) add("diff", "응용 명령어", label, "설명 '" + label + "' / IL '" + same.map((a) => a.op + " " + a.args.join(" ")).join("', '") + "'", { type: "operand_mismatch", code: label, line: lineOf(same[0].net) });
      else add("diff", "응용 명령어", label, "설명에 있는 " + op + " 명령이 IL 코드에 없습니다.", { type: "instruction_mismatch", code: label });
    });
    S.apps.forEach((a) => {
      const label = a.op + " " + a.args.join(" ");
      if (!appMentions.some((m) => up(m[1]) === a.op && up(m[2]).split(/\s+/).join(" ") === a.args.join(" "))) add("none", "응용 명령어", label, "설명에서 이 명령을 찾을 수 없습니다.", { line: lineOf(a.net) });
    });

    // Device occurrences in prose
    const occ = [...prose.matchAll(DEV)].map((m) => ({ d: m[1], i: m.index, end: m.index + m[0].length })).filter((o) => !inUsed(o.i));
    const proseDevs = [...new Set(occ.map((o) => o.d))];

    // Timers / counters
    S.tcs.forEach((tc) => {
      const kind = /^T/.test(tc.d) ? "타이머" : "카운터";
      const o = occ.find((x) => x.d === tc.d);
      if (!o) { add("none", kind, tc.d, "설명에서 " + tc.d + " " + kind + "를 찾을 수 없습니다. IL 설정값 " + tc.val, { line: lineOf(tc.net) }); return; }
      add("ok", kind + " 번호", tc.d, "설명과 IL 모두 " + tc.d + " 사용", { line: lineOf(tc.net) });
      const nextDev = occ.find((x) => x.i > o.i && x.d !== tc.d);
      const lineEnd = prose.indexOf("\n", o.end), lim = Math.min(lineEnd < 0 ? prose.length : lineEnd, o.end + 50, nextDev ? nextDev.i : Infinity);
      const seg = prose.slice(o.end, lim);
      const km = new RegExp(KV.source).exec(seg);
      const ilK = /^K(-?\d+)$/.exec(tc.val);
      if (km) {
        used.push([o.end + km.index, o.end + km.index + km[0].length]);
        if (!ilK) add("unk", kind + " 설정값", tc.d, "IL 설정값 '" + tc.val + "'이 K 상수가 아니어서 설명 K" + km[1] + "과 비교할 수 없습니다.", { line: lineOf(tc.net) });
        else add(+km[1] === +ilK[1] ? "ok" : "diff", kind + " 설정값", tc.d, "설명 K" + km[1] + " / IL " + tc.val, { type: (kind === "타이머" ? "timer" : "counter") + "_value_mismatch", code: tc.d + " K" + km[1] + " ≠ " + tc.val, line: lineOf(tc.net) });
        return;
      }
      const tm = /(\d+(?:\.\d+)?)\s*(초|sec|ms|분)/i.exec(seg), cm = kind === "카운터" ? /(\d+)\s*(회|번|개|펄스|pulse)/i.exec(seg) : null;
      if (cm && ilK) add(+cm[1] === +ilK[1] ? "ok" : "diff", kind + " 설정값", tc.d, "설명 " + cm[1] + cm[2] + " / IL " + tc.val, { type: "counter_value_mismatch", code: tc.d + " " + cm[1] + cm[2] + " ≠ " + tc.val, line: lineOf(tc.net) });
      else if (tm) add("unk", kind + " 설정값", tc.d, "설명 '" + tm[0] + "'은 시간 단위로 표기되어 있습니다. 타이머 단위(100ms/10ms/1ms)는 PLC 설정에 따라 달라 K값과 직접 비교할 수 없습니다. IL " + tc.val, { line: lineOf(tc.net) });
      else add("none", kind + " 설정값", tc.d, "설명에 " + tc.d + " 설정값 서술이 없습니다. IL " + tc.val, { line: lineOf(tc.net) });
    });
    occ.filter((o) => isTC(o.d) && !S.devs.has(o.d)).forEach((o) => {
      const lineEnd = prose.indexOf("\n", o.end), nextDev = occ.find((x) => x.i > o.i);
      const seg = prose.slice(o.end, Math.min(lineEnd < 0 ? prose.length : lineEnd, o.end + 50, nextDev ? nextDev.i : Infinity));
      const km = new RegExp(KV.source).exec(seg);
      if (km) used.push([o.end + km.index, o.end + km.index + km[0].length]);
    });
    proseDevs.filter((d) => isTC(d) && !S.devs.has(d)).forEach((d) => {
      add("diff", /^T/.test(d) ? "타이머 번호" : "카운터 번호", d, "설명의 " + d + "가 IL 코드에 없습니다.", { type: (/^T/.test(d) ? "timer" : "counter") + "_number_mismatch", code: d });
    });

    // Plain devices
    proseDevs.filter((d) => !isTC(d)).forEach((d) => {
      if (S.devs.has(d)) add("ok", "디바이스 주소(존재만 확인)", d, "설명과 IL 모두 " + d + " 사용 (주소 존재만 확인)", { line: lineOf(S.devs.get(d)) });
      else add("diff", "디바이스 주소(존재만 확인)", d, "설명에 있는 " + d + "가 IL 코드에 없습니다.", { type: "device_mismatch", code: d });
    });
    [...S.devs.keys()].filter((d) => !isTC(d) && !proseDevs.includes(d)).forEach((d) => {
      add("none", "디바이스 주소(존재만 확인)", d, "설명에서 " + d + "를 찾을 수 없습니다.", { line: lineOf(S.devs.get(d)) });
    });

    // NO/NC and OUT/SET/RST wording near a device
    const contactDevs = new Map(), outDevs = new Map();
    S.contacts.forEach((c) => { if (!contactDevs.has(c.d)) contactDevs.set(c.d, { kinds: new Set(), net: c.net }); contactDevs.get(c.d).kinds.add(c.k); });
    S.outs.forEach((o) => { if (!outDevs.has(o.d)) outDevs.set(o.d, { ops: new Set(), net: o.net }); outDevs.get(o.d).ops.add(o.op); });
    const seenK = new Set(), seenO = new Set();
    occ.forEach((o) => {
      const before = prose.slice(Math.max(0, o.i - 14), o.i), after = prose.slice(o.end, o.end + 22);
      if (contactDevs.has(o.d)) {
        const info = contactDevs.get(o.d);
        let kw = null;
        const mb = /(a\s*접점|b\s*접점|N\.?O\.?\s*접점|N\.?C\.?\s*접점|상시\s*열림|평상시\s*열림|상시\s*닫힘|평상시\s*닫힘)[\s(\[:]*$/i.exec(before);
        const ma = /^\s*(?:을|를|은|는|이|가)?\s*[\(\[:]?\s*(a\s*접점|b\s*접점|N\.?O\.?(?![A-Za-z])|N\.?C\.?(?![A-Za-z])|상시\s*열림|평상시\s*열림|상시\s*닫힘|평상시\s*닫힘)/i.exec(after);
        const mo = /^\s*(ON|OFF)\s*(?:일\s*때|이면|시|되면|상태)/i.exec(after);
        if (mb) kw = mb[1]; else if (ma) kw = ma[1]; else if (mo) kw = mo[1];
        if (kw) {
          const key = o.d + "|" + kw;
          if (seenK.has(key)) return; seenK.add(key);
          const nk = kw.replace(/\s+/g, "").replace(/\./g, "").toLowerCase();
          const stated = /^(a접점|no|상시열림|평상시열림|on)$/.test(nk) || /^no접점$/.test(nk) ? "NO" : "NC";
          const hasNO = info.kinds.has("NO"), hasNC = info.kinds.has("NC");
          const ilTxt = [...info.kinds].join("/");
          if (!hasNO && !hasNC) add("unk", "접점 NO/NC", o.d, "IL 접점 종류 " + ilTxt + "는 NO/NC로 직접 비교할 수 없습니다.", { line: lineOf(info.net) });
          else add((stated === "NO" ? hasNO : hasNC) ? "ok" : "diff", "접점 NO/NC", o.d, "설명 " + stated + "(" + kw.trim() + ") / IL " + ilTxt, { type: "contact_type_mismatch", code: o.d + " " + stated + " ≠ " + ilTxt, line: lineOf(info.net) });
        }
      }
      if (outDevs.has(o.d)) {
        const info = outDevs.get(o.d);
        const mb = /(SET|RST|OUT)[\s(\[:]*$/i.exec(before);
        const ma = /^\s*(?:을|를|은|는|이|가)?\s*[\(\[:]?\s*(SET|RST|OUT(?![A-Za-z])|세트|셋|래치|리셋|해제)/i.exec(after);
        const kw = mb ? mb[1] : ma ? ma[1] : null;
        if (kw) {
          const stated = OUTKW[kw.toUpperCase()] || OUTKW[kw];
          const key = o.d + "|" + stated;
          if (seenO.has(key)) return; seenO.add(key);
          const ilTxt = [...info.ops].join("/");
          add(info.ops.has(stated) ? "ok" : "diff", "출력 명령", o.d, "설명 " + stated + " / IL " + ilTxt, { type: "output_kind_mismatch", code: o.d + " " + stated + " ≠ " + ilTxt, line: lineOf(info.net) });
        }
      }
    });
    if (!items.some((x) => x.cat === "접점 NO/NC") && contactDevs.size) add("none", "접점 NO/NC", "접점 " + contactDevs.size + "개", "설명에 a접점/b접점 또는 NO/NC 서술이 없습니다.");
    if (!items.some((x) => x.cat === "출력 명령") && outDevs.size) add("none", "출력 명령", "출력 " + outDevs.size + "개", "설명에 OUT/SET/RST 구분 서술이 없습니다.");

    // Generic K values outside the bound ones
    const ilKs = new Set();
    const grabK = (a) => { const m = /^K(-?\d+)$/.exec(a); if (m) ilKs.add(+m[1]); };
    S.tcs.forEach((t) => t.val.split(" ").forEach(grabK)); S.apps.forEach((a) => a.args.forEach(grabK));
    rungs.forEach((r) => { const w = (n) => { if (n.t === "c") (n.args || []).forEach((a) => grabK(up(a))); else n.n.forEach(w); }; w(r.cond); });
    const seenV = new Set();
    [...prose.matchAll(KV)].forEach((m) => {
      if (inUsed(m.index) || seenV.has(m[1])) return; seenV.add(m[1]);
      add(ilKs.has(+m[1]) ? "ok" : "diff", "설정값(존재만 확인)", "K" + m[1], ilKs.has(+m[1]) ? "IL 코드 어딘가에 K" + m[1] + " 존재 (어느 명령에 쓰였는지는 확인하지 않음)" : "설명의 K" + m[1] + "이 IL 코드에 없습니다.", { type: "setvalue_mismatch", code: "K" + m[1] });
    });

    // Series/parallel structure
    if (ascii) {
      add("unk", "직렬·병렬 구조", "ASCII 래더", "ASCII 래더의 직렬·병렬 구조와 접점 종류는 비교하지 않습니다(주소와 K값만 비교).");
      const aDevs = [...new Set([...ascii.matchAll(DEV)].map((m) => m[1]))];
      aDevs.forEach((d) => add(S.devs.has(d) ? "ok" : "diff", "ASCII 주소", d, S.devs.has(d) ? "ASCII 래더와 IL 모두 " + d + " 사용" : "ASCII 래더의 " + d + "가 IL 코드에 없습니다.", { type: "ascii_device_mismatch", code: d }));
      const missing = [...S.devs.keys()].filter((d) => !aDevs.includes(d));
      if (missing.length) add("unk", "ASCII 주소", missing.join(", "), "IL에는 있지만 ASCII 래더에서 찾지 못한 주소입니다. ASCII가 일부만 표시했는지 확인할 수 없습니다.");
      [...new Set([...ascii.matchAll(KV)].map((m) => +m[1]))].forEach((v) => add(ilKs.has(v) ? "ok" : "diff", "ASCII 설정값", "K" + v, ilKs.has(v) ? "ASCII 래더와 IL 모두 K" + v + " 사용" : "ASCII 래더의 K" + v + "이 IL 코드에 없습니다.", { type: "ascii_value_mismatch", code: "K" + v }));
    } else add("none", "ASCII 래더", "ASCII 래더", "응답에 ASCII 래더가 없습니다.");
    if (/직렬|병렬|자기\s*유지|AND\s*조건|OR\s*조건/i.test(prose)) add("unk", "직렬·병렬 구조", "설명 문장", "설명의 직렬·병렬 서술은 문장에서 구조를 신뢰성 있게 추출할 수 없어 비교하지 않습니다. 위 래더 도식을 IL 기준으로 직접 확인하세요.");
    else add("none", "직렬·병렬 구조", "설명 문장", "설명에 직렬·병렬 구조 서술이 없습니다.");

    const counts = { ok: 0, diff: 0, unk: 0, none: 0 };
    items.forEach((x) => counts[x.status]++);
    const target = "네트워크 " + total + "개 · 접점 " + S.contacts.length + " · 출력 " + S.outs.length + " · 타이머/카운터 " + S.tcs.length + " · 응용 명령 " + S.apps.length + (ascii ? " · ASCII 래더 포함" : "");
    return { error: null, target, items, findings, counts };
  }

  return { check, STATUS: ST };
})();
