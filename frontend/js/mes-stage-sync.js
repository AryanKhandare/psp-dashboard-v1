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

const STAGES = ["Inspection", "Machining", "Masking", "Blasting", "Spraying", "Sealing", "Grinding", "Polishing", "Final Inspection", "Dispatch", "Outsourcing", "Dispatched"];

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
  getFolder_(null, PIR_PHOTO_FOLDER);
  getFolder_(null, FIR_PHOTO_FOLDER);
  Logger.log("Tabs ready in: " + ss.getName() + " (incl. " + PIR_TAB + ", " + FIR_TAB + "), Drive folders: " + PIR_PHOTO_FOLDER + ", " + FIR_PHOTO_FOLDER);
}
