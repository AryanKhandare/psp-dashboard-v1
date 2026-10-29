/**
 * PSP MES – Stage-wise, KP-wise logging into the Q2P FMS sheet  +  PIR (Pre Inspection Report) receiver.
 *
 * Stage events (from mes-stage-sync.js) write two tabs (created automatically if missing):
 *   MES_Stage_Summary  – one row per KP per stage, updated as the job progresses
 *   MES_Stage_Log      – one new row for every action (start, hold, resume, complete, ...)
 *
 * PIRs (from pir-form.js, request type "PIR") and FIRs (from fir-form.js, request type "FIR"):
 *   PIR_Reports / FIR_Reports – one row per report submitted in the dashboard
 *   Google Drive              – photos in "PSP PIR Photos" / "PSP FIR Photos" → <KP number>, links in the row
 *
 * Customer clearance (from the dashboard's Hold for Customer Clearance, request type "CLEARANCE"):
 *   Customer_Clearance – one row per KP: On Hold / Clearance Received / Dispatched without clearance
 *   + a row in MES_Stage_Log and the Dispatch row of MES_Stage_Summary shows "Hold – Customer Clearance".
 *
 * This is a SEPARATE Apps Script project. It never reads or edits the FMS tab.
 * Deploy: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 * After changes: Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy (URL stays the same).
 */

const Q2P_SHEET_ID = "1vZUBWe2c5pNdKTQ808jF8XPeE5j-XOUYwHAsNK0aqB8";
const SHARED_TOKEN = "psp-mes-54f01c5b50486721db971093"; // must match mes-stage-sync.js and pir-form.js
const SUMMARY_TAB = "MES_Stage_Summary";
const LOG_TAB = "MES_Stage_Log";
const PIR_TAB = "PIR_Reports";
const PIR_PHOTO_FOLDER = "PSP PIR Photos";
const FIR_TAB = "FIR_Reports";
const DISPATCH_TAB = "Dispatch_Reports";
const DISPATCH_HEADERS = [
  "Submitted At", "KP No.", "JC No.", "Part Name", "Customer", "Job Qty", "Dispatch Qty", "Dimension", "Weight (kg)",
  "Submitter Name", "FIR No.", "Customer Clearance", "Submitted By (dashboard login)"
];
const CLEARANCE_TAB = "Customer_Clearance";
const CLEARANCE_HEADERS = [
  "KP No", "JC No", "Part Name", "Customer", "Qty", "FIR No", "Clearance Status",
  "On Hold Since", "Put on Hold By", "Clearance Received / Dispatched At", "Released By", "Days on Hold", "Last Updated"
];
const FIR_PHOTO_FOLDER = "PSP FIR Photos";

const SUMMARY_HEADERS = [
  "KP No", "JC No", "Part Name", "Customer", "Qty", "Process", "Stage", "Status",
  "Operator", "Shift", "Entered At", "Started At", "Completed At", "Active Time (h:mm)",
  "Hold Count", "Last Hold Reason", "Next Stage", "Done Qty", "Last Updated"
];
const LOG_HEADERS = [
  "Timestamp", "KP No", "JC No", "Part Name", "Customer", "Qty", "Stage", "Event",
  "Operator", "Shift", "Hold Reason", "Active Time (h:mm)", "Next Stage", "Done Qty",
  "Split KP", "Logged By"
];
const PIR_HEADERS = [
  "Submitted At", "Process", "KP No.", "PIR No.", "JC No.", "Part Name", "Customer",
  "Coating Dia (mm)", "Coating Length (mm)", "Total Length (mm)", "Part Type", "Qty", "Inspector Name",
  "Status", "Outsourcing", "Process Code", "Processes", "Next Stage", "Photo Count", "Photos Folder", "Photo Links",
  "Submitted By (dashboard login)"
];
const FIR_HEADERS = [
  "Submitted At", "Process", "KP No.", "FIR No.", "JC No.", "Part Name", "Customer", "Qty (FIR)", "Job Qty",
  "Coating Length (mm)", "Coating Dia (mm)", "Inspector Name", "Report Sent to Customer", "Outsourcing Status",
  "Sent To", "Photo Count", "Photos Folder", "Photo Links", "Submitted By (dashboard login)"
];
// Column positions in the summary tab (1-based)
const S = {};
SUMMARY_HEADERS.forEach((h, i) => { S[h] = i + 1; });

