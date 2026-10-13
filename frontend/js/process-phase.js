/**
 * PSP MES – Pre / Post process phase for Machining, Grinding and Polishing.
 *
 * - A coloured badge at the top of every job card: PRE / POST MACHINING, PRE / POST GRINDING,
 *   PRE / FINAL POLISHING (stage queues and the Inspection page board).
 * - The badge uses the process the operator chose; if none was chosen yet it is worked out
 *   automatically: job already sprayed → Post / Final, not yet sprayed → Pre.
 * - Polishing cards get a "Polishing Process" selector (Pre Polishing / Final Polishing), saved to Firebase.
 * - The Start Machining / Start Grinding pop-ups pre-select the matching process.
 *
 * Load after psp-common.js and the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] process-phase: psp-common.js must load first."); return; }
  const { $, esc, allJobs, user, isReadOnly } = window.PSP;
  const MODULE_VERSION = 1;

  // Stage → field on the job, and the two process names (first = before spraying, second = after)
  const PHASES = {
    Machining: { key: "machining", pre: "Pre Machining",  post: "Post Machining" },
    Grinding:  { key: "grinding",  pre: "Pre Grinding",   post: "Post Grinding" },
    Polishing: { key: "polishing", pre: "Pre Polishing",  post: "Final Polishing" }
  };

  const hasBeenSprayed = job => !!(job && job.spraying && job.spraying.status === "Completed");

  // Returns { label, isPost, auto } for a job in one of the three stages, or null
  function phaseOf(job, stage) {
    const cfg = PHASES[stage];
    if (!cfg || !job) return null;
    const chosen = job[cfg.key] && job[cfg.key].processType;
    if (chosen === cfg.pre || chosen === cfg.post) return { label: chosen, isPost: chosen === cfg.post, auto: false };
    const isPost = hasBeenSprayed(job);
    return { label: isPost ? cfg.post : cfg.pre, isPost, auto: true };
  }

  // ---------- styles ----------
  function injectStyles() {
    const css = `
      .psp-phase-badge { display:block; margin:-2px 0 8px; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:800;
        letter-spacing:.6px; text-transform:uppercase; color:#fff; text-align:center; line-height:1.3; }
      .psp-phase-badge.pre  { background:#0284c7; }
      .psp-phase-badge.post { background:#7c3aed; }
      .psp-phase-badge .psp-phase-auto { font-weight:600; opacity:.8; text-transform:none; letter-spacing:0; margin-left:6px; font-size:10px; }
      .psp-polish-process { display:flex; align-items:center; gap:8px; margin:6px 0 10px; font-size:12px; }
      .psp-polish-process select { flex:1; height:30px; font-size:12px; padding:2px 6px; }
    `;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  function badgeHTML(ph) {
    const tip = ph.auto ? "Worked out automatically: " + (ph.isPost ? "job has already been sprayed" : "job has not been sprayed yet")
                        : "Process chosen by the operator";
    return `<div class="psp-phase-badge ${ph.isPost ? "post" : "pre"}" title="${esc(tip)}">${esc(ph.label)}` +
           (ph.auto ? `<span class="psp-phase-auto">(auto)</span>` : "") + `</div>`;
  }

  function putBadge(card, ph) {
    if (!card || !ph) return;
    const old = card.querySelector(":scope > .psp-phase-badge");
    if (old) old.remove();
    const holder = document.createElement("div");
    holder.innerHTML = badgeHTML(ph);
    const badge = holder.firstElementChild;
    const strip = card.querySelector(":scope > .stage-card-priority-strip");
    if (strip) strip.insertAdjacentElement("afterend", badge);
    else card.insertBefore(badge, card.firstChild);
  }

  // Match queue cards (whose header shows "KP-xxx (JC)") to jobs, in render order
  function decorateQueue(containerId, stage) {
    const box = $(containerId);
    if (!box) return;
    const cards = [...box.querySelectorAll(":scope > .stage-kanban-card")];
    if (!cards.length) return;
    const pool = allJobs().filter(j => j.currentDepartment === stage);
    const used = new Set();
    cards.forEach(card => {
      const head = card.querySelector(".job-card-header .font-mono, .job-card-header span");
      const m = head && head.textContent.trim().match(/^(KP-[A-Za-z0-9-]+?)(?=\s|\(|$)/);
      if (!m) return;
      const label = m[1].toUpperCase();
      const job = pool.find(j => !used.has(j) && String(typeof getCleanKpNumber === "function" ? getCleanKpNumber(j.kpNumber) : j.kpNumber).toUpperCase() === label);
      if (!job) return;
      used.add(job);
      putBadge(card, phaseOf(job, stage));
      if (stage === "Polishing") addPolishingSelector(card, job);
    });
  }

  // Inspection page board cards carry the full KP in data-board-kp
  function decorateBoard() {
    const cols = { "cards-machining-stage": "Machining", "cards-review": "Grinding", "cards-ready": "Polishing" };
    Object.keys(cols).forEach(id => {
      const box = $(id);
      if (!box) return;
      box.querySelectorAll("[data-board-kp]").forEach(card => {
        const job = allJobs().find(j => j.kpNumber === card.getAttribute("data-board-kp"));
        if (job) putBadge(card, phaseOf(job, cols[id]));
      });
    });
  }

  // ---------- Polishing process selector ----------
  function addPolishingSelector(card, job) {
    if (isReadOnly()) return;
    if (card.querySelector(".psp-polish-process")) return;
    const ph = phaseOf(job, "Polishing");
    const row = document.createElement("div");
    row.className = "psp-polish-process";
    row.innerHTML = `<label style="font-weight:700; white-space:nowrap;">Polishing Process:</label>
      <select class="form-input" aria-label="Polishing process for ${esc(job.kpNumber)}">
        <option value="Pre Polishing" ${ph.label === "Pre Polishing" ? "selected" : ""}>Pre Polishing</option>
        <option value="Final Polishing" ${ph.label === "Final Polishing" ? "selected" : ""}>Final Polishing</option>
      </select>`;
    const sel = row.querySelector("select");
    sel.addEventListener("mousedown", e => e.stopPropagation());
    sel.addEventListener("click", e => e.stopPropagation());
    sel.addEventListener("change", () => savePolishingProcess(job, sel.value));
    const actions = card.querySelector(".stage-card-actions");
    if (actions) actions.insertAdjacentElement("beforebegin", row); else card.appendChild(row);
  }

  async function savePolishingProcess(job, value) {
    job.polishing = job.polishing || { status: "Pending" };
    job.polishing.processType = value;
    try { if (typeof renderAll === "function") renderAll(); } catch (e) {}
    try {
      if (typeof createAuditLog === "function") createAuditLog((user() && user().email) || "Operator", job.kpNumber, `Polishing process set to ${value}`);
    } catch (e) {}
    if (typeof isMockMode === "function" && isMockMode()) return;
    try {
      const db = firebase.firestore();
      const ref = job.id ? db.collection("jobs").doc(job.id) : null;
      const update = { "polishing.processType": value, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() };
      if (ref) await ref.update(update);
      else {
        const snap = await db.collection("jobs").doc("job_" + job.kpNumber).get();
        if (snap.exists) await snap.ref.update(update);
      }
    } catch (e) {
      console.warn("[Process Phase] Could not save polishing process:", e && e.message ? e.message : e);
      alert(`Could not save the polishing process for ${job.kpNumber}: ${e && e.message ? e.message : e}`);
    }
  }

  // ---------- Start pop-ups: pre-select the matching process ----------
  function watchStartModal(modalId, kpDisplayId, selectId, stage) {
    const modal = $(modalId);
    if (!modal) return;
    new MutationObserver(() => {
      if (!modal.classList.contains("active")) return;
      const kpEl = $(kpDisplayId), sel = $(selectId);
      if (!kpEl || !sel) return;
      const kp = kpEl.textContent.trim();
      const job = allJobs().find(j => j.kpNumber === kp) ||
                  allJobs().find(j => j.currentDepartment === stage && String(getCleanKpNumber(j.kpNumber)) === kp);
      const ph = job && phaseOf(job, stage);
      if (ph && [...sel.options].some(o => o.value === ph.label)) sel.value = ph.label;
    }).observe(modal, { attributes: true, attributeFilter: ["class", "style"] });
  }

  function decorateAll() {
    decorateQueue("machining-queue-cards", "Machining");
    decorateQueue("grinding-queue-cards", "Grinding");
    decorateQueue("polishing-queue-cards", "Polishing");
    decorateBoard();
  }

  function installHooks() {
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        try { decorateAll(); } catch (e) { console.warn("[Process Phase] render error:", e); }
        return r;
      };
    }
    // Machining/Grinding sub-tab switches re-render their queues outside executeRenderAll
    ["machining-queue-cards", "grinding-queue-cards", "polishing-queue-cards"].forEach(id => {
      const box = $(id);
      if (!box) return;
      let pending = false;
      new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(() => { pending = false; try { decorateAll(); } catch (e) {} }, 0);
      }).observe(box, { childList: true });
    });
  }

  // ===================== BOOT =====================
  try {
    injectStyles();
    installHooks();
    watchStartModal("modal-start-grinding", "modal-grinding-kp-display", "grinding-process-select", "Grinding");
    watchStartModal("modal-start-machining", "modal-machining-kp-display", "machining-process-select", "Machining");
    window.PSPProcessPhase = { phaseOf };
    console.log("[PSP] process-phase v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] process-phase failed to load:", err);
  }
})();
