/**
 * PSP MES – FIR (Final Inspection Report) form, built into the dashboard.
 *
 * "Approve QA & Close" (or dragging a Final Inspection card) opens this form instead of the
 * "quantity completed" prompt and the "Select Next Stage" screen:
 *   - its Qty is the quantity done in Final Inspection (less than the full quantity splits the job)
 *   - its "Send job to" decides the next stage (Dispatch by default; earlier stages = rework)
 *
 * Saved to:
 *   - Firebase: job.firReport (latest) + job.firReports (all)
 *   - Google Sheet "FIR_Reports" tab + photos in Drive "PSP FIR Photos", through the MES Stage Sync Apps Script
 *
 * Load after the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] fir-form: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user } = window.PSP;
  const MODULE_VERSION = 8;

  // ===================== CONFIG =====================
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzMXoqOSbxHnedhNpf_8XFAJ1UCLHHnwtDPqx_05gjU3rcb9U1mmlRfd0ma5ulwO3DV/exec";
  const TOKEN = "psp-mes-54f01c5b50486721db971093";
  const STAGE = "Final Inspection";
  const INSPECTORS = ["MF", "VG", "JN", "SJ", "Laxmi"];
  const SEND_TO = ["Dispatch", "Outsourcing", "Polishing", "Grinding", "Sealing", "Spraying", "Masking", "Machining"];
  const MAX_PHOTOS = 10;

  // ===================== UI =====================
  function injectStyles() {
    const st = document.createElement("style");
    st.textContent = `
      #psp-fir-modal { display:none; position:fixed; inset:0; z-index:12000; background:rgba(15,23,42,.88); backdrop-filter:blur(6px);
        align-items:center; justify-content:center; padding:10px; }
      #psp-fir-modal .fir-box { background:var(--bg-card,#fff); color:var(--text-main,#0f172a); width:100%; max-width:820px; max-height:96vh;
        height:auto; border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 40px rgba(0,0,0,.5); }
      #psp-fir-modal .fir-head { padding:12px 16px; border-bottom:1px solid var(--border-color,#cbd5e1); display:flex; justify-content:space-between; gap:10px; align-items:center; }
      #psp-fir-modal .fir-body { flex:1; overflow-y:auto; padding:14px 16px; }
      #psp-fir-modal .fir-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px 16px; }
      #psp-fir-modal .fir-field label { display:block; font-size:12px; font-weight:700; margin-bottom:4px; }
      #psp-fir-modal .fir-field label .req { color:#ef4444; }
      #psp-fir-modal .fir-field input, #psp-fir-modal .fir-field select { width:100%; height:42px; font-size:15px; padding:6px 10px; box-sizing:border-box; }
      #psp-fir-modal .fir-field input[readonly] { opacity:.75; background:rgba(148,163,184,.15); }
      #psp-fir-modal .fir-hint { font-size:11px; opacity:.75; margin-top:3px; }
      #psp-fir-modal .fir-wide { grid-column:1 / -1; }
      #psp-fir-modal .fir-photos { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
      #psp-fir-modal .fir-photos div { position:relative; }
      #psp-fir-modal .fir-photos img { width:84px; height:84px; object-fit:cover; border-radius:6px; border:1px solid var(--border-color,#cbd5e1); }
      #psp-fir-modal .fir-photos button { position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:50%; border:0;
        background:#ef4444; color:#fff; font-weight:800; cursor:pointer; line-height:22px; padding:0; }
      #psp-fir-modal .fir-foot { padding:10px 16px; border-top:1px solid var(--border-color,#cbd5e1); display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
      #psp-fir-modal .fir-msg { flex:1; font-size:12px; font-weight:600; min-width:180px; }
      @supports (height: 100dvh) { #psp-fir-modal .fir-box { max-height:calc(100dvh - 20px); } }
      #psp-fir-modal .fir-foot { flex-shrink:0; padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px)); }
      @media (max-width: 640px) { #psp-fir-modal .fir-grid { grid-template-columns:1fr; } #psp-fir-modal { padding:0; }
        #psp-fir-modal .fir-box { max-height:100dvh; height:100dvh; border-radius:0; } }`;
    document.head.appendChild(st);
  }

  function field(id, label, required, control, wide, hint) {
    return `<div class="fir-field${wide ? " fir-wide" : ""}"><label for="${id}">${label}${required ? ' <span class="req">*</span>' : ""}</label>${control}${hint ? `<div class="fir-hint" id="${id}-hint">${hint}</div>` : ""}</div>`;
  }
  const sel = (id, list, required, blank) => `<select id="${id}" class="form-input" ${required ? "required" : ""}>${blank === false ? "" : '<option value="">-- Select --</option>'}${opts(list)}</select>`;
  const inp = (id, type, required, extra) => `<input id="${id}" type="${type}" class="form-input" ${required ? "required" : ""} ${extra || ""}>`;

  function injectModal() {
    if ($("psp-fir-modal")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="psp-fir-modal" role="dialog" aria-modal="true" aria-labelledby="psp-fir-title">
        <form class="fir-box" id="psp-fir-form" novalidate>
          <div class="fir-head">
            <div><div id="psp-fir-title" style="font-weight:800; font-size:16px;">✅ FIR – Final Inspection Report</div>
              <div id="psp-fir-sub" style="font-size:12px; opacity:.8;"></div></div>
            <button type="button" id="psp-fir-cancel" class="btn btn-secondary btn-xs" style="height:34px; padding:0 12px;">✕ Cancel</button>
          </div>
          <div class="fir-body">
            <div class="fir-grid">
              ${field("fir-process", "1. Process", true, inp("fir-process", "text", true, 'readonly value="Final Inspection"'))}
              ${field("fir-kp", "2. KP No.", true, inp("fir-kp", "text", true, "readonly"))}
              ${field("fir-no", "3. FIR No.", true, inp("fir-no", "text", true, 'placeholder="Enter FIR number"'))}
              ${field("fir-jc", "4. JC No.", false, inp("fir-jc", "text", false))}
              ${field("fir-qty", "5. Qty", true, inp("fir-qty", "number", true, 'min="1" step="1" inputmode="numeric"'), false, "Job quantity")}
              ${field("fir-clen", "6. Coating Length (mm)", false, inp("fir-clen", "number", false, 'step="any" min="0" inputmode="decimal"'))}
              ${field("fir-dia", "7. Coating Dia (mm)", false, inp("fir-dia", "number", false, 'step="any" min="0" inputmode="decimal"'))}
              ${field("fir-inspector", "8. Inspector Name", true, sel("fir-inspector", INSPECTORS, true))}
              ${field("fir-report", "10. Report Sent to Customer", true, sel("fir-report", ["Yes", "No"], true))}
              ${field("fir-outsourcing", "11. Outsourcing Status", false, sel("fir-outsourcing", ["Yes", "No"], false))}
              ${field("fir-next", "Send job to", true, sel("fir-next", SEND_TO, true, false), true, "Dispatch when the job passed Final Inspection; an earlier stage sends it back for rework.")}
              <div class="fir-field fir-wide">
                <label for="fir-photos">9. Job Photos <span style="font-weight:400; opacity:.75;">(you can add several, up to ${MAX_PHOTOS})</span></label>
                <input id="fir-photos" type="file" accept="image/*" multiple class="form-input" style="height:auto; padding:8px;">
                <div id="fir-photo-list" class="fir-photos"></div>
              </div>
            </div>
          </div>
          <div class="fir-foot">
            <div id="psp-fir-msg" class="fir-msg"></div>
            <button type="button" id="psp-fir-skip" class="btn btn-secondary btn-xs" style="height:42px; padding:0 14px; display:none;">Skip FIR (Super Admin)</button>
            <button type="submit" id="psp-fir-submit" class="btn btn-success" style="height:42px; padding:0 20px; font-weight:800;">Submit FIR &amp; Send to Dispatch</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== STATE =====================
  let active = null;   // { job }
  let photos = [];
  let busy = false;
  const msg = (t, c) => { const m = $("psp-fir-msg"); m.textContent = t || ""; m.style.color = c || ""; };
  const operatorName = () => {
    try { if (typeof getLoggedUser === "function" && getLoggedUser()) return getLoggedUser().name; } catch (e) {}
    const u = user(); return (u && (u.name || u.email)) || "Inspector";
  };

  // FIR questions are needed only for Dispatch. For rework (earlier stage) or Outsourcing only Qty + "Send job to" stay.
  const FIR_ONLY = ["fir-no", "fir-jc", "fir-clen", "fir-dia", "fir-inspector", "fir-report", "fir-outsourcing", "fir-photos"];
  const FIR_REQUIRED = ["fir-no", "fir-inspector", "fir-report"];
  const isFirNeeded = () => ($("fir-next").value || "Dispatch") === "Dispatch";
  function applyMode() {
    const need = isFirNeeded();
    FIR_ONLY.forEach(id => {
      const el = $(id); if (!el) return;
      const wrap = el.closest(".fir-field"); if (wrap) wrap.style.display = need ? "" : "none";
      if (FIR_REQUIRED.includes(id)) { if (need) el.setAttribute("required", ""); else el.removeAttribute("required"); }
    });
    $("psp-fir-title").textContent = need ? "✅ FIR – Final Inspection Report" : "↩️ Send job from Final Inspection";
    $("psp-fir-skip").style.visibility = need ? "" : "hidden";
  }

  function updateLabels() {
    const job = active && active.job;
    const q = parseInt($("fir-qty").value, 10);
    const hint = $("fir-qty-hint");
    if (hint && job) hint.textContent = (q > 0 && q < job.quantity)
      ? `${q} of ${job.quantity} pcs move on; ${job.quantity - q} stay in Final Inspection.`
      : `Job quantity: ${job.quantity} pcs.`;
    const next = $("fir-next").value || "Dispatch";
    applyMode();
    $("psp-fir-submit").textContent = next === "Dispatch" ? "Submit FIR & Send to Dispatch"
      : next === "Outsourcing" ? "Send to Outsourcing" : `Send back to ${next} (rework)`;
  }

  function openFIR(job) {
    active = { job };
    photos = [];
    $("fir-photo-list").innerHTML = "";
    $("fir-photos").value = "";
    const jc = (typeof getJobJcNo === "function" ? getJobJcNo(job) : job.jcNo) || "";
    const pir = job.pirReport || {};
    $("psp-fir-sub").textContent = `${job.kpNumber}${jc ? " (" + jc + ")" : ""} · ${job.partName || ""} · ${job.customer || ""}`;
    $("fir-kp").value = job.kpNumber;
    $("fir-jc").value = jc || pir.jcNo || "";
    $("fir-no").value = "";
    $("fir-qty").value = job.quantity || "";
    $("fir-qty").max = job.quantity || "";
    $("fir-clen").value = pir.coatingLengthMm || "";
    $("fir-dia").value = pir.coatingDiaMm || "";
    ["fir-report", "fir-outsourcing"].forEach(id => { $(id).value = ""; });
    const u = user();
    const me = u && INSPECTORS.find(n => n.toLowerCase() === String(u.name || "").toLowerCase());
    $("fir-inspector").value = me || "";
    $("fir-next").value = "Dispatch";
    updateLabels();
    $("psp-fir-skip").style.display = (u && u.role === "super_admin") ? "" : "none";
    msg("");
    $("psp-fir-modal").style.display = "flex";
    setTimeout(() => $("fir-no").focus(), 50);
  }

  function closeFIR() { $("psp-fir-modal").style.display = "none"; active = null; photos = []; }
  function cancelFIR() { if (!busy) closeFIR(); }

  // ---------- photos ----------
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read " + file.name));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Not an image: " + file.name));
        img.onload = () => {
          const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve({ name: (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", dataUrl: c.toDataURL("image/jpeg", 0.75) });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function drawPhotos() {
    $("fir-photo-list").innerHTML = photos.map((p, i) =>
      `<div><img src="${p.dataUrl}" alt="Job photo ${i + 1}"><button type="button" data-fir-del="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("");
  }
  async function addPhotos(list) {
    const files = [...list].slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    if (list.length > files.length) msg(`Only ${MAX_PHOTOS} photos can be attached.`, "#f97316");
    for (const f of files) { try { photos.push(await shrink(f)); } catch (e) { msg(e.message, "#ef4444"); } }
    $("fir-photos").value = "";
    drawPhotos();
  }

  // ---------- the move (same as the app's original Final Inspection logic, with the FIR's qty) ----------
  function moveJob(job, doneQty, nextStage) {
    const op = operatorName();
    const payloadGenerator = ns => (doneQty < job.quantity)
      ? splitJobAndProgress(job, doneQty, ns, op, STAGE)
      : { type: "END_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: op, endTime: new Date().toISOString(), activeTimeMs: 0, nextStage: ns };
    const applyLocalMutation = ns => { if (!(doneQty < job.quantity)) transitionToStage(job, ns, op); };
    window.pendingTransition = { job, stage: STAGE, payloadGenerator, applyLocalMutation, _fromFir: true };
    applyStageTransitionWithUndo(nextStage);
  }

  // ---------- submit ----------
  function readForm() {
    const v = id => String($(id).value || "").trim();
    return {
      process: "Final Inspection", kpNo: v("fir-kp"), firNo: v("fir-no"), jcNo: v("fir-jc"), qty: v("fir-qty"),
      coatingLengthMm: v("fir-clen"), coatingDiaMm: v("fir-dia"), inspectorName: v("fir-inspector"),
      reportSentToCustomer: v("fir-report"), outsourcingStatus: v("fir-outsourcing"), sendTo: v("fir-next")
    };
  }

  async function sendToSheet(report) {
    if (!SCRIPT_URL) return { ok: false, skipped: true };
    const body = JSON.stringify({ type: "FIR", token: TOKEN, report, photos: photos.map(p => ({ name: p.name, type: p.type, data: p.dataUrl.split(",")[1] })) });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, signal: ctrl.signal });
      const out = await res.json();
      if (!out || !out.ok) throw new Error((out && out.error) || "sheet did not confirm");
      return out;
    } finally { clearTimeout(t); }
  }

  async function saveToFirebase(job, report) {
    if (typeof isMockMode === "function" && isMockMode()) return;
    const db = firebase.firestore();
    const ref = job.id ? db.collection("jobs").doc(job.id) : db.collection("jobs").doc("job_" + job.kpNumber);
    await ref.update({
      firReport: report,
      firReports: firebase.firestore.FieldValue.arrayUnion(report),
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function submitFIR(e) {
    if (e) e.preventDefault();
    if (busy || !active) return;
    const job = active.job;
    for (const el of $("psp-fir-form").querySelectorAll("[required]")) {
      if (!String(el.value || "").trim()) {
        msg("Please fill in: " + el.closest(".fir-field").querySelector("label").textContent.replace("*", "").trim(), "#ef4444");
        el.focus(); return;
      }
    }
    const data = readForm();
    const doneQty = parseInt(data.qty, 10);
    if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
      msg(`Qty must be between 1 and ${job.quantity}.`, "#ef4444"); $("fir-qty").focus(); return;
    }
    if (!isFirNeeded()) {
      // Rework or Outsourcing: no FIR. A move to an earlier stage asks for the rework reason (app pop-up); Outsourcing moves directly.
      closeFIR();
      moveJob(job, doneQty, data.sendTo);
      return;
    }
    const u = user() || {};
    const report = Object.assign({}, data, {
      partName: job.partName || "", customer: job.customer || "", jobQty: job.quantity,
      submittedAt: new Date().toISOString(), submittedBy: u.name || u.email || "Unknown", photoUrls: [], photoFolderUrl: ""
    });

    busy = true;
    const btn = $("psp-fir-submit"); btn.disabled = true;
    msg(photos.length ? `Saving FIR and uploading ${photos.length} photo(s)…` : "Saving FIR…", "#2563eb");
    try {
      try {
        const out = await sendToSheet(report);
        if (!out.skipped) { report.photoUrls = out.photoUrls || []; report.photoFolderUrl = out.folderUrl || ""; }
      } catch (err) {
        busy = false; btn.disabled = false;
        msg("Could not reach the FIR sheet: " + (err && err.message ? err.message : err) + ". Check the internet and press Submit again.", "#ef4444");
        return;
      }
      await saveToFirebase(job, report);
      try {
        if (typeof createAuditLog === "function") createAuditLog(u.email || report.submittedBy, job.kpNumber,
          `FIR ${data.firNo} submitted (${doneQty}/${job.quantity} pcs, report to customer: ${data.reportSentToCustomer}) → ${data.sendTo}` +
          (report.photoUrls.length ? `, ${report.photoUrls.length} photo(s)` : ""));
      } catch (err2) {}
      job.firReport = report;
      busy = false; btn.disabled = false;
      closeFIR();
      moveJob(job, doneQty, data.sendTo);
    } catch (err) {
      busy = false; btn.disabled = false;
      msg("Could not save the FIR: " + (err && err.message ? err.message : err), "#ef4444");
    }
  }

  // ---------- Final Insp. Planned (Q2P col AL) on the Final Inspection stage cards ----------
  const toDay = v => { if (!v) return null; const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(String(v).length === 10 ? v + "T00:00:00" : v); return isNaN(d.getTime()) ? null : d; };
  function plannedFor(job) {
    if (job.plannedCompletionDate) return toDay(job.plannedCompletionDate);
    if (/-R/i.test(job.kpNumber || "")) {   // split parts use their parent's date
      const parentKp = String(job.kpNumber).toUpperCase().split("-R")[0];
      const parent = allJobs().find(j => String(j.kpNumber || "").toUpperCase() === parentKp);
      if (parent) return toDay(parent.plannedCompletionDate);
    }
    return null;
  }
  function decorateFinalCards() {
    const box = $("final-inspection-queue-cards");
    if (!box) return;
    const pool = allJobs().filter(j => j.currentDepartment === STAGE);
    const used = new Set();
    const label = j => { const kp = typeof getCleanKpNumber === "function" ? getCleanKpNumber(j.kpNumber) : j.kpNumber;
                         const jc = typeof getJobJcNo === "function" ? getJobJcNo(j) : (j.jcNo || ""); return (kp + (jc ? ` (${jc})` : "")).trim(); };
    box.querySelectorAll(":scope > .stage-kanban-card").forEach(card => {
      const old = card.querySelector(".fir-planned-row"); if (old) old.remove();
      const head = card.querySelector(".job-card-header .font-mono");
      const body = card.querySelector(".job-card-body");
      if (!head || !body) return;
      const text = head.textContent.replace(/\s+/g, " ").trim();
      const job = pool.find(j => !used.has(j) && label(j) === text);
      if (!job) return;
      used.add(job);
      const d = window.PSP.plannedFor ? window.PSP.plannedFor(job).fin : plannedFor(job);
      const late = d && d < new Date();
      const row = document.createElement("div");
      row.className = "job-card-row fir-planned-row";
      row.innerHTML = `<span class="job-card-label">Final Insp. Planned:</span>
        <span class="job-card-value font-mono" style="white-space:nowrap; ${late ? "color:#ef4444; font-weight:800;" : "font-weight:700;"}" title="${late ? "Final inspection planned date has passed" : ""}">${window.PSP.fmtDateTime ? window.PSP.fmtDateTime(d) : (d ? d.toLocaleDateString("en-IN") : "—")}${late ? " (late)" : ""}</span>`;
      body.appendChild(row);
    });
  }

  // ===================== HOOKS =====================
  let firBypass = false;
  function installApplyHook() {
    if (typeof window.applyStageTransitionWithUndo !== "function") return;
    const origApply = window.applyStageTransitionWithUndo;
    window.applyStageTransitionWithUndo = function (targetStage) {
      const tr = window.pendingTransition;
      if (!firBypass && tr && tr.stage === STAGE && tr.job && targetStage === "Dispatch" && !tr._fromFir) {
        window.pendingTransition = null;
        openFIR(tr.job);
        const next = $("fir-next");
        if (next) {
          if (![...next.options].some(o => o.value === targetStage)) {
            const o = document.createElement("option"); o.value = targetStage; o.textContent = targetStage; next.appendChild(o);
          }
          next.value = targetStage;
          updateLabels();
        }
        return;
      }
      return origApply.apply(this, arguments);
    };
  }

  function installHooks() {
    installApplyHook();
    const finalBox = $("final-inspection-queue-cards");
    if (finalBox) {
      let queued = false;
      new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; try { decorateFinalCards(); } catch (e) {} }, 0); })
        .observe(finalBox, { childList: true });
    }
    // "Approve QA & Close" buttons and card drags call this by name
    window.triggerFinalInspectionFloatingTransition = function (kpNumber) {
      const job = allJobs().find(j => j.kpNumber === kpNumber);
      if (!job) return;
      openFIR(job);
    };
  }

  function bindEvents() {
    $("psp-fir-form").addEventListener("submit", submitFIR);
    $("psp-fir-cancel").addEventListener("click", cancelFIR);
    $("fir-qty").addEventListener("input", updateLabels);
    $("fir-next").addEventListener("change", updateLabels);
    $("fir-photos").addEventListener("change", e => addPhotos(e.target.files));
    $("fir-photo-list").addEventListener("click", e => {
      const b = e.target.closest("[data-fir-del]");
      if (!b) return;
      photos.splice(Number(b.getAttribute("data-fir-del")), 1);
      drawPhotos();
    });
    $("psp-fir-skip").addEventListener("click", () => {
      if (!active || busy) return;
      const job = active.job;
      const q = parseInt($("fir-qty").value, 10);
      const doneQty = (q > 0 && q <= job.quantity) ? q : job.quantity;
      const next = $("fir-next").value || "Dispatch";
      if (!confirm(`Skip the FIR and send ${job.kpNumber} (${doneQty} pcs) to ${next}? This is recorded in the audit log.`)) return;
      try { if (typeof createAuditLog === "function") createAuditLog((user() || {}).email || "Super Admin", job.kpNumber, `FIR SKIPPED by Super Admin → ${next}`); } catch (e) {}
      closeFIR();
      moveJob(job, doneQty, next);
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("psp-fir-modal").style.display === "flex") cancelFIR();
    });
  }

  // ===================== BOOT =====================
  try {
    injectStyles();
    injectModal();
    installHooks();
    bindEvents();
    console.log("[PSP] fir-form v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] fir-form failed to load:", err);
  }
})();
