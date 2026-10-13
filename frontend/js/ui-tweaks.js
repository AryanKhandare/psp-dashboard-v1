/**
 * PSP MES – small UI adjustments.
 *
 * - Adds "Machining" to every stage's Next Department / Next Process list.
 * - The Spraying "cannot switch screens" lock applies only to Spraying operators, not to admins.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] ui-tweaks: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 5;

  const STAGE = "Machining";

  // Add "Machining" to every stage's Next Department / Next Process list (right after Inspection)
  function injectNextStageOptions() {
    ["spraying-complete-next-process", "grinding-complete-next-process", "masking-complete-next-process",
     "masking-next-process", "no-masking-next-process"].forEach(id => {
      const sel = $(id);
      if (!sel || sel.querySelector('option[value="Machining"]')) return;
      const o = document.createElement("option");
      o.value = STAGE;
      o.textContent = STAGE;
      const insp = sel.querySelector('option[value="Inspection"]');
      if (insp) insp.insertAdjacentElement("afterend", o);
      else sel.insertBefore(o, sel.firstChild);
    });
  }

  // Spraying "can't leave the screen" lock: keep it ONLY for Spraying operators.
  // The app sets window.sprayingJobActive whenever a spraying job runs, for every user; admins got locked too.
  // Rework pop-up: add "Post Machining Process" as a reason, shown only when the job is sent back to Machining
  const POST_MACHINING = "Post Machining Process";
  function addPostMachiningReason() {
    const sel = $("rework-reason-select");
    const toEl = $("rework-to-stage");
    const comments = $("rework-custom-input");
    if (!sel || sel.querySelector(`option[value="${POST_MACHINING}"]`)) return;

    const opt = document.createElement("option");
    opt.value = POST_MACHINING;
    opt.textContent = POST_MACHINING;
    const first = sel.querySelector('option[value=""]');
    if (first) first.insertAdjacentElement("afterend", opt); else sel.insertBefore(opt, sel.firstChild);

    const sync = () => {
      const toMachining = String((toEl && toEl.textContent) || "").trim() === STAGE;
      opt.hidden = !toMachining;
      opt.disabled = !toMachining;
      if (!toMachining && sel.value === POST_MACHINING) sel.value = "";
    };
    sync();
    // The app writes the target stage into the pop-up right before opening it
    if (toEl) new MutationObserver(sync).observe(toEl, { childList: true, characterData: true, subtree: true });

    // Comments are required by the form: fill a sensible default for this reason (still editable)
    const AUTO = "Sent to Machining for post machining process";
    sel.addEventListener("change", () => {
      if (!comments) return;
      if (sel.value === POST_MACHINING && !comments.value.trim()) comments.value = AUTO;
      else if (sel.value !== POST_MACHINING && comments.value === AUTO) comments.value = "";
    });
  }

  // Inspectors (operators of the Inspection department: MF, VG, SJ, JN, Laxmi) also get Final Inspection.
  // Result for them: Inspection + Final Inspection + Performance Reports.
  function giveInspectorsFinalInspection() {
    if (typeof ROLE_PERMISSIONS === "undefined" || !ROLE_PERMISSIONS.operator) return;
    const list = ROLE_PERMISSIONS.operator.Inspection;
    if (Array.isArray(list) && !list.includes("tab-final-inspection")) {
      const at = list.indexOf("tab-inspection");
      list.splice(at === -1 ? list.length : at + 1, 0, "tab-final-inspection");
    }
  }

  // Spraying › Active Job: list of all running / on-hold spraying cycles on the right (like Machining / Grinding).
  // Clicking one shows it in the station monitor.
  function sprayActiveMs(sp) {
    let ms = Number((sp && sp.activeTimeMs) || 0);
    if (sp && sp.status === "In Progress" && sp.lastStartedAt) ms += Date.now() - new Date(sp.lastStartedAt).getTime();
    return ms;
  }
  const fmtMs = ms => (typeof formatDuration === "function") ? formatDuration(ms || 0) : "00:00:00";

  function addSprayingActiveList() {
    const pane = $("spraying-subtab-active");
    const layout = pane && pane.querySelector(".split-layout");
    if (!layout || $("spraying-active-cycles-list")) return;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `<div class="panel-header"><h3>ACTIVE SPRAYING CYCLES</h3></div>
      <div class="panel-body" style="max-height:500px; overflow-y:auto;">
        <div id="spraying-active-cycles-list" class="active-cards-list"></div>
      </div>`;
    layout.appendChild(panel);
    $("spraying-active-cycles-list").addEventListener("click", e => {
      const card = e.target.closest("[data-spray-kp]");
      if (!card) return;
      try { selectedSprayingJobKp = card.getAttribute("data-spray-kp"); } catch (err) {}
      if (typeof renderAll === "function") renderAll();
    });
    setInterval(() => {
      const tab = $("tab-spraying");
      if (!tab || !tab.classList.contains("active")) return;
      document.querySelectorAll("[data-spray-timer]").forEach(el => {
        const job = allJobs().find(j => j.kpNumber === el.getAttribute("data-spray-timer"));
        if (job && job.spraying) el.textContent = fmtMs(sprayActiveMs(job.spraying));
      });
    }, 1000);
  }

  function renderSprayingActiveList() {
    const box = $("spraying-active-cycles-list");
    const tab = $("tab-spraying");
    if (!box || !tab || !tab.classList.contains("active")) return;
    const list = allJobs().filter(j => j.currentDepartment === "Spraying" && j.spraying &&
                                      (j.spraying.status === "In Progress" || j.spraying.status === "Hold"));
    if (!list.length) { box.innerHTML = `<div class="no-selection-message">No running spraying cycles on the shop floor.</div>`; return; }
    let selected = null;
    try { selected = selectedSprayingJobKp; } catch (err) {}
    box.innerHTML = list.map(job => {
      const sp = job.spraying;
      const label = (window.PSP && window.PSP.kpLabel) ? window.PSP.kpLabel(job) : job.kpNumber;
      const qty = (window.PSP && window.PSP.qtyLabel) ? window.PSP.qtyLabel(job) : esc(job.quantity);
      const who = [sp.sprayingBooth || "", sp.operatorName || job.operatorName || ""].filter(Boolean).join(" · ") || "-";
      return `<div class="active-card${job.kpNumber === selected ? " selected-card" : ""}" data-spray-kp="${esc(job.kpNumber)}" style="cursor:pointer;">
          <div class="card-left">
            <div class="card-kp-row"><span class="card-kp">${esc(label)}</span>
              <span class="badge ${sp.status === "Hold" ? "badge-hold" : "badge-progress"} text-xs">${esc(sp.status)}</span></div>
            <span class="card-part">${esc(job.partName)} (${qty})</span>
            <span class="card-op-info">${esc(who)}</span>
          </div>
          <div class="card-right"><span class="card-time font-mono" data-spray-timer="${esc(job.kpNumber)}">${fmtMs(sprayActiveMs(sp))}</span>
            <span class="text-xs text-muted">Active Run</span></div>
        </div>`;
    }).join("");
  }

  function installRenderHook() {
    if (typeof window.executeRenderAll !== "function") return;
    const orig = window.executeRenderAll;
    window.executeRenderAll = function () {
      const r = orig.apply(this, arguments);
      try { renderSprayingActiveList(); } catch (e) { console.warn("[UI Tweaks] spraying list error:", e); }
      return r;
    };
  }

  // "Select Next Stage" screen: fit all stage targets (7 since Machining was added) on any screen size.
  // Phones: 3 per row, compact boxes, scrollable, and "tap" wording (drag does not work by finger).
  function fixNextStageLayoutOnPhones() {
    if ($("psp-next-stage-css")) return;
    const st = document.createElement("style");
    st.id = "psp-next-stage-css";
    st.textContent = `
      .bottom-stage-selector { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)) !important; }
      @media (max-width: 700px) {
        .transition-overlay { overflow-y: auto !important; justify-content: flex-start !important; gap: 14px; padding: 18px 10px 24px !important; }
        .transition-instruction-header h2 { font-size: 20px !important; margin-bottom: 4px !important; }
        .transition-instruction-header p { font-size: 12px !important; }
        .floating-card-center-container { flex: 0 0 auto !important; }
        .floating-card { width: 100% !important; max-width: 340px !important; padding: 14px !important;
                         animation: none !important; transform: none !important; }
        .bottom-stage-selector { grid-template-columns: repeat(3, 1fr) !important; gap: 8px !important;
                                 padding: 10px !important; max-width: 100% !important; box-sizing: border-box; }
        .drop-target-stage { padding: 12px 4px !important; gap: 6px !important; min-height: 74px; }
        .drop-target-stage:hover, .drop-target-stage.drag-active { transform: none !important; }
        .drop-icon { font-size: 22px !important; }
        .drop-label { font-size: 10px !important; letter-spacing: .04em !important; text-align: center; }
      }`;
    document.head.appendChild(st);

    // Touch screens: say "tap" instead of "drag"
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!touch) return;
    const header = document.querySelector("#transition-drag-overlay .transition-instruction-header p");
    if (header) header.textContent = "Tap the stage this job goes to next";
    const card = $("floating-drag-card");
    if (card) {
      const fixHint = () => {
        card.querySelectorAll("*").forEach(el => {
          if (el.children.length === 0 && /drag me/i.test(el.textContent)) el.textContent = "TAP A STAGE BELOW";
        });
      };
      new MutationObserver(fixHint).observe(card, { childList: true, subtree: true });
    }
  }

  function limitSprayingLockToOperators() {
    let raw = !!window.sprayingJobActive;
    const isSprayingOperator = () => {
      const u = user();
      if (!u || u.role !== "operator") return false;
      const dept = typeof getCleanDeptKey === "function" ? getCleanDeptKey(u.department) : u.department;
      return String(dept || "").toLowerCase().includes("spray");
    };
    try {
      Object.defineProperty(window, "sprayingJobActive", {
        configurable: true,
        get() { return raw && isSprayingOperator(); },
        set(v) { raw = !!v; }
      });
    } catch (e) { console.warn("[UI Tweaks] Could not adjust spraying lock:", e); }
  }

  // ===================== BOOT =====================
  try {
    injectNextStageOptions();
    giveInspectorsFinalInspection();
    limitSprayingLockToOperators();
    addPostMachiningReason();
    addSprayingActiveList();
    fixNextStageLayoutOnPhones();
    installRenderHook();
    console.log("[PSP] ui-tweaks v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] ui-tweaks failed to load:", err);
  }
})();
