/**
 * PSP MES – Department Backlog Report (Super Admin only).
 *
 * Sidebar "BKL · Backlog Report": department cards, open-job table with days in stage and days left,
 * department dropdown, filters, and Excel (.xlsx) export via SheetJS (CSV fallback).
 *
 * "⟳ Sync All Jobs to Sheet" (Super Admin): copies every job from Firebase into the Q2P backend sheets
 * (PIR_Reports, FIR_Reports, Dispatch_Reports, MES_Stage_Summary, MES_Stage_Log) through the MES Stage Sync
 * Apps Script (request type "BACKFILL"). Rows already in the sheets are skipped, so it can be clicked any time.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] backlog-report: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 8;

  // ===================== BACKLOG REPORT (all departments) =====================
  const BACKLOG_STAGES = ["Inspection", "Machining", "Masking", "Blasting", "Spraying", "Sealing", "Grinding", "Polishing", "Final Inspection", "Dispatch", "Outsourcing", "Quarantine"];
  let backlogFilter = { dept: "", status: "", search: "" };

  function injectBacklogTab() {
    if ($("tab-backlog")) return;
    // Sidebar button, just above Performance Reports
    const reportsBtn = $("nav-btn-reports");
    if (reportsBtn && !$("nav-btn-backlog")) {
      const btn = document.createElement("button");
      btn.className = "nav-btn";
      btn.id = "nav-btn-backlog";
      btn.setAttribute("data-tab", "tab-backlog");
      btn.innerHTML = `<span class="stage-num">BKL</span><span class="stage-name">Backlog Report</span>
                       <span class="stage-badge badge-pending" id="badge-count-backlog">0</span>`;
      btn.addEventListener("click", () => { window.location.hash = "#/backlog"; });
      const u = user();
      if (!u || u.role !== "super_admin") btn.style.display = "none";
      reportsBtn.insertAdjacentElement("beforebegin", btn);
    }
    const main = document.querySelector(".mes-main-content");
    if (!main) return;
    const sec = document.createElement("section");
    sec.id = "tab-backlog";
    sec.className = "tab-pane";
    sec.innerHTML = `
      <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap;">
        <div>
          <h2>Department Backlog Report</h2>
          <p class="section-desc">Every open job by department: days in its current stage, job age since material was received, and days left to (or past) the delivery date from the Q2P sheet. Click a department card to filter.</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <label for="backlog-filter-dept" style="font-weight:700; font-size:13px;">Department:</label>
          <select id="backlog-filter-dept" class="form-input select-sm" style="height:36px; min-width:190px; font-weight:600;">
            <option value="">All Departments</option>${opts(BACKLOG_STAGES)}</select>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-backlog-print" style="height:36px;">🖨️ Print</button>
          <button type="button" class="btn btn-success btn-sm" id="btn-backlog-export" style="height:36px; font-weight:700;">⬇️ Export Excel – All Departments</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-backlog-sync" style="height:36px; font-weight:700;" title="Copy every job (PIR, FIR, Dispatch, stage history) into the Q2P backend sheets. Rows already there are skipped.">⟳ Sync All Jobs to Sheet</button>
        </div>
      </div>
      <div id="backlog-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:12px; margin-bottom:16px;"></div>
      <div class="panel">
        <div class="panel-body">
          <div class="filters-toolbar">
            <div class="filter-group"><label for="backlog-filter-status">Status:</label>
              <select id="backlog-filter-status" class="form-input select-sm">
                <option value="">All</option><option value="Pending">Pending (waiting)</option><option value="In Progress">In Progress</option>
                <option value="Hold">On Hold</option><option value="overdue">Overdue only</option></select></div>
            <div class="filter-group"><label for="backlog-filter-search">Search:</label>
              <input type="text" id="backlog-filter-search" class="form-input input-sm" placeholder="KP, JC, customer, part..."></div>
            <button id="btn-backlog-clear" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
          </div>
          <div id="backlog-summary-line" class="text-xs text-muted" style="margin:8px 0;"></div>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr>
                <th>Department</th><th>KP Number</th><th>Part Name</th><th>Customer</th><th>Qty</th><th>Status</th>
                <th>Operator / Machine</th><th>In Stage Since</th><th>Days in Stage</th><th>Job Age</th><th>Delivery Date</th><th>Days Left / Overdue</th>
              </tr></thead>
              <tbody id="backlog-table-body"></tbody>
            </table>
          </div>
        </div>
      </div>`;
    main.appendChild(sec);

    $("backlog-filter-dept").addEventListener("change", e => { backlogFilter.dept = e.target.value; renderBacklog(); });
    $("backlog-filter-status").addEventListener("change", e => { backlogFilter.status = e.target.value; renderBacklog(); });
    $("backlog-filter-search").addEventListener("input", e => { backlogFilter.search = e.target.value; renderBacklog(); });
    $("btn-backlog-clear").addEventListener("click", () => {
      backlogFilter = { dept: "", status: "", search: "" };
      $("backlog-filter-dept").value = ""; $("backlog-filter-status").value = ""; $("backlog-filter-search").value = "";
      renderBacklog();
    });
    $("backlog-cards").addEventListener("click", e => {
      const card = e.target.closest("[data-backlog-dept]");
      if (!card) return;
      const d = card.getAttribute("data-backlog-dept");
      backlogFilter.dept = backlogFilter.dept === d ? "" : d;
      $("backlog-filter-dept").value = backlogFilter.dept;
      renderBacklog();
    });
    $("btn-backlog-export").addEventListener("click", exportBacklogExcel);
    $("btn-backlog-print").addEventListener("click", () => window.print());
    $("btn-backlog-sync").addEventListener("click", syncAllJobsToSheet);
  }

  function parseDateSafe(v) {
    if (!v) return null;
    if (v && typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // ---- Delivery (Q) and received (D) dates read straight from the Q2P sheet, for this report only ----
  // The rest of the dashboard keeps its own dates (TAT chips etc. are not affected).
  const sheetDates = new Map();   // KP -> { received: Date|null, delivery: Date|null }
  let sheetDatesAt = 0, sheetDatesLoading = false, sheetDatesError = "";
  const SHEET_DATES_MAX_AGE = 5 * 60 * 1000;

  function sheetCellDate(c) {
    if (!c) return null;
    const v = c.v;
    if (v instanceof Date || Object.prototype.toString.call(v) === "[object Date]") {
      return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    const txt = String(c.f != null ? c.f : (v != null ? v : "")).trim();
    if (!txt) return null;
    let m = txt.match(/^Date\((\d+),(\d+),(\d+)/);
    if (m) return new Date(Number(m[1]), Number(m[2]), Number(m[3]));
    m = txt.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);          // day-first: 05/10/2026 = 5 Oct
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return null;
  }

  async function loadSheetDates(force) {
    if (sheetDatesLoading) return;
    if (!force && sheetDatesAt && Date.now() - sheetDatesAt < SHEET_DATES_MAX_AGE) return;
    if (typeof fetchGVizData !== "function") { sheetDatesError = "sheet reader not available"; return; }
    sheetDatesLoading = true;
    try {
      const table = await fetchGVizData("SELECT T, D, Q WHERE T IS NOT NULL");
      sheetDates.clear();
      ((table && table.rows) || []).forEach(r => {
        const c = r.c || [];
        const kp = String((c[0] && c[0].v) || "").trim().toUpperCase();
        if (!/^KP-/.test(kp)) return;
        sheetDates.set(kp, { received: sheetCellDate(c[1]), delivery: sheetCellDate(c[2]) });
      });
      sheetDatesAt = Date.now();
      sheetDatesError = "";
    } catch (e) {
      sheetDatesError = (e && e.message) ? e.message : String(e);
      console.warn("[Backlog] Could not read delivery dates from the sheet:", sheetDatesError);
    } finally {
      sheetDatesLoading = false;
      renderBacklog();
    }
  }

  function datesFor(kp) {
    const k = String(kp || "").trim().toUpperCase();
    if (sheetDates.has(k)) return sheetDates.get(k);
    const i = k.indexOf("-R");                     // split jobs (KP-xxx-01-R1) use the parent KP's dates
    return i !== -1 ? (sheetDates.get(k.slice(0, i)) || null) : null;
  }

  const dayDiff = (a, b) => Math.floor((a - b) / 86400000);
  const fmtDate = d => d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  function backlogRows() {
    const now = new Date();
    return allJobs().filter(j => j && j.kpNumber && BACKLOG_STAGES.includes(j.currentDepartment)).map(j => {
      const dept = j.currentDepartment;
      const key = stageKeyOf(dept);
      const sd = j[key] || {};
      const flatKey = String(dept).toLowerCase().replace(/[^a-z]/g, "");
      const since = parseDateSafe((j.stageAssignedAt || {})[flatKey]) || parseDateSafe(sd.queueEntryTime)
                 || (dept === "Inspection" ? parseDateSafe(j.inspectionDate) : null);
      let status = sd.status || j.status || "Pending";
      if (status === "Completed") status = "Pending"; // finished the previous cycle here, waiting to move on
      const sd2 = datesFor(j.kpNumber);
      const due = sd2 ? sd2.delivery : null;        // Q2P column Q "Del Date"
      const received = sd2 ? sd2.received : null;   // Q2P column D "Incoming Date"
      const who = [sd.operatorName || j.operatorName || "", sd.machineName || sd.grindingMachine || sd.booth || ""].filter(Boolean).join(" · ");
      return {
        dept, kp: j.kpNumber, label: kpLabel(j), part: j.partName || "", customer: j.customer || "", qty: j.quantity || "",
        status, who, since, daysIn: since ? Math.max(0, dayDiff(now, since)) : null,
        due, daysLeft: due ? dayDiff(due, new Date(now.toDateString())) : null,
        received, age: received ? Math.max(0, dayDiff(new Date(now.toDateString()), new Date(received.toDateString()))) : null,
        jc: (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || ""), priority: j.priority || "Normal"
      };
    });
  }

  function filteredBacklog(rows) {
    const q = backlogFilter.search.trim().toLowerCase();
    return rows.filter(r => {
      if (backlogFilter.dept && r.dept !== backlogFilter.dept) return false;
      if (backlogFilter.status === "overdue") { if (!(r.daysLeft !== null && r.daysLeft < 0)) return false; }
      else if (backlogFilter.status && r.status !== backlogFilter.status) return false;
      if (q && ![r.kp, r.jc, r.customer, r.part].some(v => String(v).toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (BACKLOG_STAGES.indexOf(a.dept) - BACKLOG_STAGES.indexOf(b.dept)) || ((b.daysIn ?? -1) - (a.daysIn ?? -1)));
  }

  function renderBacklog() {
    const u = user();
    const navBtn = $("nav-btn-backlog");
    if (!u || u.role !== "super_admin") { if (navBtn) navBtn.style.display = "none"; return; }
    if (navBtn) navBtn.style.display = "";
    const rows = backlogRows();
    const badge = $("badge-count-backlog");
    if (badge) badge.textContent = rows.length;
    const pane = $("tab-backlog");
    if (!pane || !pane.classList.contains("active")) return;
    loadSheetDates(false);

    // Department cards
    $("backlog-cards").innerHTML = BACKLOG_STAGES.map(d => {
      const list = rows.filter(r => r.dept === d);
      const running = list.filter(r => r.status === "In Progress").length;
      const hold = list.filter(r => r.status === "Hold").length;
      const overdue = list.filter(r => r.daysLeft !== null && r.daysLeft < 0).length;
      const oldest = list.reduce((m, r) => Math.max(m, r.daysIn ?? 0), 0);
      const active = backlogFilter.dept === d;
      return `<div class="metric-card" data-backlog-dept="${esc(d)}" style="cursor:pointer; text-align:left; padding:12px; ${active ? "outline:3px solid var(--text-highlight);" : ""}">
          <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">${esc(d)}</div>
          <div style="font-size:30px; font-weight:800; line-height:1.2;">${list.length}</div>
          <div style="font-size:11px; line-height:1.6;">
            ${list.length - running - hold} waiting · ${running} running · ${hold} hold<br>
            <span style="color:${overdue ? "#ef4444" : "inherit"}; font-weight:${overdue ? 700 : 400};">${overdue} overdue</span> · oldest ${oldest}d
          </div>
        </div>`;
    }).join("");

    const exportBtn = $("btn-backlog-export");
    if (exportBtn) exportBtn.textContent = `⬇️ Export Excel – ${backlogFilter.dept || "All Departments"}`;
    const list = filteredBacklog(rows);
    $("backlog-summary-line").textContent = `${list.length} of ${rows.length} open jobs shown` +
      (backlogFilter.dept ? ` · ${backlogFilter.dept}` : "") + " · sorted by department, then longest waiting first" +
      (sheetDatesLoading ? " · reading delivery dates from Q2P sheet…"
        : sheetDatesError ? ` · delivery dates not available (${sheetDatesError})`
        : sheetDatesAt ? ` · delivery dates from Q2P sheet at ${new Date(sheetDatesAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "");

    const statusStyle = st => st === "In Progress" ? "background:#3b82f6;" : st === "Hold" ? "background:#ef4444;" : "background:#f97316;";
    $("backlog-table-body").innerHTML = list.length ? list.map(r => {
      const late = r.daysLeft !== null && r.daysLeft < 0;
      const soon = r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 2;
      const longWait = r.daysIn !== null && r.daysIn >= 3;
      return `<tr>
        <td><strong>${esc(r.dept)}</strong></td>
        <td class="font-mono font-bold text-cyan">${esc(r.label)}</td>
        <td>${esc(r.part)}</td><td>${esc(r.customer)}</td><td class="font-mono">${esc(r.qty)}</td>
        <td><span style="font-size:10px; font-weight:700; padding:2px 8px; border-radius:4px; color:#fff; ${statusStyle(r.status)}">${esc(String(r.status).toUpperCase())}</span></td>
        <td>${esc(r.who || "—")}</td>
        <td>${fmtDate(r.since)}</td>
        <td class="font-mono" style="${longWait ? "color:#f97316; font-weight:700;" : ""}">${r.daysIn === null ? "—" : r.daysIn + " d"}</td>
        <td class="font-mono" title="${r.received ? "Material received " + fmtDate(r.received) : ""}">${r.age === null ? "—" : r.age + " d"}</td>
        <td>${fmtDate(r.due)}</td>
        <td class="font-mono" style="${late ? "color:#ef4444; font-weight:800;" : soon ? "color:#f97316; font-weight:700;" : ""}">${r.daysLeft === null ? "—" : late ? Math.abs(r.daysLeft) + " d LATE" : (r.daysLeft === 0 ? "Due today" : r.daysLeft + " d left")}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="12" class="text-center text-muted">No open jobs match these filters.</td></tr>`;
  }

  // ---- Real Excel (.xlsx) export via SheetJS, loaded only when needed ----
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      const t = setTimeout(() => reject(new Error("Excel library took too long to load")), 15000);
      sc.onload = () => { clearTimeout(t); window.XLSX ? resolve(window.XLSX) : reject(new Error("Excel library not available")); };
      sc.onerror = () => { clearTimeout(t); reject(new Error("Excel library could not be loaded")); };
      document.head.appendChild(sc);
    });
  }

  const XL_HEAD = ["Department", "KP Number", "JC No", "Part Name", "Customer", "Qty", "Status", "Operator / Machine",
                   "In Stage Since", "Days in Stage", "Material Received", "Job Age (days)", "Delivery Date", "Days Left", "Overdue (days)", "Priority"];
  const xlDate = d => d ? `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}` : "";
  const xlRow = r => [r.dept, r.kp, r.jc, r.part, r.customer, Number(r.qty) || r.qty, r.status, r.who,
                      xlDate(r.since), r.daysIn ?? "", xlDate(r.received), r.age ?? "", xlDate(r.due),
                      (r.daysLeft !== null && r.daysLeft >= 0) ? r.daysLeft : "",
                      (r.daysLeft !== null && r.daysLeft < 0) ? Math.abs(r.daysLeft) : "", r.priority];

  function xlSheet(XLSX, aoa, widths) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = widths.map(w => ({ wch: w }));
    if (aoa.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
    return ws;
  }

  async function exportBacklogExcel() {
    const btn = $("btn-backlog-export");
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Preparing Excel…"; }
    try {
      const XLSX = await loadSheetJS();
      const all = backlogRows();
      const list = filteredBacklog(all);
      const widths = [16, 14, 10, 26, 30, 6, 12, 24, 14, 12, 16, 13, 14, 10, 13, 9];
      const wb = XLSX.utils.book_new();
      const stamp = new Date();

      if (backlogFilter.dept) {
        // One department: a single sheet with its backlog
        XLSX.utils.book_append_sheet(wb, xlSheet(XLSX, [XL_HEAD].concat(list.map(xlRow)), widths), backlogFilter.dept.slice(0, 31));
      } else {
        // All departments: Summary + All Jobs + one sheet per department
        const summary = [["PSP Backlog Report", "", "", "", "", ""],
                         ["Generated", stamp.toLocaleString("en-IN"), "", "", "", ""],
                         ["", "", "", "", "", ""],
                         ["Department", "Open Jobs", "Waiting", "Running", "On Hold", "Overdue", "Oldest (days in stage)"]];
        BACKLOG_STAGES.forEach(d => {
          const rows = list.filter(r => r.dept === d);
          const run = rows.filter(r => r.status === "In Progress").length, hold = rows.filter(r => r.status === "Hold").length;
          summary.push([d, rows.length, rows.length - run - hold, run, hold,
                        rows.filter(r => r.daysLeft !== null && r.daysLeft < 0).length,
                        rows.reduce((m, r) => Math.max(m, r.daysIn ?? 0), 0)]);
        });
        summary.push(["TOTAL", list.length, "", "", "", list.filter(r => r.daysLeft !== null && r.daysLeft < 0).length, ""]);
        const ws = XLSX.utils.aoa_to_sheet(summary);
        ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, ws, "Summary");
        XLSX.utils.book_append_sheet(wb, xlSheet(XLSX, [XL_HEAD].concat(list.map(xlRow)), widths), "All Jobs");
        BACKLOG_STAGES.forEach(d => {
          const rows = list.filter(r => r.dept === d);
          XLSX.utils.book_append_sheet(wb, xlSheet(XLSX, [XL_HEAD].concat(rows.map(xlRow)), widths), d.slice(0, 31));
        });
      }
      const fname = `PSP-Backlog-${(backlogFilter.dept || "All-Departments").replace(/\s+/g, "-")}-${stamp.toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e) {
      console.warn("[Backlog] Excel export failed, using CSV instead:", e && e.message ? e.message : e);
      alert("Excel file could not be created (" + (e && e.message ? e.message : e) + ").\nA CSV file (opens in Excel) will be downloaded instead.");
      exportBacklogCsv();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function exportBacklogCsv() {
    const list = filteredBacklog(backlogRows());
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Department", "KP Number", "JC No", "Part Name", "Customer", "Qty", "Status", "Operator / Machine",
                  "In Stage Since", "Days in Stage", "Material Received", "Job Age (days)", "Delivery Date", "Days Left", "Overdue (days)", "Priority"];
    const lines = [head.map(q).join(",")].concat(list.map(r => [
      r.dept, r.kp, r.jc, r.part, r.customer, r.qty, r.status, r.who,
      xlDate(r.since), r.daysIn ?? "", xlDate(r.received), r.age ?? "", xlDate(r.due),
      (r.daysLeft !== null && r.daysLeft >= 0) ? r.daysLeft : "",
      (r.daysLeft !== null && r.daysLeft < 0) ? Math.abs(r.daysLeft) : "", r.priority
    ].map(q).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `PSP-backlog-${backlogFilter.dept ? backlogFilter.dept.replace(/\s+/g, "-") + "-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ===================== SYNC ALL JOBS TO THE BACKEND SHEET (backfill) =====================
  const SYNC_URL = "https://script.google.com/macros/s/AKfycbzMXoqOSbxHnedhNpf_8XFAJ1UCLHHnwtDPqx_05gjU3rcb9U1mmlRfd0ma5ulwO3DV/exec";
  const SYNC_TOKEN = "psp-mes-54f01c5b50486721db971093";
  const SYNC_STAGE_KEYS = [["inspection", "Inspection"], ["machining", "Machining"], ["masking", "Masking"], ["blasting", "Blasting"], ["spraying", "Spraying"],
    ["sealing", "Sealing"], ["grinding", "Grinding"], ["polishing", "Polishing"], ["finalInspection", "Final Inspection"], ["dispatch", "Dispatch"],
    ["outsourcing", "Outsourcing"], ["quarantine", "Quarantine"]];
  const SYNC_STATUS_MAP = { "No Masking Required": "Bypassed", "At Vendor": "In Progress", "Returned": "Completed", "In Quarantine": "In Progress", "Released": "Completed" };
  let syncing = false;

  async function syncAllJobsToSheet() {
    const u = user();
    if (!u || u.role !== "super_admin") { alert("Only Super Admin can sync all jobs."); return; }
    if (syncing) return;
    if (!confirm("Copy ALL jobs from the MES into the Q2P backend sheets?\n\nPIR_Reports, FIR_Reports, Dispatch_Reports, MES_Stage_Summary, MES_Stage_Log.\nRows already in the sheets are skipped (no duplicates).\n\nThis takes 1–3 minutes. Keep this page open.")) return;
    const btn = $("btn-backlog-sync");
    const label = btn.textContent;
    const setBtn = t => { btn.textContent = t; };
    syncing = true; btn.disabled = true;
    const toIso = v => { if (!v) return ""; const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? "" : d.toISOString(); };
    try {
      // 1) every job, straight from Firebase (it keeps the PIR / FIR / Dispatch forms and stage times)
      setBtn("Reading jobs…");
      const snap = await firebase.firestore().collection("jobs").get({ source: "server" });
      const docs = snap.docs.map(d => d.data()).filter(d => d.isDeleted !== true && d.kpNumber);
      const pir = [], fir = [], dsp = [], stageItems = [];
      const reports = (arr, one) => (Array.isArray(arr) && arr.length ? arr : (one ? [one] : []));
      docs.forEach(d => {
        const jc = d.jcNo || (window.kpToJcMap || {})[String(d.kpNumber).toUpperCase()] || "";
        const base = { kpNo: d.kpNumber, jcNo: jc, partName: d.partName || "", customer: d.customer || "" };
        reports(d.pirReports, d.pirReport).forEach(r => pir.push(Object.assign({}, base, r)));
        reports(d.firReports, d.firReport).forEach(r => fir.push(Object.assign({}, base, r)));
        reports(d.dispatchReports, d.dispatchReport).forEach(r => dsp.push(Object.assign({}, base, r)));
        const assigned = d.stageAssignedAt || {};
        const stages = [];
        SYNC_STAGE_KEYS.forEach(([key, name]) => {
          const st = d[key];
          if (!st || typeof st !== "object") return;
          const isCurrent = d.currentStage === name;
          let status = SYNC_STATUS_MAP[st.status] || st.status || "";
          if (!isCurrent && (!status || status === "Pending")) return;      // stage not used by this job
          if (key === "dispatch" && d.currentStage === "Dispatched") status = "Completed";
          const holds = Array.isArray(st.holdHistory) ? st.holdHistory : [];
          const lastHold = holds.length ? (holds[holds.length - 1].reason || holds[holds.length - 1].holdReason || "") : (st.holdReason || "");
          stages.push({
            stage: name, status, operator: st.operatorName || st.vendor || st.by || "", shift: st.shift || "",
            enteredAt: toIso(assigned[key.toLowerCase()] || st.queueEntryTime || st.enteredAt || st.at),
            startedAt: toIso(st.startTime || st.sentAt), completedAt: toIso(st.endTime || st.receivedAt || st.releasedAt),
            activeTimeMs: Number(st.activeTimeMs || st.durationMs || 0), holdCount: holds.length, lastHoldReason: lastHold,
            nextStage: st.nextStage || st.returnedTo || st.releasedTo || ""
          });
        });
        if (d.currentStage === "Dispatched") stages.push({ stage: "Dispatched", status: "Completed",
          enteredAt: toIso(assigned.dispatched || (d.dispatch || {}).endTime), completedAt: toIso((d.dispatch || {}).endTime) });
        if (stages.length) stageItems.push({ kpNo: d.kpNumber, jcNo: jc, partName: d.partName || "", customer: d.customer || "",
          quantity: d.quantity || "", processType: d.processType || "", stages });
      });
      const uniq = (list, key) => { const seen = new Set(); return list.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

      // 2) send in batches; the sheet answers what it added
      async function send(kind, items, size) {
        const tot = { added: 0, already: 0, summaryRows: 0, logRows: 0 };
        for (let i = 0; i < items.length; i += size) {
          const chunk = items.slice(i, i + size);
          setBtn(`Syncing ${kind} ${Math.min(i + size, items.length)}/${items.length}…`);
          let out = null, lastErr = null;
          for (let attempt = 1; attempt <= 3 && !out; attempt++) {
            try {
              const res = await fetch(SYNC_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ type: "BACKFILL", kind, token: SYNC_TOKEN, items: chunk }) });
              const text = await res.text();
              let o; try { o = JSON.parse(text); } catch (e) { throw new Error("the MES Stage Sync web app did not answer with data – check its deployment (Who has access: Anyone, New version)"); }
              if (o.ok === false) throw new Error(o.error || "sheet refused");
              out = o;
            } catch (e) { lastErr = e; if (attempt < 3) await new Promise(r => setTimeout(r, 4000)); }
          }
          if (!out) throw new Error(`${kind} ${i + 1}–${i + chunk.length}: ${lastErr ? lastErr.message : "no answer"}`);
          tot.added += out.added || 0; tot.already += out.alreadyThere || 0;
          tot.summaryRows += out.newSummaryRows || 0; tot.logRows += out.newLogRows || 0;
        }
        return tot;
      }
      const r1 = await send("PIR", uniq(pir, x => x.kpNo + "|" + x.pirNo + "|" + x.submittedAt), 100);
      const r2 = await send("FIR", uniq(fir, x => x.kpNo + "|" + x.firNo + "|" + x.submittedAt), 100);
      const r3 = await send("DISPATCH", uniq(dsp, x => x.kpNo + "|" + x.dispatchQty + "|" + x.submittedAt), 100);
      const r4 = await send("STAGES", stageItems, 25);
      const msg = `SYNC DONE – ${docs.length} jobs\n\n` +
        `PIR_Reports: ${r1.added} added, ${r1.already} already there\n` +
        `FIR_Reports: ${r2.added} added, ${r2.already} already there\n` +
        `Dispatch_Reports: ${r3.added} added, ${r3.already} already there\n` +
        `MES_Stage_Summary: ${r4.summaryRows} new rows (gaps filled in existing rows)\n` +
        `MES_Stage_Log: ${r4.logRows} rows added (marked "backfill")`;
      console.log("[Backlog] " + msg.replace(/\n+/g, " | "));
      alert(msg);
    } catch (e) {
      console.warn("[Backlog] Sync to sheet failed:", e);
      alert("Sync stopped:\n" + (e && e.message ? e.message : e) + "\n\nNothing is lost – fix the cause and click the button again (rows already copied are skipped).");
    } finally {
      syncing = false; btn.disabled = false; btn.textContent = label;
    }
  }

  // ===================== HOOKS =====================
  function installHooks() {
    // Backlog Report: Super Admin only
    if (typeof ROLE_PERMISSIONS !== "undefined" && Array.isArray(ROLE_PERMISSIONS.super_admin) &&
        !ROLE_PERMISSIONS.super_admin.includes("tab-backlog")) {
      ROLE_PERMISSIONS.super_admin.push("tab-backlog");
    }
    // Refresh the report (and its sidebar badge) with every app refresh
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        try { renderBacklog(); } catch (e) { console.warn("[Backlog] render error:", e); }
        return r;
      };
    }
  }

  // ===================== BOOT =====================
  try {
    injectBacklogTab();
    installHooks();
    console.log("[PSP] backlog-report v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] backlog-report failed to load:", err);
  }
})();