const STAGES = ["Inspection", "Machining", "Masking", "Blasting", "Spraying", "Sealing", "Grinding", "Polishing", "Final Inspection", "Dispatch", "Outsourcing", "Quarantine", "Dispatched"];

function doGet() {
  return json_({ ok: true, service: "PSP MES stage sync + PIR" });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "invalid JSON" });
  }
  if (body.token !== SHARED_TOKEN) return json_({ ok: false, error: "bad token" });
  if (body.type === "PIR") return handleReport_(body, "PIR");
  if (body.type === "FIR") return handleReport_(body, "FIR");
  if (body.type === "CLEARANCE") return handleClearance_(body);
  if (body.type === "DISPATCH") return handleReport_(body, "DISPATCH");

  const events = Array.isArray(body.events) ? body.events : [body.event];
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: "busy" });
  try {
    const ss = SpreadsheetApp.openById(Q2P_SHEET_ID);
    const summary = getTab_(ss, SUMMARY_TAB, SUMMARY_HEADERS);
    const log = getTab_(ss, LOG_TAB, LOG_HEADERS);
    const index = buildIndex_(summary);
    let written = 0;

    events.slice(0, 50).forEach(ev => {
      const clean = validate_(ev);
      if (!clean) return;
      appendLog_(log, clean);
      applySummary_(summary, index, clean);
      written++;
    });
    SpreadsheetApp.flush();
    return json_({ ok: true, written: written });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ============================ PIR / FIR ============================

const REPORTS = {
  PIR: {
    tab: PIR_TAB, headers: PIR_HEADERS, folder: PIR_PHOTO_FOLDER, numberKey: "pirNo",
    row: (r, n, folderUrl, urls) => [
      n.when, r.process || "Pre Inspection", r.kpNo, r.pirNo, r.jcNo, r.partName, r.customer,
      numOrText_(r.coatingDiaMm), numOrText_(r.coatingLengthMm), numOrText_(r.totalLengthMm), r.partType, numOrText_(r.qty),
      r.inspectorName, r.status, r.outsourcing, r.processCode, r.processes, r.nextStage,
      urls.length, folderUrl, urls.join("\n"), r.submittedBy]
  },
  DISPATCH: {
    tab: DISPATCH_TAB, headers: DISPATCH_HEADERS, folder: "PSP Dispatch Photos", numberKey: "kpNo",
    row: (r, n) => [
      n.when, r.kpNo, r.jcNo, r.partName, r.customer, numOrText_(r.jobQty), numOrText_(r.dispatchQty), r.dimension,
      numOrText_(r.weightKg), r.submitterName, r.firNo, r.clearance || "", r.submittedBy]
  },
  FIR: {
    tab: FIR_TAB, headers: FIR_HEADERS, folder: FIR_PHOTO_FOLDER, numberKey: "firNo",
    row: (r, n, folderUrl, urls) => [
      n.when, r.process || "Final Inspection", r.kpNo, r.firNo, r.jcNo, r.partName, r.customer,
      numOrText_(r.qty), numOrText_(r.jobQty), numOrText_(r.coatingLengthMm), numOrText_(r.coatingDiaMm),
      r.inspectorName, r.reportSentToCustomer, r.outsourcingStatus, r.sendTo,
      urls.length, folderUrl, urls.join("\n"), r.submittedBy]
  }
};

function handleReport_(body, kind) {
  const cfg = REPORTS[kind];
  const r = body.report || {};
  if (!/^KP-[A-Z0-9-]+$/i.test(String(r.kpNo || ""))) return json_({ ok: false, error: "missing KP number" });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: "busy, try again" });
  try {
    // 1) Photos → Drive: "<folder>" / <KP>
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 10) : [];
    let folderUrl = "";
    const photoUrls = [];
    if (photos.length) {
      const kpFolder = getFolder_(getFolder_(null, cfg.folder), String(r.kpNo).toUpperCase());
      folderUrl = kpFolder.getUrl();
      const stamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd-HHmm");
      photos.forEach((p, i) => {
        const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.type || "image/jpeg",
          `${r.kpNo}_${kind}-${r[cfg.numberKey] || "NA"}_${stamp}_${i + 1}.jpg`);
        const file = kpFolder.createFile(blob);
        try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}
        photoUrls.push(file.getUrl());
      });
    }
    // 2) Row → report tab
    const ss = SpreadsheetApp.openById(Q2P_SHEET_ID);
    const sh = getTab_(ss, cfg.tab, cfg.headers);
    sh.appendRow(cfg.row(r, { when: r.submittedAt ? new Date(r.submittedAt) : new Date() }, folderUrl, photoUrls));
    SpreadsheetApp.flush();
    return json_({ ok: true, row: sh.getLastRow(), folderUrl: folderUrl, photoUrls: photoUrls });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getFolder_(parent, name) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function numOrText_(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return isNaN(n) ? String(v) : n;
}

