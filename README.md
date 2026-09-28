# Plasma Spray Processors - MES Operations Dashboard

A real-time Manufacturing Execution System (MES) and operations monitoring platform for Plasma Spray Processors (PSP), integrating shop floor stage tracking across Inspection, Masking, Spraying, Grinding, Polishing, and Dispatch.

---

## 📁 Repository Structure

```
psp-dashboard-v1/
├── frontend/                     # Client application (HTML, CSS, JS)
│   ├── index.html                # Main MES shop-floor operations dashboard
│   ├── login.html                # Secure corporate access & operator PIN gateway
│   ├── spraying.html             # Spray booth specialized control console
│   ├── css/                      # Curated design systems & stylesheets
│   │   ├── styles.css            # Dark/light theme dashboard styles
│   │   └── login.css             # Authentication portal styling
│   └── js/                       # Modular frontend architecture
│       ├── app.js                # Core UI initialization & event delegation
│       ├── dashboard.js          # User management, stage flows, KPI metrics
│       ├── firebase-config.js    # Firebase & Google Apps Script configuration
│       ├── firestore-service.js  # Real-time Firestore sync & listeners
│       ├── google-sheet-service.js # Google Sheet FMS synchronization
│       ├── grinding.js           # Grinding stage controller
│       ├── inspection.js         # Inspection stage controller & Kanban
│       ├── login.js              # Authentication engine & operator PIN verification
│       ├── masking.js            # Masking stage controller
│       ├── render.js             # Table & board rendering utilities
│       ├── reports.js            # PDF/Excel report generator
│       ├── seed.js               # Client fallback mock data
│       ├── spraying.js           # Spraying stage controller
│       ├── spraying_frontend.js  # React spraying booth interface
│       ├── state.js              # Centralized reactive state store
│       ├── timer.js              # Job duration & OEE tracking timers
│       └── utils.js              # Global helper functions & RBAC permissions
│
├── backend/                      # Backend integrations & data pipelines
│   ├── google-apps-script/       # Google Apps Script Web App macros & sheet APIs
│   │   ├── PSP_Backend_API.js    # Master FMS sheet sync API
│   │   └── spraying_backend.js   # Spraying stage macro processor
│   └── scripts/                  # Diagnostic & automation CLI tools
│       ├── debug_names_and_gids.js
│       ├── explore_assignments.js
│       ├── explore_status.js
│       ├── find_delivered.js
│       ├── print_first_50.js
│       ├── query_macro_record.js
│       └── test_fetch.js
│
├── database/                     # Database schemas & configurations
│   ├── firestore.rules           # Cloud Firestore security & authorization rules
│   ├── seed.js                   # Canonical database seed configuration
│   └── README.md                 # Database architecture documentation
│
├── index.html                    # Root redirect to frontend/index.html
├── package.json                  # Project dependencies & development scripts
├── vercel.json                   # Vercel deployment routing & caching headers
└── .gitignore
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
* **Node.js** (v16+) or **Python 3**

### Running the App
Run the local development server:
```bash
npm run dev
```
Or start directly via Python:
```bash
python -m http.server 3000
```

* **Login Screen:** [http://localhost:3000/frontend/login.html](http://localhost:3000/frontend/login.html)
* **Main Dashboard:** [http://localhost:3000/frontend/index.html](http://localhost:3000/frontend/index.html)
*(Root URL [http://localhost:3000/](http://localhost:3000/) automatically redirects to `frontend/index.html`)*

---

## 🔐 Security & Access Control
* **Corporate Email Constraint:** Restricts account creation and sign-ins to `@plasmaspray.co.in` emails.
* **Role Permissions:** Supports granular role permissions:
  - `super_admin`: Full system & user administration
  - `production_admin`: Operational scheduling & dispatch
  - `quality_admin`: Quality inspection, pre-inspection, FIR
  - `operator`: Stage-specific execution (Masking, Spraying, Grinding, Polishing, Inspection)
  - `hr_admin`: Read-only audit & reporting
* **Operator Access Mode:** Fast PIN-based shop-floor authentication matching assigned department and name.
