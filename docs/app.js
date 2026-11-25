(() => {
  "use strict";

  const PASS_STORAGE_KEY = "livestream_cal_pass_v1";

  const TYPE_COLOR_MAP = {
    "专业课": 0,
    "朝阳计划": 1,
    "百场督导咨询观摩": 2,
    "平台产品": 3,
    "团督": 4,
    "朝阳训练营": 5,
    "咨询伦理决策现场": 2,
  };

  const ROOM_SHORT = {
    "19楼": "19F",
    "21楼·就事论事": "21F·就事",
    "21楼·赏心悦室": "21F·赏心",
  };

  const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  // 2026 & 2027 China Official Statutory Holidays (国务院放假调休安排) + Festivals (incl. 情人节 & 儿童节)
  const CHINA_STATUTORY_HOLIDAYS = {
    // ---- 2026 ----
    "2026-01-01": { kind: "off", name: "元旦" },
    "2026-01-02": { kind: "off", name: "元旦休" },
    "2026-01-03": { kind: "off", name: "元旦休" },
    "2026-01-04": { kind: "work", name: "补班" },
    "2026-02-14": { kind: "work", name: "补班" },
    "2026-02-15": { kind: "off", name: "春节休" },
    "2026-02-16": { kind: "off", name: "除夕" },
    "2026-02-17": { kind: "off", name: "春节" },
    "2026-02-18": { kind: "off", name: "春节休" },
    "2026-02-19": { kind: "off", name: "春节休" },
    "2026-02-20": { kind: "off", name: "春节休" },
    "2026-02-21": { kind: "off", name: "春节休" },
    "2026-02-22": { kind: "off", name: "春节休" },
    "2026-02-23": { kind: "off", name: "春节休" },
    "2026-02-28": { kind: "work", name: "补班" },
    "2026-04-04": { kind: "off", name: "清明休" },
    "2026-04-05": { kind: "off", name: "清明节" },
    "2026-04-06": { kind: "off", name: "清明休" },
    "2026-05-01": { kind: "off", name: "劳动节" },
    "2026-05-02": { kind: "off", name: "五一休" },
    "2026-05-03": { kind: "off", name: "五一休" },
    "2026-05-04": { kind: "off", name: "五一休" },
    "2026-05-05": { kind: "off", name: "五一休" },
    "2026-05-09": { kind: "work", name: "补班" },
    "2026-06-19": { kind: "off", name: "端午节" },
    "2026-06-20": { kind: "off", name: "端午休" },
    "2026-06-21": { kind: "off", name: "端午休" },
    "2026-09-20": { kind: "work", name: "补班" },
    "2026-09-25": { kind: "off", name: "中秋节" },
    "2026-09-26": { kind: "off", name: "中秋休" },
    "2026-09-27": { kind: "off", name: "中秋休" },
    "2026-10-01": { kind: "off", name: "国庆节" },
    "2026-10-02": { kind: "off", name: "国庆休" },
    "2026-10-03": { kind: "off", name: "国庆休" },
    "2026-10-04": { kind: "off", name: "国庆休" },
    "2026-10-05": { kind: "off", name: "国庆休" },
    "2026-10-06": { kind: "off", name: "国庆休" },
    "2026-10-07": { kind: "off", name: "国庆休" },
    "2026-10-10": { kind: "work", name: "补班" },
    // ---- 2027 ----
    "2027-01-01": { kind: "off", name: "元旦" },
    "2027-01-02": { kind: "off", name: "元旦休" },
    "2027-01-03": { kind: "off", name: "元旦休" },
    "2027-01-31": { kind: "work", name: "补班" },
    "2027-02-05": { kind: "off", name: "除夕" },
    "2027-02-06": { kind: "off", name: "春节" },
    "2027-02-07": { kind: "off", name: "春节休" },
    "2027-02-08": { kind: "off", name: "春节休" },
    "2027-02-09": { kind: "off", name: "春节休" },
    "2027-02-10": { kind: "off", name: "春节休" },
    "2027-02-11": { kind: "off", name: "春节休" },
    "2027-02-12": { kind: "off", name: "春节休" },
    "2027-02-13": { kind: "off", name: "春节休" },
    "2027-02-14": { kind: "work", name: "补班" },
    "2027-04-03": { kind: "off", name: "清明休" },
    "2027-04-04": { kind: "off", name: "清明休" },
    "2027-04-05": { kind: "off", name: "清明节" },
    "2027-05-01": { kind: "off", name: "劳动节" },
    "2027-05-02": { kind: "off", name: "五一休" },
    "2027-05-03": { kind: "off", name: "五一休" },
    "2027-05-04": { kind: "off", name: "五一休" },
    "2027-05-05": { kind: "off", name: "五一休" },
    "2027-05-08": { kind: "work", name: "补班" },
    "2027-06-09": { kind: "off", name: "端午节" },
    "2027-09-15": { kind: "off", name: "中秋节" },
    "2027-09-26": { kind: "work", name: "补班" },
    "2027-10-01": { kind: "off", name: "国庆节" },
    "2027-10-02": { kind: "off", name: "国庆休" },
    "2027-10-03": { kind: "off", name: "国庆休" },
    "2027-10-04": { kind: "off", name: "国庆休" },
    "2027-10-05": { kind: "off", name: "国庆休" },
    "2027-10-06": { kind: "off", name: "国庆休" },
    "2027-10-07": { kind: "off", name: "国庆休" },
    "2027-10-09": { kind: "work", name: "补班" },
  };

  const FIXED_FESTIVALS_MD = {
    "02-14": "情人节",
    "03-08": "妇女节",
    "05-04": "青年节",
    "06-01": "儿童节",
    "07-01": "建党节",
    "08-01": "建军节",
    "09-10": "教师节",
    "11-11": "双11",
    "12-24": "平安夜",
    "12-25": "圣诞节",
  };

  const YEARLY_FESTIVALS = {
    "2026-01-26": "腊八节",
    "2026-03-03": "元宵节",
    "2026-05-10": "母亲节",
    "2026-06-21": "父亲节",
    "2026-08-19": "七夕节",
    "2026-10-18": "重阳节",
    "2027-01-15": "腊八节",
    "2027-02-20": "元宵节",
    "2027-05-09": "母亲节",
    "2027-06-20": "父亲节",
    "2027-08-08": "七夕节",
    "2027-10-19": "重阳节",
  };

  function getDateHolidayInfo(dateKey) {
    const stat = CHINA_STATUTORY_HOLIDAYS[dateKey] || null;
    const fest = YEARLY_FESTIVALS[dateKey] || FIXED_FESTIVALS_MD[dateKey.slice(5)] || "";
    return { stat, fest };
  }

  function renderHolidayBadges(dateKey) {
    const { stat, fest } = getDateHolidayInfo(dateKey);
    let html = "";
    if (stat) {
      const cls = stat.kind === "off" ? "holiday-off" : "holiday-work";
      const label = stat.kind === "off"
        ? (stat.name.endsWith("休") ? "休" : `休·${stat.name}`)
        : "班";
      html += `<span class="holiday-tag ${cls}" title="${escapeHtml(stat.name)}">${escapeHtml(label)}</span>`;
    }
    if (fest) {
      html += `<span class="holiday-tag holiday-festival" title="${escapeHtml(fest)}">${escapeHtml(fest)}</span>`;
    }
    return html;
  }

  const state = {
    encryptedEnvelope: null,
    isEncryptedMode: false,
    activePassword: "",
    liveSync: null,
    meta: {},
    events: [],
    view: "month",
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    weekStart: getMonday(new Date()),
    search: "",
    room: "",
    type: "",
    ops: "",
    invite: "",
    conflictOnly: false,
  };

  function getMonday(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d;
  }

  function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]));
  }

  function getTypeIdx(type) {
    if (type in TYPE_COLOR_MAP) return TYPE_COLOR_MAP[type];
    let h = 0;
    for (const ch of String(type || "其他")) h = (h * 31 + ch.charCodeAt(0)) % 6;
    return Math.abs(h);
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---- Web Crypto AES-256-GCM Decryption ----
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function decryptEnvelope(envelope, password) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("当前环境不支持 Web Crypto 解密，请通过 HTTPS 网址或 localhost 访问");
    }
    const enc = new TextEncoder();
    const salt = b64ToBytes(envelope.salt);
    const iv = b64ToBytes(envelope.iv);
    const combined = b64ToBytes(envelope.ciphertext);
    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: Number(envelope.iterations) || 200000,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plainBuf = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, combined);
    if (envelope.compressed === "gzip") {
      if (typeof DecompressionStream !== "function") {
        throw new Error("当前浏览器版本过旧，不支持 gzip 解压，请升级浏览器");
      }
      const stream = new Blob([plainBuf]).stream().pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(stream).text();
      return JSON.parse(text);
    }
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  function showLockScreen(errorMsg = "") {
    document.getElementById("appShell").classList.add("hidden");
    document.getElementById("lockScreen").classList.remove("hidden");
    const errEl = document.getElementById("lockError");
    if (errorMsg) {
      errEl.textContent = errorMsg;
      errEl.classList.remove("hidden");
    } else {
      errEl.classList.add("hidden");
    }
    setTimeout(() => document.getElementById("passwordInput").focus(), 30);
  }

  function showAppWithData(data) {
    state.meta = data.meta || {};
    state.events = data.events || [];
    state.liveSync = data.liveSync || null;
    document.getElementById("lockScreen").classList.add("hidden");
    document.getElementById("appShell").classList.remove("hidden");

    const encMode = Boolean(state.isEncryptedMode || state.meta.encrypted);
    document.getElementById("encBadge").classList.toggle("hidden", !encMode);
    document.getElementById("lockBtn").classList.toggle("hidden", !encMode);
    document.getElementById("copyIcsUrlBtn").classList.toggle("hidden", encMode);

    updateHeaderMeta();
    populateFilterControls();
    alignInitialPeriod(state.events);
    render();
    scrollToTodayCell(false);
  }

  function scrollToTodayCell(smooth = true) {
    requestAnimationFrame(() => {
      const todayEl = document.querySelector("[data-is-today='true']");
      if (todayEl) {
        todayEl.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "center" });
      }
    });
  }

  // ---- Theme ----
  function initTheme() {
    const saved = localStorage.getItem("calendar_theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
    document.getElementById("themeBtn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("calendar_theme", next);
      applyTheme(next);
    });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.getElementById("themeBtn").textContent = theme === "dark" ? "浅色模式" : "深色模式";
  }

  function alignInitialPeriod(events) {
    const now = new Date();
    const curPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dated = events.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    if (!dated.length) return;

    if (dated.some((e) => e.date.startsWith(curPrefix))) {
      state.year = now.getFullYear();
      state.month = now.getMonth();
      state.weekStart = getMonday(now);
      return;
    }

    const first = dated[0].date.split("-").map(Number);
    state.year = first[0];
    state.month = first[1] - 1;
    state.weekStart = getMonday(new Date(first[0], first[1] - 1, first[2]));
  }

  function populateFilterControls() {
    const rooms = [...new Set(state.events.map((e) => e.room).filter(Boolean))];
    const types = [...new Set(state.events.map((e) => e.type).filter(Boolean))];
    const opsList = [...new Set(state.events.map((e) => e.ops).filter(Boolean))];

    fillSelect("roomFilter", "全部直播间", rooms, true, "未填直播间");
    fillSelect("typeFilter", "全部直播类型", types, false);
    fillSelect("opsFilter", "全部运营", opsList, true, "未填运营");

    const months = [...new Set(state.events.map((e) => (e.date || "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
    const quickEl = document.getElementById("quickMonths");
    quickEl.className = "quick-months-wrap";

    const jumpToYM = (ym) => {
      if (!ym || !ym.includes("-")) return;
      const [y, m] = ym.split("-").map(Number);
      state.year = y;
      state.month = m - 1;
      const firstInMonth = state.events.find((e) => e.date && e.date.startsWith(ym));
      if (firstInMonth) {
        const [fy, fm, fd] = firstInMonth.date.split("-").map(Number);
        state.weekStart = getMonday(new Date(fy, fm - 1, fd));
      } else {
        state.weekStart = getMonday(new Date(y, m - 1, 1));
      }
      render();
    };

    const primaryMonths = months.slice(0, 3);
    const extraMonths = months.slice(3);
    let quickHtml = primaryMonths
      .map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        return `<button type="button" class="btn btn-ghost quick-month-btn" data-ym="${ym}">${y}年${m}月</button>`;
      })
      .join("");
    if (extraMonths.length) {
      quickHtml +=
        `<select id="moreMonthsSelect" class="select quick-month-select" aria-label="更多月份">` +
        `<option value="">更多月份 (${extraMonths.length})</option>` +
        extraMonths
          .map((ym) => {
            const [y, m] = ym.split("-").map(Number);
            return `<option value="${ym}">${y}年${m}月</option>`;
          })
          .join("") +
        `</select>`;
    }
    quickEl.innerHTML = quickHtml;
    quickEl.querySelectorAll(".quick-month-btn").forEach((btn) => {
      btn.addEventListener("click", () => jumpToYM(btn.dataset.ym));
    });
    const moreSel = document.getElementById("moreMonthsSelect");
    if (moreSel) {
      moreSel.addEventListener("change", (e) => {
        if (e.target.value) {
          jumpToYM(e.target.value);
          e.target.value = "";
        }
      });
    }

    document.getElementById("legendBar").innerHTML =
      `<strong style="color:var(--text);">图例：</strong>` +
      types
        .map((t) => `<span class="legend-item"><span class="swatch" style="background:var(--cat-${getTypeIdx(t)});"></span>${escapeHtml(t)}</span>`)
        .join("") +
      `<span class="legend-item" style="color:var(--danger);font-weight:600;"><span class="swatch" style="background:var(--danger);"></span>时段冲突</span>` +
      `<span class="legend-item"><span class="dot" style="background:var(--success);"></span>已邀约</span>` +
      `<span class="legend-item"><span class="dot" style="background:var(--warning);"></span>未邀约</span>`;
  }

  function fillSelect(id, allLabel, items, includeEmpty, emptyLabel) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    let html = `<option value="">${allLabel}</option>` +
      items.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (includeEmpty) html += `<option value="__EMPTY__">${emptyLabel}</option>`;
    sel.innerHTML = html;
    sel.value = cur;
  }

  function updateHeaderMeta() {
    const modeMap = {
      "dingtalk-3table": "钉钉三表联动同步",
      "dingtalk-api": "钉钉 API 自动同步",
      "csv-fallback": "排期快照",
      "csv-manual": "CSV 加密同步",
      "browser-csv": "本地 CSV 预演",
    };
    const badge = document.getElementById("syncBadge");
    badge.textContent = `${modeMap[state.meta.sourceMode] || "已就绪"} · ${state.events.length} 场`;
    badge.className = `pill ${state.meta.sourceMode && state.meta.sourceMode.startsWith("dingtalk") ? "success" : "warning"}`;
    document.getElementById("syncTimeBadge").textContent = `上次同步：${state.meta.syncedAt || "--"}`;

    const srcLink = document.getElementById("sourceLink");
    if (state.meta.sourceUrl) {
      srcLink.href = state.meta.sourceUrl;
      srcLink.classList.remove("hidden");
    } else {
      srcLink.classList.add("hidden");
    }
  }

  function getFilteredEvents() {
    const q = state.search.trim().toLowerCase();
    return state.events.filter((e) => {
      if (state.room === "__EMPTY__" && e.room) return false;
      if (state.room && state.room !== "__EMPTY__" && e.room !== state.room) return false;
      if (state.type && e.type !== state.type) return false;
      if (state.ops === "__EMPTY__" && e.ops) return false;
      if (state.ops && state.ops !== "__EMPTY__" && e.ops !== state.ops) return false;
      if (state.invite === "__EMPTY__" && e.inviteStatus) return false;
      if (state.invite && state.invite !== "__EMPTY__" && e.inviteStatus !== state.invite) return false;
      if (state.conflictOnly && !e.isConflict && !e.hasAnomaly) return false;
      if (q) {
        const hay = [
          e.displayTitle, e.type, e.speaker, e.host, e.ops, e.stageControl, e.streamPush,
          e.room, e.videoAccount, e.appAccount, e.broadcastMode, e.coursePrice, e.salesType,
          e.detail, e.scheduleNote,
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderKPIs(filtered) {
    const total = filtered.length;
    const room19 = filtered.filter((e) => e.room === "19楼").length;
    const room21 = filtered.filter((e) => e.room && e.room.startsWith("21楼")).length;
    const invited = filtered.filter((e) => e.inviteStatus === "已邀约").length;
    const conflicts = filtered.filter((e) => e.isConflict).length;

    const cards = [
      { label: "筛选场次", val: total, sub: `总排期 ${state.events.length} 场`, color: "var(--text)" },
      { label: "19楼直播间", val: room19, sub: "与21楼互为并行间", color: "var(--cat-0)" },
      { label: "21楼直播间", val: room21, sub: "就事论事 + 赏心悦室", color: "var(--cat-1)" },
      { label: "讲师已邀约", val: invited, sub: `待确认/未邀约 ${total - invited} 场`, color: "var(--success)" },
      { label: "冲突预警", val: conflicts, sub: conflicts ? "建议勾选“仅看冲突”排查" : "当前排期无冲突", color: conflicts ? "var(--danger)" : "var(--success)" },
    ];

    document.getElementById("kpiBar").innerHTML = cards
      .map((c) => `
        <div class="kpi-card">
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-value" style="color:${c.color};">${c.val}</div>
          <div class="kpi-sub">${c.sub}</div>
        </div>
      `)
      .join("");
  }

  function renderAnomalyBanner(filtered) {
    const undated = filtered.filter((e) => !e.date);
    const el = document.getElementById("anomalyBanner");
    if (!undated.length) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="pill danger">缺日期排期 (${undated.length})</span>
        <span>以下记录在表格中缺少“日期”，无法落入日历格子：</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${undated
          .map((e) => `<button type="button" class="btn" style="border-color:var(--danger-border);color:var(--danger);" data-open-id="${escapeHtml(e.id)}">${escapeHtml(e.displayTitle)} (${escapeHtml(e.start || "?")}–${escapeHtml(e.end || "?")})</button>`)
          .join("")}
      </div>
    `;
  }

  function eventCardHtml(e, showEnd) {
    const idx = getTypeIdx(e.type);
    const roomShort = e.room ? (ROOM_SHORT[e.room] || e.room) : "缺房间";
    const people = [e.speaker, e.host].filter(Boolean).join(" / ");
    const dot = e.inviteStatus === "已邀约"
      ? `<span class="dot" style="background:var(--success);" title="已邀约"></span>`
      : e.inviteStatus === "未邀约"
        ? `<span class="dot" style="background:var(--warning);" title="未邀约"></span>`
        : "";

    return `
      <button type="button" class="event-card cat-${idx} ${e.isConflict ? "conflict" : ""}" data-open-id="${escapeHtml(e.id)}">
        <div class="ev-top">
          <span class="ev-time">${escapeHtml(e.start || "--:--")}${showEnd && e.end ? "–" + escapeHtml(e.end) : ""}</span>
          <span class="ev-meta-right">
            ${e.isConflict ? `<span class="conflict-tag">!冲突</span>` : ""}
            <span class="room-tag">${escapeHtml(roomShort)}</span>
            ${dot}
          </span>
        </div>
        <div class="ev-title">${escapeHtml(e.displayTitle)}</div>
        ${people ? `<div class="ev-people">${escapeHtml(people)}</div>` : ""}
      </button>
    `;
  }

  function renderMonth(filtered) {
    document.getElementById("periodTitle").textContent = `${state.year}年 ${state.month + 1}月`;
    const first = new Date(state.year, state.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(state.year, state.month, 1 - offset);
    const todayKey = formatDateKey(new Date());

    const byDate = {};
    for (const e of filtered) {
      if (!e.date) continue;
      (byDate[e.date] ||= []).push(e);
    }

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      if (i === 35 && d.getMonth() !== state.month) break;
      const key = formatDateKey(d);
      const inMonth = d.getMonth() === state.month;
      const list = byDate[key] || [];
      const hasConflict = list.some((e) => e.isConflict);
      const isToday = key === todayKey;
      const hInfo = getDateHolidayInfo(key);
      const holidayOffCls = hInfo.stat && hInfo.stat.kind === "off" ? "is-holiday-off" : "";

      cells.push(`
        <div class="day-cell ${inMonth ? "" : "outside"} ${isToday ? "today" : ""} ${holidayOffCls}" ${isToday ? 'data-is-today="true"' : ""}>
          <div class="day-head">
            <div class="day-head-left">
              <span class="day-num">${d.getDate() === 1 ? `${d.getMonth() + 1}月1日` : d.getDate()}</span>
              ${isToday ? `<span class="today-badge">今天</span>` : ""}
              ${renderHolidayBadges(key)}
            </div>
            ${list.length ? `<span class="day-count ${hasConflict ? "has-conflict" : ""}">${list.length}场</span>` : ""}
          </div>
          <div class="day-events">
            ${list.map((e) => eventCardHtml(e, false)).join("")}
          </div>
        </div>
      `);
    }

    document.getElementById("calendarRoot").innerHTML = `
      <div class="weekday-header">
        ${WEEKDAYS.map((w, i) => `<div class="weekday-cell ${i >= 5 ? "weekend" : ""}">${w}</div>`).join("")}
      </div>
      <div class="month-grid">${cells.join("")}</div>
    `;
  }

  function renderWeek(filtered) {
    const start = new Date(state.weekStart);
    const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const end = days[6];
    document.getElementById("periodTitle").textContent = `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;

    const knownStudios = [
      { key: "19楼", name: "19楼", sub: "主直播间（并行）" },
      { key: "21楼·就事论事", name: "21楼·就事论事", sub: "与19楼并行开播" },
      { key: "21楼·赏心悦室", name: "21楼·赏心悦室", sub: "与19楼并行开播" },
    ];
    const extraRooms = [...new Set(filtered.map((e) => e.room).filter((r) => r && !knownStudios.some((s) => s.key === r)))];
    for (const r of extraRooms) knownStudios.push({ key: r, name: r, sub: "直播间" });
    knownStudios.push({ key: "", name: "未分配直播间", sub: "需补充房间字段" });

    const map = {};
    for (const e of filtered) {
      if (!e.date) continue;
      const k = `${e.room || ""}__${e.date}`;
      (map[k] ||= []).push(e);
    }

    const visibleStudios = knownStudios.filter((s) => {
      if (s.key !== "") return true;
      return days.some((d) => (map[`__${formatDateKey(d)}`] || []).length > 0);
    });

    const todayKey = formatDateKey(new Date());
    const headCols = days
      .map((d, i) => {
        const key = formatDateKey(d);
        const isToday = key === todayKey;
        return `<th ${isToday ? 'data-is-today="true" style="background:var(--primary-soft);"' : ""}>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
            <span>${WEEKDAYS[i]}</span>
            ${isToday ? `<span class="today-badge">今天</span>` : ""}
            ${renderHolidayBadges(key)}
          </div>
          <div style="font-weight:400;color:var(--text-muted);font-variant-numeric:tabular-nums;">${d.getMonth() + 1}月${d.getDate()}日</div>
        </th>`;
      })
      .join("");

    const bodyRows = visibleStudios
      .map((studio) => {
        const tds = days
          .map((d) => {
            const list = map[`${studio.key}__${formatDateKey(d)}`] || [];
            return `
              <td class="week-cell">
                ${list.length ? `<div class="day-events">${list.map((e) => eventCardHtml(e, true)).join("")}</div>` : `<div class="empty-slot">—</div>`}
              </td>
            `;
          })
          .join("");
        return `
          <tr>
            <td class="studio-col">
              <div class="studio-name">${escapeHtml(studio.name)}</div>
              <div class="studio-sub">${escapeHtml(studio.sub)}</div>
            </td>
            ${tds}
          </tr>
        `;
      })
      .join("");

    document.getElementById("calendarRoot").innerHTML = `
      <div class="week-scroll">
        <table class="week-table">
          <thead>
            <tr><th class="studio-col">直播间泳道</th>${headCols}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  function renderAgenda(filtered) {
    document.getElementById("periodTitle").textContent = `全部日程 (${filtered.length} 场)`;
    if (!filtered.length) {
      document.getElementById("calendarRoot").innerHTML = `<div class="empty-state">当前筛选条件下暂无排期记录</div>`;
      return;
    }

    const groups = {};
    for (const e of filtered) {
      const k = e.date || "待定日期（原表缺日期）";
      (groups[k] ||= []).push(e);
    }

    document.getElementById("calendarRoot").innerHTML = Object.entries(groups)
      .map(([dateStr, items]) => {
        let label = dateStr;
        let badgesHtml = "";
        const todayKey = formatDateKey(new Date());
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const [y, m, d] = dateStr.split("-").map(Number);
          const dtObj = new Date(y, m - 1, d);
          label = `${dateStr} · ${WEEKDAYS[(dtObj.getDay() + 6) % 7]}`;
          badgesHtml = `${dateStr === todayKey ? '<span class="today-badge">今天</span>' : ""}${renderHolidayBadges(dateStr)}`;
        }
        return `
          <div class="agenda-group" ${dateStr === todayKey ? 'data-is-today="true"' : ""}>
            <div class="agenda-date-bar">
              <span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">${escapeHtml(label)} ${badgesHtml}</span>
              <span style="font-weight:400;color:var(--text-muted);">${items.length} 场直播</span>
            </div>
            ${items
              .map((e) => {
                const idx = getTypeIdx(e.type);
                const accounts = [e.videoAccount ? `视频号：${e.videoAccount}` : "", e.appAccount ? `APP：${e.appAccount}` : ""].filter(Boolean).join(" / ");
                const alerts = [...(e.conflictReasons || []), ...(e.anomalyReasons || [])];
                return `
                  <div class="agenda-row ${e.isConflict ? "conflict" : ""}" data-open-id="${escapeHtml(e.id)}">
                    <div class="agenda-left">
                      <span class="agenda-time">${escapeHtml(e.start || "--:--")}–${escapeHtml(e.end || "--:--")}</span>
                      <span class="cat-badge cat-badge-${idx}">${escapeHtml(e.type || "未分类")}</span>
                      <div style="min-width:0;flex:1;">
                        <div style="font-weight:700;font-size:13.5px;">${escapeHtml(e.displayTitle)}</div>
                        <div class="agenda-meta">
                          <span>直播间：${escapeHtml(e.room || "未分配")}</span>
                          ${e.speaker ? `<span>讲师：${escapeHtml(e.speaker)}</span>` : ""}
                          ${e.host ? `<span>主持：${escapeHtml(e.host)}</span>` : ""}
                          ${e.ops ? `<span>运营：${escapeHtml(e.ops)}</span>` : ""}
                          ${accounts ? `<span>${escapeHtml(accounts)}</span>` : ""}
                        </div>
                        ${alerts.length ? `<div class="agenda-alert">⚠ ${escapeHtml(alerts.join("；"))}</div>` : ""}
                      </div>
                    </div>
                    <div>
                      ${e.inviteStatus ? `<span class="pill ${e.inviteStatus === "已邀约" ? "success" : "warning"}">${escapeHtml(e.inviteStatus)}</span>` : `<span class="pill">邀约未填</span>`}
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        `;
      })
      .join("");
  }

  function render() {
    const filtered = getFilteredEvents();
    renderKPIs(filtered);
    renderAnomalyBanner(filtered);
    if (state.view === "month") renderMonth(filtered);
    else if (state.view === "week") renderWeek(filtered);
    else renderAgenda(filtered);
  }

  function openModal(id) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return;
    const idx = getTypeIdx(e.type);

    document.getElementById("modalBadges").innerHTML = `
      <span class="cat-badge cat-badge-${idx}">${escapeHtml(e.type || "未分类")}</span>
      ${e.origin === "supplement" ? `<span class="pill">补充表补录</span>` : ""}
      ${e.salesType ? `<span class="pill">${escapeHtml(e.salesType)}</span>` : ""}
      ${e.inviteStatus ? `<span class="pill ${e.inviteStatus === "已邀约" ? "success" : "warning"}">${escapeHtml(e.inviteStatus)}</span>` : ""}
      ${e.isConflict ? `<span class="pill danger">时段冲突</span>` : ""}
      ${e.supplementSources?.length ? `<span class="pill success">已补充：${escapeHtml(e.supplementSources.join(" + "))}</span>` : ""}
    `;
    document.getElementById("modalTitle").textContent = e.displayTitle;

    const alerts = [...(e.conflictReasons || []), ...(e.anomalyReasons || [])];
    const items = [
      ["日期与时段", `${e.date || "（缺失）"}  ${e.start || "--:--"} – ${e.end || "--:--"}`],
      ["直播间", e.room || "（未分配）"],
      ["视频号账号", e.videoAccount || "—"],
      ["APP 账号", e.appAccount || "—"],
      ["讲师", e.speaker || "—"],
      ["主持人 / 主播", e.host || "—"],
      ["对接运营", e.ops || "—"],
      ["场控 / 推流", [e.stageControl ? `场控：${e.stageControl}` : "", e.streamPush ? `推流：${e.streamPush}` : ""].filter(Boolean).join(" · ") || "—"],
    ];
    if (e.broadcastMode) items.push(["开播方式 / 平台", e.broadcastMode]);
    if (e.coursePrice) items.push(["课程（客单价）", e.coursePrice]);
    if (e.salesTarget) items.push(["转化目标", e.salesTarget]);
    if (e.detail) items.push(["原表详情摘要", e.detail]);

    document.getElementById("modalBody").innerHTML = `
      ${alerts.length ? `<div class="alert-box"><strong>冲突 / 数据提醒：</strong><br>${escapeHtml(alerts.join("；"))}</div>` : ""}
      <div class="detail-grid">
        ${items.map(([k, v]) => `<div class="detail-item"><div class="detail-k">${k}</div><div class="detail-v">${escapeHtml(v)}</div></div>`).join("")}
      </div>
      ${e.scheduleNote ? `<div class="detail-item"><div class="detail-k">直播时间表补充原文</div><div class="detail-v" style="font-weight:400;font-size:12.5px;line-height:1.55;">${escapeHtml(e.scheduleNote)}</div></div>` : ""}
    `;
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function closeModal() {
    document.getElementById("modalBackdrop").classList.remove("open");
  }

  // ---- Dynamic In-Browser ICS Export (no public plaintext calendar.ics needed) ----
  function timeToMins(t) {
    if (!t || !t.includes(":")) return null;
    const [h, m] = t.split(":").map(Number);
    return Number.isNaN(h) ? null : h * 60 + (m || 0);
  }

  function escapeIcs(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  function downloadFilteredIcs() {
    const list = getFilteredEvents().filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    const nowUtc = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//DingTalk Livestream Calendar//Encrypted Export//CN",
      "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:直播排期日历",
      "X-WR-TIMEZONE:Asia/Shanghai",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Shanghai",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0800",
      "TZOFFSETTO:+0800",
      "TZNAME:CST",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
    for (const e of list) {
      const dStr = e.date.replace(/-/g, "");
      const startHm = e.start || "09:00";
      let endHm = e.end || startHm;
      const sMins = timeToMins(startHm) ?? 540;
      let eMins = timeToMins(endHm);
      if (eMins == null || eMins <= sMins) {
        eMins = Math.min(sMins + 60, 23 * 60 + 59);
        endHm = `${String(Math.floor(eMins / 60)).padStart(2, "0")}:${String(eMins % 60).padStart(2, "0")}`;
      }
      const roomTag = ROOM_SHORT[e.room] || e.room || "待定";
      const summary = `${e.isConflict ? "[冲突] " : ""}[${roomTag}] ${e.displayTitle}`;
      const accounts = [e.videoAccount ? `视频号:${e.videoAccount}` : "", e.appAccount ? `APP:${e.appAccount}` : ""].filter(Boolean).join(" / ");
      const desc = [
        `直播类型：${e.type || "未分类"}`,
        `直播间：${e.room || "未分配"}`,
        `讲师：${e.speaker || "待定"} | 主持人：${e.host || "待定"} | 运营：${e.ops || "待定"}`,
        `邀约状态：${e.inviteStatus || "未填写"}`,
        `账号：${accounts || "待定"}`,
        ...(e.conflictReasons?.length ? [`冲突：${e.conflictReasons.join("；")}`] : []),
      ].join("\n");

      lines.push(
        "BEGIN:VEVENT",
        `UID:dingtalk-live-${e.id}@schedule`,
        `DTSTAMP:${nowUtc}`,
        `DTSTART;TZID=Asia/Shanghai:${dStr}T${startHm.replace(":", "")}00`,
        `DTEND;TZID=Asia/Shanghai:${dStr}T${endHm.replace(":", "")}00`,
        `SUMMARY:${escapeIcs(summary)}`,
        `LOCATION:${escapeIcs(e.room || "待定")}`,
        `DESCRIPTION:${escapeIcs(desc)}`,
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "直播排期日历.ics";
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${list.length} 场排期到 直播排期日历.ics`);
  }

  // ---- Client-side CSV preview import ----
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && next === "\n") i++;
          row.push(cell);
          if (row.some((c) => c.trim() !== "")) rows.push(row);
          row = []; cell = "";
        } else cell += ch;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function previewLocalCSV(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ""));
    const headerIdx = rows.findIndex((r) => r.includes("直播主题") && r.includes("日期"));
    if (headerIdx === -1) {
      showToast("未找到包含“直播主题”和“日期”的表头行");
      return;
    }
    const headers = rows[headerIdx].map((h) => h.trim());
    const col = (name) => headers.indexOf(name);
    const parsed = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (["姓名", "冲突对", "账号名称", "名称"].includes((r[0] || "").trim()) && (r.includes("角色") || r.includes("场次A") || r.includes("平台") || r.includes("说明"))) break;
      const title = (r[col("直播主题")] || "").trim();
      const date = (r[col("日期")] || "").trim();
      const type = (r[col("直播类型")] || "").trim();
      const start = (r[col("开始时间")] || "").trim();
      const end = (r[col("结束时间")] || "").trim();
      if (!title && !date && !type) continue;

      const room = (r[col("直播间")] || "").trim();
      const videoAccount = (r[col("视频号账号")] || "").trim() || ((r[col("视频号账号(旧)")] || "").trim() ? `${r[col("视频号账号(旧)")].trim()}(旧)` : "");
      const conflictReasons = (r[col("冲突标记")] || "").trim() === "冲突" ? [(r[col("冲突原因")] || "").trim() || "原表标记冲突"] : [];
      const anomalyReasons = [];
      if (!date) anomalyReasons.push("缺少日期");
      if (!title) anomalyReasons.push("未填直播主题");
      if (!room) anomalyReasons.push("未分配直播间");
      if (start && end && start === end) anomalyReasons.push("开始与结束时间相同");

      parsed.push({
        id: `csv-${i}`,
        title,
        displayTitle: title || `（未命名 · ${type || "直播"}）`,
        date,
        type,
        start,
        end,
        videoAccount,
        appAccount: (r[col("APP账号")] || "").trim(),
        speaker: (r[col("讲师")] || "").trim(),
        host: (r[col("主持人")] || "").trim(),
        inviteStatus: (r[col("老师邀约状态")] || "").trim(),
        ops: (r[col("运营")] || "").trim(),
        room,
        detail: (r[col("详情")] || "").trim(),
        conflictReasons,
        anomalyReasons,
        isConflict: conflictReasons.length > 0,
        hasAnomaly: anomalyReasons.length > 0 || conflictReasons.length > 0,
      });
    }

    const byDateRoom = {};
    for (const e of parsed) {
      if (!e.date || !e.room) continue;
      (byDateRoom[`${e.date}__${e.room}`] ||= []).push(e);
    }
    for (const group of Object.values(byDateRoom)) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          const aS = timeToMins(a.start), aE = timeToMins(a.end);
          const bS = timeToMins(b.start), bE = timeToMins(b.end);
          if (aS == null || bS == null) continue;
          const aEnd = aE && aE > aS ? aE : aS + 60;
          const bEnd = bE && bE > bS ? bE : bS + 60;
          if (aS < bEnd && bS < aEnd) {
            a.isConflict = b.isConflict = a.hasAnomaly = b.hasAnomaly = true;
            const msgA = `与【${b.displayTitle}】(${b.start}-${b.end}) 同直播间时段重叠`;
            const msgB = `与【${a.displayTitle}】(${a.start}-${a.end}) 同直播间时段重叠`;
            if (!a.conflictReasons.some((r) => r.includes(b.displayTitle))) a.conflictReasons.push(msgA);
            if (!b.conflictReasons.some((r) => r.includes(a.displayTitle))) b.conflictReasons.push(msgB);
          }
        }
      }
    }

    parsed.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.start || "99:99").localeCompare(b.start || "99:99"));
    state.events = parsed;
    state.meta = { ...state.meta, sourceMode: "browser-csv", syncedAt: new Date().toLocaleString("zh-CN") };
    updateHeaderMeta();
    populateFilterControls();
    alignInitialPeriod(state.events);
    render();
    showToast(`已载入本地 CSV（共 ${parsed.length} 场排期）`);
  }

  function bindEvents() {
    // Unlock form
    document.getElementById("togglePwBtn").addEventListener("click", () => {
      const inp = document.getElementById("passwordInput");
      const btn = document.getElementById("togglePwBtn");
      const showing = inp.type === "text";
      inp.type = showing ? "password" : "text";
      btn.textContent = showing ? "显示" : "隐藏";
    });

    document.getElementById("unlockForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = document.getElementById("passwordInput").value.trim();
      const remember = document.getElementById("rememberPw").checked;
      const btn = document.getElementById("unlockBtn");
      const errEl = document.getElementById("lockError");
      if (!pw || !state.encryptedEnvelope) return;

      btn.disabled = true;
      btn.textContent = "正在解密…";
      errEl.classList.add("hidden");
      try {
        const data = await decryptEnvelope(state.encryptedEnvelope, pw);
        state.activePassword = pw;
        if (remember) localStorage.setItem(PASS_STORAGE_KEY, pw);
        else localStorage.removeItem(PASS_STORAGE_KEY);
        document.getElementById("passwordInput").value = "";
        showAppWithData(data);
        showToast(remember ? "解锁成功，本机已记住密码（下次打开直接进入）" : "解锁成功");
      } catch (err) {
        errEl.textContent = err.message && err.message.includes("Web Crypto")
          ? err.message
          : "密码不正确，请检查后重试";
        errEl.classList.remove("hidden");
      } finally {
        btn.disabled = false;
        btn.textContent = "解锁查看";
      }
    });

    document.getElementById("lockBtn").addEventListener("click", () => {
      localStorage.removeItem(PASS_STORAGE_KEY);
      state.activePassword = "";
      state.events = [];
      state.meta = {};
      showLockScreen("");
      showToast("已退出登录并清除本机记住的密码");
    });

    document.getElementById("refreshBtn").addEventListener("click", refreshLatestData);

    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });

    document.getElementById("prevBtn").addEventListener("click", () => {
      if (state.view === "month") {
        const d = new Date(state.year, state.month - 1, 1);
        state.year = d.getFullYear(); state.month = d.getMonth();
      } else if (state.view === "week") {
        state.weekStart = new Date(state.weekStart.getFullYear(), state.weekStart.getMonth(), state.weekStart.getDate() - 7);
      }
      render();
    });

    document.getElementById("nextBtn").addEventListener("click", () => {
      if (state.view === "month") {
        const d = new Date(state.year, state.month + 1, 1);
        state.year = d.getFullYear(); state.month = d.getMonth();
      } else if (state.view === "week") {
        state.weekStart = new Date(state.weekStart.getFullYear(), state.weekStart.getMonth(), state.weekStart.getDate() + 7);
      }
      render();
    });

    document.getElementById("todayBtn").addEventListener("click", () => {
      const now = new Date();
      state.year = now.getFullYear();
      state.month = now.getMonth();
      state.weekStart = getMonday(now);
      render();
      scrollToTodayCell(true);
    });

    document.getElementById("searchInput").addEventListener("input", (e) => { state.search = e.target.value; render(); });
    document.getElementById("roomFilter").addEventListener("change", (e) => { state.room = e.target.value; render(); });
    document.getElementById("typeFilter").addEventListener("change", (e) => { state.type = e.target.value; render(); });
    document.getElementById("opsFilter").addEventListener("change", (e) => { state.ops = e.target.value; render(); });
    document.getElementById("inviteFilter").addEventListener("change", (e) => { state.invite = e.target.value; render(); });
    document.getElementById("conflictOnly").addEventListener("change", (e) => { state.conflictOnly = e.target.checked; render(); });

    document.getElementById("resetBtn").addEventListener("click", () => {
      state.search = state.room = state.type = state.ops = state.invite = "";
      state.conflictOnly = false;
      document.getElementById("searchInput").value = "";
      document.getElementById("roomFilter").value = "";
      document.getElementById("typeFilter").value = "";
      document.getElementById("opsFilter").value = "";
      document.getElementById("inviteFilter").value = "";
      document.getElementById("conflictOnly").checked = false;
      render();
    });

    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-open-id]");
      if (target) openModal(target.getAttribute("data-open-id"));
    });

    document.getElementById("closeModal").addEventListener("click", closeModal);
    document.getElementById("modalBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "modalBackdrop") closeModal();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    document.getElementById("downloadIcsBtn").addEventListener("click", downloadFilteredIcs);

    document.getElementById("copyIcsUrlBtn").addEventListener("click", async () => {
      const icsUrl = new URL("./calendar.ics", window.location.href).href;
      try {
        await navigator.clipboard.writeText(icsUrl);
        showToast("已复制 .ics 日历订阅地址");
      } catch {
        prompt("请复制以下 .ics 订阅链接：", icsUrl);
      }
    });

    document.getElementById("csvInput").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => previewLocalCSV(ev.target.result);
      reader.readAsText(file, "utf-8");
      e.target.value = "";
    });
  }

  async function fetchAndApplyLatest(prevSyncedAt, prevHash) {
    const res = await fetch(`./data/schedule.enc.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const envelope = await res.json();
      if (envelope && envelope.encrypted) {
        state.encryptedEnvelope = envelope;
        state.isEncryptedMode = true;
        const pw = state.activePassword || localStorage.getItem(PASS_STORAGE_KEY) || "";
        if (!pw) {
          showLockScreen("请输入访问密码以加载最新排期");
          return { ok: false };
        }
        let data;
        try {
          data = await decryptEnvelope(envelope, pw);
        } catch {
          localStorage.removeItem(PASS_STORAGE_KEY);
          state.activePassword = "";
          showLockScreen("团队访问密码已更新，请重新输入新密码");
          return { ok: false };
        }
        state.meta = data.meta || {};
        state.events = data.events || [];
        state.liveSync = data.liveSync || state.liveSync || null;
        updateHeaderMeta();
        populateFilterControls();
        render();
        const changed = (state.meta.contentHash && state.meta.contentHash !== prevHash) ||
                        (state.meta.syncedAt && state.meta.syncedAt !== prevSyncedAt);
        return { ok: true, changed };
      }
    }
    const resPlain = await fetch(`./data/schedule.json?t=${Date.now()}`, { cache: "no-store" });
    if (resPlain.ok) {
      const data = await resPlain.json();
      state.meta = data.meta || {};
      state.events = data.events || [];
      updateHeaderMeta();
      populateFilterControls();
      render();
      return { ok: true, changed: true };
    }
    return { ok: false };
  }

  async function triggerLiveDingTalkSync(label) {
    const cfg = state.liveSync;
    if (!cfg || !cfg.token || !cfg.repo) return { triggered: false };

    const apiBase = `https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflow || "sync-calendar.yml"}`;
    const headers = {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };

    const startedAt = Date.now();
    const dispRes = await fetch(`${apiBase}/dispatches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: cfg.ref || "main" }),
    });
    if (!dispRes.ok) {
      throw new Error(`触发钉钉同步失败 (HTTP ${dispRes.status})`);
    }

    if (label) label.textContent = "同步钉钉中…";
    showToast("已触发实时拉取钉钉三张表，预计 35–50 秒自动刷新…");

    // Poll workflow run status until completed (max 120s)
    const deadline = Date.now() + 120000;
    let runId = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const runsRes = await fetch(`${apiBase}/runs?per_page=5&t=${Date.now()}`, { headers, cache: "no-store" });
      if (!runsRes.ok) continue;
      const runsData = await runsRes.json();
      const runs = runsData.workflow_runs || [];
      const target = runId
        ? runs.find((r) => r.id === runId)
        : runs.find((r) => r.event === "workflow_dispatch" && new Date(r.created_at).getTime() >= startedAt - 15000);
      if (target) {
        runId = target.id;
        if (target.status === "completed") {
          if (target.conclusion !== "success") {
            throw new Error(`钉钉同步任务异常结束 (${target.conclusion})`);
          }
          if (label) label.textContent = "加载最新数据…";
          await new Promise((r) => setTimeout(r, 2500));
          return { triggered: true, completed: true };
        }
        if (label) {
          label.textContent = target.status === "queued" ? `排队同步 ${elapsed}s` : `拉取钉钉中 ${elapsed}s`;
        }
      } else if (label) {
        label.textContent = `启动同步 ${elapsed}s`;
      }
    }
    return { triggered: true, completed: false };
  }

  async function refreshLatestData() {
    const btn = document.getElementById("refreshBtn");
    const label = document.getElementById("refreshBtnLabel");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("spinning");
    if (label) label.textContent = "连接中…";

    const prevSyncedAt = state.meta.syncedAt || "";
    const prevHash = state.meta.contentHash || "";
    try {
      if (state.liveSync && state.liveSync.token) {
        const syncResult = await triggerLiveDingTalkSync(label);
        const pull = await fetchAndApplyLatest(prevSyncedAt, prevHash);
        if (pull.ok) {
          showToast(
            pull.changed
              ? `已从钉钉实时拉取最新排期！（共 ${state.events.length} 场 · ${state.meta.syncedAt || ""}）`
              : syncResult.completed
                ? `钉钉三表已核对完成，当前排期无新改动（${state.events.length} 场）`
                : "钉钉后台仍在同步中，请 10 秒后再点刷新查看"
          );
          return;
        }
      } else {
        const pull = await fetchAndApplyLatest(prevSyncedAt, prevHash);
        if (pull.ok) {
          showToast(
            pull.changed
              ? `已更新最新排期（共 ${state.events.length} 场 · ${state.meta.syncedAt || ""}）`
              : `当前已是最新已发布数据（上次同步：${state.meta.syncedAt || "--"}）`
          );
          return;
        }
      }
      showToast("刷新失败：未获取到远端排期文件");
    } catch (err) {
      showToast(err && err.message ? err.message : "网络异常，请稍后重试刷新");
    } finally {
      btn.disabled = false;
      btn.classList.remove("spinning");
      if (label) label.textContent = "刷新";
    }
  }

  async function loadSchedule() {
    // 1. Prefer AES-256-GCM encrypted payload (schedule.enc.json)
    try {
      const res = await fetch(`./data/schedule.enc.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const envelope = await res.json();
        if (envelope && envelope.encrypted) {
          state.encryptedEnvelope = envelope;
          state.isEncryptedMode = true;

          const savedPass = localStorage.getItem(PASS_STORAGE_KEY);
          if (savedPass) {
            try {
              const data = await decryptEnvelope(envelope, savedPass);
              state.activePassword = savedPass;
              showAppWithData(data);
              return;
            } catch {
              localStorage.removeItem(PASS_STORAGE_KEY);
              showLockScreen("团队访问密码已更新，请重新输入新密码");
              return;
            }
          }
          showLockScreen("");
          return;
        }
      }
    } catch {
      // fall through to plaintext check
    }

    // 2. Fallback: plaintext schedule.json (for unencrypted local dev)
    try {
      const res = await fetch(`./data/schedule.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        showAppWithData(await res.json());
        return;
      }
    } catch {
      // handled below
    }

    document.getElementById("appShell").classList.remove("hidden");
    document.getElementById("calendarRoot").innerHTML =
      `<div class="empty-state">未能加载排期数据。如在本地双击打开，请运行 <code>python3 -m http.server -d docs 8000</code> 后访问 <code>http://localhost:8000</code>。</div>`;
  }

  initTheme();
  bindEvents();
  loadSchedule();
})();
