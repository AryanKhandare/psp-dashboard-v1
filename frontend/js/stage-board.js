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
  const MODULE_VERSION = 1;

  let boardDragging = false; // pause board redraws while a card is being dragged

  // ===================== INSPECTION PAGE STAGE BOARD =====================
  // Turns the 5-column board on the Inspection page into a real stage board:
  // INSPECTION | MACHINING | MASKING | SPRAYING | GRINDING | POLISHING (jobs actually in each stage).
  const BOARD_COLUMNS = [
    { stage: "Inspection", tab: "inspection", cards: "cards-intake",           count: "count-intake" },
    { stage: "Machining",  tab: "machining",  cards: "cards-machining-stage",  count: "count-machining-stage" },
    { stage: "Masking",    tab: "masking",    cards: "cards-visual",           count: "count-visual" },
    { stage: "Spraying",   tab: "spraying",   cards: "cards-dimensional",      count: "count-dimensional" },
    { stage: "Grinding",   tab: "grinding",   cards: "cards-review",           count: "count-review" },
    { stage: "Polishing",  tab: "polishing",  cards: "cards-ready",            count: "count-ready" }
  ];

  function setupStageBoard() {
    const board = document.querySelector(".inspection-kanban-board");
    const first = $("cards-intake");
    if (!board || !first || $("cards-machining-stage")) return;
    board.style.gridTemplateColumns = "repeat(6, minmax(0, 1fr))";

    // Insert the MACHINING column right after INSPECTION
    const firstCol = first.closest(".kanban-column");
    const col = document.createElement("div");
    col.className = "kanban-column";
    col.setAttribute("data-status", "Machining");
    col.innerHTML = `<div class="kanban-column-header" style="border-color:#64748b;">
        <span class="column-title">MACHINING</span><span class="column-count" id="count-machining-stage">0</span></div>
      <div class="kanban-cards-container" id="cards-machining-stage"></div>`;
    firstCol.insertAdjacentElement("afterend", col);

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
      const push = e.target.closest("[data-board-push]");
      const open = e.target.closest("[data-board-open]");
      if (push && typeof triggerInspectionFloatingTransition === "function") triggerInspectionFloatingTransition(push.getAttribute("data-board-push"));
      if (open) window.location.hash = "#/" + open.getAttribute("data-board-open");
    });
  }

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
    const ref = snap.docs[0].ref;
    const data = snap.docs[0].data();
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

  function renderStageBoard() {
    if (!$("cards-machining-stage") || boardDragging) return;
    const ro = isReadOnly();
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      const cnt = $(c.count);
      if (!box) return;
      const list = allJobs().filter(j => j.currentDepartment === c.stage);
      if (cnt) cnt.textContent = list.length;
      if (!list.length) { box.innerHTML = `<div class="text-xs text-muted" style="text-align:center; padding:12px;">No jobs</div>`; return; }
      box.innerHTML = list.map(job => {
        const st = stageStatus(job, c.stage);
        const badge = st === "In Progress" ? "background:#3b82f6;" : (st === "Hold" ? "background:#ef4444;" : "background:#f97316;");
        const action = c.stage === "Inspection"
          ? (ro ? "" : `<button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:10px;" data-board-push="${esc(job.kpNumber)}">→ Move to Next Stage</button>`)
          : `<button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:10px;" data-board-open="${c.tab}">→ Open ${esc(c.stage)} Stage</button>`;
        const draggable = !ro;
        return `<div class="kanban-card" ${draggable ? `draggable="true" data-board-kp="${esc(job.kpNumber)}" style="cursor:grab;"` : ""}>
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
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; gap:4px;">
              ${action}
              ${c.stage === "Inspection" && typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}
            </div>
          </div>`;
      }).join("");
    });
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
