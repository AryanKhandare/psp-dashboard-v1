/**
 * PSP MES – "Production Manager" role.
 *
 * Sees everything a Production Admin sees (all stages, queues, active jobs, history, outsourcing, dispatch,
 * reports, main board, comments) – except Data Management and User Management.
 * Start / End (and the other actions below) can be switched on or off in PM_PERMISSIONS.
 *
 * TO GIVE ACCESS LATER: change false → true below, upload this file, and change ?v= in index.html.
 * Load LAST of the add-ons (after job-comments.js), before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] role-production-manager: psp-common.js must load first."); return; }
  const { $, user } = window.PSP;
  const MODULE_VERSION = 1;

  // ======================= PERMISSIONS (edit here) =======================
  const PM_PERMISSIONS = {
    start: false,         // Start a cycle in any stage (Start Masking / Spraying / Grinding / Machining / Sealing / Polishing, Send to Vendor)
    end: false,           // End / complete a stage, move a job (Move to Next Stage, drag on the board, Approve QA & Close, Dispatch & Close, Receive Back)
    pauseResume: false,   // Pause / Resume a running cycle
    deleteJobs: false,    // Delete Job
    comments: true        // Add / edit own comments
  };
  // =======================================================================

  const ROLE = "production_manager";
  const ROLE_LABEL = "Production Manager";
  const EXCLUDED_TABS = ["tab-data-management", "tab-user-management"];
  const isPM = () => { const u = user(); return !!(u && u.role === ROLE); };

  // ---------- 1) Role in User Management (role lists) ----------
  function addRoleOption(sel) {
    if (!sel || sel.querySelector(`option[value="${ROLE}"]`)) return;
    const o = document.createElement("option");
    o.value = ROLE; o.textContent = ROLE_LABEL;
    const after = sel.querySelector('option[value="production_admin"]');
    if (after) after.insertAdjacentElement("afterend", o); else sel.appendChild(o);
    // existing user tables: select the role the user really has
    const m = sel.id.match(/(?:dmd-)?user-role-select-(.+)$/);
    if (m && typeof users !== "undefined" && Array.isArray(users)) {
      const u = users.find(x => x.uid === m[1]);
      if (u && u.role === ROLE) sel.value = ROLE;
    }
  }
  function injectRoleOptions() {
    addRoleOption($("user-role"));
    document.querySelectorAll('select[id^="user-role-select-"], select[id^="dmd-user-role-select-"]').forEach(addRoleOption);
  }

  // ---------- 2) Tabs: everything Production Admin has, minus admin screens ----------
  function installTabAccess() {
    if (typeof window.isTabAuthorized !== "function") return;
    const orig = window.isTabAuthorized;
    window.isTabAuthorized = function (tabId) {
      if (isPM()) {
        if (EXCLUDED_TABS.includes(tabId)) return false;
        const list = (typeof ROLE_PERMISSIONS !== "undefined" && ROLE_PERMISSIONS.production_admin) || [];
        if (list.includes(tabId)) return true;
        return ["tab-machining", "tab-sealing", "tab-outsourcing", "tab-polishing", "tab-dispatch", "tab-final-inspection", "tab-reports"].includes(tabId);
      }
      return orig.apply(this, arguments);
    };
  }

  // ---------- 3) Which action is a button? ----------
  const PATTERNS = {
    start: /(^|\s)(▶\s*)?start\b|send to vendor/i,
    end: /\b(end|complete|finish)\b|approve qa|dispatch\s*&\s*close|move to next stage|receive back|receive\s*&\s*move|move to stage|push\b|no masking required|send back to|submit fir|submit pir|clearance received/i,
    pauseResume: /\b(pause|resume)\b/i,
    deleteJobs: /delete job/i
  };
  // Buttons that only look at things stay allowed
  const SAFE = /^\s*(→\s*)?(view|open|clear|cancel|close|✕|export|⬇|refresh|logout|details|search|all dates|show|hide)\b/i;
  function blockedAction(el) {
    const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    if (!text || SAFE.test(text)) return null;
    for (const key of ["deleteJobs", "end", "start", "pauseResume"]) {
      if (!PM_PERMISSIONS[key] && PATTERNS[key].test(text)) return key;
    }
    return null;
  }
  const LABEL = { start: "Start", end: "End / move", pauseResume: "Pause / Resume", deleteJobs: "Delete" };
  function toast(key) {
    const msg = `${ROLE_LABEL}: "${LABEL[key]}" is not allowed for your role.`;
    if (typeof showToast === "function") showToast("View only", msg, "warning"); else alert(msg);
  }

  // ---------- 4) Grey out and lock those buttons ----------
  function injectStyle() {
    if ($("pm-lock-css")) return;
    const st = document.createElement("style");
    st.id = "pm-lock-css";
    st.textContent = `.pm-locked { opacity:.42 !important; cursor:not-allowed !important; filter:grayscale(.6); }
      .pm-locked::after { content:" 🔒"; }
      body.pm-no-drag [draggable="true"] { cursor:pointer !important; }`;
    document.head.appendChild(st);
  }
  let queued = false;
  function lockButtons() {
    if (!isPM()) return;
    document.querySelectorAll("button, .btn, [role='button']").forEach(b => {
      if (b.closest("#jc-panel, #jc-menu, .sidebar, nav, #access-denied-modal")) return;
      const key = blockedAction(b);
      b.classList.toggle("pm-locked", !!key);
      if (key) b.title = `${ROLE_LABEL}: ${LABEL[key]} is not allowed`;
    });
    // Production Manager may see the Masking Supervisor / Materials sub-tabs (view only)
    ["masking-subtab-supervisor", "masking-subtab-materials"].forEach(id => {
      const btn = document.querySelector(`[data-subtab="${id}"]`);
      if (btn) btn.style.display = "flex";
    });
  }
  const queueLock = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; try { lockButtons(); } catch (e) {} }, 80); };

  // ---------- 5) Block clicks, drags and the save itself ----------
  const BLOCKED_SAVES = {
    start: ["START_CYCLE", "STARTCYCLE"],
    end: ["END_CYCLE", "ENDCYCLE", "SPLIT_STAGE", "SPLIT_MASKING", "APPROVE_JOB", "APPROVEJOB", "MOVE_STAGE", "BYPASS_MASKING", "UPDATE_JOB_STAGE"],
    pauseResume: ["PAUSE_CYCLE", "PAUSECYCLE", "RESUME_CYCLE", "RESUMECYCLE"],
    deleteJobs: ["DELETE_JOB"]
  };
  function installGuards() {
    document.addEventListener("click", e => {
      if (!isPM()) return;
      const b = e.target.closest("button, .btn, [role='button']");
      if (!b || b.closest("#jc-panel, #jc-menu")) return;
      const key = blockedAction(b);
      if (!key) return;
      e.preventDefault(); e.stopImmediatePropagation();
      toast(key);
    }, true);
    // forms that start / end cycles (in case a pop-up was opened another way)
    document.addEventListener("submit", e => {
      if (!isPM()) return;
      const f = e.target;
      const id = (f.id || "").toLowerCase();
      let key = null;
      if (/start|assign/.test(id)) key = "start";
      else if (/complete|end|no-masking|receive|fir|pir/.test(id)) key = "end";
      else if (/pause/.test(id)) key = "pauseResume";
      if (key && !PM_PERMISSIONS[key]) { e.preventDefault(); e.stopImmediatePropagation(); toast(key); }
    }, true);
    // dragging cards on the board / queues moves jobs
    document.addEventListener("dragstart", e => {
      if (isPM() && !PM_PERMISSIONS.end && e.target.closest && e.target.closest("[draggable='true']")) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    // the stage-move screens
    ["showFloatingCardTransition", "applyStageTransitionWithUndo"].forEach(name => {
      if (typeof window[name] !== "function") return;
      const orig = window[name];
      window[name] = function () {
        if (isPM() && !PM_PERMISSIONS.end) { toast("end"); return; }
        return orig.apply(this, arguments);
      };
    });
    // last safety net: the save itself
    if (typeof window.sendBackendPost === "function") {
      const origSend = window.sendBackendPost;
      window.sendBackendPost = async function (payload) {
        if (isPM()) {
          const type = String((payload && (payload.type || payload.action)) || "").toUpperCase();
          for (const key of Object.keys(BLOCKED_SAVES)) {
            if (!PM_PERMISSIONS[key] && BLOCKED_SAVES[key].includes(type)) {
              toast(key);
              throw new Error(`${ROLE_LABEL} is not allowed to ${LABEL[key]}`);
            }
          }
        }
        return origSend.apply(this, arguments);
      };
    }
    // comments switch
    if (!PM_PERMISSIONS.comments) {
      document.addEventListener("contextmenu", e => { if (isPM() && e.target.closest("[data-board-kp], .stage-kanban-card, .active-card, .kanban-card")) e.stopImmediatePropagation(); }, true);
    }
  }

  function installHooks() {
    const main = document.body;
    new MutationObserver(muts => {
      if (muts.some(m => m.addedNodes.length)) { queueLock(); injectRoleOptions(); }
    }).observe(main, { childList: true, subtree: true });
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        queueLock(); injectRoleOptions();
        if (isPM()) document.body.classList.toggle("pm-no-drag", !PM_PERMISSIONS.end);
        return r;
      };
    }
  }

  try {
    injectStyle();
    injectRoleOptions();
    installTabAccess();
    installGuards();
    installHooks();
    window.PSPProductionManager = { permissions: PM_PERMISSIONS };
    console.log("[PSP] role-production-manager v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] role-production-manager failed to load:", err);
  }
})();
