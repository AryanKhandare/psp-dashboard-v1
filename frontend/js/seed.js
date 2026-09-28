// Zoho Projects MES Dashboard - Seed Data Configurator
const SEED_MACHINES = [
  { id: "m-1", name: "Amba", status: "Active", department: "Grinding" },
  { id: "m-2", name: "HMT G17", status: "Active", department: "Grinding" },
  { id: "m-3", name: "Zanetti Toss", status: "Active", department: "Grinding" },
  { id: "m-4", name: "Landis M12", status: "Maintenance", department: "Grinding" },
  { id: "m-5", name: "Spitfire Polish-X", status: "Active", department: "Polishing" }
];

const SEED_OPERATORS = [
  { id: "uid-masking-operator", name: "Rajesh Patil", shift: "A Shift", jobsAssigned: 0, jobsCompleted: 0, activeTimeMs: 0 },
  { id: "uid-spraying-operator", name: "Spraying Operator", shift: "B Shift", jobsAssigned: 0, jobsCompleted: 0, activeTimeMs: 0 },
  { id: "uid-grinding-operator", name: "Grinding Operator", shift: "C Shift", jobsAssigned: 0, jobsCompleted: 0, activeTimeMs: 0 },
  { id: "uid-polishing-operator", name: "Polishing Operator", shift: "A Shift", jobsAssigned: 0, jobsCompleted: 0, activeTimeMs: 0 },
  { id: "uid-gt-operator", name: "Inspector 02", shift: "A Shift", jobsAssigned: 0, jobsCompleted: 0, activeTimeMs: 0 }
];

const SEED_MATERIALS = [
  { id: "mat-1", name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: 1.0, actualQty: 0 },
  { id: "mat-2", name: "High Temperature Putty", type: "Sealant", batch: "HTP-9921", unit: "Gram", plannedQty: 350, actualQty: 0 },
  { id: "mat-3", name: "Ceramic Protection Tape", type: "Tape", batch: "CPT-1044", unit: "KG", plannedQty: 0.8, actualQty: 0 },
  { id: "mat-4", name: "Silicone Plugs", type: "Masking Aid", batch: "SP-883", unit: "Gram", plannedQty: 120, actualQty: 0 },
  { id: "mat-5", name: "Metal Shielding Foil", type: "Foil", batch: "MSF-774", unit: "KG", plannedQty: 2.5, actualQty: 0 }
];

