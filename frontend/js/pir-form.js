/**
 * PSP MES – PIR (Pre Inspection Report) form, built into the dashboard.
 *
 * Replaces the Google Form step. When a job leaves Inspection ("→ Move to Next Stage", or a drag on the
 * Inspection page board), this form opens. Its "Next Stage" question decides where the job goes, so the
 * separate "Select Next Stage" screen is skipped for Inspection jobs.
 *
 * Saved to:
 *   - Firebase: job.pirReport (latest) + job.pirReports (all), job.processType = chosen process
 *   - Google Sheet "PIR_Reports" tab + photos in Google Drive, through the PIR Apps Script (PIR_SCRIPT_URL)
 * "Blank PIR/Quarantine" saves the PIR and keeps the job in Inspection, marked QUARANTINE.
 *
 * Load after the other add-ons, before app.js. Replaces inspection-form.js (remove that script line).
 */
(function () {
  if (!window.PSP) { console.error("[PSP] pir-form: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user } = window.PSP;
  const MODULE_VERSION = 6;

  // ===================== CONFIG =====================
  // The MES Stage Sync Apps Script (it also handles PIRs: PIR_Reports tab + photos in Drive).
  // If this is empty, PIRs are still saved in Firebase, but not in the sheet, and photos are not uploaded.
  const PIR_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzMXoqOSbxHnedhNpf_8XFAJ1UCLHHnwtDPqx_05gjU3rcb9U1mmlRfd0ma5ulwO3DV/exec";
  const PIR_TOKEN = "psp-mes-54f01c5b50486721db971093";

  const INSPECTORS = ["MF", "VG", "JN", "SJ", "Laxmi"];
  const PART_TYPES = ["Cylindrical", "Rectangle"];
  const STATUSES = ["OK", "Not OK - Reported to Team Leader"];
  const PROCESSES = ["HVOF", "HAVF", "Flame Spray", "Arc Spray", "Plasma", "Rokide Gun Spray", "Arco Process", "Blank PIR"];
  const NEXT_STAGES = ["Masking", "Blasting", "Machining", "Spraying", "Grinding", "Polishing", "Outsourcing", "Blank PIR/Quarantine"];
  const QUARANTINE = "Blank PIR/Quarantine";
  const FROM_STAGE = "Inspection";
  const MAX_PHOTOS = 10;

  // ===================== UI =====================
  function injectStyles() {
    const st = document.createElement("style");
    st.textContent = `
      #psp-pir-modal { display:none; position:fixed; inset:0; z-index:12000; background:rgba(15,23,42,.88); backdrop-filter:blur(6px);
        align-items:center; justify-content:center; padding:10px; }
      #psp-pir-modal .pir-box { background:var(--bg-card,#fff); color:var(--text-main,#0f172a); width:100%; max-width:860px; max-height:96vh;
        height:96vh; border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 40px rgba(0,0,0,.5); }
      #psp-pir-modal .pir-head { padding:12px 16px; border-bottom:1px solid var(--border-color,#cbd5e1); display:flex; justify-content:space-between; gap:10px; align-items:center; }
      #psp-pir-modal .pir-body { flex:1; overflow-y:auto; padding:14px 16px; }
      #psp-pir-modal .pir-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px 16px; }
      #psp-pir-modal .pir-field label { display:block; font-size:12px; font-weight:700; margin-bottom:4px; }
      #psp-pir-modal .pir-field label .req { color:#ef4444; }
      #psp-pir-modal .pir-field input, #psp-pir-modal .pir-field select { width:100%; height:42px; font-size:15px; padding:6px 10px; box-sizing:border-box; }
      #psp-pir-modal .pir-field input[readonly] { opacity:.75; background:rgba(148,163,184,.15); }
      #psp-pir-modal .pir-wide { grid-column:1 / -1; }
      #psp-pir-modal .pir-photos { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
      #psp-pir-modal .pir-photos div { position:relative; }
      #psp-pir-modal .pir-photos img { width:84px; height:84px; object-fit:cover; border-radius:6px; border:1px solid var(--border-color,#cbd5e1); }
      #psp-pir-modal .pir-photos button { position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:50%; border:0;
        background:#ef4444; color:#fff; font-weight:800; cursor:pointer; line-height:22px; padding:0; }
      #psp-pir-modal .pir-foot { padding:10px 16px; border-top:1px solid var(--border-color,#cbd5e1); display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
      #psp-pir-modal .pir-msg { flex:1; font-size:12px; font-weight:600; min-width:180px; }
      /* tablets/phones: fit the visible screen (100vh hides the Submit button behind the browser bars) */
      @supports (height: 100dvh) { #psp-pir-modal .pir-box { height:calc(100dvh - 20px); max-height:calc(100dvh - 20px); } }
      #psp-pir-modal .pir-foot { flex-shrink:0; padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px)); }
      @media (max-width: 640px) { #psp-pir-modal .pir-grid { grid-template-columns:1fr; } #psp-pir-modal { padding:0; }
        #psp-pir-modal .pir-box { max-height:100dvh; height:100dvh; border-radius:0; } }`;
    document.head.appendChild(st);
  }

  function field(id, label, required, control, wide) {
    return `<div class="pir-field${wide ? " pir-wide" : ""}"><label for="${id}">${label}${required ? ' <span class="req">*</span>' : ""}</label>${control}</div>`;
  }
  const sel = (id, list, required) => `<select id="${id}" class="form-input" ${required ? "required" : ""}><option value="">-- Select --</option>${opts(list)}</select>`;
  const inp = (id, type, required, extra) => `<input id="${id}" type="${type}" class="form-input" ${required ? "required" : ""} ${extra || ""}>`;

  function injectModal() {
    if ($("psp-pir-modal")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="psp-pir-modal" role="dialog" aria-modal="true" aria-labelledby="psp-pir-title">
        <form class="pir-box" id="psp-pir-form" novalidate>
          <div class="pir-head">
            <div><div id="psp-pir-title" style="font-weight:800; font-size:16px;">📋 PIR – Pre Inspection Report</div>
              <div id="psp-pir-sub" style="font-size:12px; opacity:.8;"></div></div>
            <button type="button" id="psp-pir-cancel" class="btn btn-secondary btn-xs" style="height:34px; padding:0 12px;">✕ Cancel</button>
          </div>
          <div class="pir-body">
            <div class="pir-grid">
              ${field("pir-process", "1. Process", true, inp("pir-process", "text", true, 'readonly value="Pre Inspection"'))}
              ${field("pir-kp", "2. KP No.", true, inp("pir-kp", "text", true, "readonly"))}
              ${field("pir-no", "3. PIR No.", true, inp("pir-no", "text", true, 'placeholder="Enter PIR number"'))}
              ${field("pir-jc", "4. JC No.", true, inp("pir-jc", "text", true))}
              ${field("pir-part", "5. Part Name", true, inp("pir-part", "text", true))}
              ${field("pir-dia", "6. Coating Dia (mm)", true, inp("pir-dia", "number", true, 'step="any" min="0" inputmode="decimal"'))}
              ${field("pir-clen", "7. Coating Length (mm)", true, inp("pir-clen", "number", true, 'step="any" min="0" inputmode="decimal"'))}
              ${field("pir-tlen", "8. Total Length (mm)", true, inp("pir-tlen", "number", true, 'step="any" min="0" inputmode="decimal"'))}
              ${field("pir-ptype", "9. Part Type", true, sel("pir-ptype", PART_TYPES, true))}
              ${field("pir-qty", "10. Qty", false, inp("pir-qty", "number", false, 'min="1" step="1" inputmode="numeric"'))}
              ${field("pir-inspector", "11. Inspector Name", true, sel("pir-inspector", INSPECTORS, true))}
              ${field("pir-status", "13. Status", true, sel("pir-status", STATUSES, true))}
              ${field("pir-outsourcing", "14. Outsourcing", true, sel("pir-outsourcing", ["Outsourcing Yes", "Outsourcing No"], true))}
              ${field("pir-pcode", "15. Process Code", true, inp("pir-pcode", "text", true))}
              ${field("pir-processes", "16. Processes", true, sel("pir-processes", PROCESSES, true))}
              ${field("pir-next", "17. Next Stage", true, sel("pir-next", NEXT_STAGES, true), true)}
              <div class="pir-field pir-wide">
                <label for="pir-photos">12. Job Photos <span style="font-weight:400; opacity:.75;">(you can add several, up to ${MAX_PHOTOS})</span></label>
                <input id="pir-photos" type="file" accept="image/*" multiple class="form-input" style="height:auto; padding:8px;">
                <div id="pir-photo-list" class="pir-photos"></div>
              </div>
            </div>
          </div>
          <div class="pir-foot">
            <div id="psp-pir-msg" class="pir-msg"></div>
            <button type="button" id="psp-pir-skip" class="btn btn-secondary btn-xs" style="height:42px; padding:0 14px; display:none;">Skip PIR (Super Admin)</button>
            <button type="submit" id="psp-pir-submit" class="btn btn-success" style="height:42px; padding:0 20px; font-weight:800;">Submit PIR &amp; Move</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== STATE =====================
  let active = null;          // { job, transition }
  let photos = [];            // [{ name, type, dataUrl }]
  let busy = false;
  let origApply = null, bypass = false;

  const msg = (text, color) => { const m = $("psp-pir-msg"); m.textContent = text || ""; m.style.color = color || ""; };

  function updateSubmitLabel() {
    const next = $("pir-next").value;
    $("psp-pir-submit").textContent = next === QUARANTINE ? "Submit PIR (Quarantine – stays in Inspection)"
      : next ? `Submit PIR & Move to ${next}` : "Submit PIR & Move";
  }

  function openPIR(job, presetTarget, transition) {
    active = { job, transition };
    photos = [];
    $("pir-photo-list").innerHTML = "";
    $("pir-photos").value = "";
    const jc = (typeof getJobJcNo === "function" ? getJobJcNo(job) : job.jcNo) || "";
    $("psp-pir-sub").textContent = `${job.kpNumber}${jc ? " (" + jc + ")" : ""} · ${job.partName || ""} · ${job.customer || ""}`;
    $("pir-kp").value = job.kpNumber;
    $("pir-jc").value = jc;
    $("pir-part").value = job.partName || "";
    $("pir-qty").value = job.quantity || "";
    ["pir-no", "pir-dia", "pir-clen", "pir-tlen", "pir-pcode"].forEach(id => { $(id).value = ""; });
    ["pir-ptype", "pir-status", "pir-outsourcing"].forEach(id => { $(id).value = ""; });
    const known = PROCESSES.find(p => p.toLowerCase() === String(job.processType || "").toLowerCase());
    $("pir-processes").value = known || "";
    const u = user();
    const me = u && INSPECTORS.find(n => n.toLowerCase() === String(u.name || "").toLowerCase());
    $("pir-inspector").value = me || "";
    // Next Stage: preset from a board drag; add the stage to the list if it is not one of the usual ones
    const next = $("pir-next");
    if (presetTarget && !NEXT_STAGES.includes(presetTarget) && !next.querySelector(`option[value="${presetTarget}"]`)) {
      const o = document.createElement("option"); o.value = presetTarget; o.textContent = presetTarget;
      next.insertBefore(o, next.querySelector(`option[value="${QUARANTINE}"]`));
    }
    next.value = presetTarget || "";
    updateSubmitLabel();
    $("psp-pir-skip").style.display = (u && u.role === "super_admin") ? "" : "none";
    msg("");
    $("psp-pir-modal").style.display = "flex";
    setTimeout(() => $("pir-no").focus(), 50);
  }

  function closePIR() {
    $("psp-pir-modal").style.display = "none";
    active = null;
    photos = [];
  }

  function cancelPIR() {
    if (busy) return;
    closePIR();
    const overlay = $("transition-drag-overlay");
    if (overlay) overlay.style.display = "none";
    window.pendingTransition = null;
    try { if (typeof renderAll === "function") renderAll(); } catch (e) {}
  }

  // ---------- photos (shrunk before upload so they send quickly from phones) ----------
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
    $("pir-photo-list").innerHTML = photos.map((p, i) =>
      `<div><img src="${p.dataUrl}" alt="Job photo ${i + 1}"><button type="button" data-pir-del="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("");
  }

  async function addPhotos(fileList) {
    const files = [...fileList].slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    if (fileList.length > files.length) msg(`Only ${MAX_PHOTOS} photos can be attached.`, "#f97316");
    for (const f of files) {
      try { photos.push(await shrink(f)); } catch (e) { msg(e.message, "#ef4444"); }
    }
    $("pir-photos").value = "";
    drawPhotos();
  }

  // ---------- submit ----------
  function readForm() {
    const v = id => String($(id).value || "").trim();
    return {
      process: "Pre Inspection", kpNo: v("pir-kp"), pirNo: v("pir-no"),
      jcNo: v("pir-jc"), partName: v("pir-part"), coatingDiaMm: v("pir-dia"), coatingLengthMm: v("pir-clen"),
      totalLengthMm: v("pir-tlen"), partType: v("pir-ptype"), qty: v("pir-qty"), inspectorName: v("pir-inspector"),
      status: v("pir-status"), outsourcing: v("pir-outsourcing"), processCode: v("pir-pcode"),
      processes: v("pir-processes"), nextStage: v("pir-next")
    };
  }

  function firstMissing() {
    const form = $("psp-pir-form");
    for (const el of form.querySelectorAll("[required]")) {
      if (!String(el.value || "").trim()) return el;
      if (el.type === "number" && Number(el.value) <= 0) return el;
    }
    return null;
  }

  async function sendToSheet(report) {
    if (!PIR_SCRIPT_URL) return { ok: false, skipped: true };
    const body = JSON.stringify({ type: "PIR", token: PIR_TOKEN, report, photos: photos.map(p => ({ name: p.name, type: p.type, data: p.dataUrl.split(",")[1] })) });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(PIR_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, signal: ctrl.signal });
      const out = await res.json();
      if (!out || !out.ok) throw new Error((out && out.error) || "sheet did not confirm");
      return out;
    } finally { clearTimeout(t); }
  }

  async function saveToFirebase(job, report, extra) {
    if (typeof isMockMode === "function" && isMockMode()) return;
    const db = firebase.firestore();
    const ref = job.id ? db.collection("jobs").doc(job.id) : db.collection("jobs").doc("job_" + job.kpNumber);
    const upd = {
      pirReport: report,
      pirReports: firebase.firestore.FieldValue.arrayUnion(report),
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (report.processes && report.processes !== "Blank PIR") upd.processType = report.processes;
    if (report.jcNo && !job.jcNo) upd.jcNo = report.jcNo;
    Object.assign(upd, extra || {});
    await ref.update(upd);
  }

  async function submitPIR(e) {
    if (e) e.preventDefault();
    if (busy || !active) return;
    const missing = firstMissing();
    if (missing) {
      const lbl = missing.closest(".pir-field").querySelector("label").textContent.replace("*", "").trim();
      msg(`Please fill in: ${lbl}`, "#ef4444"); missing.focus(); return;
    }
    const data = readForm();
    if (data.status.startsWith("Not OK") && !confirm(`Status is "${data.status}".\n\nSave this PIR and continue?`)) return;

    const { job, transition } = active;
    const u = user() || {};
    const report = Object.assign({}, data, {
      customer: job.customer || "", submittedAt: new Date().toISOString(),
      submittedBy: u.name || u.email || "Unknown", photoUrls: [], photoFolderUrl: ""
    });

    busy = true;
    const btn = $("psp-pir-submit"); btn.disabled = true;
    msg(photos.length ? `Saving PIR and uploading ${photos.length} photo(s)…` : "Saving PIR…", "#2563eb");
    let sheetNote = "";
    try {
      try {
        const out = await sendToSheet(report);
        if (out.skipped) sheetNote = " (sheet not linked yet – saved in dashboard only)";
        else { report.photoUrls = out.photoUrls || []; report.photoFolderUrl = out.folderUrl || ""; }
      } catch (err) {
        busy = false; btn.disabled = false;
        msg("Could not reach the PIR sheet: " + (err && err.message ? err.message : err) + ". Check the internet and press Submit again.", "#ef4444");
        return;
      }
      const quarantine = data.nextStage === QUARANTINE;
      await saveToFirebase(job, report, quarantine ? { quarantine: true, quarantineReason: "Blank PIR/Quarantine", quarantineAt: report.submittedAt } : { quarantine: false });
      try {
        if (typeof createAuditLog === "function") createAuditLog(u.email || report.submittedBy, job.kpNumber,
          `PIR ${data.pirNo} submitted (${data.status}, ${data.processes}) → ${data.nextStage}${report.photoUrls.length ? `, ${report.photoUrls.length} photo(s)` : ""}`);
      } catch (err2) {}
      // local copy so the screen updates at once
      job.pirReport = report;
      if (data.processes && data.processes !== "Blank PIR") job.processType = data.processes;

      busy = false; btn.disabled = false;
      closePIR();
      if (quarantine) {
        job.quarantine = true;
        const overlay = $("transition-drag-overlay"); if (overlay) overlay.style.display = "none";
        window.pendingTransition = null;
        try { if (typeof renderAll === "function") renderAll(); } catch (err3) {}
        alert(`PIR saved${sheetNote}.\n\n${job.kpNumber} stays in Inspection, marked QUARANTINE.`);
        return;
      }
      window.pendingTransition = transition;
      bypass = true;
      try { origApply(data.nextStage); } finally { bypass = false; }
      if (sheetNote) console.log("[PIR] " + job.kpNumber + sheetNote);
    } catch (err) {
      busy = false; btn.disabled = false;
      msg("Could not save the PIR: " + (err && err.message ? err.message : err), "#ef4444");
    }
  }

  // ===================== HOOKS =====================
  function installHooks() {
    // Board drags (and anything else) out of Inspection go through applyStageTransitionWithUndo
    if (typeof window.applyStageTransitionWithUndo === "function") {
      origApply = window.applyStageTransitionWithUndo;
      window.applyStageTransitionWithUndo = function (targetStage) {
        const tr = window.pendingTransition;
        if (!bypass && tr && tr.stage === FROM_STAGE && tr.job && targetStage && targetStage !== FROM_STAGE) {
          openPIR(tr.job, targetStage, tr);
          return;
        }
        return origApply.apply(this, arguments);
      };
    }
    // "→ Move to Next Stage" on an Inspection card: open the PIR straight away (its Next Stage replaces the stage screen)
    if (typeof window.showFloatingCardTransition === "function") {
      const origShow = window.showFloatingCardTransition;
      window.showFloatingCardTransition = function (job, stageName, payloadGenerator, applyLocalMutation) {
        if (stageName === FROM_STAGE && job) {
          const tr = { job, stage: stageName, payloadGenerator, applyLocalMutation };
          window.pendingTransition = tr;
          openPIR(job, "", tr);
          return;
        }
        return origShow.apply(this, arguments);
      };
    }
  }

  function bindEvents() {
    $("psp-pir-form").addEventListener("submit", submitPIR);
    $("psp-pir-cancel").addEventListener("click", cancelPIR);
    $("pir-next").addEventListener("change", updateSubmitLabel);
    // "Outsourcing Yes" suggests Outsourcing as the next stage (still changeable)
    $("pir-outsourcing").addEventListener("change", () => {
      if ($("pir-outsourcing").value === "Outsourcing Yes" && !$("pir-next").value) { $("pir-next").value = "Outsourcing"; updateSubmitLabel(); }
    });
    $("pir-photos").addEventListener("change", e => addPhotos(e.target.files));
    $("pir-photo-list").addEventListener("click", e => {
      const b = e.target.closest("[data-pir-del]");
      if (!b) return;
      photos.splice(Number(b.getAttribute("data-pir-del")), 1);
      drawPhotos();
    });
    $("psp-pir-skip").addEventListener("click", () => {
      if (!active || busy) return;
      const next = $("pir-next").value;
      if (!next || next === QUARANTINE) { msg("Choose the Next Stage to move to (skip only works for a move).", "#ef4444"); return; }
      if (!confirm(`Skip the PIR and move ${active.job.kpNumber} to ${next}? This is recorded in the audit log.`)) return;
      const { job, transition } = active;
      try { if (typeof createAuditLog === "function") createAuditLog((user() || {}).email || "Super Admin", job.kpNumber, `PIR SKIPPED by Super Admin → ${next}`); } catch (e) {}
      closePIR();
      window.pendingTransition = transition;
      bypass = true;
      try { origApply(next); } finally { bypass = false; }
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("psp-pir-modal").style.display === "flex") cancelPIR();
    });
  }

  // ===================== BOOT =====================
  try {
    injectStyles();
    injectModal();
    installHooks();
    bindEvents();
    window.PSPPir = { open: (kp, stage) => { const j = allJobs().find(x => x.kpNumber === kp); if (j) openPIR(j, stage || "", window.pendingTransition); } };
    console.log("[PSP] pir-form v" + MODULE_VERSION + " loaded." + (PIR_SCRIPT_URL ? "" : " (PIR sheet not linked yet: set PIR_SCRIPT_URL)"));
  } catch (err) {
    console.error("[PSP] pir-form failed to load:", err);
  }
})();
