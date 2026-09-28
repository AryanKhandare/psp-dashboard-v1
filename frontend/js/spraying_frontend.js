import React, { useEffect, useMemo, useRef, useState } from "react";

export default function SprayBoothDashboard() {
  const [appState, setAppState] = useState("SELECT");
  const getCleanKpNumber = (kp) => {
    if (!kp) return "";
    const index = kp.indexOf("-R");
    return index !== -1 ? kp.substring(0, index) : kp;
  };
  const renderQuantity = (qty, qtyHistory) => {
    if (qtyHistory && qtyHistory.length > 0) {
      const historyParts = qtyHistory.map(h => `${h.qty} done in ${h.stage} out of ${h.originalTotal}`);
      const historyText = `(${historyParts.join(", ")})`;
      return (
        <span style={{ color: "#ef4444", fontWeight: "bold" }}>
          {qty} pcs <span style={{ fontSize: "0.85em", marginLeft: 5 }}>{historyText}</span>
        </span>
      );
    }
    return <span>{qty} pcs</span>;
  };
  const [pendingJobs, setPendingJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [runningJobs, setRunningJobs] = useState([]);
  const [finishedJobs, setFinishedJobs] = useState([]);
  const [openFinishedJobId, setOpenFinishedJobId] = useState(null);

  const [noWorkTime, setNoWorkTime] = useState(0);
  const [operatorIdleTime, setOperatorIdleTime] = useState(0);
  const [activeWorkTime, setActiveWorkTime] = useState(0);

  const [cycleSeconds, setCycleSeconds] = useState(0);

  const [batchId, setBatchId] = useState("");
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [tempBatchId, setTempBatchId] = useState("");
  const [jobQty, setJobQty] = useState("");

  const [jobLocation, setJobLocation] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [customOperatorName, setCustomOperatorName] = useState("");
  const [sprayingBooth, setSprayingBooth] = useState("");

  const [finishedJobForms, setFinishedJobForms] = useState({});
  const [savingJobs, setSavingJobs] = useState({});

  const tickRef = useRef(null);
  const segmentStartRef = useRef(Date.now());
  const noWorkBaseRef = useRef(0);
  const idleBaseRef = useRef(0);
  const activeBaseRef = useRef(0);
  const cycleBaseRef = useRef(0);
  const savingJobsRef = useRef(new Set());

  const scriptUrl =
    (window.parent && window.parent.scriptUrl) ||
    "https://script.google.com/macros/s/AKfycbxlnuCmkzKn-_dL0E740TKzRQBDMWVUOOnFwti0ygq1Bqg68b7Rcu8CJ0-X7X0MW2hRhg/exec";
  const buildRequestId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  useEffect(() => {
    if (window.parent) {
      window.parent.sprayingJobActive = (appState === "RUNNING");
    }
  }, [appState]);

  useEffect(() => {
    const enterParentFullscreen = () => {
      if (window.parent && window.parent.document && !window.parent.document.fullscreenElement) {
        window.parent.document.documentElement.requestFullscreen().catch(err => {
          console.warn("Fullscreen request blocked from within iframe:", err);
        });
      }
    };

    const parentUser = window.parent && window.parent.currentUser;
    const isSprayingOp = parentUser && 
      parentUser.role === 'operator' && 
      (parentUser.department || '').toLowerCase().includes('spray');

    if (isSprayingOp) {
      document.addEventListener("click", enterParentFullscreen);
      document.addEventListener("touchstart", enterParentFullscreen);
    }

    return () => {
      document.removeEventListener("click", enterParentFullscreen);
      document.removeEventListener("touchstart", enterParentFullscreen);
    };
  }, []);

  useEffect(() => {
    fetch(scriptUrl)
      .then((res) => res.json())
      .then((data) => {
        const normalizedData = (Array.isArray(data) ? data : [])
          .map((job, index) => {
            const importedQty = String(job.Qty ?? job.qty ?? "").trim();
            const pendingQty = String(
              job.PendingQty ?? job.pendingQty ?? job.D ?? ""
            ).trim();

            const resolvedQty = pendingQty !== "" ? pendingQty : importedQty;

             return {
              ...job,
              id: String(job.id || job.jobId || job.ID || "").trim(),
              fallbackId: `ROW-${index + 1}`,
              qty: resolvedQty,
              importedQty,
              pendingQty,
              status: String(job.Status ?? job.status ?? "").trim(),
              customerName: String(
                job.CustomerName ??
                  job["Customer Name"] ??
                  job.customerName ??
                  job.Customer ??
                  job.customer ??
                  ""
              ).trim(),
              part: String(job.part ?? job.Part ?? "").trim(),
              qtyHistory: job.qtyHistory || [],
              jcNo: String(job.jcNo || job.jcno || "").trim()
            };
          })
          .filter((job) => {
            const hasRealId = job.id !== "";
            const hasPart = job.part !== "";
            const hasQty = String(job.qty || "").trim() !== "";
            const hasCustomer = job.customerName !== "";

            return hasRealId || hasPart || hasQty || hasCustomer;
          })
          .map((job, index) => ({
            ...job,
            id: job.id || `ROW-${index + 1}`,
          }));

        console.log("DATA:", normalizedData);
        setPendingJobs(normalizedData);
      })
      .catch((err) => console.error("Fetch failed:", err));
  }, [scriptUrl]);

  const getCurrentMode = () => {
    if (pendingJobs.length === 0) return "NOWORK";
    if (appState !== "RUNNING") return "IDLE";
    return "ACTIVE";
  };

  const syncElapsedTimes = () => {
    const now = Date.now();
    const segmentStart = segmentStartRef.current || now;
    const elapsed = Math.floor((now - segmentStart) / 1000);
    const mode = getCurrentMode();

    setNoWorkTime(noWorkBaseRef.current + (mode === "NOWORK" ? elapsed : 0));
    setOperatorIdleTime(idleBaseRef.current + (mode === "IDLE" ? elapsed : 0));
    setActiveWorkTime(activeBaseRef.current + (mode === "ACTIVE" ? elapsed : 0));

    if (appState === "RUNNING" && activeJob) {
      setCycleSeconds(cycleBaseRef.current + elapsed);
    } else {
      setCycleSeconds(0);
    }

    setRunningJobs((prev) =>
      prev.map((job) => {
        if (!job.cycleStartTime) return job;

        const jobElapsed = Math.floor((now - job.cycleStartTime) / 1000);
        return {
          ...job,
          cycleSeconds: (job.cycleBaseSeconds || 0) + jobElapsed,
        };
      })
    );
  };

  const commitCurrentSegment = () => {
    const now = Date.now();
    const startedAt = segmentStartRef.current || now;
    const elapsed = Math.floor((now - startedAt) / 1000);
    const mode = getCurrentMode();

    if (mode === "NOWORK") noWorkBaseRef.current += elapsed;
    if (mode === "IDLE") idleBaseRef.current += elapsed;
    if (mode === "ACTIVE") activeBaseRef.current += elapsed;

    if (appState === "RUNNING" && activeJob) {
      cycleBaseRef.current += elapsed;
    }

    setRunningJobs((prev) =>
      prev.map((job) => {
        if (!job.cycleStartTime) return job;

        const jobElapsed = Math.floor((now - job.cycleStartTime) / 1000);
        return {
          ...job,
          cycleBaseSeconds: (job.cycleBaseSeconds || 0) + jobElapsed,
          cycleStartTime: now,
          cycleSeconds: (job.cycleBaseSeconds || 0) + jobElapsed,
        };
      })
    );

    segmentStartRef.current = now;
  };

  useEffect(() => {
    commitCurrentSegment();

    if (tickRef.current) {
      clearInterval(tickRef.current);
    }

    tickRef.current = setInterval(() => {
      syncElapsedTimes();
    }, 1000);

    syncElapsedTimes();

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
      }
    };
  }, [appState, pendingJobs.length, activeJob?.id]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      commitCurrentSegment();
      syncElapsedTimes();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [appState, pendingJobs.length, activeJob?.id]);

  const totalTime = noWorkTime + operatorIdleTime + activeWorkTime;

  const oee =
    totalTime === 0 ? 0 : ((activeWorkTime / totalTime) * 100).toFixed(1);

  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds || 0));
    const hrs = Math.floor(safeSeconds / 3600)
      .toString()
      .padStart(2, "0");

    const mins = Math.floor((safeSeconds % 3600) / 60)
      .toString()
      .padStart(2, "0");

    const secs = (safeSeconds % 60).toString().padStart(2, "0");

    return `${hrs}:${mins}:${secs}`;
  };

  const activeTimer = useMemo(() => {
    if (pendingJobs.length === 0) return "NOWORK";
    if (appState !== "RUNNING") return "IDLE";
    return "ACTIVE";
  }, [appState, pendingJobs.length]);

  const handleSelectJob = (job) => {
    setActiveJob(job);
    setJobLocation(job.location || "");
    setAppState("READY");
  };

  const handleStart = () => {
    setTempBatchId("");
    setJobQty(activeJob ? String(activeJob.qty || "") : "");
    setJobLocation(activeJob ? (activeJob.location || "") : "");
    setOperatorName("");
    setCustomOperatorName("");
    setSprayingBooth("");
    setShowBatchModal(true);
  };

  const handleEndCycle = () => {
    commitCurrentSegment();
    cycleBaseRef.current = 0;
    setCycleSeconds(0);

    setRunningJobs((prev) =>
      prev.map((job) =>
        job.id === activeJob?.id
          ? {
              ...job,
              cycleBaseSeconds: 0,
              cycleStartTime: null,
              cycleSeconds: 0,
            }
          : job
      )
    );

    setAppState("READY");
  };

  const handleFinishedJobFieldChange = (jobId, field, value) => {
    setFinishedJobForms((prev) => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        [field]: value,
      },
    }));
  };

  const handleEndJob = (job) => {
    const now = Date.now();
    const frozenCycleSeconds = job.cycleStartTime
      ? (job.cycleBaseSeconds || 0) +
        Math.floor((now - job.cycleStartTime) / 1000)
      : job.cycleSeconds || 0;

    const finishedJob = {
      ...job,
      cycleSeconds: frozenCycleSeconds,
      cycleBaseSeconds: frozenCycleSeconds,
      cycleStartTime: null,
      endTime: now,
    };

    setFinishedJobs((prev) => {
      const exists = prev.some((item) => item.id === job.id);
      if (exists) {
        return prev.map((item) => (item.id === job.id ? finishedJob : item));
      }
      return [...prev, finishedJob];
    });

    setFinishedJobForms((prev) => ({
      ...prev,
      [job.id]: {
        processedQty:
          prev[job.id]?.processedQty || String(jobQty || job.qty || ""),
        nextProcess: prev[job.id]?.nextProcess || "",
        totalPasses: prev[job.id]?.totalPasses || "",
        finalTemp: prev[job.id]?.finalTemp || "",
        finalThickness: prev[job.id]?.finalThickness || "",
        finalSize: prev[job.id]?.finalSize || "",
        powderConsumed: prev[job.id]?.powderConsumed || "",
      },
    }));

    setRunningJobs((prev) =>
      prev.filter((runningJob) => runningJob.id !== job.id)
    );

    setOpenFinishedJobId(job.id);

    if (activeJob?.id === job.id) {
      cycleBaseRef.current = 0;
      setCycleSeconds(0);
    }
  };

  const handleSaveFinishedJob = async (job) => {
    if (savingJobsRef.current.has(job.id)) {
      return;
    }

    const form = finishedJobForms[job.id] || {};

    if (!form.processedQty) {
      alert("Enter Job Qty");
      return;
    }

    if (!form.nextProcess) {
      alert("Select Next Process");
      return;
    }

    if (Number(form.processedQty) > Number(job.qty || 0)) {
      alert("Job Qty cannot exceed available Qty");
      return;
    }

    savingJobsRef.current.add(job.id);
    setSavingJobs((prev) => ({ ...prev, [job.id]: true }));

    try {
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({
          type: "SAVE_SPRAYING_JOB",
          requestId: buildRequestId(),
          batchId: batchId || "",
          jobId: job.id,
          part: job.part,
          customerName: job.customerName || "",
          qty: job.qty,
          processedQty: form.processedQty || "",
          nextProcess: form.nextProcess || "",
          totalPasses: form.totalPasses || "",
          finalTemp: form.finalTemp || "",
          finalThickness: form.finalThickness || "",
          finalSize: form.finalSize || "",
          powderConsumed: form.powderConsumed || "",
          cycleSeconds: job.cycleSeconds || 0,
          noWorkTime,
          operatorIdleTime,
          activeWorkTime,
          shiftOEE: oee,
          location: job.location || "",
          operatorName: job.operatorName || "",
          sprayingBooth: job.sprayingBooth || "",
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save job");
      }

      setPendingJobs((prev) => prev.filter((item) => item.id !== job.id));
      setFinishedJobs((prev) => prev.filter((item) => item.id !== job.id));

      setFinishedJobForms((prev) => {
        const updated = { ...prev };
        delete updated[job.id];
        return updated;
      });

      if (openFinishedJobId === job.id) {
        setOpenFinishedJobId(null);
      }

      if (activeJob?.id === job.id) {
        setActiveJob(null);
        setBatchId("");
        setJobQty("");
        setJobLocation("");
        setOperatorName("");
        setCustomOperatorName("");
        setSprayingBooth("");
        cycleBaseRef.current = 0;
        setCycleSeconds(0);

        if (runningJobs.filter((item) => item.id !== job.id).length === 0) {
          setAppState("SELECT");
        } else {
          setAppState("RUNNING");
        }
      }

      alert(
        result.duplicate
          ? "Duplicate ignored, job already saved"
          : "Job saved successfully"
      );
    } catch (error) {
      console.error("Finished job save failed:", error);
      alert("Failed to save job");
    } finally {
      savingJobsRef.current.delete(job.id);
      setSavingJobs((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const MetricCard = ({ title, value, active }) => {
    return (
      <div
        style={{
          background: active ? "#2563eb" : "#1e293b",
          border: active ? "3px solid #60a5fa" : "2px solid #334155",
          borderRadius: 20,
          minHeight: 132,
          padding: "16px 14px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          transition: "0.2s",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: "clamp(16px, 1.8vw, 22px)",
            lineHeight: 1.15,
            fontWeight: 800,
            color: "#cbd5e1",
            marginBottom: 10,
            letterSpacing: 0.3,
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: "clamp(28px, 3vw, 42px)",
            lineHeight: 1,
            fontWeight: 900,
            color: "white",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: 1,
          }}
        >
          {value}
        </div>
      </div>
    );
  };

  const commonInputStyle = {
    width: "100%",
    height: 78,
    borderRadius: 18,
    border: "3px solid #475569",
    background: "#0f172a",
    color: "white",
    fontSize: "clamp(24px, 2.4vw, 32px)",
    fontWeight: 700,
    padding: "0 18px",
    outline: "none",
    boxSizing: "border-box",
  };

  const compactInputStyle = {
    width: "100%",
    height: 52,
    borderRadius: 12,
    border: "2px solid #475569",
    background: "#0f172a",
    color: "white",
    fontSize: "18px",
    fontWeight: 700,
    padding: "0 14px",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
        background: "#0f172a",
        fontFamily: "Arial, sans-serif",
        color: "white",
      }}
    >
      <div
        style={{
          flex: "0 0 245px",
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
          padding: 16,
          borderBottom: "3px solid #334155",
          boxSizing: "border-box",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            gap: 14,
            height: "100%",
            alignItems: "stretch",
          }}
        >
          {pendingJobs.map((job) => (
            <button
              type="button"
              key={job.id}
              onClick={() => handleSelectJob(job)}
              style={{
                minWidth: 260,
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
                borderRadius: 22,
                border:
                  activeJob?.id === job.id
                    ? "4px solid #22d3ee"
                    : "2px solid #475569",
                background: activeJob?.id === job.id ? "#155e75" : "#1e293b",
                color: "white",
                padding: 16,
                cursor: "pointer",
                textAlign: "left",
                justifyContent: "flex-start",
                boxSizing: "border-box",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: "clamp(28px, 2.8vw, 36px)",
                  fontWeight: 900,
                  lineHeight: 1,
                }}
              >
                {getCleanKpNumber(job.id)} {job.jcNo ? `(${job.jcNo})` : ""}
              </div>
 
              <div
                style={{
                  fontSize: "clamp(18px, 1.8vw, 22px)",
                  color: "white",
                  marginTop: 10,
                  fontWeight: 700,
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                }}
              >
                {job.part}
              </div>
 
              <div
                style={{
                  fontSize: "clamp(14px, 1.3vw, 17px)",
                  color: "#93c5fd",
                  marginTop: 8,
                  fontWeight: 700,
                  whiteSpace: "normal",
                  lineHeight: 1.25,
                  wordBreak: "break-word",
                }}
              >
                Customer: {job.customerName || "-"}
              </div>
 
              <div
                style={{
                  fontSize: "clamp(17px, 1.6vw, 20px)",
                  color: "#cbd5e1",
                  marginTop: 10,
                }}
              >
                Qty: {renderQuantity(job.qty, job.qtyHistory)}
              </div>
              {job.splitRemark && (
                <div
                  style={{
                    fontSize: "clamp(12px, 1vw, 14px)",
                    color: "#f97316",
                    marginTop: 5,
                    fontWeight: "bold",
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                  }}
                >
                  Split Remark: {job.splitRemark}
                </div>
              )}
            </button>
          ))}

          {pendingJobs.length === 0 && (
            <div
              style={{
                color: "#94a3b8",
                fontSize: "clamp(26px, 2.6vw, 34px)",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                height: "100%",
                paddingInline: 16,
              }}
            >
              No Pending Jobs
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 20,
          boxSizing: "border-box",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          className="tablet-metric-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <MetricCard title="SHIFT OEE" value={`${oee}%`} active={false} />
          <MetricCard
            title="NO WORK"
            value={formatTime(noWorkTime)}
            active={activeTimer === "NOWORK"}
          />
          <MetricCard
            title="OPERATOR IDLE"
            value={formatTime(operatorIdleTime)}
            active={activeTimer === "IDLE"}
          />
          <MetricCard
            title="ACTIVE WORK"
            value={formatTime(activeWorkTime)}
            active={activeTimer === "ACTIVE"}
          />
        </div>

        {appState === "SELECT" && (
          <div
            style={{
              minHeight: "calc(100% - 170px)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              color: "#94a3b8",
              fontSize: "clamp(28px, 4vw, 42px)",
              fontWeight: 800,
              textAlign: "center",
              lineHeight: 1.15,
              padding: "24px 16px",
            }}
          >
            Select a job from the top row.
          </div>
        )}

        {appState === "READY" && activeJob && (
          <div>
            <div
              style={{
                background: "#1e293b",
                borderRadius: 24,
                padding: 24,
                marginBottom: 24,
                border: "2px solid #334155",
              }}
            >
              <div
                style={{
                  fontSize: "clamp(36px, 4vw, 48px)",
                  fontWeight: 900,
                  marginBottom: 14,
                  lineHeight: 1,
                }}
              >
                {getCleanKpNumber(activeJob.id)} {activeJob.jcNo ? `(${activeJob.jcNo})` : ""}
              </div>
 
              <div
                style={{
                  fontSize: "clamp(24px, 2.5vw, 32px)",
                  color: "#e2e8f0",
                  marginBottom: 12,
                  lineHeight: 1.2,
                }}
              >
                Part: {activeJob.part}
              </div>
 
              <div
                style={{
                  fontSize: "clamp(22px, 2.2vw, 28px)",
                  color: "#93c5fd",
                  marginBottom: 12,
                  lineHeight: 1.2,
                }}
              >
                Customer: {activeJob.customerName || "-"}
              </div>
 
              <div
                style={{
                  fontSize: "clamp(24px, 2.5vw, 32px)",
                  color: "#e2e8f0",
                  marginBottom: 12,
                  lineHeight: 1.2,
                }}
              >
                Quantity: {renderQuantity(activeJob.qty, activeJob.qtyHistory)}
              </div>
              {activeJob.splitRemark && (
                <div
                  style={{
                    fontSize: "clamp(16px, 1.6vw, 20px)",
                    color: "#f97316",
                    marginBottom: 12,
                    fontWeight: "bold",
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                  }}
                >
                  Split Remark: {activeJob.splitRemark}
                </div>
              )}

              <div
                style={{
                  fontSize: "clamp(22px, 2.2vw, 28px)",
                  color: "#38bdf8",
                  fontWeight: 800,
                  lineHeight: 1.2,
                }}
              >
                Location: {activeJob.location}
              </div>
            </div>

            <button
              type="button"
              onClick={handleStart}
              style={{
                width: "100%",
                minHeight: 110,
                borderRadius: 24,
                border: "none",
                background: "#16a34a",
                color: "white",
                fontSize: "clamp(32px, 3.4vw, 42px)",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              START CYCLE
            </button>
          </div>
        )}

        {showBatchModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.75)",
              zIndex: 9999,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <div
              style={{
                width: "min(560px, 100%)",
                background: "#1e293b",
                borderRadius: 28,
                padding: 28,
                border: "3px solid #3b82f6",
                boxSizing: "border-box",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  fontSize: "clamp(28px, 3vw, 34px)",
                  fontWeight: 900,
                  color: "white",
                  marginBottom: 22,
                  textAlign: "center",
                }}
              >
                Start Spraying Cycle
              </div>

              {/* Batch ID */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ color: "#94a3b8", display: "block", marginBottom: 6, fontWeight: "bold", fontSize: 18 }}>Batch ID:</label>
                <input
                  value={tempBatchId}
                  onChange={(e) => setTempBatchId(e.target.value)}
                  autoFocus
                  placeholder="Enter Batch ID"
                  style={compactInputStyle}
                />
              </div>

              {/* Job Qty */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ color: "#94a3b8", display: "block", marginBottom: 6, fontWeight: "bold", fontSize: 18 }}>Job Qty:</label>
                <input
                  type="number"
                  placeholder="Job Qty"
                  value={jobQty}
                  onChange={(e) => setJobQty(e.target.value)}
                  style={compactInputStyle}
                />
              </div>

              {/* Store Location */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ color: "#94a3b8", display: "block", marginBottom: 6, fontWeight: "bold", fontSize: 18 }}>Store Location:</label>
                <select
                  value={jobLocation}
                  onChange={(e) => {
                    setJobLocation(e.target.value);
                    setSprayingBooth(""); // reset booth on location change
                  }}
                  style={compactInputStyle}
                >
                  <option value="">Select Location</option>
                  <option value="B-37">B-37</option>
                  <option value="C-20/4">C-20/4</option>
                </select>
              </div>

              {/* Spraying Booth */}
              {(jobLocation === "B-37" || jobLocation === "C-20/4") && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ color: "#94a3b8", display: "block", marginBottom: 6, fontWeight: "bold", fontSize: 18 }}>Spraying Booth:</label>
                  <select
                    value={sprayingBooth}
                    onChange={(e) => setSprayingBooth(e.target.value)}
                    style={compactInputStyle}
                  >
                    <option value="">Select Booth</option>
                    {jobLocation === "B-37" ? (
                      <>
                        <option value="Booth 4">Booth 4</option>
                        <option value="Booth 5">Booth 5</option>
                      </>
                    ) : (
                      <>
                        <option value="Booth 1">Booth 1</option>
                        <option value="Booth 2">Booth 2</option>
                        <option value="Booth 3">Booth 3</option>
                      </>
                    )}
                  </select>
                </div>
              )}

              {/* Operator Name */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ color: "#94a3b8", display: "block", marginBottom: 6, fontWeight: "bold", fontSize: 18 }}>Operator Name:</label>
                <select
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  style={compactInputStyle}
                >
                  <option value="">Select Operator</option>
                  {(window.parent && Array.isArray(window.parent.operators)
                    ? window.parent.operators.map(op => op.name)
                    : ["Laxmi", "SJ", "Aryan", "Venkatesh"]
                  ).map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Custom Operator Name */}
              {operatorName === "Other" && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ color: "#94a3b8", display: "block", marginBottom: 6, fontWeight: "bold", fontSize: 18 }}>Custom Operator Name:</label>
                  <input
                    value={customOperatorName}
                    onChange={(e) => setCustomOperatorName(e.target.value)}
                    placeholder="Enter Custom Operator Name"
                    style={compactInputStyle}
                  />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 24 }}>
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  style={{
                    width: "100%",
                    height: 70,
                    borderRadius: 18,
                    border: "2px solid #64748b",
                    background: "#334155",
                    color: "white",
                    fontSize: 22,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  CANCEL
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!tempBatchId) {
                      alert("Enter Batch ID");
                      return;
                    }

                    if (!jobQty) {
                      alert("Enter Job Qty");
                      return;
                    }

                    const maxJobQty = Number(activeJob?.qty || 0);

                    if (Number(jobQty) > maxJobQty) {
                      alert("Job Qty cannot exceed available Qty");
                      return;
                    }

                    if (!jobLocation) {
                      alert("Select Store Location");
                      return;
                    }

                    if (!sprayingBooth) {
                      alert("Select Spraying Booth");
                      return;
                    }

                    if (!operatorName) {
                      alert("Select Operator Name");
                      return;
                    }

                    if (operatorName === "Other" && !customOperatorName.trim()) {
                      alert("Enter Custom Operator Name");
                      return;
                    }

                    const chosenOperator = operatorName === "Other" ? customOperatorName.trim() : operatorName;
                    const now = Date.now();

                    // Save location immediately to Firestore
                    fetch(scriptUrl, {
                      method: "POST",
                      headers: {
                        "Content-Type": "text/plain",
                      },
                      body: JSON.stringify({
                        type: "MATERIAL_LOCATION",
                        jobId: activeJob.id,
                        part: activeJob.part,
                        qty: activeJob.qty,
                        location: jobLocation,
                      }),
                    }).catch(err => {
                      console.error("Failed to save location immediately:", err);
                    });

                    setBatchId(tempBatchId);
                    setShowBatchModal(false);
                    setOpenFinishedJobId(null);
                    cycleBaseRef.current = 0;
                    segmentStartRef.current = now;
                    setCycleSeconds(0);
                    setAppState("RUNNING");

                    const runningJobData = {
                      ...activeJob,
                      location: jobLocation,
                      operatorName: chosenOperator,
                      sprayingBooth: sprayingBooth,
                      batchId: tempBatchId,
                      qty: Number(jobQty),
                      startTime: now,
                      cycleStartTime: now,
                      cycleBaseSeconds: 0,
                      cycleSeconds: 0,
                    };

                    setRunningJobs((prev) => {
                      const exists = prev.some((item) => item.id === activeJob.id);

                      if (exists) {
                        return prev.map((item) =>
                          item.id === activeJob.id ? runningJobData : item
                        );
                      }

                      return [...prev, runningJobData];
                    });
                  }}
                  style={{
                    width: "100%",
                    height: 70,
                    borderRadius: 18,
                    border: "none",
                    background: "#2563eb",
                    color: "white",
                    fontSize: 22,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  START CYCLE
                </button>
              </div>
            </div>
          </div>
        )}

        {appState === "RUNNING" && (
          <div>
            <div
              style={{
                background: "#020617",
                border: "4px solid #22c55e",
                borderRadius: 28,
                padding: "34px 20px",
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  fontSize: "clamp(64px, 10vw, 110px)",
                  fontWeight: 900,
                  color: "#22c55e",
                  letterSpacing: 2,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatTime(cycleSeconds)}
              </div>
            </div>

            {runningJobs.length > 0 && (
              <div
                style={{
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 900,
                    marginBottom: 18,
                    color: "#22c55e",
                  }}
                >
                  ACTIVE JOBS
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                    gap: 18,
                  }}
                >
                  {runningJobs.map((job) => (
                    <div
                      key={job.id}
                      style={{
                        background: "#14532d",
                        borderRadius: 24,
                        padding: 22,
                        border: "3px solid #22c55e",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 34,
                          fontWeight: 900,
                          marginBottom: 12,
                        }}
                      >
                        {getCleanKpNumber(job.id)} {job.jcNo ? `(${job.jcNo})` : ""}
                      </div>
 
                      <div
                        style={{
                          fontSize: 24,
                          marginBottom: 10,
                        }}
                      >
                        {job.part}
                      </div>
 
                      <div
                        style={{
                          fontSize: 20,
                          color: "#bfdbfe",
                          marginBottom: 10,
                          fontWeight: 700,
                        }}
                      >
                        Customer: {job.customerName || "-"}
                      </div>
 
                      <div
                        style={{
                          fontSize: 22,
                          color: "#bbf7d0",
                          marginBottom: 18,
                        }}
                      >
                        Qty: {renderQuantity(job.qty, job.qtyHistory)}
                      </div>
                      
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          marginBottom: 16,
                          fontSize: 16,
                          color: "#cbd5e1"
                        }}
                      >
                        <div><strong style={{ color: "white" }}>Location:</strong> {job.location || "-"}</div>
                        {job.sprayingBooth && <div><strong style={{ color: "white" }}>Booth:</strong> {job.sprayingBooth}</div>}
                        {job.operatorName && <div><strong style={{ color: "white" }}>Operator:</strong> {job.operatorName}</div>}
                      </div>
                      {job.splitRemark && (
                        <div
                          style={{
                            fontSize: 14,
                            color: "#f97316",
                            marginBottom: 10,
                            fontWeight: "bold",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                          }}
                        >
                          Split Remark: {job.splitRemark}
                        </div>
                      )}
 
                      <div
                        style={{
                          fontSize: 42,
                          fontWeight: 900,
                          color: "white",
                          marginBottom: 20,
                        }}
                      >
                        {formatTime(job.cycleSeconds || 0)}
                      </div>
 
                      <button
                        type="button"
                        onClick={() => handleEndJob(job)}
                        style={{
                          width: "100%",
                          height: 74,
                          borderRadius: 18,
                          border: "none",
                          background: "#dc2626",
                          color: "white",
                          fontSize: 24,
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        END JOB
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
 
            <button
              type="button"
              onClick={handleEndCycle}
              style={{
                width: "100%",
                minHeight: 110,
                borderRadius: 24,
                border: "none",
                background: "#dc2626",
                color: "white",
                fontSize: "clamp(32px, 3.4vw, 42px)",
                fontWeight: 900,
                cursor: "pointer",
                marginTop: 24,
              }}
            >
              END CYCLE
            </button>
          </div>
        )}
 
        {finishedJobs.length > 0 && (
          <div
            style={{
              marginTop: 40,
            }}
          >
            <div
              style={{
                fontSize: 34,
                fontWeight: 900,
                marginBottom: 18,
                color: "#facc15",
              }}
            >
              FINISHED JOBS
            </div>
 
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))",
                gap: 22,
              }}
            >
              {finishedJobs.map((job) => {
                const form = finishedJobForms[job.id] || {};
                const isSaving = !!savingJobs[job.id];
 
                return (
                  <div
                    key={job.id}
                    style={{
                      background: "#1e293b",
                      borderRadius: 24,
                      padding: 24,
                      border: "3px solid #facc15",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 34,
                        fontWeight: 900,
                        marginBottom: 10,
                      }}
                    >
                      {getCleanKpNumber(job.id)} {job.jcNo ? `(${job.jcNo})` : ""}
                    </div>

                    <div
                      style={{
                        fontSize: 22,
                        marginBottom: 20,
                      }}
                    >
                      {job.part}
                    </div>

                    {openFinishedJobId === job.id && (
                      <>
                        <input
                          type="number"
                          placeholder="Job Qty"
                          value={form.processedQty || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "processedQty",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        />

                        <div style={{ height: 12 }} />

                        <select
                          value={form.nextProcess || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "nextProcess",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        >
                          <option value="">Select Next Process</option>
                          <option value="Inspection">Inspection</option>
                          <option value="Masking">Masking</option>
                          <option value="Spraying">Spraying</option>
                          <option value="Grinding">Grinding</option>
                          <option value="Polishing">Polishing</option>
                          <option value="Final Inspection">
                            Final Inspection
                          </option>
                          <option value="Dispatch">Dispatch</option>
                        </select>

                        <div style={{ height: 12 }} />

                        <input
                          type="number"
                          placeholder="Total Passes"
                          value={form.totalPasses || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "totalPasses",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        />

                        <div style={{ height: 12 }} />

                        <input
                          type="number"
                          placeholder="Final Temp"
                          value={form.finalTemp || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "finalTemp",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        />

                        <div style={{ height: 12 }} />

                        <input
                          type="number"
                          placeholder="Final Thickness"
                          value={form.finalThickness || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "finalThickness",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        />

                        <div style={{ height: 12 }} />

                        <input
                          type="number"
                          placeholder="Final Size"
                          value={form.finalSize || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "finalSize",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        />

                        <div style={{ height: 12 }} />

                        <input
                          type="number"
                          placeholder="Powder Consumed"
                          value={form.powderConsumed || ""}
                          onChange={(e) =>
                            handleFinishedJobFieldChange(
                              job.id,
                              "powderConsumed",
                              e.target.value
                            )
                          }
                          style={commonInputStyle}
                        />

                        <div style={{ height: 18 }} />

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveFinishedJob(job)}
                          style={{
                            width: "100%",
                            height: 74,
                            borderRadius: 18,
                            border: "none",
                            background: isSaving ? "#64748b" : "#2563eb",
                            color: "white",
                            fontSize: 24,
                            fontWeight: 900,
                            cursor: isSaving ? "not-allowed" : "pointer",
                            opacity: isSaving ? 0.75 : 1,
                          }}
                        >
                          {isSaving ? "SAVING..." : "SAVE JOB"}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .tablet-metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }

        input::placeholder {
          color: #94a3b8;
          opacity: 1;
        }

        select option {
          color: white;
          background: #0f172a;
        }

        button:active {
          transform: scale(0.99);
        }

        button:disabled:active {
          transform: none;
        }
      `}</style>
    </div>
  );
}