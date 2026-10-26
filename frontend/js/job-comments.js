/**
 * PSP MES – Job comments (like comments in Google Sheets).
 *
 * Right-click (or long-press on tablets/phones) any job card – main board, stage queues, active lists,
 * Final Inspection, Dispatch, Outsourcing – → "Add comment" / "View comments".
 * Each comment shows who wrote it and the date & time (and "edited" time). Edit / Delete: the author,
 * or Super Admin / Production Admin. Cards of jobs with comments get a yellow corner + 💬 count.
 *
 * Stored on the job document: comments.<id> = { text, by, byEmail, at, editedAt }, hasComments = true.
 * Load after the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] job-comments: psp-common.js must load first."); return; }
  const { $, esc, allJobs, user, kpLabel } = window.PSP;
  const MODULE_VERSION = 2;
  const MODERATORS = ["super_admin", "production_admin"];

  // ---------- data: comments of every job that has any (live from Firebase) ----------
  const store = new Map();   // KP -> { docId, comments: { id: {...} } }
  let started = false;
  function startListener() {
    if (started) return;
    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return;
    if (typeof isMockMode === "function" && isMockMode()) return;
    let au = null; try { au = firebase.auth().currentUser; } catch (e) { return; }
    if (!au || au.isAnonymous) return;
    started = true;
    firebase.firestore().collection("jobs").where("hasComments", "==", true).onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (!d.kpNumber) return;
        if (ch.type === "removed" || d.isDeleted === true) store.delete(d.kpNumber);
        else store.set(d.kpNumber, { docId: ch.doc.id, comments: d.comments || {} });
      });
      decorateAll();
      if (panelKp) drawPanel();
    }, e => console.warn("[Comments] listener:", e && e.message ? e.message : e));
  }
  const commentsOf = kp => {
    const c = (store.get(kp) || {}).comments || {};
    return Object.entries(c).filter(([, v]) => v && v.text).map(([id, v]) => Object.assign({ id }, v))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  };
  const countOf = kp => commentsOf(kp).length;

  // ---------- which job is a card? ----------
  const STAGE_OF_TAB = { "tab-machining": "Machining", "tab-masking": "Masking", "tab-blasting": "Blasting", "tab-spraying": "Spraying", "tab-sealing": "Sealing",
    "tab-grinding": "Grinding", "tab-polishing": "Polishing", "tab-final-inspection": "Final Inspection", "tab-dispatch": "Dispatch",
    "tab-outsourcing": "Outsourcing" };
  const CARD_SEL = "[data-board-kp], .stage-kanban-card, .active-card, .kanban-card, .job-queue-card";
  function jobFromCard(card) {
    if (!card) return null;
    const direct = card.getAttribute("data-board-kp");
    if (direct) return allJobs().find(j => j.kpNumber === direct) || null;
    const text = card.textContent.replace(/\s+/g, " ");
    const m = text.match(/KP-[A-Z0-9]+(?:-[A-Z0-9]+)*(?:\s*\([^)]*\))?/i);
    if (!m) return null;
    const label = m[0].trim().toUpperCase();
    const kpOnly = label.replace(/\s*\(.*$/, "");
    const pane = card.closest(".tab-pane");
    const stage = pane ? STAGE_OF_TAB[pane.id] : null;
    const candidates = allJobs().filter(j => {
      const kp = String(j.kpNumber || "").toUpperCase();
      return kpLabel(j).toUpperCase() === label || kp === kpOnly || kp.split("-R")[0] === kpOnly;
    });
    return candidates.find(j => stage && j.currentDepartment === stage && kpLabel(j).toUpperCase() === label)
        || candidates.find(j => stage && j.currentDepartment === stage)
        || candidates.find(j => kpLabel(j).toUpperCase() === label)
        || candidates[0] || null;
  }

  // ---------- UI ----------
  function injectUI() {
    if ($("jc-menu")) return;
    const st = document.createElement("style");
    st.textContent = `
      #jc-menu { position:fixed; z-index:13000; display:none; background:var(--bg-card,#fff); color:var(--text-main,#0f172a);
        border:1px solid var(--border-color,#cbd5e1); border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,.35); min-width:210px; overflow:hidden; }
      #jc-menu .jc-head { font-size:11px; font-weight:800; padding:8px 12px; border-bottom:1px solid var(--border-color,#cbd5e1); opacity:.8; }
      #jc-menu button { display:block; width:100%; text-align:left; padding:10px 12px; background:none; border:0; color:inherit; font-size:13px; cursor:pointer; }
      #jc-menu button:hover { background:rgba(59,130,246,.12); }
      .jc-flag { position:absolute; top:0; right:0; width:0; height:0; border-top:16px solid #f5c518; border-left:16px solid transparent; z-index:3; pointer-events:none; }
      .jc-badge { position:absolute; top:4px; right:18px; z-index:4; background:#f5c518; color:#3a2a00; font-size:10px; font-weight:800;
        border-radius:10px; padding:1px 6px; cursor:pointer; line-height:16px; box-shadow:0 1px 3px rgba(0,0,0,.25); }
      #jc-panel { display:none; position:fixed; inset:0; z-index:12500; background:rgba(15,23,42,.6); align-items:center; justify-content:center; padding:10px; }
      #jc-panel .jc-box { background:var(--bg-card,#fff); color:var(--text-main,#0f172a); width:100%; max-width:560px; max-height:calc(100dvh - 20px);
        border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 40px rgba(0,0,0,.5); }
      #jc-panel .jc-top { padding:12px 16px; border-bottom:1px solid var(--border-color,#cbd5e1); display:flex; justify-content:space-between; gap:10px; align-items:center; }
      #jc-panel .jc-list { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:10px; min-height:80px; }
      #jc-panel .jc-item { border:1px solid var(--border-color,#cbd5e1); border-left:4px solid #f5c518; border-radius:8px; padding:8px 10px; background:rgba(245,197,24,.06); }
      #jc-panel .jc-meta { font-size:11px; opacity:.8; display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      #jc-panel .jc-text { font-size:14px; margin-top:4px; white-space:pre-wrap; word-break:break-word; }
      #jc-panel .jc-actions button { background:none; border:0; color:#2563eb; font-size:12px; font-weight:700; cursor:pointer; padding:0 0 0 10px; }
      #jc-panel .jc-actions button.jc-del { color:#ef4444; }
      #jc-panel .jc-new { padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px)); border-top:1px solid var(--border-color,#cbd5e1); display:flex; flex-direction:column; gap:8px; }
      #jc-panel textarea { width:100%; min-height:70px; font-size:14px; padding:8px; box-sizing:border-box; resize:vertical; }`;
    document.head.appendChild(st);

    const menu = document.createElement("div");
    menu.id = "jc-menu";
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);

    const panel = document.createElement("div");
    panel.id = "jc-panel";
    panel.innerHTML = `
      <div class="jc-box" role="dialog" aria-modal="true" aria-labelledby="jc-title">
        <div class="jc-top"><div><div id="jc-title" style="font-weight:800; font-size:15px;">💬 Comments</div>
          <div id="jc-sub" style="font-size:12px; opacity:.8;"></div></div>
          <button type="button" id="jc-close" class="btn btn-secondary btn-xs" style="height:32px; padding:0 12px;">✕ Close</button></div>
        <div class="jc-list" id="jc-list"></div>
        <div class="jc-new">
          <label for="jc-text" id="jc-text-label" style="font-size:12px; font-weight:700;">Add a comment</label>
          <textarea id="jc-text" class="form-input" placeholder="Write a comment… (Ctrl + Enter to send)"></textarea>
          <div style="display:flex; gap:8px; justify-content:flex-end; align-items:center;">
            <span id="jc-msg" style="flex:1; font-size:12px; font-weight:600;"></span>
            <button type="button" id="jc-cancel-edit" class="btn btn-secondary btn-xs" style="height:36px; padding:0 12px; display:none;">Cancel edit</button>
            <button type="button" id="jc-send" class="btn btn-primary" style="height:36px; padding:0 18px; font-weight:800;">Comment</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(panel);
  }

  // ---------- context menu ----------
  function showMenu(x, y, job) {
    const menu = $("jc-menu");
    const n = countOf(job.kpNumber);
    menu.innerHTML = `<div class="jc-head">${esc(kpLabel(job))} · ${esc(job.currentDepartment || "")}</div>
      <button type="button" role="menuitem" data-jc="add">💬 Add comment</button>
      ${n ? `<button type="button" role="menuitem" data-jc="view">👁 View comments (${n})</button>` : ""}`;
    menu.style.display = "block";
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
    menu.onclick = e => {
      const b = e.target.closest("[data-jc]");
      if (!b) return;
      hideMenu();
      openPanel(job.kpNumber, b.getAttribute("data-jc") === "add");
    };
  }
  const hideMenu = () => { const m = $("jc-menu"); if (m) m.style.display = "none"; };

  // ---------- panel ----------
  let panelKp = null, editingId = null;
  const canChange = c => { const u = user() || {}; return MODERATORS.includes(u.role) || (c.byEmail && u.email && c.byEmail.toLowerCase() === u.email.toLowerCase()); };
  const readOnly = () => { const u = user() || {}; return u.role === "hr_admin"; };
  const fmtDT = iso => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); };

  function openPanel(kp, focus) {
    panelKp = kp; editingId = null;
    const job = allJobs().find(j => j.kpNumber === kp);
    $("jc-sub").textContent = job ? `${kpLabel(job)} · ${job.partName || ""} · now in ${job.currentDepartment || ""}` : kp;
    $("jc-text").value = "";
    $("jc-msg").textContent = "";
    const ro = readOnly();
    $("jc-text").disabled = ro; $("jc-send").disabled = ro;
    $("jc-text-label").textContent = ro ? "View only (your role cannot add comments)" : "Add a comment";
    setEditMode(null);
    drawPanel();
    $("jc-panel").style.display = "flex";
    if (focus && !ro) setTimeout(() => $("jc-text").focus(), 50);
  }
  function closePanel() { $("jc-panel").style.display = "none"; panelKp = null; editingId = null; }

  function drawPanel() {
    const list = commentsOf(panelKp);
    $("jc-title").textContent = `💬 Comments (${list.length})`;
    $("jc-list").innerHTML = list.length ? list.map(c => `
      <div class="jc-item" data-cid="${esc(c.id)}">
        <div class="jc-meta"><span><strong>${esc(c.by || "User")}</strong> · ${esc(fmtDT(c.at))}${c.editedAt ? ` · <em>edited ${esc(fmtDT(c.editedAt))}</em>` : ""}</span>
          ${canChange(c) && !readOnly() ? `<span class="jc-actions"><button type="button" data-jc-edit="${esc(c.id)}">Edit</button><button type="button" class="jc-del" data-jc-del="${esc(c.id)}">Delete</button></span>` : ""}</div>
        <div class="jc-text">${esc(c.text)}</div>
      </div>`).join("")
      : `<div style="text-align:center; opacity:.7; font-size:13px; padding:18px 0;">No comments yet for this job.</div>`;
  }

  function setEditMode(id) {
    editingId = id;
    $("jc-send").textContent = id ? "Save edit" : "Comment";
    $("jc-cancel-edit").style.display = id ? "" : "none";
    $("jc-text-label").textContent = id ? "Edit comment" : (readOnly() ? "View only (your role cannot add comments)" : "Add a comment");
  }

  async function jobRefFor(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    const db = firebase.firestore();
    if (job && job.id) return db.collection("jobs").doc(job.id);
    const snap = await db.collection("jobs").where("kpNumber", "==", kp).get();
    const live = snap.docs.find(d => d.data().isDeleted !== true) || snap.docs[0];
    return live ? live.ref : null;
  }

  async function send() {
    const text = $("jc-text").value.trim();
    if (!text) { $("jc-msg").textContent = "Write something first."; $("jc-msg").style.color = "#ef4444"; return; }
    const u = user() || {};
    const kp = panelKp;
    const entry = store.get(kp) || { comments: {} };
    const now = new Date().toISOString();
    const wasEdit = !!editingId;
    let id = editingId, c;
    if (id) {
      c = Object.assign({}, entry.comments[id], { text, editedAt: now, editedBy: u.name || u.email || "User" });
    } else {
      id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      c = { text, by: u.name || (u.email || "User").split("@")[0], byEmail: u.email || "", at: now };
    }
    // show at once, then save
    entry.comments = Object.assign({}, entry.comments, { [id]: c });
    store.set(kp, entry);
    $("jc-text").value = ""; setEditMode(null); drawPanel(); decorateAll();
    $("jc-msg").textContent = "Saving…"; $("jc-msg").style.color = "#2563eb";
    try {
      if (!(typeof isMockMode === "function" && isMockMode())) {
        const ref = await jobRefFor(kp);
        if (!ref) throw new Error("job not found");
        await ref.update({ [`comments.${id}`]: c, hasComments: true });
      }
      try { if (typeof createAuditLog === "function") createAuditLog(u.email || c.by, kp, `${wasEdit ? "Edited" : "Added"} comment: "${text.slice(0, 80)}"`); } catch (e) {}
      $("jc-msg").textContent = "Saved."; $("jc-msg").style.color = "#16a34a";
    } catch (e) {
      $("jc-msg").textContent = "Could not save: " + (e && e.message ? e.message : e); $("jc-msg").style.color = "#ef4444";
    }
  }

  async function remove(id) {
    const kp = panelKp;
    const entry = store.get(kp);
    if (!entry || !entry.comments[id]) return;
    if (!confirm("Delete this comment?")) return;
    const removed = entry.comments[id];
    const rest = Object.assign({}, entry.comments); delete rest[id];
    entry.comments = rest;
    const left = Object.keys(rest).length;
    drawPanel(); decorateAll();
    try {
      if (!(typeof isMockMode === "function" && isMockMode())) {
        const ref = await jobRefFor(kp);
        if (ref) await ref.update({ [`comments.${id}`]: firebase.firestore.FieldValue.delete(), hasComments: left > 0 });
      }
      const u = user() || {};
      try { if (typeof createAuditLog === "function") createAuditLog(u.email || "User", kp, `Deleted comment: "${String(removed.text).slice(0, 80)}"`); } catch (e) {}
    } catch (e) { alert("Could not delete: " + (e && e.message ? e.message : e)); }
  }

  // ---------- card markers (yellow corner + 💬 count) ----------
  let decoQueued = false;
  function decorateAll() {
    document.querySelectorAll(CARD_SEL).forEach(card => {
      if (card.parentElement && card.parentElement.closest(CARD_SEL)) return;   // only the outer card
      const job = jobFromCard(card);
      const n = job ? countOf(job.kpNumber) : 0;
      let badge = card.querySelector(":scope > .jc-badge"), flag = card.querySelector(":scope > .jc-flag");
      if (!n) { if (badge) badge.remove(); if (flag) flag.remove(); return; }
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      if (!flag) { flag = document.createElement("span"); flag.className = "jc-flag"; card.appendChild(flag); }
      if (!badge) { badge = document.createElement("span"); badge.className = "jc-badge"; card.appendChild(badge); }
      badge.textContent = `💬 ${n}`;
      badge.title = `${n} comment(s) – click to view`;
      badge.setAttribute("data-jc-open", job.kpNumber);
    });
  }
  function queueDecorate() {
    if (decoQueued) return;
    decoQueued = true;
    setTimeout(() => { decoQueued = false; try { decorateAll(); } catch (e) {} }, 120);
  }

  // ---------- events ----------
  function bind() {
    document.addEventListener("contextmenu", e => {
      const card = e.target.closest(CARD_SEL);
      if (!card || e.target.closest("#jc-panel, #jc-menu, input, textarea, select")) return;
      const outer = card.parentElement && card.parentElement.closest(CARD_SEL) ? card.parentElement.closest(CARD_SEL) : card;
      const job = jobFromCard(outer);
      if (!job) return;
      e.preventDefault();
      showMenu(e.clientX, e.clientY, job);
    });
    document.addEventListener("click", e => {
      const open = e.target.closest("[data-jc-open]");
      if (open) { e.preventDefault(); e.stopPropagation(); hideMenu(); openPanel(open.getAttribute("data-jc-open"), false); return; }
      if (!e.target.closest("#jc-menu")) hideMenu();
    }, true);
    document.addEventListener("scroll", hideMenu, true);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { hideMenu(); if ($("jc-panel").style.display === "flex") closePanel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && document.activeElement === $("jc-text")) send();
    });
    $("jc-close").addEventListener("click", closePanel);
    $("jc-panel").addEventListener("click", e => { if (e.target === $("jc-panel")) closePanel(); });
    $("jc-send").addEventListener("click", send);
    $("jc-cancel-edit").addEventListener("click", () => { $("jc-text").value = ""; setEditMode(null); });
    $("jc-list").addEventListener("click", e => {
      const ed = e.target.closest("[data-jc-edit]"), del = e.target.closest("[data-jc-del]");
      if (ed) {
        const c = commentsOf(panelKp).find(x => x.id === ed.getAttribute("data-jc-edit"));
        if (c) { $("jc-text").value = c.text; setEditMode(c.id); $("jc-text").focus(); }
      }
      if (del) remove(del.getAttribute("data-jc-del"));
    });
    // re-mark cards whenever any screen redraws its cards
    const main = document.querySelector(".mes-main-content") || document.body;
    new MutationObserver(muts => {
      if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && !(n.classList && (n.classList.contains("jc-badge") || n.classList.contains("jc-flag")))))) queueDecorate();
    }).observe(main, { childList: true, subtree: true });
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        try { startListener(); } catch (e) {}
        const r = orig.apply(this, arguments);
        queueDecorate();
        return r;
      };
    }
  }

  try {
    injectUI();
    bind();
    const wait = setInterval(() => { try { startListener(); } catch (e) {} if (started) clearInterval(wait); }, 1500);
    window.PSPComments = { open: kp => openPanel(kp, true) };
    console.log("[PSP] job-comments v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] job-comments failed to load:", err);
  }
})();
