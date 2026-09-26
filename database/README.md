# Database Security Rules & Seed Configurations

This directory maintains the Cloud Firestore security rules, master schemas, and seed data definitions for the Plasma Spray Processors MES system.

## Files

```
database/
├── firestore.rules   # Cloud Firestore security rules (role-based access control & domain enforcement)
└── seed.js           # Master seed definitions (machines, operators, materials, sample jobs)
```

## Cloud Firestore Security Rules
* **Role-Based Access Control:** `super_admin`, `production_admin`, `quality_admin`, `hr_admin`, `it_team`, `operator`
* **Domain Whitelist:** Restricts profile provisioning and writes to `@plasmaspray.co.in` corporate email addresses.
* **Collections Protected:**
  - `/users/{userId}`: Access profiles and Security PIN credentials
  - `/jobs/{jobId}`: Shop-floor jobs, process history, and material consumption
  - `/machines/{machineId}`: Equipment statuses and maintenance telemetry
  - `/master_materials/{materialId}`: Factory inventory catalog
  - `/audit_logs/{logId}`: Immutable audit tracking
