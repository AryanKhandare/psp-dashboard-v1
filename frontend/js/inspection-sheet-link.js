/**
 * PSP MES – Google Sheet Delink / Link Controller for Inspection Stage.
 * 
 * Provides an option ONLY for Super Admin to delink or re-link the Google Sheet
 * where component entries arrive into the Inspection stage.
 * 
 * Features:
 * - Asks for confirmation BEFORE committing any changes.
 * - Shows friendly toast notifications when linking / delinking.
 * - Persists state in localStorage and Firestore (system_monitoring/inspection_sync_status).
 * - Disables Google Sheet fetch and auto-sync when delinked.
 * - Immediately re-fetches and auto-syncs Google Sheet entries when re-linked.
 * - UI controls are strictly restricted and only visible to Super Admin.
 */

(function () {
  const STORAGE_KEY = "psp_inspection_sheet_delinked";

  function isInspectionSheetDelinked() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch (e) {
      return false;
    }
  }
  window.isInspectionSheetDelinked = isInspectionSheetDelinked;

  function getUser() {
    try {
      if (typeof currentUser !== "undefined" && currentUser) return currentUser;
    } catch (e) {}
    try {
      return JSON.parse(localStorage.getItem("psp_logged_in_user") || "null");
    } catch (e) {
      return null;
    }
  }

  function isSuperAdmin() {
    const u = getUser();
    return !!(u && u.role === "super_admin");
  }
  window.isSuperAdmin = isSuperAdmin;

  function updateSheetLinkUI() {
    const isSuper = isSuperAdmin();
    const isDelinked = isInspectionSheetDelinked();

    // 1. Inspection stage button (in #tab-inspection header)
    const btnInsp = document.getElementById("btn-sheet-toggle-inspection");
    const btnInspText = document.getElementById("btn-sheet-toggle-inspection-text");
    const btnInspIcon = document.getElementById("btn-sheet-toggle-inspection-icon");
    const badgeInsp = document.getElementById("inspection-sheet-status-badge");
    const bannerInsp = document.getElementById("inspection-sheet-delinked-banner");

    if (btnInsp) {
      btnInsp.style.display = isSuper ? "inline-flex" : "none";
      if (isDelinked) {
        btnInsp.className = "btn btn-success btn-xs";
        btnInsp.style.display = isSuper ? "inline-flex" : "none";
        btnInsp.style.alignItems = "center";
        btnInsp.style.gap = "5px";
        btnInsp.style.cursor = "pointer";
        btnInsp.style.height = "24px";
        btnInsp.style.padding = "2px 10px";
        btnInsp.style.fontWeight = "700";
        if (btnInspText) btnInspText.textContent = "RE-LINK SHEET";
        if (btnInspIcon) btnInspIcon.textContent = "⚡";
        btnInsp.title = "Google Sheet is delinked. Click to re-link and resume incoming entries to Inspection (Super Admin only).";
      } else {
        btnInsp.className = "btn btn-warning btn-xs";
        btnInsp.style.display = isSuper ? "inline-flex" : "none";
        btnInsp.style.alignItems = "center";
        btnInsp.style.gap = "5px";
        btnInsp.style.cursor = "pointer";
        btnInsp.style.height = "24px";
        btnInsp.style.padding = "2px 10px";
        btnInsp.style.fontWeight = "700";
        if (btnInspText) btnInspText.textContent = "DELINK SHEET";
        if (btnInspIcon) btnInspIcon.textContent = "🔗";
        btnInsp.title = "Google Sheet is linked. Click to delink and pause incoming entries to Inspection (Super Admin only).";
      }
    }

    if (badgeInsp) {
      badgeInsp.style.display = "inline-block";
      if (isDelinked) {
        badgeInsp.textContent = "SHEET: DELINKED";
        badgeInsp.style.background = "rgba(239, 68, 68, 0.15)";
        badgeInsp.style.color = "#ef4444";
        badgeInsp.style.border = "1px solid #ef4444";
      } else {
        badgeInsp.textContent = "SHEET: LIVE";
        badgeInsp.style.background = "rgba(16, 185, 129, 0.15)";
        badgeInsp.style.color = "#10b981";
        badgeInsp.style.border = "1px solid #10b981";
      }
    }

    if (bannerInsp) {
      bannerInsp.style.display = isDelinked ? "flex" : "none";
    }

    // 2. Super Admin User Management Tab integration panel
    const adminPanel = document.getElementById("super-admin-sheet-integration-panel");
    const adminBtn = document.getElementById("btn-sheet-toggle-admin");
    const adminBtnText = document.getElementById("btn-sheet-toggle-admin-text");
    const adminBtnIcon = document.getElementById("btn-sheet-toggle-admin-icon");
    const adminStatusPill = document.getElementById("super-admin-sheet-status-pill");

    if (adminPanel) {
      adminPanel.style.display = isSuper ? "block" : "none";
    }

    if (adminBtn) {
      if (isDelinked) {
        adminBtn.className = "btn btn-success btn-sm";
        if (adminBtnText) adminBtnText.textContent = "Re-link Google Sheet";
        if (adminBtnIcon) adminBtnIcon.textContent = "⚡";
      } else {
        adminBtn.className = "btn btn-warning btn-sm";
        if (adminBtnText) adminBtnText.textContent = "Delink Google Sheet";
        if (adminBtnIcon) adminBtnIcon.textContent = "🔗";
      }
    }

    if (adminStatusPill) {
      if (isDelinked) {
        adminStatusPill.textContent = "DELINKED (PAUSED)";
        adminStatusPill.style.background = "rgba(239, 68, 68, 0.15)";
        adminStatusPill.style.color = "#ef4444";
        adminStatusPill.style.border = "1px solid #ef4444";
      } else {
        adminStatusPill.textContent = "LINKED (LIVE)";
        adminStatusPill.style.background = "rgba(16, 185, 129, 0.15)";
        adminStatusPill.style.color = "#10b981";
        adminStatusPill.style.border = "1px solid #10b981";
      }
    }
  }
  window.updateSheetLinkUI = updateSheetLinkUI;

  async function setInspectionSheetDelinked(delinked) {
    try {
      localStorage.setItem(STORAGE_KEY, delinked ? "true" : "false");
    } catch (e) {}

    // Persist to Firestore if available
    const isMock = typeof isMockMode === "function" ? isMockMode() : false;
    if (!isMock && typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
      try {
        const u = getUser();
        const db = firebase.firestore();
        await db.collection("system_monitoring").doc("inspection_sync_status").set({
          isDelinked: !!delinked,
          updatedBy: (u && u.email) || "Super Admin",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.warn("[Sheet Link] Failed to persist status in Firestore:", err);
      }
    }

    updateSheetLinkUI();
  }
  window.setInspectionSheetDelinked = setInspectionSheetDelinked;

  async function toggleGoogleSheetLink() {
    const u = getUser();
    if (!u || u.role !== "super_admin") {
      alert("Unauthorized: Only Super Admin can link or delink the Google Sheet.");
      return;
    }

    const currentlyDelinked = isInspectionSheetDelinked();

    if (currentlyDelinked) {
      // Prompt before committing changes to link
      const proceed = window.confirm(
        "🔗 Confirm Re-linking Google Sheet\n\n" +
        "Are you sure you want to RE-LINK the Google Sheet to the Inspection stage?\n\n" +
        "• Incoming data from the Google Sheet will start flowing into the Inspection stage again.\n" +
        "• Fresh entries will be fetched immediately.\n\n" +
        "Do you want to proceed?"
      );

      if (!proceed) {
        return; // User canceled before committing changes
      }

      await setInspectionSheetDelinked(false);

      if (typeof showToast === "function") {
        showToast("Google Sheet Linked", "Google Sheet successfully re-linked to Inspection stage! Fetching incoming entries...", "success");
      } else {
        alert("Google Sheet re-linked successfully! Incoming entries will now sync.");
      }

      try {
        if (typeof createAuditLog === "function") {
          createAuditLog(u.email || "Super Admin", "N/A", "Google Sheet LINKED to Inspection stage by Super Admin");
        }
      } catch (e) {}

      // Fetch fresh data from Google Sheet so data comes again into the inspection stage
      if (typeof loadInspectionKPs === "function") {
        try {
          await loadInspectionKPs(true);
        } catch (err) {
          console.error("[Sheet Link] Error loading inspection KPs on link:", err);
        }
      }

      if (typeof renderAll === "function") {
        renderAll();
      }
    } else {
      // Prompt before committing changes to delink
      const proceed = window.confirm(
        "⚠️ Confirm Delinking Google Sheet\n\n" +
        "Are you sure you want to DELINK the Google Sheet from the Inspection stage?\n\n" +
        "• Incoming entries from Google Sheet will NOT enter the Inspection stage.\n" +
        "• Automatic sync for spreadsheet jobs will be paused.\n" +
        "• You can re-link the Google Sheet at any time.\n\n" +
        "Do you want to proceed?"
      );

      if (!proceed) {
        return; // User canceled before committing changes
      }

      await setInspectionSheetDelinked(true);

      if (typeof showToast === "function") {
        showToast("Google Sheet Delinked", "Google Sheet successfully delinked from Inspection stage. Incoming data sync is paused.", "warning");
      } else {
        alert("Google Sheet delinked successfully. Incoming entries to Inspection stage are paused.");
      }

      try {
        if (typeof createAuditLog === "function") {
          createAuditLog(u.email || "Super Admin", "N/A", "Google Sheet DELINKED from Inspection stage by Super Admin");
        }
      } catch (e) {}

      if (typeof updateInspectionDropdowns === "function") {
        updateInspectionDropdowns();
      }

      if (typeof renderAll === "function") {
        renderAll();
      }
    }
  }
  window.toggleGoogleSheetLink = toggleGoogleSheetLink;

  function attachListeners() {
    const btnInsp = document.getElementById("btn-sheet-toggle-inspection");
    if (btnInsp && !btnInsp._boundSheetLink) {
      btnInsp._boundSheetLink = true;
      btnInsp.addEventListener("click", toggleGoogleSheetLink);
    }

    const btnAdmin = document.getElementById("btn-sheet-toggle-admin");
    if (btnAdmin && !btnAdmin._boundSheetLink) {
      btnAdmin._boundSheetLink = true;
      btnAdmin.addEventListener("click", toggleGoogleSheetLink);
    }
  }

  function startFirestoreListener() {
    const isMock = typeof isMockMode === "function" ? isMockMode() : false;
    if (isMock || typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return;
    try {
      const db = firebase.firestore();
      db.collection("system_monitoring").doc("inspection_sync_status").onSnapshot(doc => {
        if (doc && doc.exists) {
          const data = doc.data();
          if (data && typeof data.isDelinked !== "undefined") {
            const current = isInspectionSheetDelinked();
            const remote = !!data.isDelinked;
            if (current !== remote) {
              localStorage.setItem(STORAGE_KEY, remote ? "true" : "false");
              updateSheetLinkUI();
              if (current && !remote) {
                // Remotely re-linked: fetch sheet data
                if (typeof loadInspectionKPs === "function") {
                  loadInspectionKPs(true).catch(e => console.error(e));
                }
              } else if (!current && remote) {
                // Remotely delinked: update dropdowns
                if (typeof updateInspectionDropdowns === "function") {
                  updateInspectionDropdowns();
                }
              }
            }
          }
        }
      }, err => {
        console.warn("[Sheet Link] Listener notice:", err.message);
      });
    } catch (e) {}
  }

  // Initialize once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      attachListeners();
      updateSheetLinkUI();
      startFirestoreListener();
    });
  } else {
    attachListeners();
    updateSheetLinkUI();
    startFirestoreListener();
  }
})();
