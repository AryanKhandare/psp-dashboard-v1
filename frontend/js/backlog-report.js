/**
 * PSP MES – Department Backlog Report (Super Admin only).
 *
 * Sidebar "BKL · Backlog Report": department cards, open-job table with days in stage and days left,
 * department dropdown, filters, and Excel (.xlsx) export via SheetJS (CSV fallback).
 */
(function () {
  if (!window.PSP) { console.error("[PSP] backlog-report: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 1;

  // ===================== BACKLOG REPORT (all departments) =====================
  const BACKLOG_STAGES = ["Inspection", "Machining", "Masking", "Spraying", "Grinding", "Polishing", "Final Inspection", "Dispatch"];
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
          <p class="section-desc">Every open job by department: how long it has waited in its current stage and how close it is to its due date. Click a department card to filter.</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <label for="backlog-filter-dept" style="font-weight:700; font-size:13px;">Department:</label>
          <select id="backlog-filter-dept" class="form-input select-sm" style="height:36px; min-width:190px; font-weight:600;">
            <option value="">All Departments</option>${opts(BACKLOG_STAGES)}</select>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-backlog-print" style="height:36px;">🖨️ Print</button>
          <button type="button" class="btn btn-success btn-sm" id="btn-backlog-export" style="height:36px; font-weight:700;">⬇️ Export Excel – All Departments</button>
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
                <th>Operator / Machine</th><th>In Stage Since</th><th>Days in Stage</th><th>Due Date</th><th>Days Left</th>
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
  }

  function parseDateSafe(v) {
    if (!v) return null;
    if (v && typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
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
      const due = parseDateSafe(j.plannedCompletionDate);
      const who = [sd.operatorName || j.operatorName || "", sd.machineName || sd.grindingMachine || sd.booth || ""].filter(Boolean).join(" · ");
      return {
        dept, kp: j.kpNumber, label: kpLabel(j), part: j.partName || "", customer: j.customer || "", qty: j.quantity || "",
        status, who, since, daysIn: since ? Math.max(0, dayDiff(now, since)) : null,
        due, daysLeft: due ? dayDiff(due, new Date(now.toDateString())) : null,
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
      (backlogFilter.dept ? ` · ${backlogFilter.dept}` : "") + " · sorted by department, then longest waiting first";

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
        <td>${fmtDate(r.due)}</td>
        <td class="font-mono" style="${late ? "color:#ef4444; font-weight:800;" : soon ? "color:#f97316; font-weight:700;" : ""}">${r.daysLeft === null ? "—" : late ? Math.abs(r.daysLeft) + " d LATE" : r.daysLeft + " d"}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="11" class="text-center text-muted">No open jobs match these filters.</td></tr>`;
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
                   "In Stage Since", "Days in Stage", "Due Date", "Days Left", "Overdue", "Priority"];
  const xlDate = d => d ? `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}` : "";
  const xlRow = r => [r.dept, r.kp, r.jc, r.part, r.customer, Number(r.qty) || r.qty, r.status, r.who,
                      xlDate(r.since), r.daysIn ?? "", xlDate(r.due), r.daysLeft ?? "",
                      (r.daysLeft !== null && r.daysLeft < 0) ? "YES" : "", r.priority];

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
      const widths = [16, 14, 10, 26, 30, 6, 12, 24, 14, 12, 12, 10, 9, 9];
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
                  "In Stage Since", "Days in Stage", "Due Date", "Days Left", "Priority"];
    const lines = [head.map(q).join(",")].concat(list.map(r => [
      r.dept, r.kp, r.jc, r.part, r.customer, r.qty, r.status, r.who,
      r.since ? r.since.toISOString().slice(0, 10) : "", r.daysIn ?? "",
      r.due ? r.due.toISOString().slice(0, 10) : "", r.daysLeft ?? "", r.priority
    ].map(q).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `PSP-backlog-${backlogFilter.dept ? backlogFilter.dept.replace(/\s+/g, "-") + "-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
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
