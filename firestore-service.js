
async function createFirestoreAuditLog(userEmail, department, kpNumber, action, details) {
  const isMock = isMockMode();
  if (isMock) return;
  
  try {
    const db = firebase.firestore();
    let userId = "system";
    let userRole = "System";
    if (currentUser) {
      userId = currentUser.uid || "system";
      userRole = currentUser.role || "Operator";
    }
    
    await db.collection("audit_logs").add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userId: userId,
      userEmail: userEmail || currentUser?.email || "System",
      role: userRole,
      department: department || "System",
      kpNumber: kpNumber || "N/A",
      action: action,
      details: details || `${userRole.toUpperCase()} action: ${action}`
    });
  } catch (err) {
    console.warn("Failed to write firestore audit log:", err.message || err);
    handleFirestoreError("audit-log-write", err);
  }
}

function logErrorToFirestore(action, error) {
  if (isMockMode()) {
    console.warn("Mock Mode: Error logged:", action, error);
    return;
  }
  try {
    const db = firebase.firestore();
    db.collection("error_logs").add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userId: currentUser ? currentUser.uid : "unknown",
      path: window.location.hash || "app.js",
      errorMessage: error.message || String(error),
      stackTrace: error.stack || ""
    });
  } catch(e) {
    console.error("Failed to write error log to firestore:", e);
  }
}

function handleFirestoreError(source, err) {
  console.error(`[Firestore Error] from ${source}:`, err);
  const errMsg = String(err.message || err || "").toLowerCase();
  
  if (
    errMsg.includes("quota") || 
    errMsg.includes("limit") || 
    errMsg.includes("exceeded") || 
    errMsg.includes("resource-exhausted") || 
    errMsg.includes("permission-denied") || 
    errMsg.includes("unavailable")
  ) {
    if (localStorage.getItem("psp_auth_mock") !== "true") {
      console.warn("⚠️ Firestore quota/limit exceeded or resource exhausted. Falling back to Mock/Offline Mode...");
      localStorage.setItem("psp_auth_mock", "true");
      
      // Unsubscribe all active listeners immediately to prevent crash loops
      if (Array.isArray(firestoreListeners)) {
        firestoreListeners.forEach(unsub => {
          try { unsub(); } catch(e) {}
        });
        firestoreListeners = [];
      }

      // Terminate Firestore and delete Firebase app to completely stop background reconnection retries
      try {
        if (typeof firebase !== 'undefined') {
          firebase.firestore().terminate().catch(() => {});
          firebase.app().delete().catch(() => {});
        }
      } catch (e) {
        console.warn("Failed to shut down Firebase background threads:", e);
      }
      
      // Load offline state and render
      if (typeof loadState === 'function') {
        loadState().then(() => {
          renderAll();
          if (typeof showToast === 'function') {
            showToast(
              "⚠️ Offline Mode Fallback", 
              "Firebase daily usage limit exceeded. We've switched you to offline mode so you can continue working smoothly. Your changes will save locally.", 
              "warning", 
              15000
            );
          }
        });
      }
    }
  }
}

