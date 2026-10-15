/**
 * PSP MES – shared helpers used by the add-on files
 * (machining.js, stage-board.js, job-guards.js, backlog-report.js, ui-tweaks.js).
 *
 * Load in index.html AFTER dashboard.js / mes-stage-sync.js and BEFORE the add-on files.
 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const opts = (list, selected) => list.map(v => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
  const allJobs = () => (typeof jobs !== "undefined" && Array.isArray(jobs)) ? jobs : [];
  const user = () => (typeof currentUser !== "undefined" && currentUser) ? currentUser : null;
  const isReadOnly = () => { const u = user(); return !!(u && u.role === "hr_admin"); };
  const fmt = ms => (typeof formatDuration === "function") ? formatDuration(ms || 0) : "00:00:00";
  const kpLabel = job => {
    const kp = (typeof getCleanKpNumber === "function") ? getCleanKpNumber(job.kpNumber) : job.kpNumber;
    const jc = (typeof getJobJcNo === "function") ? getJobJcNo(job) : (job.jcNo || "");
    return jc ? `${kp} (${jc})` : kp;
  };
  const qtyLabel = job => (typeof renderQuantityWithHistory === "function") ? renderQuantityWithHistory(job) : esc(job.quantity);

  // Field name of each stage's data on the job ("Final Inspection" is stored as finalInspection)
  const stageKeyOf = stage => {
    const k = String(stage || "").toLowerCase().replace(/[^a-z]/g, "");
    return k === "finalinspection" ? "finalInspection" : k;
  };

  // ---- Planned date + time from the Q2P sheet (col X = Pre-Inspection Planned, col AL = Final Inspection Planned).
  //      The app keeps only the date, so these are read straight from the sheet (refreshed every 5 minutes).
  const planned = new Map();   // KP -> { pre: Date|null, fin: Date|null }
  let plannedAt = 0, plannedBusy = false;
  function cellDateTime(c) {
    if (!c) return null;
    const v = c.v;
    if (v instanceof Date || Object.prototype.toString.call(v) === "[object Date]") return isNaN(v.getTime()) ? null : new Date(v.getTime());
    const t = String(c.f != null ? c.f : (v != null ? v : "")).trim();
    if (!t) return null;
    let m = t.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+)(?:,(\d+))?)?/);
    if (m) return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/);   // day first
    if (m) {
      let h = +(m[4] || 0);
      if (m[7]) { const pm = /p/i.test(m[7]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      return new Date(+m[3], +m[2] - 1, +m[1], h, +(m[5] || 0), +(m[6] || 0));
    }
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  async function loadPlanned(force) {
    if (plannedBusy || (!force && plannedAt && Date.now() - plannedAt < 5 * 60 * 1000)) return;
    if (typeof fetchGVizData !== "function") return;
    plannedBusy = true;
    try {
      const table = await fetchGVizData("SELECT T, X, AL WHERE T IS NOT NULL");
      planned.clear();
      ((table && table.rows) || []).forEach(r => {
        const c = r.c || [];
        const kp = String((c[0] && c[0].v) || "").trim().toUpperCase();
        if (/^KP-/.test(kp)) planned.set(kp, { pre: cellDateTime(c[1]), fin: cellDateTime(c[2]) });
      });
      plannedAt = Date.now();
      if (typeof renderAll === "function") renderAll();
    } catch (e) {
      console.warn("[PSP] Could not read planned dates from the sheet:", e && e.message ? e.message : e);
      plannedAt = Date.now();   // retry after 5 minutes, not on every render
    } finally { plannedBusy = false; }
  }
  // Planned { pre, fin } for a job: sheet value with time, else the stored date; split parts use their parent KP
  function plannedFor(job) {
    loadPlanned(false);
    const kp = String((job && job.kpNumber) || "").toUpperCase();
    const base = kp.includes("-R") ? kp.split("-R")[0] : kp;
    const s = planned.get(kp) || planned.get(base) || {};
    const parent = base !== kp ? allJobs().find(j => String(j.kpNumber || "").toUpperCase() === base) : null;
    const stored = v => { if (!v) return null; const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(String(v).length === 10 ? v + "T00:00:00" : v); return isNaN(d.getTime()) ? null : d; };
    return {
      pre: s.pre || stored(job.inspectionDate) || (parent && stored(parent.inspectionDate)) || null,
      fin: s.fin || stored(job.plannedCompletionDate) || (parent && stored(parent.plannedCompletionDate)) || null
    };
  }
  // date + time; a value without a time (exactly 00:00, e.g. a stored date-only fallback) shows just the date
  const fmtDateTime = d => !d ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    ((d.getHours() || d.getMinutes()) ? ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");

  window.PSP = { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf, plannedFor, fmtDateTime, loadPlanned };
  console.log("[PSP] psp-common v2 loaded.");
})();
