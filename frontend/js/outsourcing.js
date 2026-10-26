/**
 * PSP MES – Outsourcing (jobs sent to an outside vendor, from any stage, back to any stage).
 *
 *  - "🏭 Outsourcing" target on the Select Next Stage screen and in every Next Department list.
 *  - The stage a job came from is remembered (outsourcing.fromStage).
 *  - Outsourcing tab: Queue (Send to Vendor → At Vendor → Receive Back) and History (all trips).
 *    Send to Vendor: vendor, work, DC/Challan No., qty sent, sent date, expected return date, remarks.
 *    Receive Back: qty received, received date, remarks, "Send job to" any stage (suggests the stage it came from).
 *  - Overdue = expected return date passed while At Vendor.
 *  - Firebase: job.outsourcing (current trip) + job.outsourcingTrips (all trips, added on receive).
 *
 * Load after stage-board.js (uses its MOVE_STAGE save) and the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] outsourcing: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, kpLabel, qtyLabel } = window.PSP;
  const MODULE_VERSION = 6;

  const STAGE = "Outsourcing";
  // Inspectors (Inspection-department operators) who may also use the Outsourcing tab, by login name
  const OUTSOURCING_INSPECTORS = ["MF", "VG", "SJ", "Laxmi", "JN"];
  const RETURN_STAGES = ["Inspection", "Machining", "Masking", "Blasting", "Spraying", "Sealing", "Grinding", "Polishing", "Final Inspection", "Dispatch", "Quarantine"];
  const WORK_SUGGESTIONS = ["Machining", "Grinding", "Heat Treatment", "Plating", "Coating", "Welding", "Balancing", "Polishing", "Testing"];
  let activeSubtab = "out-subtab-queue";

  // ---------- helpers ----------
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const parseDay = v => { if (!v) return null; const d = new Date(String(v).length === 10 ? v + "T00:00:00" : v); return isNaN(d.getTime()) ? null : d; };
  const fmtDay = v => { const d = parseDay(v); return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"; };
  const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b.toDateString()) - new Date(a.toDateString())) / 86400000));
  const me = () => { const u = user() || {}; return u.name || u.email || "User"; };
  const outOf = job => job.outsourcing && typeof job.outsourcing === "object" ? job.outsourcing : {};
  // A trip's state: "Pending" (waiting to send), "At Vendor", "Returned" (received, still to be moved on)
  const stateOf = job => { const o = outOf(job); return ["At Vendor", "Returned"].includes(o.status) ? o.status : "Pending"; };
  const isOverdue = job => { const o = outOf(job); const exp = parseDay(o.expectedReturn); return stateOf(job) === "At Vendor" && exp && exp < new Date(new Date().toDateString()); };
  const outJobs = () => allJobs().filter(j => j.currentDepartment === STAGE);

  function audit(kp, text) { try { if (typeof createAuditLog === "function") createAuditLog((user() || {}).email || me(), kp, text); } catch (e) {} }
  async function saveJob(job, update) {
    if (typeof isMockMode === "function" && isMockMode()) return;
    const db = firebase.firestore();
    const ref = job.id ? db.collection("jobs").doc(job.id) : db.collection("jobs").doc("job_" + job.kpNumber);
    await ref.update(Object.assign({ lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, update));
  }

  // ---------- live Firebase copy of outsourcing fields (the app's job loader does not keep them) ----------
  const fsOut = new Map();   // KP -> { outsourcing, outsourcingTrips }
  let fsStarted = false;
  function applyFirebase() {
    allJobs().forEach(job => {
      const f = fsOut.get(job.kpNumber);
      if (!f) return;
      if (f.outsourcing && (!job.outsourcing || !job.outsourcing._local)) job.outsourcing = JSON.parse(JSON.stringify(f.outsourcing));
      if (Array.isArray(f.outsourcingTrips)) job.outsourcingTrips = f.outsourcingTrips;
    });
  }
  function startListeners() {
    if (fsStarted) return;
    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return;
    if (typeof isMockMode === "function" && isMockMode()) return;
    let au = null; try { au = firebase.auth().currentUser; } catch (e) { return; }
    if (!au || au.isAnonymous) return;
    fsStarted = true;
    const db = firebase.firestore();
    const onSnap = snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (!d.kpNumber) return;
        fsOut.set(d.kpNumber, { outsourcing: d.outsourcing || null, outsourcingTrips: d.outsourcingTrips || [] });
      });
      applyFirebase();
      if (typeof renderAll === "function") renderAll();
    };
    const onErr = e => console.warn("[Outsourcing] listener:", e && e.message ? e.message : e);
    db.collection("jobs").where("currentStage", "==", STAGE).onSnapshot(onSnap, onErr);
    db.collection("jobs").where("outsourcing.status", "==", "Returned").onSnapshot(onSnap, onErr);
  }

  // ===================== UI: sidebar, tab, modals, stage targets =====================
  function injectSidebar() {
    const after = $("nav-btn-dispatch");
    if (!after || $("nav-btn-outsourcing")) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id = "nav-btn-outsourcing";
    btn.setAttribute("data-tab", "tab-outsourcing");
    btn.innerHTML = `<span class="stage-num">OUT</span><span class="stage-name">Outsourcing</span>
                     <span class="stage-badge badge-pending" id="badge-count-outsourcing">0</span>`;
    btn.addEventListener("click", () => { window.location.hash = "#/outsourcing"; });
    after.insertAdjacentElement("afterend", btn);
  }

  function injectStageTargets() {
    // Select Next Stage screen
    const dispatchZone = $("target-zone-dispatch");
    if (dispatchZone && !$("target-zone-outsourcing")) {
      const z = document.createElement("div");
      z.className = "drop-target-stage";
      z.id = "target-zone-outsourcing";
      z.setAttribute("data-target-stage", STAGE);
      z.innerHTML = `<span class="drop-icon">🏭</span><span class="drop-label">Outsourcing</span>`;
      dispatchZone.insertAdjacentElement("afterend", z);
    }
    // Next Department lists
    ["spraying-complete-next-process", "grinding-complete-next-process", "masking-complete-next-process",
     "masking-next-process", "no-masking-next-process"].forEach(id => {
      const s = $(id);
      if (!s || s.querySelector(`option[value="${STAGE}"]`)) return;
      const o = document.createElement("option"); o.value = STAGE; o.textContent = STAGE; s.appendChild(o);
    });
  }

  function injectTab() {
    const main = document.querySelector(".mes-main-content");
    if (!main || $("tab-outsourcing")) return;
    const sec = document.createElement("section");
    sec.id = "tab-outsourcing";
    sec.className = "tab-pane";
    sec.innerHTML = `
      <div class="masking-dashboard-header"><div class="section-title-wrapper">
        <h2>OUTSOURCING CONTROL PANEL</h2>
        <p class="section-desc">Jobs sent to outside vendors from any stage: send, track the return date, receive back into any stage.</p>
      </div></div>
      <div class="grinding-kpis-grid" style="grid-template-columns:repeat(4,1fr); margin-bottom:20px;">
        <div class="metric-card"><span class="metric-val text-orange" id="out-kpi-waiting">0</span><span class="metric-lbl">Waiting to Send</span></div>
        <div class="metric-card"><span class="metric-val text-blue" id="out-kpi-vendor">0</span><span class="metric-lbl">At Vendor</span></div>
        <div class="metric-card"><span class="metric-val" id="out-kpi-overdue" style="color:#ef4444;">0</span><span class="metric-lbl">Overdue</span></div>
        <div class="metric-card"><span class="metric-val text-green" id="out-kpi-returned">0</span><span class="metric-lbl">Returned (30 days)</span></div>
      </div>
      <div class="grinding-tabs-nav">
        <button type="button" class="machining-tab-btn active" data-out-subtab="out-subtab-queue"><span class="subtab-icon">📋</span><span class="subtab-label">Queue</span></button>
        <button type="button" class="machining-tab-btn" data-out-subtab="out-subtab-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>
      </div>
      <div id="out-subtab-queue" class="machining-subtab-panel active">
        <div class="panel">
          <div class="panel-header"><h3>JOBS IN OUTSOURCING</h3><span class="panel-subtitle">Waiting to send, at vendor, or received back.</span></div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="out-filter-text">Search:</label><input type="text" id="out-filter-text" class="form-input input-sm" placeholder="KP, JC, customer, vendor..."></div>
              <div class="filter-group"><label for="out-filter-state">Status:</label>
                <select id="out-filter-state" class="form-input select-sm"><option value="">All</option><option value="Pending">Waiting to send</option>
                  <option value="At Vendor">At vendor</option><option value="overdue">Overdue only</option><option value="Returned">Received back</option></select></div>
              <button id="out-filter-clear" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div id="out-queue-cards" class="queue-cards-grid"></div>
          </div>
        </div>
      </div>
      <div id="out-subtab-history" class="machining-subtab-panel">
        <div class="panel">
          <div class="panel-header"><h3>OUTSOURCING HISTORY (ALL TRIPS)</h3></div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="out-hist-text">Search:</label><input type="text" id="out-hist-text" class="form-input input-sm" placeholder="KP, customer, vendor, DC no..."></div>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table mt-1">
                <thead><tr><th>KP Number</th><th>Part Name</th><th>Customer</th><th>From Stage</th><th>Vendor</th><th>Work</th><th>DC No.</th>
                  <th>Qty Sent</th><th>Sent On</th><th>Qty Received</th><th>Received On</th><th>Days at Vendor</th><th>Returned To</th></tr></thead>
                <tbody id="out-history-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;
    main.appendChild(sec);
  }

  function injectModals() {
    if ($("out-modal-send")) return;
    const wrap = document.createElement("div");
    const fld = (id, label, req, ctl) => `<div class="form-group"><label for="${id}" style="font-weight:bold; margin-bottom:5px; display:block;">${label}${req ? " *" : ""}</label>${ctl}</div>`;
    const css = 'class="form-input" style="height:48px; font-size:16px; width:100%;"';
    wrap.innerHTML = `
      <div id="out-modal-send" class="modal-overlay"><div class="modal-content">
        <div class="modal-header"><h3>Send to Vendor</h3><button type="button" class="modal-close" data-out-close="out-modal-send">&times;</button></div>
        <div class="modal-body">
          <p>Send <strong id="out-send-kp" class="text-cyan"></strong> <span id="out-send-from" class="text-muted text-xs"></span> to an outside vendor.</p>
          <form id="out-send-form" class="industrial-form mt-1">
            ${fld("out-vendor", "Vendor Name", true, `<input id="out-vendor" list="out-vendor-list" ${css} required autocomplete="off" placeholder="Type or pick a vendor"><datalist id="out-vendor-list"></datalist>`)}
            ${fld("out-work", "Work / Process Sent For", true, `<input id="out-work" list="out-work-list" ${css} required autocomplete="off"><datalist id="out-work-list">${WORK_SUGGESTIONS.map(w => `<option value="${esc(w)}"></option>`).join("")}</datalist>`)}
            <div class="form-grid">
              ${fld("out-dc", "DC / Challan No.", true, `<input id="out-dc" ${css} required>`)}
              ${fld("out-qty", "Qty Sent", true, `<input id="out-qty" type="number" min="1" step="1" ${css} required>`)}
            </div>
            <div class="form-grid">
              ${fld("out-sent", "Sent Date", true, `<input id="out-sent" type="date" ${css} required>`)}
              ${fld("out-expected", "Expected Return Date", true, `<input id="out-expected" type="date" ${css} required>`)}
            </div>
            ${fld("out-remarks", "Remarks", false, `<input id="out-remarks" ${css}>`)}
            <div class="form-actions mt-1" style="flex-direction:column; gap:12px;">
              <button type="submit" class="btn btn-success btn-tablet-primary" style="height:56px; font-size:17px;">Send to Vendor</button>
              <button type="button" class="btn btn-secondary modal-cancel-btn" data-out-close="out-modal-send" style="height:52px; width:100%;">Cancel</button>
            </div>
          </form>
        </div></div></div>

      <div id="out-modal-receive" class="modal-overlay"><div class="modal-content">
        <div class="modal-header"><h3>Receive Back from Vendor</h3><button type="button" class="modal-close" data-out-close="out-modal-receive">&times;</button></div>
        <div class="modal-body">
          <p id="out-recv-info"></p>
          <form id="out-receive-form" class="industrial-form mt-1">
            <div class="form-grid">
              ${fld("out-rqty", "Qty Received", true, `<input id="out-rqty" type="number" min="0" step="1" ${css} required>`)}
              ${fld("out-rdate", "Received Date", true, `<input id="out-rdate" type="date" ${css} required>`)}
            </div>
            ${fld("out-rremarks", "Remarks (condition, shortfall…)", false, `<input id="out-rremarks" ${css}>`)}
            ${fld("out-rnext", "Send job to", true, `<select id="out-rnext" ${css} required>${opts(RETURN_STAGES)}</select>`)}
            <div id="out-rnext-hint" class="text-xs text-muted" style="margin-top:-6px;"></div>
            <div class="form-actions mt-1" style="flex-direction:column; gap:12px;">
              <button type="submit" id="out-receive-submit" class="btn btn-success btn-tablet-primary" style="height:56px; font-size:17px;">Receive &amp; Move</button>
              <button type="button" class="btn btn-secondary modal-cancel-btn" data-out-close="out-modal-receive" style="height:52px; width:100%;">Cancel</button>
            </div>
          </form>
        </div></div></div>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== RENDER =====================
  function renderKpis() {
    const list = outJobs();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("out-kpi-waiting", list.filter(j => stateOf(j) === "Pending").length);
    set("out-kpi-vendor", list.filter(j => stateOf(j) === "At Vendor").length);
    set("out-kpi-overdue", list.filter(isOverdue).length);
    const cutoff = Date.now() - 30 * 86400000;
    set("out-kpi-returned", allTrips().filter(t => { const d = parseDay(t.receivedAt); return d && d.getTime() >= cutoff; }).length);
    const b = $("badge-count-outsourcing"); if (b) b.textContent = list.length;
  }

  function renderQueue() {
    const box = $("out-queue-cards");
    if (!box) return;
    const q = ($("out-filter-text").value || "").toLowerCase();
    const st = $("out-filter-state").value;
    const list = outJobs().filter(j => {
      const o = outOf(j), s = stateOf(j);
      if (st === "overdue" ? !isOverdue(j) : (st && s !== st)) return false;
      const jc = (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || "");
      if (q && ![j.kpNumber, jc, j.customer, j.partName, o.vendor, o.dcNo].some(v => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (isOverdue(b) - isOverdue(a)) || String(outOf(a).expectedReturn || "9").localeCompare(String(outOf(b).expectedReturn || "9")));
    if (!list.length) { box.innerHTML = `<div class="no-selection-message" style="grid-column:1 / -1; width:100%;">No jobs in Outsourcing.</div>`; return; }
    const ro = isReadOnly();
    box.innerHTML = list.map(job => {
      const o = outOf(job), s = stateOf(job), late = isOverdue(job);
      const badge = s === "At Vendor" ? (late ? `<span class="badge" style="background:#ef4444; color:#fff; font-size:10px;">OVERDUE</span>` : `<span class="badge badge-progress" style="font-size:10px;">AT VENDOR</span>`)
        : s === "Returned" ? `<span class="badge badge-completed" style="font-size:10px;">RECEIVED</span>` : `<span class="badge badge-pending" style="font-size:10px;">WAITING TO SEND</span>`;
      const daysOut = s === "At Vendor" && parseDay(o.sentAt) ? daysBetween(parseDay(o.sentAt), new Date()) : null;
      const rows = [];
      rows.push(["From Stage", esc(o.fromStage || "—")]);
      if (s !== "Pending") {
        rows.push(["Vendor", `<strong>${esc(o.vendor || "—")}</strong>`], ["Work", esc(o.work || "—")], ["DC No.", esc(o.dcNo || "—")],
                  ["Qty Sent", esc(o.qtySent || "—")], ["Sent On", fmtDay(o.sentAt)],
                  ["Expected Back", `<span style="${late ? "color:#ef4444; font-weight:800;" : ""}">${fmtDay(o.expectedReturn)}</span>`]);
        if (daysOut !== null) rows.push(["Days at Vendor", `<span class="font-mono">${daysOut} d</span>`]);
      }
      const action = ro ? "" : s === "Pending"
        ? `<button class="btn btn-success btn-xs" style="width:100%; height:34px;" data-out-send="${esc(job.kpNumber)}">SEND TO VENDOR</button>`
        : s === "At Vendor"
          ? `<button class="btn btn-primary btn-xs" style="width:100%; height:34px;" data-out-receive="${esc(job.kpNumber)}">RECEIVE BACK</button>`
          : `<button class="btn btn-primary btn-xs" style="width:100%; height:34px;" data-out-receive="${esc(job.kpNumber)}">MOVE TO STAGE</button>`;
      return `<div class="stage-kanban-card"${late ? ' style="border:2px solid #ef4444;"' : ""}>
          <div class="stage-card-priority-strip ${esc(String(job.priority || "Normal").toLowerCase())}"></div>
          <div class="job-card-header" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="font-mono font-bold text-cyan" style="font-size:14px;">${esc(kpLabel(job))}</span>${badge}</div>
          <div class="job-card-body" style="font-size:12px; display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
            <div class="job-card-row"><span class="job-card-label">Part Name:</span><span class="job-card-value">${esc(job.partName)}</span></div>
            <div class="job-card-row"><span class="job-card-label">Customer:</span><span class="job-card-value">${esc(job.customer)}</span></div>
            <div class="job-card-row"><span class="job-card-label">Quantity:</span><span class="job-card-value font-mono">${qtyLabel(job)}</span></div>
            ${rows.map(r => `<div class="job-card-row"><span class="job-card-label">${r[0]}:</span><span class="job-card-value">${r[1]}</span></div>`).join("")}
          </div>
          <div class="stage-card-actions" style="border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; display:flex; flex-direction:column; gap:8px;">${action}${typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}</div>
        </div>`;
    }).join("");
  }

  function allTrips() {
    const out = [];
    allJobs().forEach(j => (Array.isArray(j.outsourcingTrips) ? j.outsourcingTrips : []).forEach(t => out.push(Object.assign({ job: j }, t))));
    return out.sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  }

  function renderHistory() {
    const tbody = $("out-history-body");
    if (!tbody) return;
    const q = ($("out-hist-text").value || "").toLowerCase();
    const list = allTrips().filter(t => !q || [t.job.kpNumber, t.job.customer, t.vendor, t.dcNo, t.work].some(v => String(v || "").toLowerCase().includes(q)));
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="13" class="text-center text-muted">No outsourcing trips recorded yet.</td></tr>`; return; }
    tbody.innerHTML = list.map(t => {
      const s = parseDay(t.sentAt), r = parseDay(t.receivedAt);
      return `<tr><td class="font-mono font-bold text-cyan">${esc(t.job.kpNumber)}</td><td>${esc(t.job.partName)}</td><td>${esc(t.job.customer)}</td>
        <td>${esc(t.fromStage || "—")}</td><td><strong>${esc(t.vendor || "—")}</strong></td><td>${esc(t.work || "—")}</td><td>${esc(t.dcNo || "—")}</td>
        <td class="font-mono">${esc(t.qtySent || "—")}</td><td style="white-space:nowrap;">${fmtDay(t.sentAt)}</td>
        <td class="font-mono">${esc(t.qtyReceived === undefined ? "—" : t.qtyReceived)}</td><td style="white-space:nowrap;">${fmtDay(t.receivedAt)}</td>
        <td class="font-mono">${s && r ? daysBetween(s, r) + " d" : "—"}</td><td><strong>${esc(t.returnedTo || "—")}</strong></td></tr>`;
    }).join("");
  }

  function render() {
    renderKpis();
    const pane = $("tab-outsourcing");
    if (!pane || !pane.classList.contains("active")) return;
    if (activeSubtab === "out-subtab-queue") renderQueue(); else renderHistory();
  }

  // ===================== ACTIONS =====================
  const openModal = id => $(id).classList.add("active");
  const closeModal = id => $(id).classList.remove("active");
  let current = null;

  function openSend(kp) {
    const job = allJobs().find(j => j.kpNumber === kp); if (!job) return;
    current = job;
    const o = outOf(job);
    $("out-send-kp").textContent = kpLabel(job);
    $("out-send-from").textContent = o.fromStage ? `(from ${o.fromStage})` : "";
    const vendors = [...new Set(allTrips().map(t => t.vendor).concat(outJobs().map(j => outOf(j).vendor)).filter(Boolean))].sort();
    $("out-vendor-list").innerHTML = vendors.map(v => `<option value="${esc(v)}"></option>`).join("");
    $("out-vendor").value = ""; $("out-work").value = ""; $("out-dc").value = ""; $("out-remarks").value = "";
    $("out-qty").value = job.quantity || ""; $("out-qty").max = job.quantity || "";
    $("out-sent").value = today();
    const exp = new Date(); exp.setDate(exp.getDate() + 7);
    $("out-expected").value = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, "0")}-${String(exp.getDate()).padStart(2, "0")}`;
    openModal("out-modal-send");
  }

  async function submitSend(e) {
    e.preventDefault();
    const job = current; if (!job) return;
    const v = id => String($(id).value || "").trim();
    if (!v("out-vendor") || !v("out-work") || !v("out-dc") || !v("out-qty") || !v("out-sent") || !v("out-expected")) { alert("Please fill in all required fields."); return; }
    if (v("out-expected") < v("out-sent")) { alert("Expected return date cannot be before the sent date."); return; }
    const o = Object.assign({}, outOf(job), {
      status: "At Vendor", vendor: v("out-vendor"), work: v("out-work"), dcNo: v("out-dc"), qtySent: Number(v("out-qty")),
      sentAt: v("out-sent"), expectedReturn: v("out-expected"), remarks: v("out-remarks"), sentBy: me(), sentRecordedAt: new Date().toISOString(),
      qtyReceived: null, receivedAt: null, returnRemarks: "", returnedTo: ""
    });
    job.outsourcing = Object.assign({ _local: true }, o);
    job.status = "In Progress";
    closeModal("out-modal-send");
    render();
    audit(job.kpNumber, `Sent to vendor ${o.vendor} (${o.work}), DC ${o.dcNo}, ${o.qtySent} pcs, expected back ${o.expectedReturn}`);
    try { await saveJob(job, { outsourcing: o, currentStatus: "In Progress" }); delete job.outsourcing._local; }
    catch (err) { alert("Could not save: " + (err && err.message ? err.message : err)); }
  }

  function openReceive(kp) {
    const job = allJobs().find(j => j.kpNumber === kp); if (!job) return;
    current = job;
    const o = outOf(job);
    $("out-recv-info").innerHTML = `<strong class="text-cyan">${esc(kpLabel(job))}</strong> from <strong>${esc(o.vendor || "vendor")}</strong>` +
      (o.dcNo ? ` · DC ${esc(o.dcNo)}` : "") + (o.sentAt ? ` · sent ${fmtDay(o.sentAt)}` : "");
    $("out-rqty").value = o.qtyReceived != null ? o.qtyReceived : (o.qtySent || job.quantity || "");
    $("out-rdate").value = (o.receivedAt || today()).slice(0, 10);
    $("out-rremarks").value = o.returnRemarks || "";
    const back = RETURN_STAGES.includes(o.fromStage) ? o.fromStage : "Inspection";
    $("out-rnext").value = o.returnedTo && RETURN_STAGES.includes(o.returnedTo) ? o.returnedTo : back;
    $("out-rnext-hint").textContent = o.fromStage ? `It came from ${o.fromStage}.` : "";
    $("out-receive-submit").textContent = `Receive & Move to ${$("out-rnext").value}`;
    openModal("out-modal-receive");
  }

  async function submitReceive(e) {
    e.preventDefault();
    const job = current; if (!job) return;
    const o = outOf(job);
    const qty = Number($("out-rqty").value), rdate = $("out-rdate").value, next = $("out-rnext").value;
    if (!rdate || !next || isNaN(qty) || qty < 0) { alert("Please fill in all required fields."); return; }
    if (o.sentAt && rdate < String(o.sentAt).slice(0, 10)) { alert("Received date cannot be before the sent date."); return; }
    if (o.qtySent && qty < o.qtySent && !confirm(`Only ${qty} of ${o.qtySent} pcs received. Continue?`)) return;
    const trip = {
      fromStage: o.fromStage || "", vendor: o.vendor || "", work: o.work || "", dcNo: o.dcNo || "", qtySent: o.qtySent || "",
      sentAt: o.sentAt || "", expectedReturn: o.expectedReturn || "", remarks: o.remarks || "", sentBy: o.sentBy || "",
      qtyReceived: qty, receivedAt: rdate, returnRemarks: $("out-rremarks").value.trim(), receivedBy: me(), returnedTo: next,
      recordedAt: new Date().toISOString()
    };
    const newOut = Object.assign({}, o, { status: "Returned", qtyReceived: qty, receivedAt: rdate, returnRemarks: trip.returnRemarks, returnedTo: next, receivedBy: trip.receivedBy });
    delete newOut._local;
    job.outsourcing = newOut;
    job.outsourcingTrips = (Array.isArray(job.outsourcingTrips) ? job.outsourcingTrips : []).concat([trip]);
    closeModal("out-modal-receive");
    audit(job.kpNumber, `Received back from ${trip.vendor} (${qty}/${trip.qtySent} pcs) → ${next}`);
    try {
      await saveJob(job, { outsourcing: newOut, outsourcingTrips: firebase.firestore.FieldValue.arrayUnion(trip) });
    } catch (err) { alert("Could not save the receipt: " + (err && err.message ? err.message : err)); return; }
    moveOut(job, next);
  }

  // Move a job out of Outsourcing to any stage (saved by stage-board.js as MOVE_STAGE, with the 10 s UNDO)
  function moveOut(job, target) {
    if (typeof applyStageTransitionWithUndo !== "function") return;
    const op = me();
    window.pendingTransition = {
      job, stage: STAGE,
      payloadGenerator: ns => ({ type: "MOVE_STAGE", kpNo: job.kpNumber, stage: STAGE, nextStage: ns, operatorName: op, stopRunningCycle: false, time: new Date().toISOString() }),
      applyLocalMutation: ns => { if (typeof transitionToStage === "function") transitionToStage(job, ns, op); else job.currentDepartment = ns; }
    };
    applyStageTransitionWithUndo(target);
  }

  // ===================== HOOKS =====================
  function installHooks() {
    // Sidebar and page access both use isTabAuthorized: allow the named inspectors for this tab only
    if (typeof window.isTabAuthorized === "function") {
      const origAuth = window.isTabAuthorized;
      window.isTabAuthorized = function (tabId) {
        if (tabId === "tab-outsourcing") {
          const u = user();
          if (u && u.role === "operator") {
            const dept = typeof getCleanDeptKey === "function" ? getCleanDeptKey(u.department) : u.department;
            const name = String(u.name || "").trim().toLowerCase();
            if (dept === "Inspection" && OUTSOURCING_INSPECTORS.some(n => n.toLowerCase() === name)) return true;
          }
        }
        return origAuth.apply(this, arguments);
      };
    }
    if (typeof ROLE_PERMISSIONS !== "undefined") {
      ["super_admin", "production_admin", "hr_admin"].forEach(r => {
        const l = ROLE_PERMISSIONS[r];
        if (Array.isArray(l) && !l.includes("tab-outsourcing")) l.push("tab-outsourcing");
      });
    }
    // Entering Outsourcing: start a fresh trip and remember where the job came from (locally at once, in Firebase after the save)
    if (typeof window.transitionToStage === "function") {
      const orig = window.transitionToStage;
      window.transitionToStage = function (job, stageName) {
        const from = job && job.currentDepartment;
        const r = orig.apply(this, arguments);
        if (stageName === STAGE && job) job.outsourcing = { status: "Pending", fromStage: from && from !== STAGE ? from : "", _local: true };
        return r;
      };
    }
    if (typeof window.sendBackendPost === "function") {
      const origSend = window.sendBackendPost;
      window.sendBackendPost = async function (payload) {
        const res = await origSend.apply(this, arguments);
        try {
          if (payload && payload.nextStage === STAGE && payload.stage && payload.stage !== STAGE) {
            const job = allJobs().find(j => j.kpNumber === payload.kpNo || (payload.type === "SPLIT_STAGE" && j.kpNumber === payload.kpNo));
            const fresh = { status: "Pending", fromStage: payload.stage, enteredAt: new Date().toISOString() };
            if (job) {
              await saveJob(job, { outsourcing: fresh });
              job.outsourcing = fresh;
            }
          }
        } catch (e) { console.warn("[Outsourcing] could not record the source stage:", e && e.message ? e.message : e); }
        return res;
      };
    }
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        try { startListeners(); applyFirebase(); } catch (e) {}
        const r = orig.apply(this, arguments);
        try { render(); } catch (e) { console.warn("[Outsourcing] render:", e); }
        return r;
      };
    }
  }

  function bindEvents() {
    document.querySelectorAll("#tab-outsourcing [data-out-subtab]").forEach(b => b.addEventListener("click", () => {
      activeSubtab = b.getAttribute("data-out-subtab");
      document.querySelectorAll("#tab-outsourcing [data-out-subtab]").forEach(x => x.classList.toggle("active", x === b));
      document.querySelectorAll("#tab-outsourcing .machining-subtab-panel").forEach(p => p.classList.toggle("active", p.id === activeSubtab));
      render();
    }));
    $("out-filter-text").addEventListener("input", renderQueue);
    $("out-filter-state").addEventListener("change", renderQueue);
    $("out-filter-clear").addEventListener("click", () => { $("out-filter-text").value = ""; $("out-filter-state").value = ""; renderQueue(); });
    $("out-hist-text").addEventListener("input", renderHistory);
    $("out-queue-cards").addEventListener("click", e => {
      const s = e.target.closest("[data-out-send]"), r = e.target.closest("[data-out-receive]");
      if (s) openSend(s.getAttribute("data-out-send"));
      if (r) openReceive(r.getAttribute("data-out-receive"));
    });
    $("out-send-form").addEventListener("submit", submitSend);
    $("out-receive-form").addEventListener("submit", submitReceive);
    $("out-rnext").addEventListener("change", () => { $("out-receive-submit").textContent = `Receive & Move to ${$("out-rnext").value}`; });
    document.querySelectorAll("[data-out-close]").forEach(b => b.addEventListener("click", () => closeModal(b.getAttribute("data-out-close"))));
  }

  // ===================== BOOT =====================
  try {
    injectSidebar();
    injectStageTargets();
    injectTab();
    injectModals();
    installHooks();
    bindEvents();
    const wait = setInterval(() => { try { startListeners(); } catch (e) {} if (fsStarted) clearInterval(wait); }, 1500);
    window.PSPOutsourcing = { render, moveOut };
    console.log("[PSP] outsourcing v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] outsourcing failed to load:", err);
  }
})();