// ============================ CUSTOMER CLEARANCE ============================

function handleClearance_(body) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: "busy, try again" });
  try {
    const ss = SpreadsheetApp.openById(Q2P_SHEET_ID);
    const sh = getTab_(ss, CLEARANCE_TAB, CLEARANCE_HEADERS);
    const log = getTab_(ss, LOG_TAB, LOG_HEADERS);
    const summary = getTab_(ss, SUMMARY_TAB, SUMMARY_HEADERS);
    const sIndex = buildIndex_(summary);
    // KP -> row in Customer_Clearance
    const last = sh.getLastRow();
    const rows = {};
    if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => { if (r[0]) rows[String(r[0]).toUpperCase()] = i + 2; });
    const STATUS = { HOLD: "On Hold", RELEASE: "Clearance Received", DISPATCHED: "Dispatched without clearance" };
    let written = 0;

    items.forEach(it => {
      const kp = str_(it.kpNo).toUpperCase();
      if (!/^KP-[A-Z0-9-]+$/.test(kp) || !STATUS[it.action]) return;
      const status = STATUS[it.action];
      const now = date_(it.time) || new Date();
      let row = rows[kp];
      // a backfill (log === false) never overwrites a later release
      if (row && it.log === false && sh.getRange(row, 7).getValue() !== "On Hold") return;
      if (!row) { sh.appendRow([kp]); row = sh.getLastRow(); rows[kp] = row; }
      const since = date_(it.since);
      const released = it.action === "HOLD" ? "" : (date_(it.releasedAt) || now);
      const values = [kp, str_(it.jcNo), str_(it.partName), str_(it.customer), num_(it.qty) || "", str_(it.firNo), status,
        since || sh.getRange(row, 8).getValue() || now, str_(it.by) || sh.getRange(row, 9).getValue(),
        released, it.action === "HOLD" ? "" : str_(it.releasedBy), "", now];
      sh.getRange(row, 1, 1, values.length).setValues([values]);
      sh.getRange(row, 12).setFormula(`=IF(H${row}="","",ROUND(IF(J${row}="",NOW(),J${row})-H${row},1))`);
      sh.getRange(row, 8).setNumberFormat("dd-mm-yyyy hh:mm"); sh.getRange(row, 10).setNumberFormat("dd-mm-yyyy hh:mm"); sh.getRange(row, 13).setNumberFormat("dd-mm-yyyy hh:mm");
      sh.getRange(row, 1, 1, values.length).setBackground(status === "On Hold" ? "#fff4d6" : null);

      if (it.log !== false) {
        const event = it.action === "HOLD" ? "On Hold – Customer Clearance" : it.action === "RELEASE" ? "Customer Clearance Received" : "Dispatched without clearance";
        appendLog_(log, { time: now, kpNo: kp, jcNo: str_(it.jcNo), partName: str_(it.partName), customer: str_(it.customer), quantity: num_(it.qty),
          stage: "Dispatch", event: event, operator: it.action === "HOLD" ? str_(it.by) : str_(it.releasedBy), shift: "",
          holdReason: it.action === "HOLD" ? "Customer clearance" : "", activeTimeMs: 0, nextStage: "", doneQty: 0, splitKp: "",
          loggedBy: it.action === "HOLD" ? str_(it.by) : str_(it.releasedBy) });
      }
      // Dispatch row in the summary shows the hold
      const ev = { kpNo: kp, jcNo: str_(it.jcNo), partName: str_(it.partName), customer: str_(it.customer), quantity: num_(it.qty), processType: "", time: now };
      const sRow = upsertRow_(summary, sIndex, kp, "Dispatch", ev);
      if (it.action === "HOLD") {
        summary.getRange(sRow, S["Status"]).setValue("Hold – Customer Clearance");
        summary.getRange(sRow, S["Last Hold Reason"]).setValue("Customer clearance");
      } else if (it.action === "RELEASE") {
        summary.getRange(sRow, S["Status"]).setValue("Pending");
      } else if (it.action === "DISPATCHED") {
        summary.getRange(sRow, S["Status"]).setValue("Completed");
      }
      summary.getRange(sRow, S["Last Updated"]).setValue(now);
      written++;
    });
    SpreadsheetApp.flush();
    return json_({ ok: true, written: written });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ============================ STAGE EVENTS ============================

