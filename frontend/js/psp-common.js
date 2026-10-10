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

  window.PSP = { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf };
  console.log("[PSP] psp-common v1 loaded.");
})();
