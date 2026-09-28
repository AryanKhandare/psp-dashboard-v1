# Backend Services & Google Apps Script Integrations

This directory contains the backend integration layers, Google Apps Script handlers, and diagnostic CLI scripts for the Plasma Spray Processors (PSP) MES platform.

## Directory Structure

```
backend/
├── google-apps-script/
│   ├── PSP_Backend_API.js      # Main Google Apps Script Web App API for FMS Google Sheet
│   └── spraying_backend.js     # Spraying stage macro and stage transition handlers
└── scripts/                    # Diagnostic, data exploration, and testing utility scripts
    ├── debug_names_and_gids.js
    ├── explore_assignments.js
    ├── explore_status.js
    ├── find_delivered.js
    ├── print_first_50.js
    ├── query_macro_record.js
    └── test_fetch.js
```

## Google Apps Script Endpoints
* **Web App URL:** Configured in `frontend/js/firebase-config.js` via `APPS_SCRIPT_WEB_APP_URL`
* **Actions Supported:**
  - `getJobs`: Fetches active jobs from FMS sheet
  - `getOperators`: Fetches operator list
  - `getMaterials`: Fetches bill of materials
  - `getAuditLogs`: Fetches system audit logs
  - `getInspectionKPs`: Dynamic query for Inspection arrival and pre-inspection records