function validate_(ev) {
  if (!ev || typeof ev !== "object") return null;
  const kp = str_(ev.kpNo).toUpperCase();
  if (!/^KP-[A-Z0-9-]+$/.test(kp)) return null;
  const stage = str_(ev.stage);
  if (STAGES.indexOf(stage) === -1) return null;
  const next = str_(ev.nextStage);
  return {
    kpNo: kp,
    jcNo: str_(ev.jcNo),
    partName: str_(ev.partName),
    customer: str_(ev.customer),
    quantity: num_(ev.quantity),
    processType: str_(ev.processType),
    stage: stage,
    event: str_(ev.event) || "Update",
    status: str_(ev.status),
    operator: str_(ev.operator),
    shift: str_(ev.shift),
    holdReason: str_(ev.holdReason),
    activeTimeMs: num_(ev.activeTimeMs),
    nextStage: STAGES.indexOf(next) === -1 ? "" : next,
    doneQty: num_(ev.doneQty),
    splitKp: str_(ev.splitKp).toUpperCase(),
    loggedBy: str_(ev.loggedBy),
    time: date_(ev.time) || new Date()
  };
}

function appendLog_(sheet, ev) {
  sheet.appendRow([
    ev.time, ev.kpNo, ev.jcNo, ev.partName, ev.customer, ev.quantity || "", ev.stage, ev.event,
    ev.operator, ev.shift, ev.holdReason, ev.activeTimeMs ? hm_(ev.activeTimeMs) : "",
    ev.nextStage, ev.doneQty || "", ev.splitKp, ev.loggedBy
  ]);
}

function applySummary_(sheet, index, ev) {
  const row = upsertRow_(sheet, index, ev.kpNo, ev.stage, ev);
  const set = (col, val) => { if (val !== "" && val !== null && val !== undefined) sheet.getRange(row, S[col]).setValue(val); };

  if (ev.status) set("Status", ev.status);
  set("Operator", ev.operator);
  set("Shift", ev.shift);
  if (ev.event === "Started") set("Started At", ev.time);
  if (ev.activeTimeMs) set("Active Time (h:mm)", hm_(ev.activeTimeMs));
  if (ev.event === "On Hold") {
    const cur = Number(sheet.getRange(row, S["Hold Count"]).getValue()) || 0;
    sheet.getRange(row, S["Hold Count"]).setValue(cur + 1);
    set("Last Hold Reason", ev.holdReason);
  }
  if (ev.status === "Completed" || ev.status === "Bypassed") set("Completed At", ev.time);
  set("Next Stage", ev.nextStage);
  if (ev.doneQty) set("Done Qty", ev.doneQty);
  sheet.getRange(row, S["Last Updated"]).setValue(ev.time);

  // When a job leaves this stage, open a "Pending" row for the stage it goes to
  if (ev.nextStage && ["Completed", "Bypassed", "Partial"].indexOf(ev.status) !== -1) {
    const targetKp = ev.status === "Partial" && ev.splitKp ? ev.splitKp : ev.kpNo;
    const nextEv = Object.assign({}, ev, { kpNo: targetKp, quantity: ev.doneQty || ev.quantity });
    const r2 = upsertRow_(sheet, index, targetKp, ev.nextStage, nextEv);
    const st = sheet.getRange(r2, S["Status"]);
    if (!st.getValue()) st.setValue(ev.nextStage === "Dispatched" ? "Completed" : "Pending");
    sheet.getRange(r2, S["Last Updated"]).setValue(ev.time);
  }
}

