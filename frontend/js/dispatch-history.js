/**
 * PSP MES – Dispatch History.
 *
 * Adds Queue / History sub-tabs to the Dispatch stage.
 * History lists every dispatched job (closed with "Dispatch & Close"): dispatched on, KP (JC), part, customer,
 * qty, FIR No., report sent to customer, dispatched by, total days (material received → dispatched).
 * Summary: dispatched today / last 7 days / this month, plus jobs ready to dispatch.
 * Filters: search + date range (default last 30 days). Export to Excel (CSV).
 *
 * FIR details are not part of the app's job list, so they are fetched once when History is opened.
 *
 * Hold for Customer Clearance (set from the FIR form, stored as dispatch.clearanceHold):
 * the Dispatch card and its main-board card are highlighted amber, "✔ Clearance Received" releases it,
 * and "Dispatch & Close" on a held job asks for confirmation first.
 * Load after psp-common.js and the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] dispatch-history: psp-common.js must load first."); return; }
  const { $, esc, allJobs, kpLabel } = window.PSP;
  const MODULE_VERSION = 2;
  let sub = "dispatch-sub-queue";
  const firCache = new Map();   // KP -> firReport
  let firLoaded = false, firLoading = false;

  const toDate = v => { if (!v) return null; const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? null : d; };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtDT = d => d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " " +
                         d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
  const shortName = n => { const t = String(n || "").trim(); return t.includes("@") ? t.split("@")[0] : t; };

  function dispatchedAt(job) {
    const d = job.dispatch || {};
    return toDate(d.endTime) || toDate((job.stageAssignedAt || {}).dispatched) || toDate(job.lastUpdated) || null;
  }

  function rows() {
    return allJobs().filter(j => j && j.currentDepartment === "Dispatched").map(j => {
      const at = dispatchedAt(j);
      const fir = j.firReport || firCache.get(j.kpNumber) || firCache.get(String(j.kpNumber).split("-R")[0]) || {};
      const start = toDate(j.inspectionDate);
      const jc = (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || "");
      return {
        job: j, at, kp: j.kpNumber, jc, label: kpLabel(j), part: j.partName || "", customer: j.customer || "", qty: j.quantity || "",
        firNo: fir.firNo || "", reportSent: fir.reportSentToCustomer || "",
        by: shortName((j.dispatch || {}).operatorName) || "",
        days: at && start ? Math.max(0, Math.round((new Date(at.toDateString()) - new Date(start.toDateString())) / 86400000)) : null
      };
    }).sort((a, b) => (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0));
  }

  // ---------- UI ----------
  function injectUI() {
    const sec = $("tab-dispatch");
    if (!sec || $("dispatch-sub-history")) return;
    const h2 = sec.querySelector(".section-header h2");
    if (h2) h2.textContent = "DISPATCH & SHIPPING CONSOLE";
    const queuePanel = $("dispatch-queue-cards") && $("dispatch-queue-cards").closest(".panel");
    if (!queuePanel) return;

    const kpis = document.createElement("div");
    kpis.className = "grinding-kpis-grid";
    kpis.style.cssText = "grid-template-columns:repeat(5,1fr); margin-bottom:20px;";
    kpis.innerHTML = `
      <div class="metric-card"><span class="metric-val text-orange" id="dsp-kpi-ready">0</span><span class="metric-lbl">Ready to Dispatch</span></div>
      <div class="metric-card" style="border:2px solid #f59e0b;"><span class="metric-val" id="dsp-kpi-hold" style="color:#d97706;">0</span><span class="metric-lbl">On Hold (Customer Clearance)</span></div>
      <div class="metric-card"><span class="metric-val text-green" id="dsp-kpi-today">0</span><span class="metric-lbl">Dispatched Today</span></div>
      <div class="metric-card"><span class="metric-val text-blue" id="dsp-kpi-week">0</span><span class="metric-lbl">Last 7 Days</span></div>
      <div class="metric-card"><span class="metric-val text-cyan" id="dsp-kpi-month">0</span><span class="metric-lbl">This Month</span></div>`;
    const nav = document.createElement("div");
    nav.className = "grinding-tabs-nav";
    nav.innerHTML = `
      <button type="button" class="machining-tab-btn active" data-dsp-sub="dispatch-sub-queue"><span class="subtab-icon">📋</span><span class="subtab-label">Queue</span></button>
      <button type="button" class="machining-tab-btn" data-dsp-sub="dispatch-sub-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>`;
    const queueWrap = document.createElement("div");
    queueWrap.id = "dispatch-sub-queue";
    queueWrap.className = "machining-subtab-panel active";
    queuePanel.parentNode.insertBefore(kpis, queuePanel);
    queuePanel.parentNode.insertBefore(nav, queuePanel);
    queuePanel.parentNode.insertBefore(queueWrap, queuePanel);
    queueWrap.appendChild(queuePanel);

    const from = new Date(); from.setDate(from.getDate() - 30);
    const hist = document.createElement("div");
    hist.id = "dispatch-sub-history";
    hist.className = "machining-subtab-panel";
    hist.innerHTML = `
      <div class="panel">
        <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
          <h3>DISPATCHED JOBS</h3>
          <button type="button" id="dsp-export" class="btn btn-success btn-sm" style="height:34px;">⬇️ Export to Excel</button>
        </div>
        <div class="panel-body">
          <div class="filters-toolbar">
            <div class="filter-group"><label for="dsp-search">Search:</label><input type="text" id="dsp-search" class="form-input input-sm" placeholder="KP, JC, customer, part, FIR..."></div>
            <div class="filter-group"><label for="dsp-from">From:</label><input type="date" id="dsp-from" class="form-input input-sm" value="${ymd(from)}"></div>
            <div class="filter-group"><label for="dsp-to">To:</label><input type="date" id="dsp-to" class="form-input input-sm" value="${ymd(new Date())}"></div>
            <button id="dsp-clear" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">ALL DATES</button>
          </div>
          <div id="dsp-summary" class="text-xs text-muted" style="margin:8px 0;"></div>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Dispatched On</th><th>KP Number</th><th>Part Name</th><th>Customer</th><th>Qty</th>
                <th>FIR No.</th><th>Report Sent to Customer</th><th>Dispatched By</th><th>Total Days</th></tr></thead>
              <tbody id="dsp-history-body"></tbody>
            </table>
          </div>
        </div>
      </div>`;
    queueWrap.insertAdjacentElement("afterend", hist);

    nav.querySelectorAll("[data-dsp-sub]").forEach(b => b.addEventListener("click", () => {
      sub = b.getAttribute("data-dsp-sub");
      nav.querySelectorAll("[data-dsp-sub]").forEach(x => x.classList.toggle("active", x === b));
      [queueWrap, hist].forEach(p => p.classList.toggle("active", p.id === sub));
      render();
    }));
    $("dsp-search").addEventListener("input", renderHistory);
    $("dsp-from").addEventListener("change", renderHistory);
    $("dsp-to").addEventListener("change", renderHistory);
    $("dsp-clear").addEventListener("click", () => { $("dsp-from").value = ""; $("dsp-to").value = ""; renderHistory(); });
    $("dsp-export").addEventListener("click", exportCsv);
  }

  function filtered() {
    const q = ($("dsp-search").value || "").toLowerCase();
    const from = $("dsp-from").value ? new Date($("dsp-from").value + "T00:00:00") : null;
    const to = $("dsp-to").value ? new Date($("dsp-to").value + "T23:59:59") : null;
    return rows().filter(r => {
      if (from && (!r.at || r.at < from)) return false;
      if (to && (!r.at || r.at > to)) return false;
      if (q && ![r.kp, r.jc, r.customer, r.part, r.firNo].some(v => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderKpis() {
    const all = rows();
    const now = new Date(), startToday = new Date(now.toDateString());
    const week = new Date(startToday); week.setDate(week.getDate() - 6);
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const inDispatch = allJobs().filter(j => j.currentDepartment === "Dispatch");
    set("dsp-kpi-hold", inDispatch.filter(onHold).length);
    set("dsp-kpi-ready", inDispatch.filter(j => !onHold(j)).length);
    set("dsp-kpi-today", all.filter(r => r.at && r.at >= startToday).length);
    set("dsp-kpi-week", all.filter(r => r.at && r.at >= week).length);
    set("dsp-kpi-month", all.filter(r => r.at && r.at >= month).length);
  }

  function renderHistory() {
    const tbody = $("dsp-history-body");
    if (!tbody) return;
    loadFirDetails();
    const list = filtered();
    const pcs = list.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    $("dsp-summary").textContent = `${list.length} job(s), ${pcs} pcs dispatched` +
      ($("dsp-from").value || $("dsp-to").value ? ` · ${$("dsp-from").value || "start"} to ${$("dsp-to").value || "today"}` : " · all dates") +
      (firLoading ? " · loading FIR details…" : "");
    tbody.innerHTML = list.length ? list.map(r => `<tr>
        <td style="white-space:nowrap;" class="font-mono text-xs">${fmtDT(r.at)}</td>
        <td class="font-mono font-bold text-cyan">${esc(r.label)}</td><td>${esc(r.part)}</td><td>${esc(r.customer)}</td>
        <td class="font-mono">${esc(r.qty)}</td><td>${esc(r.firNo || "—")}</td>
        <td>${r.reportSent ? `<span class="badge ${r.reportSent === "Yes" ? "badge-completed" : "badge-pending"}" style="font-size:10px;">${esc(r.reportSent)}</span>` : "—"}</td>
        <td>${esc(r.by || "—")}</td><td class="font-mono">${r.days === null ? "—" : r.days + " d"}</td></tr>`).join("")
      : `<tr><td colspan="9" class="text-center text-muted">No dispatched jobs for these filters.</td></tr>`;
  }

  // FIR No. / report sent: fetched once per session when History is opened
  async function loadFirDetails() {
    if (firLoaded || firLoading) return;
    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return;
    if (typeof isMockMode === "function" && isMockMode()) { firLoaded = true; return; }
    firLoading = true;
    try {
      const snap = await firebase.firestore().collection("jobs").where("currentStage", "==", "Dispatched").get();
      snap.forEach(doc => { const d = doc.data(); if (d.kpNumber && d.firReport) firCache.set(d.kpNumber, d.firReport); });
      // split jobs (KP-xxx-R) inherit the FIR of their parent when they have none
      const parents = new Set(rows().filter(r => !firCache.get(r.kp) && r.kp.includes("-R")).map(r => r.kp.split("-R")[0]));
      if (parents.size) {
        const db = firebase.firestore();
        await Promise.all([...parents].map(kp => db.collection("jobs").doc("job_" + kp).get().then(s => {
          if (s.exists && s.data().firReport) firCache.set(kp, s.data().firReport);
        }).catch(() => {})));
      }
      firLoaded = true;
    } catch (e) {
      console.warn("[Dispatch History] could not load FIR details:", e && e.message ? e.message : e);
    } finally {
      firLoading = false;
      renderHistory();
    }
  }

  function exportCsv() {
    const list = filtered();
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Dispatched On", "KP Number", "JC No", "Part Name", "Customer", "Qty", "FIR No.", "Report Sent to Customer", "Dispatched By", "Total Days"];
    const lines = [head.map(q).join(",")].concat(list.map(r => [
      r.at ? `${ymd(r.at)} ${r.at.toTimeString().slice(0, 5)}` : "", r.kp, r.jc, r.part, r.customer, r.qty, r.firNo, r.reportSent, r.by, r.days ?? ""
    ].map(q).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `PSP-Dispatched-${$("dsp-from").value || "all"}_to_${$("dsp-to").value || ymd(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ===================== HOLD FOR CUSTOMER CLEARANCE =====================
  const onHold = j => !!(j && j.dispatch && j.dispatch.clearanceHold && j.dispatch.clearanceHold.active);
  const AMBER = "#f59e0b";
  function holdSince(j) {
    const h = (j.dispatch || {}).clearanceHold || {};
    const d = toDate(h.since);
    return `${d ? fmtDT(d) : ""}${h.by ? " · by " + shortName(h.by) : ""}`;
  }
  function injectHoldStyle() {
    if ($("dsp-hold-css")) return;
    const st = document.createElement("style");
    st.id = "dsp-hold-css";
    st.textContent = `.dsp-on-hold { border:2px solid ${AMBER} !important; background:rgba(245,158,11,0.12) !important; box-shadow:0 0 0 2px rgba(245,158,11,.25); }
      .dsp-hold-banner { background:${AMBER}; color:#1f1300; font-weight:800; font-size:11px; letter-spacing:.3px; padding:5px 8px; border-radius:5px; margin-bottom:8px; }
      .dsp-hold-banner small { display:block; font-weight:600; font-size:10px; opacity:.85; letter-spacing:0; }`;
    document.head.appendChild(st);
  }
  // Match a rendered card to its job by the "KP (JC)" label in its header
  function jobForCard(card, pool, used) {
    const head = card.querySelector(".job-card-header .font-mono, .kanban-card-kp");
    if (!head) return null;
    const text = head.textContent.replace(/\s+/g, " ").trim();
    const job = pool.find(j => !used.has(j) && kpLabel(j) === text);
    if (job) used.add(job);
    return job;
  }
  function decorateDispatchCards() {
    injectHoldStyle();
    const pool = allJobs().filter(j => j.currentDepartment === "Dispatch");
    const ro = window.PSP.isReadOnly ? window.PSP.isReadOnly() : false;
    // Dispatch tab queue
    const box = $("dispatch-queue-cards");
    if (box) {
      const used = new Set();
      box.querySelectorAll(":scope > .stage-kanban-card").forEach(card => {
        card.querySelectorAll(".dsp-hold-banner, [data-dsp-release]").forEach(x => x.remove());
        card.classList.remove("dsp-on-hold");
        const job = jobForCard(card, pool, used);
        if (!job || !onHold(job)) return;
        card.classList.add("dsp-on-hold");
        const banner = document.createElement("div");
        banner.className = "dsp-hold-banner";
        banner.innerHTML = `⏸ HOLD – CUSTOMER CLEARANCE<small>${esc(holdSince(job))}</small>`;
        const body = card.querySelector(".job-card-body");
        if (body) body.parentNode.insertBefore(banner, body);
        const badge = card.querySelector(".badge-completed");
        if (badge && /ready/i.test(badge.textContent)) { badge.textContent = "Awaiting Customer Clearance"; badge.style.background = AMBER; badge.style.color = "#1f1300"; }
        const actions = card.querySelector(".stage-card-actions");
        if (actions && !ro) {
          const b = document.createElement("button");
          b.className = "btn btn-xs";
          b.setAttribute("data-dsp-release", job.kpNumber);
          b.style.cssText = `width:100%; height:32px; background:${AMBER}; color:#1f1300; font-weight:800; border:0;`;
          b.textContent = "✔ Clearance Received";
          actions.insertBefore(b, actions.firstChild);
        }
      });
    }
    // Main board DISPATCH column
    const col = $("cards-dispatch-stage");
    if (col) {
      col.querySelectorAll("[data-board-kp]").forEach(card => {
        const job = pool.find(j => j.kpNumber === card.getAttribute("data-board-kp"));
        const old = card.querySelector(".dsp-hold-banner");
        if (old) old.remove();
        card.classList.toggle("dsp-on-hold", !!(job && onHold(job)));
        if (job && onHold(job)) {
          const tag = document.createElement("div");
          tag.className = "dsp-hold-banner";
          tag.style.marginBottom = "6px";
          tag.textContent = "⏸ HOLD – CUSTOMER CLEARANCE";
          card.insertBefore(tag, card.firstChild);
        }
      });
    }
  }

  async function releaseHold(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job || !onHold(job)) return;
    if (!confirm(`Customer clearance received for ${kpLabel(job)}?\n\nThe job becomes ready to dispatch.`)) return;
    const u = window.PSP.user() || {};
    const released = Object.assign({}, job.dispatch.clearanceHold, { active: false, releasedAt: new Date().toISOString(), releasedBy: u.name || u.email || "User" });
    job.dispatch.clearanceHold = released;
    decorateDispatchCards(); renderKpis();
    try {
      if (!(typeof isMockMode === "function" && isMockMode())) {
        const db = firebase.firestore();
        const ref = job.id ? db.collection("jobs").doc(job.id) : db.collection("jobs").doc("job_" + job.kpNumber);
        await ref.update({ "dispatch.clearanceHold": released, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() });
      }
      if (typeof createAuditLog === "function") createAuditLog(u.email || released.releasedBy, kp, "Customer clearance received – released from HOLD in Dispatch");
    } catch (e) { alert("Could not save: " + (e && e.message ? e.message : e)); }
  }

  function render() {
    try { decorateDispatchCards(); } catch (e) { console.warn("[Dispatch] hold display:", e); }
    const pane = $("tab-dispatch");
    if (!pane || !pane.classList.contains("active")) return;
    renderKpis();
    if (sub === "dispatch-sub-history") renderHistory();
  }

  function installHooks() {
    ["dispatch-queue-cards", "cards-dispatch-stage"].forEach(id => {
      const el = $(id);
      if (!el) return;
      let queued = false;
      new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; try { decorateDispatchCards(); } catch (e) {} }, 0); })
        .observe(el, { childList: true });
    });
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-dsp-release]");
      if (b) { e.stopPropagation(); releaseHold(b.getAttribute("data-dsp-release")); }
    }, true);
    if (typeof window.triggerDispatchFloatingTransition === "function") {
      const origDispatch = window.triggerDispatchFloatingTransition;
      window.triggerDispatchFloatingTransition = function (kpNumber) {
        const job = allJobs().find(j => j.kpNumber === kpNumber);
        if (job && onHold(job) && !confirm(`${kpLabel(job)} is on HOLD for customer clearance (${holdSince(job)}).\n\nCustomer clearance not received yet. Dispatch anyway?`)) return;
        return origDispatch.apply(this, arguments);
      };
    }
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        try { render(); } catch (e) { console.warn("[Dispatch History] render:", e); }
        return r;
      };
    }
  }

  try {
    injectUI();
    installHooks();
    console.log("[PSP] dispatch-history v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] dispatch-history failed to load:", err);
  }
})();
