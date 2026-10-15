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
 * Load after psp-common.js and the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] dispatch-history: psp-common.js must load first."); return; }
  const { $, esc, allJobs, kpLabel } = window.PSP;
  const MODULE_VERSION = 1;
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
    kpis.style.cssText = "grid-template-columns:repeat(4,1fr); margin-bottom:20px;";
    kpis.innerHTML = `
      <div class="metric-card"><span class="metric-val text-orange" id="dsp-kpi-ready">0</span><span class="metric-lbl">Ready to Dispatch</span></div>
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
    set("dsp-kpi-ready", allJobs().filter(j => j.currentDepartment === "Dispatch").length);
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

  function render() {
    const pane = $("tab-dispatch");
    if (!pane || !pane.classList.contains("active")) return;
    renderKpis();
    if (sub === "dispatch-sub-history") renderHistory();
  }

  function installHooks() {
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