// Find the KP+stage row, or create it. Fills job details and "Entered At" on creation.
function upsertRow_(sheet, index, kp, stage, ev) {
  const key = kp + "|" + stage;
  let row = index[key];
  if (!row) {
    const values = SUMMARY_HEADERS.map(() => "");
    values[S["KP No"] - 1] = kp;
    values[S["Stage"] - 1] = stage;
    values[S["Entered At"] - 1] = ev.time;
    sheet.appendRow(values);
    row = sheet.getLastRow();
    index[key] = row;
  }
  // Keep job details current
  const details = { "JC No": ev.jcNo, "Part Name": ev.partName, "Customer": ev.customer, "Qty": ev.quantity || "", "Process": ev.processType };
  Object.keys(details).forEach(col => { if (details[col] !== "") sheet.getRange(row, S[col]).setValue(details[col]); });
  return row;
}

function buildIndex_(sheet) {
  const index = {};
  const last = sheet.getLastRow();
  if (last < 2) return index;
  const kps = sheet.getRange(2, S["KP No"], last - 1, 1).getValues();
  const stages = sheet.getRange(2, S["Stage"], last - 1, 1).getValues();
  for (let i = 0; i < kps.length; i++) {
    if (kps[i][0]) index[String(kps[i][0]).toUpperCase() + "|" + stages[i][0]] = i + 2;
  }
  return index;
}

function getTab_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#dfe7f1");
    sh.setFrozenRows(1);
  }
  return sh;
}

function hm_(ms) {
  const totalMin = Math.round(Number(ms) / 60000);
  return Math.floor(totalMin / 60) + ":" + String(totalMin % 60).padStart(2, "0");
}
function str_(v) { return v === null || v === undefined ? "" : String(v).trim().slice(0, 300); }
function num_(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function date_(v) { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** Run once from the editor: creates all tabs and the PIR photos folder, and asks for the Drive permission. */
function setupTabs() {
  const ss = SpreadsheetApp.openById(Q2P_SHEET_ID);
  getTab_(ss, SUMMARY_TAB, SUMMARY_HEADERS);
  getTab_(ss, LOG_TAB, LOG_HEADERS);
  getTab_(ss, PIR_TAB, PIR_HEADERS);
  getTab_(ss, FIR_TAB, FIR_HEADERS);
  getTab_(ss, CLEARANCE_TAB, CLEARANCE_HEADERS);
  getTab_(ss, DISPATCH_TAB, DISPATCH_HEADERS);
  getFolder_(null, PIR_PHOTO_FOLDER);
  getFolder_(null, FIR_PHOTO_FOLDER);
  Logger.log("Tabs ready in: " + ss.getName() + " (incl. " + PIR_TAB + ", " + FIR_TAB + "), Drive folders: " + PIR_PHOTO_FOLDER + ", " + FIR_PHOTO_FOLDER);
}


// =====================================================================================================
// BROWSER PART – STAGE LOG SENDER
// Everything above is the Apps Script receiver (used only on script.google.com, unchanged).
// The block below runs ONLY in the dashboard (browser): in Apps Script there is no "window", so it is skipped.
// It sends every stage action (start, pause, resume, end, approve, split, board move, delete) to the
// MES Stage Sync web app, which writes MES_Stage_Log and MES_Stage_Summary in the Q2P sheet.
// In index.html this file must load LAST, just before app.js.
// =====================================================================================================
if (typeof window !== "undefined" && typeof document !== "undefined") {
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
      DELETE_JOB:      p => ({ stage: p.stage, event: "Deleted", status: "Deleted" }),
      // Board drag / Outsourcing "Receive Back" / Quarantine "Release" / script-free moves between any two stages
      MOVE_STAGE:      p => ({ stage: p.stage, event: "Moved to " + (p.nextStage || ""), status: "Completed", nextStage: p.nextStage })
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
      // A save that another add-on skipped (e.g. the job guard refusing to re-create a deleted job) changed nothing: do not log it
      if (result && result.skipped) return result;
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
    console.log("[PSP] stage-log sender loaded – stage actions are sent to MES_Stage_Log.");
  })();
}
