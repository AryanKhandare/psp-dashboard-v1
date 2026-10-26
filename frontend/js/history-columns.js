/**
 * PSP MES – Operator name and completion date & time in every department's History tab.
 *
 *   Masking    : nothing to add (masking.js shows Operator and "Completed On" itself)
 *   Spraying   : + Operator, + Completed On
 *   Grinding   : + Operator, + Completed On
 *   Machining  : + Completed On (next to Operator)
 *   Sealing    : + Completed On (next to Operator)
 *   Polishing  : + Completed On (next to Operator)
 *
 * Works on the tables after each department draws them, so no department file changes.
 * Load LAST of the add-ons (after machining, sealing, polishing, operator-choice), before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] history-columns: psp-common.js must load first."); return; }
  const { $, esc, allJobs } = window.PSP;
  const MODULE_VERSION = 3;

  // tbody id → where to add columns. "after" = index of the existing column the new ones follow.
  const TABLES = [
    { tbody: "spraying-history-table-body",   key: "spraying",  add: ["operator", "completed"], after: 3 },
    { tbody: "grinding-history-table-body",   key: "grinding",  add: ["operator", "completed"], after: 3 },
    { tbody: "machining-history-table-body",  key: "machining", add: ["completed"], after: 6 },
    { tbody: "sealing-history-table-body",    key: "sealing",   add: ["completed"], after: 5 },
    { tbody: "blasting-history-table-body",   key: "blasting",  add: ["completed"], after: 5 },
    { tbody: "polishing-mod-history-body",    key: "polishing", add: ["completed"], after: 5 }
  ];
  const HEAD = { operator: "Operator", completed: "Completed On" };

  const shortName = n => { const t = String(n || "").trim(); return t.includes("@") ? t.split("@")[0] : t; };
  function fmtDateTime(v) {
    if (!v) return "—";
    const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " " +
           d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  const cleanKp = kp => (typeof getCleanKpNumber === "function" ? getCleanKpNumber(kp) : kp);

  function addHeaders(cfg, table) {
    if (!cfg.add.length) return;
    const tr = table.querySelector("thead tr");
    if (!tr || tr.dataset.pspHist) return;
    tr.dataset.pspHist = "1";
    const ths = tr.querySelectorAll("th");
    let ref = ths[cfg.after];
    cfg.add.forEach(k => {
      const th = document.createElement("th");
      th.textContent = HEAD[k];
      if (ref) { ref.insertAdjacentElement("afterend", th); ref = th; } else tr.appendChild(th);
    });
  }

  function decorate(cfg) {
    const tbody = $(cfg.tbody);
    if (!tbody) return;
    const table = tbody.closest("table");
    if (table) addHeaders(cfg, table);

    const completed = allJobs().filter(j => j && j[cfg.key] && j[cfg.key].status === "Completed");
    const used = new Set();
    tbody.querySelectorAll(":scope > tr").forEach(tr => {
      if (tr.dataset.pspHist) return;
      tr.dataset.pspHist = "1";
      const cells = tr.querySelectorAll(":scope > td");
      // "No records" row: widen it for the extra columns
      if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
        cells[0].setAttribute("colspan", String(Number(cells[0].getAttribute("colspan") || 1) + cfg.add.length));
        return;
      }
      const m = cells[0] && cells[0].textContent.trim().match(/^(KP-[A-Za-z0-9-]+?)(?=\s|\(|$)/i);
      if (!m) return;
      const token = m[1].toUpperCase();
      const job = completed.find(j => !used.has(j) && String(j.kpNumber).toUpperCase() === token) ||
                  completed.find(j => !used.has(j) && String(cleanKp(j.kpNumber)).toUpperCase() === token);
      if (job) used.add(job);
      const sd = job ? job[cfg.key] : {};

      // Masking: show date + time in Cycle Start / Cycle End
      if (cfg.datesAt && job) {
        if (cells[cfg.datesAt[0]]) cells[cfg.datesAt[0]].textContent = fmtDateTime(sd.startTime);
        if (cells[cfg.datesAt[1]]) cells[cfg.datesAt[1]].textContent = fmtDateTime(sd.endTime);
      }
      // New columns
      let ref = cells[cfg.after];
      cfg.add.forEach(k => {
        const td = document.createElement("td");
        if (k === "operator") { td.className = "font-bold"; td.textContent = shortName(sd.operatorName || (job && job.operatorName)) || "—"; }
        if (k === "completed") { td.className = "font-mono text-xs"; td.style.whiteSpace = "nowrap"; td.textContent = fmtDateTime(sd.endTime); }
        if (ref) { ref.insertAdjacentElement("afterend", td); ref = td; } else tr.appendChild(td);
      });
    });
  }

  function decorateAll() { TABLES.forEach(cfg => { try { decorate(cfg); } catch (e) { console.warn("[History] " + cfg.tbody, e); } }); }

  function installHooks() {
    // Each department redraws its history table on its own (filters, sub-tab switches) → watch the tables
    TABLES.forEach(cfg => {
      const tbody = $(cfg.tbody);
      if (!tbody) return;
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => { queued = false; try { decorate(cfg); } catch (e) {} }, 0);
      }).observe(tbody, { childList: true });
    });
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        decorateAll();
        return r;
      };
    }
  }

  // ===================== BOOT =====================
  try {
    installHooks();
    decorateAll();
    console.log("[PSP] history-columns v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] history-columns failed to load:", err);
  }
})();
