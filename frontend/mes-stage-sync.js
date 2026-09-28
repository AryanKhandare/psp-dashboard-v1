/**
 * PSP MES – send stage-wise, KP-wise events to the Q2P sheet (MES_Stage_Summary + MES_Stage_Log).
 *
 * How it works: every dashboard save goes through sendBackendPost(). This file wraps that
 * function: after Firebase has saved successfully, the same action is queued and sent to the
 * "MES Stage Sync" Apps Script in the background. Operators never wait for the sheet, and if
 * the network or sheet is down, events stay queued in this browser and are retried.
 *
 * Load this file in index.html AFTER dashboard.js.
 */
(function () {
  // Paste the Web App URL of the "MES Stage Sync" Apps Script deployment here:
  const MES_STAGE_SYNC_URL = "https://script.google.com/macros/s/AKfycbzMXoqOSbxHnedhNpf_8XFAJ1UCLHHnwtDPqx_05gjU3rcb9U1mmlRfd0ma5ulwO3DV/exec";
  const SHARED_TOKEN = "psp-mes-54f01c5b50486721db971093"; // must match MES_Stage_Sync.gs
  const QUEUE_KEY = "psp_mes_stage_queue";
  const MAX_QUEUE = 2000;

  if (typeof window.sendBackendPost !== "function") {
    console.warn("[MES Stage Sync] sendBackendPost not found. Load mes-stage-sync.js after dashboard.js.");
    return;
  }

  // What each dashboard action means for the stage sheet
  const EVENT_MAP = {
    START_CYCLE:     p => ({ stage: p.stage, event: "Started", status: "In Progress" }),
    PAUSE_CYCLE:     p => ({ stage: p.stage, event: "On Hold", status: "Hold", holdReason: p.holdReason }),
    RESUME_CYCLE:    p => ({ stage: p.stage, event: "Resumed", status: "In Progress" }),
    END_CYCLE:       p => ({ stage: p.stage, event: "Completed", status: "Completed", nextStage: p.nextStage }),
    APPROVE_JOB:     p => ({ stage: p.stage || "Inspection", event: "Approved", status: "Completed", nextStage: p.nextStage }),
    SPLIT_STAGE:     p => ({ stage: p.stage, event: "Partial complete", status: "Partial", nextStage: p.nextStage, doneQty: p.doneQty, splitKp: p.splitKp }),
    SPLIT_MASKING:   p => ({ stage: "Masking", event: "Partial complete", status: "Partial", nextStage: p.nextStage || "Spraying", doneQty: p.doneQty, splitKp: p.splitKp }),
    BYPASS_MASKING:  p => ({ stage: "Masking", event: "Bypassed", status: "Bypassed", nextStage: p.nextStage || "Spraying" }),
    CREATE_JOB:      p => ({ stage: p.currentDepartment || "Inspection", event: "Registered", status: "Pending" }),
    UPDATE_JOB_STAGE:p => ({ stage: p.currentDepartment, event: "Moved by sheet sync", status: "Pending" }),
    DELETE_JOB:      p => ({ stage: p.stage, event: "Deleted", status: "Deleted" })
  };

  function normalizeType(p) {
    return String((p && (p.type || p.action)) || "").trim().toUpperCase().replace(/^([A-Z]+)(CYCLE|JOB|STAGE|MASKING)$/, "$1_$2");
  }

  function buildEvent(payload) {
    const type = normalizeType(payload);
    const map = EVENT_MAP[type];
    if (!map || !payload.kpNo) return null;
    const base = map(payload);
    if (!base.stage) return null;

    const kp = String(payload.kpNo).trim();
    const list = Array.isArray(window.jobs) ? window.jobs : [];
    const job = list.find(j => j.kpNumber === kp) || {};
    const jcMap = window.kpToJcMap || {};
    const user = (typeof currentUser !== "undefined" && currentUser) ? currentUser : {};

    return Object.assign({
      kpNo: kp,
      jcNo: job.jcNo || payload.jcNo || jcMap[kp.toUpperCase()] || "",
      partName: job.partName || payload.partName || "",
      customer: job.customer || payload.customer || "",
      quantity: job.quantity || payload.quantity || "",
      processType: job.processType || payload.processType || "",
      operator: payload.operatorName || "",
      shift: payload.shift || "",
      activeTimeMs: payload.activeTimeMs || 0,
      loggedBy: user.email || "",
      time: payload.endTime || payload.startTime || payload.time || new Date().toISOString()
    }, base);
  }

  // ---- Queue (survives page reloads) ----
  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch (e) {}
  }

  let flushTimer = null;
  let flushing = false;
  function scheduleFlush(delay) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  async function flush() {
    if (!MES_STAGE_SYNC_URL || flushing) return;
    const queue = readQueue();
    if (!queue.length) return;
    flushing = true;
    const batch = queue.slice(0, 50);
    try {
      // "no-cors" + text/plain = simple request to Apps Script, no CORS preflight
      await fetch(MES_STAGE_SYNC_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: SHARED_TOKEN, events: batch })
      });
      writeQueue(readQueue().slice(batch.length));
      if (readQueue().length) scheduleFlush(1000);
    } catch (err) {
      console.warn("[MES Stage Sync] Send failed, will retry:", err.message);
      scheduleFlush(60000);
    } finally {
      flushing = false;
    }
  }

  // ---- Wrap sendBackendPost: log only after Firebase saved successfully ----
  const originalSend = window.sendBackendPost;
  window.sendBackendPost = async function (payload) {
    const result = await originalSend.apply(this, arguments);
    try {
      const isMock = typeof isMockMode === "function" && isMockMode();
      const ev = !isMock && buildEvent(payload || {});
      if (ev) {
        const q = readQueue();
        q.push(ev);
        writeQueue(q);
        scheduleFlush(1500); // small delay groups bursts (e.g. sheet auto-sync) into one request
      }
    } catch (e) {
      console.warn("[MES Stage Sync] Could not queue event:", e);
    }
    return result;
  };

  if (!MES_STAGE_SYNC_URL) {
    console.warn("[MES Stage Sync] MES_STAGE_SYNC_URL is empty – events are queued but not sent yet.");
  }
  scheduleFlush(5000);             // send anything left from last session
  setInterval(() => flush(), 60000);
})();