function startFirestoreListeners() {
  if (isMockMode()) return;
  
  try {
    const db = firebase.firestore();
    
    firestoreListeners.forEach(unsub => {
      try { unsub(); } catch(e) {}
    });
    firestoreListeners = [];
    
    // 1. Listen to jobs
    const unsubJobs = db.collection("jobs").onSnapshot(snapshot => {
      let tempJobs = [];
      window.deletedJobs = window.deletedJobs || new Set();
      window.deletedJobs.clear();
      
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isDeleted === true) {
          if (data.kpNumber) {
            window.deletedJobs.add(data.kpNumber.toLowerCase());
          }
          return;
        }
        
        const job = {
          id: doc.id,
          jobId: data.jobId || doc.id,
          kpNumber: data.kpNumber,
          partName: data.partName || "Unknown Part",
          customer: data.customer || "Unknown Customer",
          quantity: Number(data.quantity || 1),
          processType: data.processType || "Plasma",
          priority: data.priority || "Normal",
          currentDepartment: data.currentStage || "Inspection",
          status: data.currentStatus || "Pending",
          operatorName: data.assignedOperator?.name || "",
          shift: data.shift || "",
          storeLocation: data.storeLocation || "",
          qtyHistory: data.qtyHistory || [],
          splitRemark: data.splitRemark || "",
          inspection: data.inspection || { status: "Pending" },
          masking: data.masking || { status: "Pending", materials: [], holdHistory: [] },
          spraying: data.spraying || { status: "Pending" },
          grinding: data.grinding || { status: "Pending", holdHistory: [] },
          polishing: data.polishing || { status: "Pending" },
          finalInspection: data.finalInspection || { status: "Pending" },
          dispatch: data.dispatch || { status: "Pending" },
          jcNo: data.jcNo || "",
          inspectionDate: data.inspectionDate || "",
          plannedCompletionDate: data.plannedCompletionDate || "",
          stageAssignedAt: data.stageAssignedAt || {}
        };
        if (!job.jcNo && window.kpToJcMap && job.kpNumber && window.kpToJcMap[job.kpNumber.toUpperCase()]) {
          job.jcNo = window.kpToJcMap[job.kpNumber.toUpperCase()];
        }
        tempJobs.push(job);
      });
      
      jobs = tempJobs;
      try {
        localStorage.setItem("psp_cached_jobs", JSON.stringify(tempJobs));
        localStorage.setItem("psp_deleted_jobs", JSON.stringify(Array.from(window.deletedJobs)));
      } catch (e) {}
      _initialFirestoreLoadComplete = true;
      if (typeof autoAssignPendingJobs === "function") {
        autoAssignPendingJobs();
      }
      renderAll();
    }, err => {
      handleFirestoreError("jobs-listener", err);
    });
    firestoreListeners.push(unsubJobs);
    
    // 2. Listen to users
    const unsubUsers = db.collection("users").onSnapshot(snapshot => {
      let tempUsers = [];
      let tempOperators = [];
      snapshot.forEach(doc => {
        const u = doc.data();
        tempUsers.push(u);
        if (u.role === 'operator') {
          tempOperators.push({
            id: u.uid || doc.id,
            name: (u.name && u.name.trim() !== "") ? u.name : (u.email ? u.email.split('@')[0] : "Operator"),
            shift: u.shift || "A Shift",
            jobsAssigned: Number(u.jobsAssigned || 0),
            jobsCompleted: Number(u.jobsCompleted || 0),
            activeTimeMs: Number(u.activeTimeMs || 0)
          });
        }
      });
      users = tempUsers;
      if (tempOperators.length > 0) {
        operators = tempOperators;
      }
      try {
        localStorage.setItem("psp_cached_users", JSON.stringify(tempUsers));
        localStorage.setItem("psp_cached_operators", JSON.stringify(tempOperators));
      } catch (e) {}
      renderAll();
    }, err => {
      handleFirestoreError("users-listener", err);
    });
    firestoreListeners.push(unsubUsers);
    
    // 3. Listen to machines
    const unsubMachines = db.collection("machines").onSnapshot(snapshot => {
      let tempMachines = [];
      snapshot.forEach(doc => {
        tempMachines.push(doc.data());
      });
      machines = tempMachines;
      renderAll();
    }, err => {
      handleFirestoreError("machines-listener", err);
    });
    firestoreListeners.push(unsubMachines);
    
    // 4. Listen to master_materials
    const unsubMaterials = db.collection("master_materials").onSnapshot(snapshot => {
      let tempMaterials = [];
      snapshot.forEach(doc => {
        tempMaterials.push(doc.data());
      });
      materials = tempMaterials;
      try {
        localStorage.setItem("psp_cached_materials", JSON.stringify(tempMaterials));
      } catch (e) {}
      renderAll();
    }, err => {
      handleFirestoreError("materials-listener", err);
    });
    firestoreListeners.push(unsubMaterials);
    
    // 5. Listen to audit_logs (only if role is admin/IT/quality/hr)
    const userRole = currentUser ? currentUser.role : "";
    const isDmdAuthorized = userRole === 'super_admin' || userRole === 'production_admin' || userRole === 'it_team';
    
    if (isDmdAuthorized || userRole === 'quality_admin' || userRole === 'hr_admin') {
      const unsubAudit = db.collection("audit_logs").orderBy("timestamp", "desc").limit(50).onSnapshot(snapshot => {
        let tempAudit = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          tempAudit.push({
            timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : (data.timestamp || new Date().toISOString()),
            user: data.userEmail || data.user || "System",
            role: data.role || "Operator",
            department: data.department || "Masking",
            kpNumber: data.kpNumber || "N/A",
            action: data.action || data.details || "Event"
          });
        });
        auditLogs = tempAudit;
        try {
          localStorage.setItem("psp_cached_audit_logs", JSON.stringify(tempAudit));
        } catch (e) {}
        renderAll();
      }, err => {
        handleFirestoreError("audit-logs-listener", err);
      });
      firestoreListeners.push(unsubAudit);
    }
    
    // 6. Listen to departments
    const unsubDepts = db.collection("departments").orderBy("sequence", "asc").onSnapshot(snapshot => {
      let tempDepts = [];
      snapshot.forEach(doc => {
        tempDepts.push(doc.data());
      });
      window.departmentsList = tempDepts;
      renderAll();
    }, err => {
      handleFirestoreError("departments-listener", err);
    });
    firestoreListeners.push(unsubDepts);
    
    // 7. Listen to system_monitoring (only if IT / Admin)
    if (isDmdAuthorized) {
      const unsubSys = db.collection("system_monitoring").onSnapshot(snapshot => {
        let tempSys = {};
        snapshot.forEach(doc => {
          tempSys[doc.id] = doc.data();
        });
        window.systemMonitoringData = tempSys;
        renderAll();
      }, err => {
        handleFirestoreError("system-monitoring-listener", err);
      });
      firestoreListeners.push(unsubSys);
    }
    
    // 8. Listen to error_logs (only if IT / Admin)
    if (isDmdAuthorized) {
      const unsubErr = db.collection("error_logs").orderBy("timestamp", "desc").limit(50).onSnapshot(snapshot => {
        let tempErr = [];
        snapshot.forEach(doc => {
          tempErr.push(doc.data());
        });
        window.errorLogsData = tempErr;
        renderAll();
      }, err => {
        handleFirestoreError("error-logs-listener", err);
      });
      firestoreListeners.push(unsubErr);
    }

    // 9. Listen to notifications
    const unsubNotifications = db.collection("notifications").orderBy("timestamp", "desc").limit(20).onSnapshot(snapshot => {
      let tempNotifications = [];
      snapshot.forEach(doc => {
        tempNotifications.push(doc.data());
      });
      window.notificationsData = tempNotifications;
      renderAll();
    }, err => {
      handleFirestoreError("notifications-listener", err);
    });
    firestoreListeners.push(unsubNotifications);
    
    // 10. Listen to deleted jobs
    const unsubDeleted = db.collection("deleted_jobs").onSnapshot(snapshot => {
      window.deletedJobs = window.deletedJobs || new Set();
      window.deletedJobs.clear();
      snapshot.forEach(doc => {
        window.deletedJobs.add(doc.id.toLowerCase());
      });
      try {
        localStorage.setItem("psp_deleted_jobs", JSON.stringify(Array.from(window.deletedJobs)));
      } catch (e) {}
    }, err => {
      console.warn("Deleted jobs listener error:", err);
    });
    firestoreListeners.push(unsubDeleted);
    
  } catch (err) {
    console.error("Error initializing Firestore listeners:", err);
  }
}

