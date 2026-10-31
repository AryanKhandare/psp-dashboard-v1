/**
 * PSP MES – small UI adjustments.
 *
 * - Adds "Machining" to every stage's Next Department / Next Process list.
 * - The Spraying "cannot switch screens" lock applies only to Spraying operators, not to admins.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] ui-tweaks: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 10;

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

  // Dispatch & Close: the "Select Next Stage" screen has no "Dispatched" target, so a dispatched job could never
  // be closed (choosing 08. Dispatch just put it back). From the Dispatch stage, close it directly instead:
  // confirm → job marked Dispatched / Completed (app's own END_CYCLE / SPLIT_STAGE save) with the 10 s UNDO banner.
  function makeDispatchCloseWork() {
    if (typeof window.showFloatingCardTransition !== "function") return;
    const orig = window.showFloatingCardTransition;
    window.showFloatingCardTransition = function (job, stageName, payloadGenerator, applyLocalMutation) {
      if (stageName !== "Dispatch" || typeof applyStageTransitionWithUndo !== "function") {
        return orig.apply(this, arguments);
      }
      window.pendingTransition = { job, stage: stageName, payloadGenerator, applyLocalMutation };
      // quantity entered in the previous prompt is inside the payload generator; show the job's own quantity here
      const label = (window.PSP && window.PSP.kpLabel) ? window.PSP.kpLabel(job) : job.kpNumber;
      if (!confirm(`Dispatch and close ${label}?\n\n${job.partName || ""}\n${job.customer || ""}\n\nThe job will be marked Dispatched / Completed and removed from the Dispatch stage.`)) {
        window.pendingTransition = null;
        return;
      }
      applyStageTransitionWithUndo("Dispatched");
    };
  }

  // Phones: the page used height 100vh, which on mobile browsers includes the area behind the address bar /
  // navigation buttons, so the bottom of the side menu (user card + LOGOUT) was hidden. Use the visible height
  // (100dvh) and keep the user card pinned at the bottom of the menu, with the stage list scrolling above it.
  function fixMobileHeight() {
    if ($("psp-mobile-height-css")) return;
    const st = document.createElement("style");
    st.id = "psp-mobile-height-css";
    st.textContent = `
      @supports (height: 100dvh) {
        body.industrial-theme { height: 100dvh !important; }
        .transition-overlay { height: 100dvh !important; }
      }
      .mes-sidebar { min-height: 0; }
      .mes-sidebar .sidebar-nav-container { min-height: 0; overflow-y: auto; }
      .mes-sidebar .sidebar-user-card { flex-shrink: 0; padding-bottom: calc(15px + env(safe-area-inset-bottom, 0px)) !important; }`;
    document.head.appendChild(st);
  }

  // "Select Next Stage" screen had no way back. Add a Cancel button, Esc key and the phone Back button.
  // Cancelling closes the screen and leaves the job exactly where it was (nothing is saved).
  function addNextStageCancel() {
    const overlay = $("transition-drag-overlay");
    if (!overlay || $("psp-transition-cancel")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "psp-transition-cancel";
    btn.textContent = "✕ Cancel";
    btn.setAttribute("aria-label", "Cancel and keep the job in its current stage");
    btn.style.cssText = "position:absolute; top:14px; right:16px; z-index:2; padding:8px 16px; border-radius:6px; " +
      "border:1px solid rgba(255,255,255,0.35); background:rgba(15,23,42,0.85); color:#fff; font-weight:700; " +
      "font-size:14px; cursor:pointer;";
    overlay.appendChild(btn);

    const isOpen = () => overlay.style.display && overlay.style.display !== "none";
    let historyPushed = false, ignoreNextPop = false;

    function cancel(fromBack) {
      if (!isOpen()) return;
      overlay.style.display = "none";
      window.pendingTransition = null;
      document.querySelectorAll(".drop-target-stage.drag-active").forEach(z => z.classList.remove("drag-active"));
      if (historyPushed && !fromBack) { ignoreNextPop = true; history.back(); }
      historyPushed = false;
      try { if (typeof renderAll === "function") renderAll(); } catch (e) {}
    }
    btn.addEventListener("click", () => cancel(false));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) cancel(false); });

    // Phone Back button: add a history step while the screen is open, and close it on Back
    new MutationObserver(() => {
      if (isOpen() && !historyPushed) {
        try { history.pushState({ pspStageScreen: 1 }, "", location.href); historyPushed = true; } catch (e) {}
      } else if (!isOpen() && historyPushed) {
        // closed by choosing a stage: remove the extra history step quietly
        historyPushed = false; ignoreNextPop = true;
        try { history.back(); } catch (e) {}
      }
    }).observe(overlay, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("popstate", () => {
      if (ignoreNextPop) { ignoreNextPop = false; return; }
      if (isOpen()) { historyPushed = false; cancel(true); }
    });
  }

  // JC number for split parts: a split part is "KP-1008-04-R" but the sheet's KP→JC list only knows "KP-1008-04".
  // Fall back to the KP without the -R suffix, then the parent job's JC, then the JC entered on the job's PIR.
  function fixSplitJobJc() {
    if (typeof window.getJobJcNo !== "function") return;
    const orig = window.getJobJcNo;
    window.getJobJcNo = function (job) {
      const found = orig.apply(this, arguments);
      if (found || !job) return found;
      const kp = String(job.kpNumber || job.kpNo || "").trim().toUpperCase();
      const at = kp.indexOf("-R");
      if (at !== -1) {
        const parentKp = kp.slice(0, at);
        if (window.kpToJcMap && window.kpToJcMap[parentKp]) return window.kpToJcMap[parentKp];
        const parent = allJobs().find(j => String(j.kpNumber || "").toUpperCase() === parentKp);
        if (parent && parent.jcNo) return parent.jcNo;
        if (parent && parent.pirReport && parent.pirReport.jcNo) return parent.pirReport.jcNo;
      }
      return (job.pirReport && job.pirReport.jcNo) || "";
    };
  }

  // Newest first in Spraying and Grinding: queue cards by arrival in the stage, history rows by completion time.
  // (The stages themselves list jobs in Firebase's internal order, so a new job could appear anywhere.)
  const NEWEST_FIRST = [
    { box: "spraying-queue-cards",        key: "spraying", stage: "Spraying", kind: "queue" },
    { box: "grinding-queue-cards",        key: "grinding", stage: "Grinding", kind: "queue" },
    { box: "spraying-history-table-body", key: "spraying", stage: "Spraying", kind: "history" },
    { box: "grinding-history-table-body", key: "grinding", stage: "Grinding", kind: "history" }
  ];
  const tsOf = v => { if (!v) return 0; const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(v); const t = d.getTime(); return isNaN(t) ? 0 : t; };
  const cleanKpOf = kp => (typeof getCleanKpNumber === "function" ? getCleanKpNumber(kp) : kp);
  const jcOf = j => (typeof getJobJcNo === "function" ? getJobJcNo(j) : j.jcNo) || "";
  function labelFromEl(el) {
    const src = el.tagName === "TR" ? (el.querySelector("td") || el) : (el.querySelector(".job-card-header") || el);
    const m = src.textContent.replace(/\s+/g, " ").match(/KP-[A-Z0-9]+(?:-[A-Z0-9]+)*(?:\s*\([^)]*\))?/i);
    return m ? m[0].trim().toUpperCase() : "";
  }
  function sortNewestFirst(cfg) {
    const box = $(cfg.box);
    if (!box) return;
    const items = [...box.children].filter(el => cfg.kind === "queue" ? el.classList.contains("stage-kanban-card") : el.tagName === "TR" && el.children.length > 1);
    if (items.length < 2) return;
    const pool = allJobs().filter(j => cfg.kind === "queue" ? j.currentDepartment === cfg.stage : (j[cfg.key] && j[cfg.key].status === "Completed"));
    const used = new Set();
    const timeOf = el => {
      const label = labelFromEl(el), kpOnly = label.replace(/\s*\(.*$/, "");
      const lbl = j => (cleanKpOf(j.kpNumber) + (jcOf(j) ? ` (${jcOf(j)})` : "")).toUpperCase();
      const job = pool.find(j => !used.has(j) && lbl(j) === label) || pool.find(j => !used.has(j) && String(cleanKpOf(j.kpNumber)).toUpperCase() === kpOnly);
      if (!job) return 0;
      used.add(job);
      const sd = job[cfg.key] || {};
      return cfg.kind === "queue"
        ? (tsOf((job.stageAssignedAt || {})[cfg.key]) || tsOf(sd.queueEntryTime) || tsOf(sd.startTime))
        : (tsOf(sd.endTime) || tsOf((job.stageAssignedAt || {})[cfg.key]));
    };
    const withTime = items.map((el, i) => ({ el, i, t: timeOf(el) }));
    const sorted = withTime.slice().sort((a, b) => (b.t - a.t) || (a.i - b.i));
    if (sorted.every((x, i) => x.el === items[i])) return;      // already in order: no DOM change
    const anchor = items[items.length - 1].nextSibling;
    sorted.forEach(x => box.insertBefore(x.el, anchor));
  }
  function installNewestFirst() {
    NEWEST_FIRST.forEach(cfg => {
      const box = $(cfg.box);
      if (!box || box.dataset.pspNewest) return;
      box.dataset.pspNewest = "1";
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => { queued = false; try { sortNewestFirst(cfg); } catch (e) {} }, 30);
      }).observe(box, { childList: true });
    });
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
    makeDispatchCloseWork();
    fixMobileHeight();
    addNextStageCancel();
    fixSplitJobJc();
    installNewestFirst();
    installRenderHook();
    console.log("[PSP] ui-tweaks v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] ui-tweaks failed to load:", err);
  }
})();
