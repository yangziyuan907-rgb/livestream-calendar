(() => {
  "use strict";

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

  const state = {
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

  // Theme management
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

  // Pick initial focus month smartly (current month if has events, else first scheduled month)
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

    // Quick month jump pills
    const months = [...new Set(state.events.map((e) => (e.date || "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
    const quickEl = document.getElementById("quickMonths");
    quickEl.innerHTML = months
      .map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        return `<button type="button" class="btn btn-ghost quick-month-btn" data-y="${y}" data-m="${m - 1}">${y}年${m}月</button>`;
      })
      .join("");
    quickEl.querySelectorAll(".quick-month-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.year = Number(btn.dataset.y);
        state.month = Number(btn.dataset.m);
        const firstInMonth = state.events.find((e) => e.date && e.date.startsWith(`${state.year}-${String(state.month + 1).padStart(2, "0")}`));
        if (firstInMonth) {
          const [y, m, d] = firstInMonth.date.split("-").map(Number);
          state.weekStart = getMonday(new Date(y, m - 1, d));
        } else {
          state.weekStart = getMonday(new Date(state.year, state.month, 1));
        }
        render();
      });
    });

    // Legend
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
      "dingtalk-api": "钉钉 API 自动同步",
      "csv-fallback": "CSV 预置数据",
      "csv-manual": "CSV 手动导入",
      "browser-csv": "本地 CSV 预演",
    };
    const badge = document.getElementById("syncBadge");
    badge.textContent = `${modeMap[state.meta.sourceMode] || "已就绪"} · ${state.events.length} 场`;
    badge.className = `pill ${state.meta.sourceMode === "dingtalk-api" ? "success" : "warning"}`;
    document.getElementById("syncTimeBadge").textContent = `上次同步：${state.meta.syncedAt || "--"}`;
    if (state.meta.sourceUrl) {
      document.getElementById("sourceLink").href = state.meta.sourceUrl;
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
          e.displayTitle, e.type, e.speaker, e.host, e.ops, e.room, e.videoAccount, e.appAccount, e.detail,
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

      cells.push(`
        <div class="day-cell ${inMonth ? "" : "outside"} ${key === todayKey ? "today" : ""}">
          <div class="day-head">
            <span class="day-num">${d.getDate() === 1 ? `${d.getMonth() + 1}月1日` : d.getDate()}</span>
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
    // Include any new studio names dynamically added in DingTalk later
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

    const headCols = days
      .map((d, i) => `<th><div>${WEEKDAYS[i]}</div><div style="font-weight:400;color:var(--text-muted);font-variant-numeric:tabular-nums;">${d.getMonth() + 1}月${d.getDate()}日</div></th>`)
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
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const [y, m, d] = dateStr.split("-").map(Number);
          const dtObj = new Date(y, m - 1, d);
          label = `${dateStr} · ${WEEKDAYS[(dtObj.getDay() + 6) % 7]}`;
        }
        return `
          <div class="agenda-group">
            <div class="agenda-date-bar">
              <span>${escapeHtml(label)}</span>
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
      ${e.inviteStatus ? `<span class="pill ${e.inviteStatus === "已邀约" ? "success" : "warning"}">${escapeHtml(e.inviteStatus)}</span>` : ""}
      ${e.isConflict ? `<span class="pill danger">时段冲突</span>` : ""}
    `;
    document.getElementById("modalTitle").textContent = e.displayTitle;

    const alerts = [...(e.conflictReasons || []), ...(e.anomalyReasons || [])];
    const items = [
      ["日期与时段", `${e.date || "（缺失）"}  ${e.start || "--:--"} – ${e.end || "--:--"}`],
      ["直播间", e.room || "（未分配）"],
      ["视频号账号", e.videoAccount || "—"],
      ["APP 账号", e.appAccount || "—"],
      ["讲师", e.speaker || "—"],
      ["主持人", e.host || "—"],
      ["对接运营", e.ops || "—"],
      ["原表详情摘要", e.detail || "—"],
    ];

    document.getElementById("modalBody").innerHTML = `
      ${alerts.length ? `<div class="alert-box"><strong>冲突 / 数据提醒：</strong><br>${escapeHtml(alerts.join("；"))}</div>` : ""}
      <div class="detail-grid">
        ${items.map(([k, v]) => `<div class="detail-item"><div class="detail-k">${k}</div><div class="detail-v">${escapeHtml(v)}</div></div>`).join("")}
      </div>
    `;
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function closeModal() {
    document.getElementById("modalBackdrop").classList.remove("open");
  }

  // Client-side CSV preview import (same rules as Python script)
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

  function timeToMins(t) {
    if (!t || !t.includes(":")) return null;
    const [h, m] = t.split(":").map(Number);
    return Number.isNaN(h) ? null : h * 60 + (m || 0);
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

    // Overlap check on room
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
            if (!a.conflictReasons.includes(msgA)) a.conflictReasons.push(msgA);
            if (!b.conflictReasons.includes(msgB)) b.conflictReasons.push(msgB);
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

    // Delegated click to open event detail modal
    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-open-id]");
      if (target) openModal(target.getAttribute("data-open-id"));
    });

    document.getElementById("closeModal").addEventListener("click", closeModal);
    document.getElementById("modalBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "modalBackdrop") closeModal();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    document.getElementById("copyIcsUrlBtn").addEventListener("click", async () => {
      const icsUrl = new URL("./calendar.ics", window.location.href).href;
      try {
        await navigator.clipboard.writeText(icsUrl);
        showToast("已复制 .ics 日历订阅地址，可粘贴到 Apple/Google/钉钉日历");
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

  async function loadSchedule() {
    let data = null;
    if (window.location.protocol !== "file:") {
      try {
        const res = await fetch(`./data/schedule.json?t=${Date.now()}`, { cache: "no-store" });
        if (res.ok) data = await res.json();
      } catch {
        // fallback below
      }
    }
    if (!data && window.__SCHEDULE_DATA__) {
      data = window.__SCHEDULE_DATA__;
    }
    if (!data) {
      document.getElementById("calendarRoot").innerHTML =
        `<div class="empty-state">未能加载排期数据，请先运行 <code>python3 scripts/sync_dingtalk.py</code> 或点击右上角导入 CSV。</div>`;
      return;
    }

    state.meta = data.meta || {};
    state.events = data.events || [];
    updateHeaderMeta();
    populateFilterControls();
    alignInitialPeriod(state.events);
    render();
  }

  initTheme();
  bindEvents();
  loadSchedule();
})();
