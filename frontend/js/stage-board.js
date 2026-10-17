/**
 * PSP MES – Inspection page stage board.
 *
 * Turns the board on the Inspection page into a live stage board:
 * INSPECTION | MACHINING | MASKING | SPRAYING | GRINDING | POLISHING.
 * Cards can be dragged to any column, forward or backward (rework reason + 10 s UNDO).
 * Saves board moves to Firebase (MOVE_STAGE).
 */
(function () {
  if (!window.PSP) { console.error("[PSP] stage-board: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 7;

  let boardDragging = false; // pause board redraws while a card is being dragged

  // ===================== INSPECTION PAGE STAGE BOARD =====================
  // Turns the 5-column board on the Inspection page into a real stage board:
  // INSPECTION | MACHINING | MASKING | SPRAYING | GRINDING | POLISHING (jobs actually in each stage).
  const BOARD_COLUMNS = [
    { stage: "Inspection", tab: "inspection", cards: "cards-intake",           count: "count-intake" },
    { stage: "Machining",  tab: "machining",  cards: "cards-machining-stage",  count: "count-machining-stage" },
    { stage: "Masking",    tab: "masking",    cards: "cards-visual",           count: "count-visual" },
    { stage: "Spraying",   tab: "spraying",   cards: "cards-dimensional",      count: "count-dimensional" },
    { stage: "Sealing",    tab: "sealing",    cards: "cards-sealing-stage",    count: "count-sealing-stage",  extra: { after: "cards-dimensional", color: "#0d9488" } },
    { stage: "Grinding",   tab: "grinding",   cards: "cards-review",           count: "count-review" },
    { stage: "Polishing",  tab: "polishing",  cards: "cards-ready",            count: "count-ready" },
    { stage: "Final Inspection", tab: "final-inspection", cards: "cards-final-stage", count: "count-final-stage", extra: { after: "cards-ready", color: "#0ea5e9" } },
    { stage: "Dispatch",   tab: "dispatch",   cards: "cards-dispatch-stage",   count: "count-dispatch-stage", extra: { after: "cards-final-stage", color: "#22c55e" } },
    { stage: "Outsourcing", tab: "outsourcing", cards: "cards-outsourcing-stage", count: "count-outsourcing-stage", extra: { after: "cards-dispatch-stage", color: "#a855f7" } }
  ];

  function setupStageBoard() {
    const board = document.querySelector(".inspection-kanban-board");
    const first = $("cards-intake");
    if (!board || !first || $("cards-machining-stage")) return;
    // 10 stages: each column keeps a readable width; the board scrolls sideways on smaller screens
    board.style.gridTemplateColumns = `repeat(${BOARD_COLUMNS.length}, minmax(210px, 1fr))`;
    board.style.overflowX = "auto";
    board.style.paddingBottom = "8px";

    // Insert the MACHINING column right after INSPECTION
    const firstCol = first.closest(".kanban-column");
    const col = document.createElement("div");
    col.className = "kanban-column";
    col.setAttribute("data-status", "Machining");
    col.innerHTML = `<div class="kanban-column-header" style="border-color:#64748b;">
        <span class="column-title">MACHINING</span><span class="column-count" id="count-machining-stage">0</span></div>
      <div class="kanban-cards-container" id="cards-machining-stage"></div>`;
    firstCol.insertAdjacentElement("afterend", col);

    // Insert SEALING, FINAL INSPECTION, DISPATCH and OUTSOURCING columns in stage order
    BOARD_COLUMNS.filter(c => c.extra).forEach(c => {
      const prev = $(c.extra.after);
      if (!prev || $(c.cards)) return;
      const ec = document.createElement("div");
      ec.className = "kanban-column";
      ec.setAttribute("data-status", c.stage);
      ec.innerHTML = `<div class="kanban-column-header" style="border-color:${c.extra.color};">
          <span class="column-title">${esc(c.stage.toUpperCase())}</span><span class="column-count" id="${c.count}">0</span></div>
        <div class="kanban-cards-container" id="${c.cards}"></div>`;
      prev.closest(".kanban-column").insertAdjacentElement("afterend", ec);
    });

    // Search bar above the board: KP No., JC No. or customer (filters every column)
    if (!$("board-search")) {
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:0 0 12px;";
      bar.innerHTML = `<input type="search" id="board-search" class="form-input" style="flex:1; min-width:220px; height:40px; font-size:14px;"
          placeholder="🔍 Search KP No., JC No. or customer name…" aria-label="Search the board by KP No., JC No. or customer" autocomplete="off">
        <button type="button" id="board-search-clear" class="btn btn-secondary btn-xs" style="height:40px; padding:0 14px;">Clear</button>
        <span id="board-search-info" class="text-xs text-muted"></span>`;
      board.parentNode.insertBefore(bar, board);
      $("board-search").addEventListener("input", () => renderStageBoard());
      $("board-search-clear").addEventListener("click", () => { $("board-search").value = ""; renderStageBoard(); });
    }

    // Stage names as column titles; switch off the old sub-step drag & drop
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      if (!box) return;
      const title = box.closest(".kanban-column").querySelector(".column-title");
      if (title) title.textContent = c.stage.toUpperCase();
      ["ondrop", "ondragover", "ondragleave"].forEach(a => box.removeAttribute(a));
    });

    // Drag an Inspection card onto another column = push the job to that stage
    board.addEventListener("dragstart", e => {
      const card = e.target.closest && e.target.closest("[data-board-kp]");
      if (!card) return;
      boardDragging = true;
      e.dataTransfer.setData("text/plain", card.getAttribute("data-board-kp"));
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    board.addEventListener("dragend", e => {
      const card = e.target.closest && e.target.closest("[data-board-kp]");
      if (card) card.classList.remove("dragging");
      board.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      boardDragging = false;
      setTimeout(() => { try { renderStageBoard(); } catch (err) {} }, 50);
    });
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      if (!box) return;
      const column = box.closest(".kanban-column");
      column.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        box.classList.add("drag-over");
      });
      column.addEventListener("dragleave", e => {
        if (!column.contains(e.relatedTarget)) box.classList.remove("drag-over");
      });
      column.addEventListener("drop", e => {
        e.preventDefault();
        box.classList.remove("drag-over");
        boardDragging = false;
        const kp = e.dataTransfer.getData("text/plain");
        console.log("[Machining] Board drop:", kp, "→", c.stage);
        const job = kp && allJobs().find(j => j.kpNumber === kp);
        if (!job || job.currentDepartment === c.stage) return;
        if (job.currentDepartment === "Inspection") pushFromInspection(job, c.stage);
        else moveJobOnBoard(job, c.stage);
      });
    });

    board.addEventListener("click", e => {
      if (!e.target.closest("button, a, input, select")) {
        const card = e.target.closest("[data-board-kp]");
        if (card) { openJobInStage(card.getAttribute("data-board-kp")); return; }
      }
      const push = e.target.closest("[data-board-push]");
      const open = e.target.closest("[data-board-open]");
      if (push && typeof triggerInspectionFloatingTransition === "function") triggerInspectionFloatingTransition(push.getAttribute("data-board-push"));
      if (open) window.location.hash = "#/" + open.getAttribute("data-board-open");
    });
  }

  // ---------- Click a board card → go to that job in its stage ----------
  const STAGE_VIEWS = {
    "Machining":        { hash: "machining",        sub: '#tab-machining [data-subtab="machining-subtab-queue"]', filter: "machining-filter-kp", box: "machining-queue-cards" },
    "Masking":          { hash: "masking",          sub: '[data-subtab="masking-subtab-queue"]',                   filter: "filter-kp",           box: "masking-queue-cards" },
    "Spraying":         { hash: "spraying",         sub: '[data-subtab="spraying-subtab-queue"]',                  filter: "spraying-filter-kp",  box: "spraying-queue-cards" },
    "Sealing":          { hash: "sealing",          sub: '#tab-sealing [data-subtab="sealing-subtab-queue"]',      filter: "sealing-filter-kp",   box: "sealing-queue-cards" },
    "Grinding":         { hash: "grinding",         sub: '[data-subtab="grinding-subtab-queue"]',                  filter: "grinding-filter-kp",  box: "grinding-queue-cards" },
    "Polishing":        { hash: "polishing",        sub: '#tab-polishing [data-subtab="polishing-mod-queue"]',     filter: "polishing-mod-filter-kp", box: "polishing-mod-queue-cards" },
    "Final Inspection": { hash: "final-inspection", sub: null,                                                     filter: "final-filter-kp",     box: "final-inspection-queue-cards" },
    "Dispatch":         { hash: "dispatch",         sub: '[data-dsp-sub="dispatch-sub-queue"]',                    filter: null,                  box: "dispatch-queue-cards" },
    "Outsourcing":      { hash: "outsourcing",      sub: '[data-out-subtab="out-subtab-queue"]',                   filter: "out-filter-text",     box: "out-queue-cards" }
  };

  function injectFocusStyle() {
    if ($("psp-focus-css")) return;
    const st = document.createElement("style");
    st.id = "psp-focus-css";
    st.textContent = `@keyframes pspFocusGlow { 0%,100% { box-shadow:0 0 0 3px #f59e0b, 0 0 18px rgba(245,158,11,.65); } 50% { box-shadow:0 0 0 5px #f59e0b, 0 0 28px rgba(245,158,11,.9); } }
      .psp-job-focus { animation: pspFocusGlow 1s ease-in-out 4; outline:3px solid #f59e0b; outline-offset:2px; border-radius:8px; }`;
    document.head.appendChild(st);
  }

  function focusCard(el) {
    document.querySelectorAll(".psp-job-focus").forEach(x => x.classList.remove("psp-job-focus"));
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    el.classList.add("psp-job-focus");
    setTimeout(() => el.classList.remove("psp-job-focus"), 6000);
  }

  function openJobInStage(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    injectFocusStyle();
    const stage = job.currentDepartment;
    if (stage === "Inspection") {             // already on this page: just highlight it on the board
      const el = document.querySelector(`.inspection-kanban-board [data-board-kp="${CSS.escape(kp)}"]`);
      if (el) focusCard(el);
      return;
    }
    const view = STAGE_VIEWS[stage];
    if (!view) return;
    const label = kpLabel(job).toUpperCase();
    const cleanKp = String((typeof getCleanKpNumber === "function") ? getCleanKpNumber(job.kpNumber) : job.kpNumber).toUpperCase();
    window.location.hash = "#/" + view.hash;

    let tries = 0, filtered = false;
    const attempt = () => {
      tries++;
      if (view.sub) { const b = document.querySelector(view.sub); if (b && !b.classList.contains("active")) b.click(); }
      const box = $(view.box);
      const cards = box ? [...box.querySelectorAll(".stage-kanban-card")] : [];
      const head = c => { const h = c.querySelector(".job-card-header .font-mono, .job-card-header span"); return (h ? h.textContent : c.textContent).replace(/\s+/g, " ").trim().toUpperCase(); };
      const match = cards.find(c => head(c) === label) || cards.find(c => head(c).startsWith(cleanKp));
      if (match) { focusCard(match); return; }
      // not visible (a filter may hide it): search that stage for this KP, then look again
      if (!filtered && tries >= 3 && view.filter && $(view.filter)) {
        filtered = true;
        const f = $(view.filter);
        f.value = cleanKp;
        f.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (tries < 15) setTimeout(attempt, 200);
    };
    setTimeout(attempt, 150);
  }
  window.PSPOpenJob = openJobInStage;

  function pushFromInspection(job, targetStage) {
    if (typeof applyStageTransitionWithUndo !== "function") {
      if (typeof triggerInspectionFloatingTransition === "function") triggerInspectionFloatingTransition(job.kpNumber);
      return;
    }
    const operator = (typeof getLoggedUser === "function" && getLoggedUser() && getLoggedUser().name) || ((user() && user().email) || "Inspector");
    window.pendingTransition = {
      job: job,
      stage: "Inspection",
      payloadGenerator: nextStage => ({
        type: "APPROVE_JOB", kpNo: job.kpNumber, stage: "Inspection",
        nextStage: nextStage, operatorName: operator, time: new Date().toISOString()
      }),
      applyLocalMutation: nextStage => {
        if (typeof transitionToStage === "function") transitionToStage(job, nextStage, operator);
        else { job.currentDepartment = nextStage; job.status = "Pending"; }
      }
    };
    applyStageTransitionWithUndo(targetStage);
  }

  // Move a job from any stage to any other stage (forward or backward) from the board
  function moveJobOnBoard(job, targetStage) {
    if (typeof applyStageTransitionWithUndo !== "function") return;
    const fromStage = job.currentDepartment;
    const fromKey = stageKeyOf(fromStage);
    const fromData = job[fromKey] || {};
    const running = fromData.status === "In Progress" || fromData.status === "Hold";
    if (running && !confirm(`${job.kpNumber} is currently ${fromData.status} in ${fromStage}.\nMoving it will stop that cycle.\n\nMove to ${targetStage} anyway?`)) return;

    const operator = (typeof getLoggedUser === "function" && getLoggedUser() && getLoggedUser().name) || ((user() && user().email) || "Supervisor");
    window.pendingTransition = {
      job: job,
      stage: fromStage,
      payloadGenerator: nextStage => ({
        type: "MOVE_STAGE", kpNo: job.kpNumber, stage: fromStage, nextStage: nextStage,
        operatorName: operator, stopRunningCycle: running, time: new Date().toISOString()
      }),
      applyLocalMutation: nextStage => {
        if (running && job[fromKey]) { job[fromKey].status = "Pending"; job[fromKey].lastStartedAt = null; }
        if (typeof transitionToStage === "function") transitionToStage(job, nextStage, operator);
        else { job.currentDepartment = nextStage; job.status = "Pending"; }
        if (window.PSPMachining) window.PSPMachining.clearSelection(job.kpNumber);
      }
    };
    applyStageTransitionWithUndo(targetStage);
  }

  // Firebase save for MOVE_STAGE (the app's own save function has no "move anywhere" step)
  async function saveMoveStage(payload) {
    const db = firebase.firestore();
    const snap = await db.collection("jobs").where("kpNumber", "==", payload.kpNo).get();
    if (snap.empty) throw new Error(`Job ${payload.kpNo} not found`);
    // Several documents can share a KP number (e.g. an old deleted copy). Always move the live one.
    const live = snap.docs.find(d => d.data().isDeleted !== true) || snap.docs[0];
    const ref = live.ref;
    const data = live.data();
    const nowIso = new Date().toISOString();
    const target = payload.nextStage;
    const tKey = stageKeyOf(target);
    const fKey = stageKeyOf(payload.stage);

    const targetData = Object.assign({}, data[tKey] || {}, {
      status: target === "Dispatched" ? "Completed" : "Pending",
      queueEntryTime: nowIso, lastStartedAt: null, startTime: null, endTime: null,
      activeTimeMs: 0, holdHistory: []
    });
    if (tKey === "masking" && !Array.isArray(targetData.materials)) targetData.materials = [];

    const updates = {
      currentStage: target,
      currentStatus: target === "Dispatched" ? "Completed" : "Pending",
      assignedOperator: null,
      shift: "",
      splitRemark: "",
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      [tKey]: targetData,
      [`stageAssignedAt.${String(target).toLowerCase().replace(/[^a-z]/g, "")}`]: nowIso
    };
    if (payload.stopRunningCycle && fKey && fKey !== tKey && data[fKey]) {
      updates[fKey] = Object.assign({}, data[fKey], { status: "Pending", lastStartedAt: null });
    }
    if (payload.reworkReasonCategory) {
      updates.lastRework = { from: payload.stage, to: target, reason: payload.reworkReasonCategory,
                             comments: payload.reworkReasonComments || "", by: payload.operatorName || "", time: nowIso };
    }
    await ref.update(updates);
    return { success: true };
  }

  function stageStatus(job, stage) {
    const key = stage.toLowerCase().replace(/[^a-z]/g, "");
    return (job[key] && job[key].status) || job.status || "Pending";
  }

  // Planned dates from the Q2P sheet: Pre-Inspection Planned (col X) and Final Inspection Planned (col AL)
  const planDate = v => {
    if (!v) return null;
    const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(String(v).length === 10 ? v + "T00:00:00" : v);
    return isNaN(d.getTime()) ? null : d;
  };
  const planText = d => d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    ((d.getHours() || d.getMinutes()) ? " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "") : "—";
  // Inspection column only: Pre-Inspection Planned (Q2P col X). Final Inspection Planned is shown on the FIR stage cards.
  function plannedRows(job, stage) {
    if (stage !== "Inspection") return "";
    const pre = (window.PSP.plannedFor ? window.PSP.plannedFor(job).pre : planDate(job.inspectionDate));
    const late = pre && pre < new Date();
    return `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(148,163,184,0.35); font-size:10.5px; line-height:1.4;">
        <div class="text-muted">Pre Insp. Planned</div>
        <div class="font-mono" style="white-space:nowrap; ${late ? "color:#ef4444; font-weight:800;" : "font-weight:700;"}" title="${late ? "Pre-inspection planned time has passed" : ""}">${window.PSP.fmtDateTime ? window.PSP.fmtDateTime(pre) : planText(pre)}</div></div>`;
  }

  function boardMatches(job, q) {
    if (!q) return true;
    const jc = (typeof getJobJcNo === "function") ? getJobJcNo(job) : (job.jcNo || "");
    const clean = (typeof getCleanKpNumber === "function") ? getCleanKpNumber(job.kpNumber) : job.kpNumber;
    return [job.kpNumber, clean, jc, job.customer, job.partName].some(v => String(v || "").toLowerCase().includes(q));
  }

  function renderStageBoard() {
    if (!$("cards-machining-stage") || boardDragging) return;
    const ro = isReadOnly();
    const q = String(($("board-search") || {}).value || "").trim().toLowerCase();
    let shown = 0, total = 0;
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      const cnt = $(c.count);
      if (!box) return;
      const all = allJobs().filter(j => j.currentDepartment === c.stage);
      const list = all.filter(j => boardMatches(j, q));
      total += all.length; shown += list.length;
      if (cnt) cnt.textContent = q ? `${list.length}/${all.length}` : all.length;
      if (!list.length) { box.innerHTML = `<div class="text-xs text-muted" style="text-align:center; padding:12px;">${q ? "No match" : "No jobs"}</div>`; return; }
      box.innerHTML = list.map(job => {
        const st = stageStatus(job, c.stage);
        const badge = st === "In Progress" ? "background:#3b82f6;" : (st === "Hold" ? "background:#ef4444;" : "background:#f97316;");
        const action = c.stage === "Inspection"
          ? (ro ? "" : `<button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:10px;" data-board-push="${esc(job.kpNumber)}">→ Move to Next Stage</button>`)
          : `<button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:10px;" data-board-open="${c.tab}">→ Open ${esc(c.stage)} Stage</button>`;
        const draggable = !ro;
        return `<div class="kanban-card" data-board-kp="${esc(job.kpNumber)}" ${draggable ? `draggable="true" style="cursor:pointer;"` : `style="cursor:pointer;"`} title="Click to open in ${esc(c.stage)}">
            <div class="kanban-card-header">
              <span class="kanban-card-kp">${esc(kpLabel(job))}</span>
              <span class="kanban-card-priority ${esc(String(job.priority || "Normal").toLowerCase())}" title="Priority: ${esc(job.priority || "Normal")}"></span>
            </div>
            <div class="kanban-card-part">${esc(job.partName || "—")}</div>
            <div class="kanban-card-cust">${esc(job.customer || "—")}</div>
            <div class="kanban-card-footer">
              <span class="kanban-card-qty">${esc(job.quantity || "—")} pcs</span>
              <span style="font-size:10px; font-weight:700; padding:2px 10px; border-radius:4px; color:#fff; ${badge}">${esc(String(st).toUpperCase())}</span>
            </div>
            ${plannedRows(job, c.stage)}
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; gap:4px;">
              ${action}
              ${c.stage === "Inspection" && typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}
            </div>
          </div>`;
      }).join("");
    });
    const info = $("board-search-info");
    if (info) info.textContent = q ? `${shown} of ${total} jobs match "${q}"` : "";
  }

  // ===================== HOOKS =====================
  function installHooks() {
    // Board moves (MOVE_STAGE) are saved here; every other save goes to the app's normal save function
    if (typeof window.sendBackendPost === "function") {
      const origSend = window.sendBackendPost;
      window.sendBackendPost = async function (payload) {
        const type = String((payload && (payload.type || payload.action)) || "").toUpperCase().replace(/_/g, "");
        if (type === "MOVESTAGE") {
          if (typeof isMockMode === "function" && isMockMode()) return { success: true };
          return saveMoveStage(payload);
        }
        return origSend.apply(this, arguments);
      };
    }

    // Inspection page board shows the real stages (keeps the admin tracking table from the original)
    if (typeof window.renderInspectionDashboard === "function") {
      const orig = window.renderInspectionDashboard;
      window.renderInspectionDashboard = function () {
        const r = orig.apply(this, arguments);
        try { renderStageBoard(); } catch (e) { console.warn("[Stage Board] render error:", e); }
        return r;
      };
    }
  }

  // ===================== BOOT =====================
  try {
    setupStageBoard();
    installHooks();
    console.log("[PSP] stage-board v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] stage-board failed to load:", err);
  }
})();