const SEED_JOBS = [
  {
    kpNumber: "KP-1001",
    partName: "Turbine Blade - Stage 1",
    customer: "HAL (Hindustan Aeronautics Ltd)",
    quantity: 5,
    processType: "Plasma",
    priority: "High",
    inspectionDate: "2026-06-14",
    receivedDate: "2026-06-15",
    currentDepartment: "Masking",
    status: "Pending", // Global Status
    operatorName: "",
    shift: "",
    inspection: {
      status: "Completed",
      startTime: "2026-06-14T08:00:00Z",
      endTime: "2026-06-14T09:30:00Z",
      operatorName: "Supervisor A"
    },
    masking: {
      operatorName: "",
      shift: "",
      status: "Pending",
      startTime: null,
      endTime: null,
      durationMs: 0,
      activeTimeMs: 0,
      lastStartedAt: null,
      lastPausedAt: null,
      holdHistory: [],
      materials: [
        { name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: 1.0, actualQty: 0 },
        { name: "High Temperature Putty", type: "Sealant", batch: "HTP-9921", unit: "Gram", plannedQty: 150, actualQty: 0 }
      ]
    },
    spraying: { status: "Pending" },
    grinding: { status: "Pending" },
    polishing: { status: "Pending" },
    finalInspection: { status: "Pending" },
    dispatch: { status: "Pending" }
  },
  {
    kpNumber: "KP-1002",
    partName: "Gas Turbine Impeller",
    customer: "ISRO (Indian Space Research Org)",
    quantity: 2,
    processType: "HCOS",
    priority: "Critical",
    inspectionDate: "2026-06-13",
    receivedDate: "2026-06-15",
    currentDepartment: "Masking",
    status: "Pending",
    operatorName: "",
    shift: "",
    inspection: {
      status: "Completed",
      startTime: "2026-06-13T10:00:00Z",
      endTime: "2026-06-13T11:15:00Z",
      operatorName: "Supervisor A"
    },
    masking: {
      operatorName: "",
      shift: "",
      status: "Pending",
      startTime: null,
      endTime: null,
      durationMs: 0,
      activeTimeMs: 0,
      lastStartedAt: null,
      lastPausedAt: null,
      holdHistory: [],
      materials: [
        { name: "Ceramic Protection Tape", type: "Tape", batch: "CPT-1044", unit: "KG", plannedQty: 0.8, actualQty: 0 }
      ]
    },
    spraying: { status: "Pending" },
    grinding: { status: "Pending" },
    polishing: { status: "Pending" },
    finalInspection: { status: "Pending" },
    dispatch: { status: "Pending" }
  },
  {
    kpNumber: "KP-1003",
    partName: "Combustion Chamber Liner",
    customer: "BHEL (Bharat Heavy Electricals)",
    quantity: 10,
    processType: "Plasma",
    priority: "Normal",
    inspectionDate: "2026-06-14",
    receivedDate: "2026-06-15",
    currentDepartment: "Inspection", // Currently in Inspection (waiting for approval)
    status: "Inspection Pending",
    operatorName: "",
    shift: "",
    inspection: {
      status: "Pending",
      queueEntryTime: "2026-06-14T08:10:00Z",
      startTime: null,
      endTime: null,
      operatorName: ""
    },
    masking: {
      operatorName: "",
      shift: "",
      status: "Pending",
      startTime: null,
      endTime: null,
      durationMs: 0,
      activeTimeMs: 0,
      lastStartedAt: null,
      lastPausedAt: null,
      holdHistory: [],
      materials: []
    },
    spraying: { status: "Pending" },
    grinding: { status: "Pending" },
    polishing: { status: "Pending" },
    finalInspection: { status: "Pending" },
    dispatch: { status: "Pending" }
  },
  {
    kpNumber: "KP-1004",
    partName: "Nozzle Guide Vane",
    customer: "GE Aviation India",
    quantity: 8,
    processType: "HCOS",
    priority: "High",
    inspectionDate: "2026-06-14",
    receivedDate: "2026-06-15",
    currentDepartment: "Masking",
    status: "Pending",
    operatorName: "",
    shift: "",
    inspection: {
      status: "Completed",
      startTime: "2026-06-14T11:00:00Z",
      endTime: "2026-06-14T12:00:00Z",
      operatorName: "Supervisor A"
    },
    masking: {
      operatorName: "",
      shift: "",
      status: "Pending",
      startTime: null,
      endTime: null,
      durationMs: 0,
      activeTimeMs: 0,
      lastStartedAt: null,
      lastPausedAt: null,
      holdHistory: [],
      materials: [
        { name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: 2.0, actualQty: 0 },
        { name: "Silicone Plugs", type: "Masking Aid", batch: "SP-883", unit: "Gram", plannedQty: 200, actualQty: 0 }
      ]
    },
    spraying: { status: "Pending" },
    grinding: { status: "Pending" },
    polishing: { status: "Pending" },
    finalInspection: { status: "Pending" },
    dispatch: { status: "Pending" }
  },
  // A pre-completed job for history
  {
    kpNumber: "KP-0985",
    partName: "Compressor Rotor",
    customer: "Siemens India",
    quantity: 1,
    processType: "HCOS",
    priority: "Normal",
    inspectionDate: "2026-06-12",
    receivedDate: "2026-06-13",
    currentDepartment: "Spraying", // Already passed masking
    status: "Completed",
    operatorName: "Rajesh Patil",
    shift: "B Shift",
    inspection: {
      status: "Completed",
      startTime: "2026-06-12T09:00:00Z",
      endTime: "2026-06-12T10:00:00Z",
      operatorName: "Supervisor A"
    },
    masking: {
      operatorName: "Rajesh Patil",
      shift: "B Shift",
      status: "Completed",
      startTime: "2026-06-13T09:15:00Z",
      endTime: "2026-06-13T10:45:00Z",
      durationMs: 5400000, // 1.5 hours
      activeTimeMs: 5400000,
      lastStartedAt: "2026-06-13T09:15:00Z",
      lastPausedAt: null,
      holdHistory: [],
      materials: [
        { name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: 1.0, actualQty: 0.95 }
      ]
    },
    spraying: { status: "Pending" },
    grinding: { status: "Pending" },
    polishing: { status: "Pending" },
    finalInspection: { status: "Pending" },
    dispatch: { status: "Pending" }
  }
];

const SEED_AUDIT_LOGS = [
  { timestamp: "2026-06-15T08:00:00Z", user: "Supervisor A", department: "Inspection", kpNumber: "KP-1001", action: "Job Received" },
  { timestamp: "2026-06-15T08:05:00Z", user: "Supervisor A", department: "Inspection", kpNumber: "KP-1002", action: "Job Received" },
  { timestamp: "2026-06-15T08:10:00Z", user: "Supervisor A", department: "Inspection", kpNumber: "KP-1004", action: "Job Received" },
  { timestamp: "2026-06-13T10:45:00Z", user: "Rajesh Patil", department: "Masking", kpNumber: "KP-0985", action: "Job Completed" }
];
