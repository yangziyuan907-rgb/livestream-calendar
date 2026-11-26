/* Read-Only AES-256-GCM Encrypted Livestream Review Viewer
 * Matches livestream-calendar's exact Web Crypto PBKDF2-SHA256 + AES-256-GCM + gzip decryption
 * and shares remember-password SSO seamlessly when hosted on the same GitHub Pages origin!
 */
(() => {
  "use strict";

  const PASS_KEY = "livestream_review_pass_v1";
  const CAL_PASS_KEY = "livestream_cal_pass_v1"; // Shared calendar password key on same origin!
  const MANUAL_LOCK_KEY = "livestream_review_manual_lock";

  const BLINE_META = {
    pro_course: { label: "专业课", cls: "tag-blue" },
    group_supervision: { label: "团督", cls: "tag-purple" },
    platform_live: { label: "平台直播", cls: "tag-cyan" },
    nurture: { label: "督导/观摩(内容)", cls: "tag-green" },
    ignored: { label: "已忽略", cls: "" },
  };

  const state = {
    envelope: null,
    activePassword: "",
    meta: {},
    sessions: [],
    details: {},
    analyticsByBline: {},
    transcripts: null,
    transcriptsLoading: false,
    transcriptsError: "",
    businessLineFilter: "",
    searchQuery: "",
    onlyLiveData: false,
    hasAutoPositioned: false,
    activeSessionId: null,
    analyticsBline: "",
    analyticsTab: "speakers",
  };

  const $ = (id) => document.getElementById(id);

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getLocalTodayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function fmtPct(rate) {
    const r = Number(rate || 0);
    return r > 0 ? (r * 100).toFixed(1) + "%" : "0%";
  }

  function toast(msg, isErr = false) {
    const el = $("toast");
    el.textContent = msg;
    el.style.background = isErr ? "#dc2626" : "#0f172a";
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
  }

  function refundAlertBadge(level, rate, count, prefix = "") {
    if (!count) return `<span class="alert-pill-green">🟢 ${prefix}0 退款</span>`;
    const pct = fmtPct(rate);
    if (level === "red") return `<span class="alert-pill-red">🔴 ${prefix}高退单 ${count}单 (${pct})</span>`;
    if (level === "yellow") return `<span class="alert-pill-yellow">🟡 ${prefix}退单预警 ${count}单 (${pct})</span>`;
    return `<span class="alert-pill-green">🟢 ${prefix}退款 ${count}单 (${pct})</span>`;
  }

  // ---------------- Web Crypto AES-256-GCM + gzip Decryption ----------------

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function decryptEnvelope(envelope, password) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("当前浏览器环境不支持 Web Crypto 解密，请通过 HTTPS 网址或 localhost 打开");
    }
    const enc = new TextEncoder();
    const salt = b64ToBytes(envelope.salt);
    const iv = b64ToBytes(envelope.iv);
    const combined = b64ToBytes(envelope.ciphertext);
    const baseKey = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: Number(envelope.iterations) || 200000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plainBuf = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, combined);
    if (envelope.compressed === "gzip") {
      if (typeof DecompressionStream !== "function") {
        throw new Error("当前浏览器版本过旧，不支持 gzip 解压，请升级至新版 Chrome/Safari/Edge");
      }
      const stream = new Blob([plainBuf]).stream().pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(stream).text();
      return JSON.parse(text);
    }
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  function showLockScreen(errMsg = "") {
    $("bootSplash").classList.add("hidden");
    $("appShell").classList.add("hidden");
    $("lockScreen").classList.remove("hidden");
    const errEl = $("lockError");
    if (errMsg) {
      errEl.textContent = errMsg;
      errEl.classList.remove("hidden");
    } else {
      errEl.classList.add("hidden");
    }
    setTimeout(() => $("passwordInput") && $("passwordInput").focus(), 40);
  }

  async function loadTranscriptsInBackground() {
    if (!state.meta.include_transcripts || state.transcripts || state.transcriptsLoading) return;
    state.transcriptsLoading = true;
    state.transcriptsError = "";
    try {
      const resp = await fetch(`./data/transcripts.enc.json?t=${Date.now()}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const env = await resp.json();
      const plain = await decryptEnvelope(env, state.activePassword);
      state.transcripts = plain.transcripts || {};
    } catch (err) {
      state.transcriptsError = String(err.message || err);
    } finally {
      state.transcriptsLoading = false;
      if (state.activeSessionId) {
        const full = state.details[String(state.activeSessionId)];
        if (full) renderMaterialsTab(full, state.activeSessionId);
      }
    }
  }

  function enterDashboard(data, password) {
    state.activePassword = password;
    state.meta = data.meta || {};
    state.sessions = data.sessions || [];
    state.details = data.details || {};
    state.analyticsByBline = data.analytics_by_bline || {};
    state.transcripts = null;
    state.transcriptsLoading = false;
    state.hasAutoPositioned = false;

    $("bootSplash").classList.add("hidden");
    $("lockScreen").classList.add("hidden");
    $("appShell").classList.remove("hidden");

    const pubTime = state.meta.published_at || "--";
    const trCnt = state.meta.transcript_sessions_count || 0;
    $("publishMetaLine").textContent = `视频号 × MK后台 × 腾讯会议 · 共 ${state.sessions.length} 场有效直播（含 ${trCnt} 场逐字稿）· 更新于 ${pubTime}`;

    renderSessionList();
    // Kick off lazy background decryption of full transcripts so UI opens instantaneously!
    if (state.meta.include_transcripts) {
      setTimeout(() => loadTranscriptsInBackground(), 120);
    }
  }

  async function bootApp(forceRefetch = false) {
    if (forceRefetch || !state.envelope) {
      $("bootSplash").classList.remove("hidden");
      $("bootSplashHint").textContent = "拉取 AES-256 加密数据包并在本地浏览器解密...";
      try {
        const resp = await fetch(`./data/studio.enc.json?t=${Date.now()}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`无法读取加密数据包 (HTTP ${resp.status})`);
        state.envelope = await resp.json();
      } catch (err) {
        showLockScreen("加载数据包失败：" + String(err.message || err));
        return;
      }
    }

    const manualLocked = localStorage.getItem(MANUAL_LOCK_KEY) === "1";
    const candidates = [];
    if (!manualLocked) {
      const ownPwd = localStorage.getItem(PASS_KEY);
      const calPwd = localStorage.getItem(CAL_PASS_KEY);
      if (ownPwd) candidates.push({ pwd: ownPwd, src: "own" });
      if (calPwd && calPwd !== ownPwd) candidates.push({ pwd: calPwd, src: "calendar" });
    }

    for (const c of candidates) {
      try {
        const data = await decryptEnvelope(state.envelope, c.pwd);
        if (c.src === "calendar") {
          localStorage.setItem(PASS_KEY, c.pwd);
        }
        enterDashboard(data, c.pwd);
        return;
      } catch (_) {
        if (c.src === "own") localStorage.removeItem(PASS_KEY);
      }
    }
    showLockScreen("");
  }

  // ---------------- Sidebar & Filtering ----------------

  function sessionHasData(s) {
    return (
      (s.ch_watch || 0) > 0 ||
      (s.ch_max_online || 0) > 0 ||
      (s.mk_watch || 0) > 0 ||
      (s.mk_max_online || 0) > 0 ||
      (s.transcript_count || 0) > 0 ||
      (s.order_rows_count || 0) > 0 ||
      (s.product_count || 0) > 0
    );
  }

  function jumpSidebarToToday(smooth = true) {
    const wrap = $("sessionList");
    const anchor = document.getElementById("todayAnchor");
    if (!wrap || !anchor) return;
    const targetTop = Math.max(0, anchor.offsetTop - wrap.offsetTop - 6);
    wrap.scrollTo({ top: targetTop, behavior: smooth ? "smooth" : "auto" });
  }

  function renderSessionList() {
    const wrap = $("sessionList");
    const todayStr = getLocalTodayStr();
    let list = state.sessions || [];
    if (state.businessLineFilter) {
      list = list.filter((s) => s.business_line === state.businessLineFilter);
    }
    const q = state.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        `${s.title || ""} ${s.speaker || ""} ${s.host || ""} ${s.course_name || ""} ${s.product_names || ""} ${s.mk_live_id || ""} ${s.date_str || ""}`
          .toLowerCase()
          .includes(q)
      );
    }
    if (state.onlyLiveData) {
      list = list.filter(sessionHasData);
    }
    if (!list.length) {
      wrap.innerHTML = `<div class="muted" style="padding:18px;text-align:center;">暂无符合条件的场次</div>`;
      return;
    }

    let todayDividerInserted = false;
    let firstTodayId = null;
    let nearestPastOrTodayId = null;
    const chunks = [];

    list.forEach((s) => {
      const dStr = s.date_str || "";
      const isToday = dStr === todayStr;
      const isFuture = dStr !== "" && dStr > todayStr;

      if (!todayDividerInserted && dStr !== "" && dStr >= todayStr) {
        todayDividerInserted = true;
        chunks.push(`<div id="todayAnchor" class="today-divider">📍 今天 · ${todayStr}（往上=之前 · 往下=之后排期）</div>`);
      }
      if (isToday && firstTodayId === null) firstTodayId = s.id;
      if (dStr && dStr <= todayStr) nearestPastOrTodayId = s.id;

      const bm = BLINE_META[s.business_line] || { label: s.business_line, cls: "" };
      const isAct = s.id === state.activeSessionId;
      const hasMk = (s.mk_watch || 0) > 0 || (s.mk_max_online || 0) > 0;
      const hasCh = (s.ch_watch || 0) > 0 || (s.ch_max_online || 0) > 0;
      const hasTr = (s.transcript_count || 0) > 0;
      const hasTl = (s.timeline_count || 0) > 0 || (s.order_rows_count || 0) > 0;
      const prodCnt = s.product_count || 0;
      const totalOrders = (s.ch_orders || 0) + (s.mk_orders || 0);
      const metricLine =
        s.review_mode === "content"
          ? `完看 ${esc(s.mk_finish_rate || "-")} · 观看 ${(s.mk_watch || 0) + (s.ch_watch || 0)} · 讨论 ${s.mk_discuss || 0}${totalOrders > 0 ? ` · 附带${totalOrders}单` : ""}`
          : `视频号 ${s.ch_watch || 0}观/${s.ch_orders || 0}单 · MK ${s.mk_watch || 0}观/${s.mk_orders || 0}单`;

      let refundDot = "";
      if (s.ch_refund_alert === "red" || s.mk_refund_alert === "red") {
        const isCh = s.ch_refund_alert === "red";
        refundDot = `<span class="dot danger">🔴 ${isCh ? "视" : "MK"}退${fmtPct(isCh ? s.ch_refund_rate : s.mk_refund_rate)}</span>`;
      } else if (s.ch_refund_alert === "yellow" || s.mk_refund_alert === "yellow") {
        const isCh = s.ch_refund_alert === "yellow";
        refundDot = `<span class="dot warn">🟡 ${isCh ? "视" : "MK"}退${fmtPct(isCh ? s.ch_refund_rate : s.mk_refund_rate)}</span>`;
      }

      const dayBadge = isToday
        ? `<span class="tag tag-today">今天</span>`
        : isFuture && !sessionHasData(s)
        ? `<span class="tag tag-future">排期</span>`
        : "";

      chunks.push(`
        <div class="session-item ${isAct ? "active" : ""} ${isToday ? "today-item" : isFuture && !sessionHasData(s) ? "future-item" : ""}" data-id="${s.id}">
          <div class="si-top">
            <div style="display:flex;gap:4px;align-items:center;">
              <span class="tag ${bm.cls}">${bm.label}</span>
              ${dayBadge}
            </div>
            <span class="muted">${esc(s.date_str || "未设日期")} ${esc(s.start_time || "")}</span>
          </div>
          <div class="si-title">${esc(s.title)}</div>
          <div class="si-meta">
            <span>讲师: ${esc(s.speaker || "-")}</span>
            <span>${metricLine}</span>
          </div>
          <div class="si-dots">
            <span class="dot ${hasCh ? "on" : ""}">视频号</span>
            <span class="dot ${hasMk ? "on" : ""}">MK</span>
            <span class="dot ${prodCnt > 0 ? "prod" : ""}">品(${prodCnt})</span>
            <span class="dot ${hasTr ? "on" : ""}">逐字稿(${s.transcript_count || 0})</span>
            <span class="dot ${hasTl ? "on" : ""}">曲线/单(${(s.timeline_count || 0) + (s.order_rows_count || 0)})</span>
            ${refundDot}
          </div>
        </div>
      `);
    });

    if (!todayDividerInserted) {
      chunks.push(`<div id="todayAnchor" class="today-divider">📍 今天 · ${todayStr}</div>`);
    }

    wrap.innerHTML = chunks.join("");
    wrap.querySelectorAll(".session-item").forEach((el) => {
      el.addEventListener("click", () => selectSession(Number(el.dataset.id)));
    });

    if (!state.hasAutoPositioned && !q) {
      state.hasAutoPositioned = true;
      requestAnimationFrame(() => jumpSidebarToToday(false));
      const autoId = firstTodayId || nearestPastOrTodayId;
      if (!state.activeSessionId && autoId) selectSession(autoId);
    }
  }

  // ---------------- Session Detail ----------------

  function statCell(label, val) {
    return `<div class="stat-cell"><div class="stat-label">${esc(label)}</div><div class="stat-val">${esc(val)}</div></div>`;
  }

  function selectSession(id) {
    state.activeSessionId = id;
    renderSessionList();
    const full = state.details[String(id)];
    if (!full) return;
    $("emptyWorkspace").classList.add("hidden");
    $("detailPanel").classList.remove("hidden");
    renderDetail(full, id);
  }

  function renderDetail(full, sid) {
    const s = full.session || {};
    const mk = full.metrics_mk || {};
    const ch = full.metrics_channels || {};
    const prods = full.products || [];
    const bm = BLINE_META[s.business_line] || { label: s.business_line, cls: "" };
    const modeLabel =
      s.review_mode === "content"
        ? "内容培育主看（同时记录挂品与附带订单）"
        : s.review_mode === "hybrid"
        ? "双平台综合复盘"
        : "双平台转化 & 出单点复盘";

    let heroRefundTag = "";
    if (ch.refund_alert === "red" || ch.refund_alert === "yellow") {
      heroRefundTag += refundAlertBadge(ch.refund_alert, ch.refund_rate, ch.refund_count, "视频号");
    }
    if (mk.refund_alert === "red" || mk.refund_alert === "yellow") {
      heroRefundTag += refundAlertBadge(mk.refund_alert, mk.refund_rate, mk.refund_count, "MK ");
    }

    $("heroTags").innerHTML = `
      <span class="tag ${bm.cls}">${bm.label}</span>
      <span class="tag tag-amber">${modeLabel}</span>
      ${s.mk_live_id ? `<span class="tag">MK ID: ${esc(s.mk_live_id)}</span>` : ""}
      ${s.channels_live_id ? `<span class="tag">视频号 ID: ${esc(s.channels_live_id)}</span>` : ""}
      ${heroRefundTag}
    `;
    $("heroTitle").textContent = s.title || "-";
    $("heroMeta").textContent = `${s.date_str || ""} ${s.weekday || ""} ${s.start_time || ""}${s.end_time ? "-" + s.end_time : ""} · 讲师：${s.speaker || "-"} · 主持人：${s.host || "-"} · 课程/挂品：${s.course_name || (prods[0] && prods[0].spu_name) || "-"}`;

    $("nurtureBanner").classList.toggle("hidden", s.review_mode !== "content");

    $("chMetricsGrid").innerHTML = [
      statCell("预约人数", ch.reserve_count || 0),
      statCell("最高在线", ch.max_online || 0),
      statCell("观看人数", ch.watch_count || 0),
      statCell("平均观看时长", ch.avg_watch_text || "-"),
      statCell("视频号订单", ch.order_count || 0),
      statCell("视频号 GMV", `¥${Number(ch.gmv || 0).toFixed(0)}`),
      statCell("曝光人数", ch.exposure_count || 0),
      statCell("新增关注", ch.new_followers || 0),
      statCell("商品点击", ch.click_count || 0),
    ].join("");
    const chCvr = ch.watch_count > 0 ? (((ch.order_count || 0) / ch.watch_count) * 100).toFixed(2) + "%" : "-";
    $("chCalcBar").innerHTML = `
      <span>视频号转化率：<strong>${chCvr}</strong></span>
      <span>双平台总订单：<strong>${(ch.order_count || 0) + (mk.order_count || 0)} 单</strong></span>
      ${refundAlertBadge(ch.refund_alert, ch.refund_rate, ch.refund_count || 0, "视频号")}
    `;

    $("mkMetricsGrid").innerHTML = [
      statCell("APP 预约", mk.reserve_count || 0),
      statCell("APP 最高在线", mk.max_online || 0),
      statCell("APP 观看人数", mk.watch_count || 0),
      statCell("平均观看时长", mk.avg_watch_text || "-"),
      statCell("APP 订单", mk.order_count || 0),
      statCell("直接流水", `¥${Number(mk.direct_gmv || 0).toFixed(0)}`),
      statCell("尾款流水", `¥${Number(mk.tail_gmv || 0).toFixed(0)}`),
      statCell("APP 退款单", mk.refund_count || 0),
      statCell("MK 直播 ID", mk.mk_live_id || s.mk_live_id || "-"),
    ].join("");
    const mkCvr = mk.watch_count > 0 ? (((mk.order_count || 0) / mk.watch_count) * 100).toFixed(2) + "%" : "-";
    const mkLiveOrders = (full.orders || []).filter((o) => o.platform === "mk" && !o.is_refund);
    const spilloverCount = mkLiveOrders.filter((o) => String(o.channel_name || "").includes("同品直播归因")).length;
    const attributedHtml = mkLiveOrders.length
      ? `<span>直播窗实测归因：<strong>${mkLiveOrders.length} 单</strong>${
          spilloverCount > 0 ? ` <span class="tag tag-spillover">含同品溢出 ${spilloverCount} 单</span>` : ""
        }</span>`
      : "";
    $("mkCalcBar").innerHTML = `
      <span>APP 转化率：<strong>${mkCvr}</strong></span>
      <span>APP 合计流水：<strong>¥${((mk.direct_gmv || 0) + (mk.tail_gmv || 0)).toFixed(0)}</strong></span>
      ${attributedHtml}
      ${refundAlertBadge(mk.refund_alert, mk.refund_rate, mk.refund_count || 0, "MK ")}
    `;
    $("mkNurtureStrip").innerHTML = `
      <span>出勤率: <b>${esc(mk.attend_rate || "-")}</b></span>
      <span>完看率: <b>${esc(mk.finish_rate || "-")}</b></span>
      <span>整体完看: <b>${esc(mk.overall_finish_rate || "-")}</b></span>
      <span>回放: <b>${mk.replay_count || 0}</b></span>
      <span>讨论: <b>${mk.discuss_count || 0}</b></span>
      <span>提问: <b>${mk.question_count || 0}</b></span>
      <span>笔记: <b>${mk.note_count || 0}</b></span>
      <span>总结提交: <b>${mk.summary_count || 0} (${esc(mk.summary_rate || "-")})</b></span>
    `;

    $("productsCountBadge").textContent = `${prods.length} 个品`;
    $("productsTableBody").innerHTML = prods.length
      ? prods
          .map((p) => {
            const platTag = p.platform === "mk" ? `<span class="tag tag-green">MK APP</span>` : `<span class="tag tag-blue">视频号</span>`;
            return `<tr>
              <td>${platTag}</td>
              <td><strong>${esc(p.spu_name)}</strong>${p.shop_name ? `<div class="muted">${esc(p.shop_name)}</div>` : ""}</td>
              <td>¥${Number(p.price || 0).toFixed(0)}</td>
              <td>${p.exposure_count || 0}</td>
              <td>${p.click_count || 0}</td>
              <td><strong>${p.pay_order_count || 0}</strong></td>
              <td><strong>¥${Number(p.gmv || 0).toFixed(0)}</strong></td>
              <td>${p.explain_start_at ? `<span class="tag tag-orange">🎙️ ${esc(p.explain_start_at.slice(11, 19))}</span>` : "-"}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8" class="muted" style="text-align:center;">暂无商品明细</td></tr>`;

    $("sessionMetaGrid").innerHTML = [
      statCell("讲师", s.speaker || "-"),
      statCell("主持人", s.host || "-"),
      statCell("运营/场控", s.ops || "-"),
      statCell("目标单数", s.order_target || "-"),
      statCell("课程单价", s.course_price ? `¥${s.course_price}` : "-"),
      statCell("内容策略", s.content_strategy || "-"),
      statCell("场次形式", s.live_form || "-"),
      statCell("备注", s.notes || "-"),
    ].join("");

    renderTimelineTab(full);
    renderReviewTab(full);
    renderMaterialsTab(full, sid);
  }

  function renderTimelineTab(full) {
    const al = full.aligned || { curves: { channels: [], mk: [] }, deal_peaks: [], commodity_events: [] };
    const isMeasured = Boolean(al.latency_measured);
    $("latencyStatusBadge").textContent = isMeasured ? "✅ 已实测校准" : "⚠️ 未实测初值";
    $("latencyStatusBadge").className = isMeasured ? "tag tag-green" : "tag tag-amber";
    $("lagHintBox").className = `lag-hint ${isMeasured ? "measured" : "unmeasured"}`;
    $("lagHintBox").textContent = al.empirical_lag_hint || `视频号延迟 ${al.channels_delay_sec ?? 15}s / MK 延迟 ${al.mk_delay_sec ?? 45}s`;

    const chPts = (al.curves && al.curves.channels) || [];
    const mkPts = (al.curves && al.curves.mk) || [];
    const peaks = al.deal_peaks || [];
    const commEvs = al.commodity_events || [];
    const commStrip = $("commodityEventsStrip");

    if (commEvs.length) {
      commStrip.classList.remove("hidden");
      commStrip.innerHTML = commEvs
        .map((ev) => `<span class="orange-chip">${ev.kind === "start_explain" ? "🎙️" : "📦"} ${esc(ev.studio_time)} ${esc(ev.label)}</span>`)
        .join("");
    } else {
      commStrip.classList.add("hidden");
      commStrip.innerHTML = "";
    }

    const chartEl = $("timelineChart");
    if (!chPts.length && !mkPts.length && !peaks.length && !commEvs.length) {
      chartEl.innerHTML = `<div class="muted" style="padding:36px;text-align:center;">本场暂无曲线、商品讲解节点或带时间订单点。</div>`;
    } else {
      const toEpoch = (s) => {
        if (!s) return null;
        const d = new Date(s.replace(" ", "T"));
        return Number.isNaN(d.getTime()) ? null : d.getTime();
      };
      const allTimes = [];
      chPts.forEach((p) => { const t = toEpoch(p.studio_full || p.recorded_at); if (t) allTimes.push(t); });
      mkPts.forEach((p) => { const t = toEpoch(p.studio_full || p.recorded_at); if (t) allTimes.push(t); });
      peaks.forEach((p) => { const t = toEpoch(p.studio_trigger_iso); if (t) allTimes.push(t); });
      commEvs.forEach((e) => { const t = toEpoch(e.studio_full || e.recorded_at); if (t) allTimes.push(t); });
      const minT = Math.min(...allTimes);
      const maxT = Math.max(...allTimes, minT + 60000);
      const maxY = Math.max(10, ...chPts.map((p) => p.online_count || 0), ...mkPts.map((p) => p.online_count || 0));
      const W = 800, H = 240, padL = 44, padR = 20, padT = 26, padB = 30;
      const xOf = (t) => padL + ((t - minT) / (maxT - minT)) * (W - padL - padR);
      const yOf = (v) => padT + (1 - v / maxY) * (H - padT - padB);
      const buildPath = (pts) =>
        pts
          .map((p, idx) => {
            const t = toEpoch(p.studio_full || p.recorded_at);
            return t ? `${idx === 0 ? "M" : "L"}${xOf(t).toFixed(1)},${yOf(p.online_count || 0).toFixed(1)}` : "";
          })
          .filter(Boolean)
          .join(" ");
      const chPath = buildPath(chPts);
      const mkPath = buildPath(mkPts);
      const commPins = commEvs
        .map((ev, idx) => {
          const t = toEpoch(ev.studio_full || ev.recorded_at);
          if (!t) return "";
          const x = xOf(t).toFixed(1);
          const yBadge = padT + 22 + (idx % 2) * 16;
          return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#ea580c" stroke-width="1.6" stroke-dasharray="2,3" opacity="0.85"/>
            <rect x="${Number(x) - 14}" y="${yBadge - 9}" width="28" height="14" rx="4" fill="#ea580c"/>
            <text x="${x}" y="${yBadge + 1}" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="700">${ev.kind === "start_explain" ? "开讲" : "上架"}</text>`;
        })
        .join("");
      const peakPins = peaks
        .map((pk) => {
          const t = toEpoch(pk.studio_trigger_iso);
          if (!t) return "";
          const x = xOf(t).toFixed(1);
          return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#dc2626" stroke-width="2" stroke-dasharray="4,3"/>
            <circle cx="${x}" cy="${padT + 6}" r="7" fill="#dc2626"/>
            <text x="${x}" y="${padT + 9.5}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${pk.order_count}</text>`;
        })
        .join("");
      const fmtTick = (ms) => new Date(ms).toTimeString().slice(0, 5);
      const xTicks = [0, 0.25, 0.5, 0.75, 1]
        .map((r) => `<text x="${(padL + r * (W - padL - padR)).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="10">${fmtTick(minT + (maxT - minT) * r)}</text>`)
        .join("");

      chartEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#f8fafc;border-radius:9px;border:1px solid #e2e8f0;">
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#cbd5e1"/>
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#cbd5e1"/>
        <text x="6" y="${padT + 8}" fill="#64748b" font-size="10">${maxY}</text>
        <text x="6" y="${H - padB}" fill="#64748b" font-size="10">0</text>
        ${xTicks}${commPins}
        ${chPath ? `<path d="${chPath}" fill="none" stroke="#2563eb" stroke-width="2.2"/>` : ""}
        ${mkPath ? `<path d="${mkPath}" fill="none" stroke="#059669" stroke-width="2.2"/>` : ""}
        ${peakPins}
      </svg>`;
    }

    $("dealPeaksList").innerHTML = peaks.length
      ? peaks
          .map((pk) => {
            const quotes = (pk.transcript_excerpt || [])
              .slice(0, 8)
              .map((q) => `<div class="quote-line"><code>${esc((q.wall_time || "").slice(11, 19))}${q.estimated ? "(估)" : ""}</code> <b>${esc(q.speaker || "发言")}:</b> ${esc(q.text)}</div>`)
              .join("");
            return `<div class="peak-card">
              <div class="peak-head">
                <strong>第 ${pk.peak_index} 波出单高峰 · 下单 ${esc(pk.order_time_range)} → 校准演播室触发 ${esc(pk.studio_trigger_range)}</strong>
                <div><span class="tag tag-red">${pk.order_count} 单 / ¥${pk.gmv}</span> <span class="tag">${esc((pk.platforms || []).join("+"))}</span></div>
              </div>
              <div class="muted">商品：${esc((pk.products || []).join(" / ") || "-")} · 渠道：${esc((pk.channels || []).join(" / ") || "-")}</div>
              ${quotes || `<div class="muted" style="margin-top:6px;">该时间窗口暂未匹配到逐字稿。</div>`}
            </div>`;
          })
          .join("")
      : `<div class="muted">本场暂无时间轴出单高峰记录。</div>`;
  }

  function renderReviewTab(full) {
    const revs = full.reviews || [];
    if (!revs.length) {
      $("reviewDealPoints").textContent = "本场暂未生成复盘摘要。";
      $("reviewFullMarkdown").textContent = "本场暂未生成完整复盘报告。";
      $("reviewEngineBadge").textContent = "未生成";
      $("complianceList").innerHTML = `<div class="muted">暂无合规扫描结果。</div>`;
      $("nextActionsList").innerHTML = "";
      return;
    }
    const latest = revs[0];
    $("reviewDealPoints").textContent = latest.deal_points_text || "（无摘要）";
    $("reviewFullMarkdown").textContent = latest.full_markdown || "（无正文）";
    $("reviewEngineBadge").textContent = `${latest.engine} · ${latest.model_name} · ${latest.created_at}`;
    const comp = latest.compliance || [];
    $("complianceList").innerHTML = comp.length
      ? comp.map((c) => `<div class="compliance-item"><b>[${esc(c.severity || "medium").toUpperCase()}] ${esc(c.category)}</b> (${esc(c.wall_time)})<br/>原话：${esc(c.quote)}<br/>建议：${esc(c.advice)}</div>`).join("")
      : `<div class="banner-green" style="margin:0;">未发现高危合规表述。</div>`;
    $("nextActionsList").innerHTML = (latest.next_actions || []).map((a) => `<li>${esc(a)}</li>`).join("");
  }

  function renderMaterialsTab(full, sid) {
    const od = full.orders || [];
    $("ordersMetaBadge").textContent = `${od.length} 笔订单`;
    $("ordersList").innerHTML = od.length
      ? od
          .map((o) => {
            const isSpill = String(o.channel_name || "").includes("同品直播归因");
            return `<div class="row-item ${isSpill ? "order-spillover" : ""}"><b>${esc(o.order_time)}</b> · <span class="tag ${
              o.platform === "mk" ? "tag-green" : "tag-blue"
            }">${esc(o.platform)}</span> ${isSpill ? `<span class="tag tag-spillover">同品直播归因</span>` : ""} · <b>¥${o.amount}</b> (${esc(
              o.pay_status
            )})<br/><span class="muted">${esc(o.product_name)} · ${esc(o.channel_name)} · ${esc(o.order_no)}</span></div>`;
          })
          .join("")
      : `<div class="muted">暂无订单下单明细。</div>`;

    if (!state.meta.include_transcripts) {
      $("transcriptMetaBadge").textContent = "精简版未包含全文";
      $("transcriptList").innerHTML = `<div class="muted">当前分享包为精简数据版，未包含全文逐字稿。</div>`;
      return;
    }
    if (!state.transcripts) {
      $("transcriptMetaBadge").textContent = state.transcriptsError ? "加载失败" : "解密中...";
      $("transcriptList").innerHTML = state.transcriptsError
        ? `<div class="muted">逐字稿解密失败：${esc(state.transcriptsError)}</div>`
        : `<div class="muted">正在本地浏览器解密逐字稿数据包，请稍候 1~2 秒...</div>`;
      loadTranscriptsInBackground();
      return;
    }

    const rawTuples = state.transcripts[String(sid)] || [];
    const tr = rawTuples.map((t) => ({ seq: t[0], speaker: t[1], wall_time: t[2], estimated: t[3], text: t[4] }));
    const hasExact = tr.some((x) => !x.estimated && x.wall_time);
    $("transcriptMetaBadge").textContent = tr.length ? `${tr.length} 段 (${hasExact ? "精确时间戳" : "对话稿"})` : "暂无逐字稿";

    const renderTr = (q = "") => {
      const kw = q.trim().toLowerCase();
      const list = kw ? tr.filter((x) => (x.text || "").toLowerCase().includes(kw) || (x.speaker || "").toLowerCase().includes(kw)) : tr;
      const hi = (txt) => {
        const safe = esc(txt);
        if (!kw) return safe;
        const re = new RegExp(esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        return safe.replace(re, (m) => `<mark>${m}</mark>`);
      };
      $("transcriptList").innerHTML = list.length
        ? list
            .slice(0, 500)
            .map((x) => `<div class="row-item"><code>${esc((x.wall_time || "").slice(11, 19) || "#" + x.seq)}${x.estimated ? "(估)" : ""}</code> <b>${hi(x.speaker)}</b>：${hi(x.text)}</div>`)
            .join("")
        : `<div class="muted">暂无匹配的逐字稿内容。</div>`;
    };
    renderTr($("transcriptSearch").value);
    $("transcriptSearch").oninput = (e) => renderTr(e.target.value);
  }

  // ---------------- Cross-Session Analytics ----------------

  function renderAnalytics() {
    const data = state.analyticsByBline[state.analyticsBline] || state.analyticsByBline[""] || {};
    const alerts = data.refund_alerts || [];
    $("analyticsKpiGrid").innerHTML = `
      <div class="kpi-box"><div class="kpi-label">统计场次总数</div><div class="kpi-val">${data.total_sessions || 0}</div></div>
      <div class="kpi-box"><div class="kpi-label">已配逐字稿场次</div><div class="kpi-val">${data.with_transcript || 0}</div></div>
      <div class="kpi-box"><div class="kpi-label">已记录挂品(品)场次</div><div class="kpi-val">${data.with_products || 0}</div></div>
      <div class="kpi-box ${alerts.length ? "kpi-danger" : ""}"><div class="kpi-label">退单率红黄灯预警</div><div class="kpi-val">${alerts.length}</div></div>
    `;

    const spks = data.speakers || [];
    $("anPane-speakers").innerHTML = spks.length
      ? `<table class="data-table"><thead><tr><th>讲师</th><th>场次</th><th>有逐字稿</th><th>均场观</th><th>均最高在线</th><th>峰值在线</th><th>均完看率</th><th>均讨论</th><th>总订单</th><th>总流水(¥)</th><th>总退款</th><th>常带商品（品）</th></tr></thead><tbody>${spks
          .map(
            (r) => `<tr><td><strong>${esc(r.speaker)}</strong></td><td>${r.sessions}</td><td>${r.with_transcript}</td><td>${r.avg_watch}</td><td>${r.avg_max_online}</td><td><strong>${r.max_online_peak}</strong></td><td>${r.avg_finish_rate ? r.avg_finish_rate + "%" : "-"}</td><td>${r.avg_discuss}</td><td>${r.total_orders}</td><td>¥${Number(r.total_gmv || 0).toFixed(0)}</td><td>${r.total_refunds > 0 ? `<span class="tag tag-red">${r.total_refunds}</span>` : "0"}</td><td class="muted">${esc((r.products || []).join(" / ") || "-")}</td></tr>`
          )
          .join("")}</tbody></table>`
      : `<div class="muted" style="padding:18px;">暂无讲师对比数据。</div>`;

    $("anPane-refunds").innerHTML = alerts.length
      ? `<table class="data-table"><thead><tr><th>日期</th><th>讲师</th><th>直播主题（点击跳转）</th><th>业务线</th><th>视频号成交/退款</th><th>MK APP 成交/退款</th><th>所带商品（品）</th></tr></thead><tbody>${alerts
          .map((a) => {
            const bm = BLINE_META[a.business_line] || { label: a.business_line, cls: "" };
            return `<tr class="clickable-row" data-jump-sid="${a.id}"><td>${esc(a.date_str)}</td><td><strong>${esc(a.speaker || "-")}</strong></td><td>${esc(a.title)}</td><td><span class="tag ${bm.cls}">${bm.label}</span></td><td>${a.ch_orders || 0}单 / ${refundAlertBadge(a.ch_refund_alert, a.ch_refund_rate, a.ch_refunds || 0)}</td><td>${a.mk_orders || 0}单 / ${refundAlertBadge(a.mk_refund_alert, a.mk_refund_rate, a.mk_refunds || 0)}</td><td class="muted">${esc(a.products || "-")}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<div class="banner-green">当前筛选范围内暂无高退单预警场次。</div>`;

    $("anPane-refunds").querySelectorAll("[data-jump-sid]").forEach((tr) => {
      tr.addEventListener("click", () => {
        $("modalAnalytics").classList.add("hidden");
        selectSession(Number(tr.dataset.jumpSid));
      });
    });

    const topics = data.topics || [];
    $("anPane-topics").innerHTML = topics.length
      ? `<table class="data-table"><thead><tr><th>议题 / 流派标签</th><th>场次</th><th>均场观</th><th>峰值在线</th><th>均完看率</th><th>均讨论</th><th>总订单</th><th>总流水(¥)</th></tr></thead><tbody>${topics
          .map(
            (t) => `<tr><td><strong>${esc(t.topic)}</strong></td><td>${t.sessions}</td><td>${t.avg_watch}</td><td><strong>${t.max_online_peak}</strong></td><td>${t.avg_finish_rate ? t.avg_finish_rate + "%" : "-"}</td><td>${t.avg_discuss}</td><td>${t.total_orders}</td><td>¥${Number(t.total_gmv || 0).toFixed(0)}</td></tr>`
          )
          .join("")}</tbody></table>`
      : `<div class="muted" style="padding:18px;">暂无议题标签统计数据。</div>`;
  }

  // ---------------- Event Bindings ----------------

  function bindEvents() {
    $("togglePwBtn").addEventListener("click", () => {
      const inp = $("passwordInput");
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      $("togglePwBtn").textContent = show ? "隐藏" : "显示";
    });

    $("unlockForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pwd = ($("passwordInput").value || "").trim();
      if (!pwd || !state.envelope) return;
      const btn = $("unlockBtn");
      btn.disabled = true;
      btn.textContent = "正在解密...";
      $("lockError").classList.add("hidden");
      try {
        const data = await decryptEnvelope(state.envelope, pwd);
        localStorage.removeItem(MANUAL_LOCK_KEY);
        if ($("rememberPw").checked) {
          localStorage.setItem(PASS_KEY, pwd);
        } else {
          localStorage.removeItem(PASS_KEY);
        }
        $("passwordInput").value = "";
        enterDashboard(data, pwd);
      } catch (_) {
        $("lockError").textContent = "密码错误或数据无法解密，请核对后重试";
        $("lockError").classList.remove("hidden");
        $("passwordInput").select();
      } finally {
        btn.disabled = false;
        btn.textContent = "解锁查看";
      }
    });

    $("btnLogout").addEventListener("click", () => {
      localStorage.removeItem(PASS_KEY);
      localStorage.setItem(MANUAL_LOCK_KEY, "1");
      state.activePassword = "";
      state.transcripts = null;
      showLockScreen("");
      toast("已退出并清除本机记住的密码");
    });

    $("btnReloadData").addEventListener("click", async () => {
      toast("正在拉取最新加密复盘数据...");
      state.envelope = null;
      await bootApp(true);
      toast("已刷新为最新数据");
    });

    $("blineTabs").querySelectorAll(".tab-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("blineTabs").querySelectorAll(".tab-pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.businessLineFilter = btn.dataset.bline;
        renderSessionList();
      });
    });

    $("searchInput").addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderSessionList();
    });

    $("btnJumpToday").addEventListener("click", () => {
      jumpSidebarToToday(true);
      toast(`已定位到今天（${getLocalTodayStr()}）`);
    });

    $("chkOnlyLiveData").addEventListener("change", (e) => {
      state.onlyLiveData = e.target.checked;
      renderSessionList();
      requestAnimationFrame(() => jumpSidebarToToday(false));
    });

    $("detailTabs").querySelectorAll(".sub-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("detailTabs").querySelectorAll(".sub-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
        $("pane-" + btn.dataset.tab).classList.remove("hidden");
        if (btn.dataset.tab === "materials" && !state.transcripts && state.meta.include_transcripts) {
          loadTranscriptsInBackground();
        }
      });
    });

    $("btnCopyDealPoints").addEventListener("click", () => {
      navigator.clipboard.writeText($("reviewDealPoints").textContent || "");
      toast("已复制复盘摘要");
    });

    $("btnAnalytics").addEventListener("click", () => {
      $("modalAnalytics").classList.remove("hidden");
      renderAnalytics();
    });
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => $(btn.dataset.close).classList.add("hidden"));
    });
    $("analyticsBlineFilters").querySelectorAll(".an-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("analyticsBlineFilters").querySelectorAll(".an-filter").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.analyticsBline = btn.dataset.bline;
        renderAnalytics();
      });
    });
    $("analyticsSubTabs").querySelectorAll(".sub-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("analyticsSubTabs").querySelectorAll(".sub-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.analyticsTab = btn.dataset.antab;
        ["speakers", "refunds", "topics"].forEach((k) => $("anPane-" + k).classList.toggle("hidden", k !== state.analyticsTab));
      });
    });
  }

  bindEvents();
  bootApp(true);
})();