async function seedFirestoreDatabaseIfEmpty() {
  if (isMockMode()) return;
  try {
    const db = firebase.firestore();
    
    const deptsSnap = await db.collection("departments").limit(1).get();
    if (deptsSnap.empty) {
      console.log("Seeding departments Master database in Firestore...");
      const depts = [
        { name: "Inspection", sequence: 1, allowedStoreLocations: ["A1", "A2", "A3"], allowedPauseReasons: ["Quality Issue", "Other"] },
        { name: "Masking", sequence: 2, allowedStoreLocations: ["M1", "M2", "M3"], allowedPauseReasons: ["Material Shortage", "Operator Unavailable", "Other"] },
        { name: "Spraying", sequence: 3, allowedStoreLocations: ["S1", "S2", "S3"], allowedPauseReasons: ["Machine Issue", "Quality Issue", "Other"] },
        { name: "Grinding", sequence: 4, allowedStoreLocations: ["C20", "B27", "A15", "D08"], allowedPauseReasons: ["Material Shortage", "Operator Unavailable", "Machine Issue", "Quality Issue", "Other"] },
        { name: "Polishing", sequence: 5, allowedStoreLocations: ["P1", "P2"], allowedPauseReasons: ["Machine Issue", "Other"] },
        { name: "Final Inspection", sequence: 6, allowedStoreLocations: ["F1", "F2"], allowedPauseReasons: ["Quality Issue", "Other"] },
        { name: "Dispatch", sequence: 7, allowedStoreLocations: ["D1", "D2"], allowedPauseReasons: ["Customer Hold", "Other"] }
      ];
      const batch = db.batch();
      depts.forEach(d => {
        const ref = db.collection("departments").doc(d.name);
        batch.set(ref, d);
      });
      await batch.commit();
    }
    
    const matsSnap = await db.collection("master_materials").limit(1).get();
    if (matsSnap.empty) {
      console.log("Seeding master materials database in Firestore...");
      const batch = db.batch();
      SEED_MATERIALS.forEach(m => {
        const ref = db.collection("master_materials").doc(m.name.toLowerCase().replace(/[^a-z0-9]/g, "_"));
        batch.set(ref, {
          materialId: m.id || m.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name: m.name,
          category: m.type || "Consumable",
          unit: m.unit || "KG",
          department: "Masking",
          isActive: true
        });
      });
      await batch.commit();
    }
    
    const machsSnap = await db.collection("machines").limit(1).get();
    if (machsSnap.empty) {
      console.log("Seeding machines database in Firestore...");
      const machs = [
        { machineId: "hmt_g17", name: "HMT G17", type: "Grinding Machine", department: "Grinding", status: "idle", lastMaintenance: firebase.firestore.FieldValue.serverTimestamp() },
        { machineId: "amba", name: "Amba", type: "Grinding Machine", department: "Grinding", status: "idle", lastMaintenance: firebase.firestore.FieldValue.serverTimestamp() },
        { machineId: "kirloskar", name: "Kirloskar", type: "Grinding Machine", department: "Grinding", status: "idle", lastMaintenance: firebase.firestore.FieldValue.serverTimestamp() }
      ];
      const batch = db.batch();
      machs.forEach(m => {
        const ref = db.collection("machines").doc(m.machineId);
        batch.set(ref, m);
      });
      await batch.commit();
    }

    // Seeding individual operators into Firestore users collection
    const opsToSeed = [
      { name: "SJ", email: "sj.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500001" },
      { name: "DN", email: "dn.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500002" },
      { name: "Tripati", email: "tripati.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500003" },
      { name: "GN", email: "gn.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500004" },
      { name: "Vikrant", email: "vikrant.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500005" },
      { name: "Sameer", email: "sameer.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500006" },
      { name: "Dhuryodhan", email: "dhuryodhan.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500007" },
      { name: "TJ", email: "tj.masking@plasmaspray.co.in", role: "operator", department: "Masking", pin: "500008" },
      
      { name: "prism", email: "prism.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600001" },
      { name: "Suraj", email: "suraj.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600002" },
      { name: "Amrish", email: "amrish.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600003" },
      { name: "Duryodhan", email: "duryodhan.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600004" },
      { name: "TJ", email: "tj.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600005" },
      { name: "Bhushan", email: "bhushan.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600006" },
      { name: "Avinash", email: "avinash.spraying@plasmaspray.co.in", role: "operator", department: "Spraying", pin: "600007" }
    ];

    for (const op of opsToSeed) {
      const q = await db.collection("users").where("email", "==", op.email).get();
      if (q.empty) {
        const docId = `op-${op.name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${op.department.toLowerCase()}`;
        await db.collection("users").doc(docId).set({
          uid: docId,
          name: op.name,
          email: op.email,
          role: op.role,
          department: op.department,
          pin: op.pin,
          active: true,
          emailVerified: true
        });
        console.log(`[Firestore Seed] Auto-created operator record for: ${op.name} (${op.email})`);
      }
    }
  } catch (err) {
    console.error("Firestore DB seeding error:", err);
  }
}