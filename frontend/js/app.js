/**
 * MES Shop Floor Dashboard - Main Bootstrapper
 *
 * The monolithic app.js has been refactored into 11 cohesive modular scripts:
 * - state.js: Global variables, database maps, cache managers, and MOCK_DB.
 * - utils.js: Pure utility calculations, formatting helpers, and access checks.
 * - timer.js: Shop floor timers, operator run-time clocks, and countdowns.
 * - firestore-service.js: Firestore transactions, collection event streams, and error telemetry.
 * - google-sheet-service.js: Google Sheets GViz adapters and synchronization engine.
 * - render.js: Router rendering active tabs, workflows, timeline charts, and Kanban boards.
 * - inspection.js: QC intake registries, dropdown lookups, and validations.
 * - masking.js: Masking active runs, consumables tracking, and operator assignments.
 * - spraying.js: Flame/plasma spraying runs, booth metrics, and logs.
 * - grinding.js: Cylindrical/surface grinding machine feeds and cycle logs.
 * - dashboard.js: Access profiles, permissions filters, UI themes, DMD dashboards, and initApp().
 */

console.log("[App] MES Shop Floor Dashboard booted successfully from modular scripts.");
