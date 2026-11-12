/**
 * PSP MES – Geo-lock: operators can use the dashboard only at the PSP plants.
 *
 * For restricted roles (operators), the device location is checked at login, every few minutes, and when the
 * app is opened again. Outside the plant zones, location refused, or location switched off → the dashboard is
 * blocked and the user is logged out. Each block is written to the Audit Log (distance only, never the location).
 * Optional working-hours lock (off by default).
 *
 * Load after the other add-ons (just before mes-stage-sync.js / app.js).
 */
(function () {
  const MODULE_VERSION = 1;

  // ======================= SETTINGS (edit here) =======================
  const ZONES = [
    { name: "B-37",   lat: 19.062396295250046, lng: 73.11311411495991 },
    { name: "C-20/4", lat: 19.06308649150058,  lng: 73.1146715800821 }
  ];
  const RADIUS_M = 300;                 // allowed distance from a plant (metres)
  const MAX_ACCURACY_ALLOWANCE_M = 300; // extra metres allowed for inaccurate (Wi-Fi) positions
  const RESTRICTED_ROLES = ["operator"];// roles that must be at the plant
  const EXEMPT_EMAILS = [];             // e.g. ["someone@plasmaspray.co.in"] – never restricted
  const CHECK_EVERY_MIN = 10;           // re-check interval while the dashboard is open
  const HOURS_LOCK = {                  // optional: allow restricted roles only during working hours
    enabled: false,
    start: "09:00", end: "17:30",
    offDays: [5]                        // 0 = Sunday … 5 = Friday, 6 = Saturday
  };
  // ====================================================================

  const getUser = () => {
    try { if (typeof currentUser !== "undefined" && currentUser) return currentUser; } catch (e) {}
    try { return JSON.parse(localStorage.getItem("psp_logged_in_user") || "null"); } catch (e) { return null; }
  };
  const isRestricted = u => !!u && RESTRICTED_ROLES.includes(u.role) &&
    !EXEMPT_EMAILS.map(e => e.toLowerCase()).includes(String(u.email || "").toLowerCase());

  function distanceM(a, b) {
    const R = 6371000, toRad = x => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function nearestZone(pos) {
    return ZONES.map(z => ({ zone: z, d: distanceM(pos, z) })).sort((x, y) => x.d - y.d)[0];
  }
  function withinHours(now) {
    if (!HOURS_LOCK.enabled) return true;
    if (HOURS_LOCK.offDays.includes(now.getDay())) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = HOURS_LOCK.start.split(":").map(Number), [eh, em] = HOURS_LOCK.end.split(":").map(Number);
    return mins >= sh * 60 + sm && mins <= eh * 60 + em;
  }

  // ---------- full-screen blocker ----------
  function overlay() {
    let el = document.getElementById("psp-geo-lock");
    if (el) return el;
    el = document.createElement("div");
    el.id = "psp-geo-lock";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-live", "assertive");
    el.style.cssText = "position:fixed; inset:0; z-index:20000; background:rgba(15,23,42,.97); color:#f8fafc; display:none; " +
      "align-items:center; justify-content:center; padding:20px; font-family:inherit; text-align:center;";
    el.innerHTML = `<div style="max-width:440px;">
        <div id="psp-geo-icon" style="font-size:46px; margin-bottom:10px;">📍</div>
        <div id="psp-geo-title" style="font-size:20px; font-weight:800; margin-bottom:8px;">Checking your location…</div>
        <div id="psp-geo-text" style="font-size:14px; line-height:1.55; opacity:.9;">The PSP dashboard can only be used at the plant.</div>
        <div id="psp-geo-buttons" style="display:none; gap:10px; justify-content:center; margin-top:18px; flex-wrap:wrap;">
          <button type="button" id="psp-geo-retry" style="height:44px; padding:0 18px; border-radius:8px; border:0; background:#3b82f6; color:#fff; font-weight:800; font-size:15px;">Try again</button>
          <button type="button" id="psp-geo-logout" style="height:44px; padding:0 18px; border-radius:8px; border:1px solid #94a3b8; background:transparent; color:#f8fafc; font-weight:700; font-size:15px;">Log out</button>
        </div>
        <div id="psp-geo-count" style="font-size:12px; opacity:.7; margin-top:12px;"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#psp-geo-retry").addEventListener("click", () => check(true));
    el.querySelector("#psp-geo-logout").addEventListener("click", logout);
    return el;
  }
  function show(icon, title, text, withButtons) {
    const el = overlay();
    el.querySelector("#psp-geo-icon").textContent = icon;
    el.querySelector("#psp-geo-title").textContent = title;
    el.querySelector("#psp-geo-text").innerHTML = text;
    el.querySelector("#psp-geo-buttons").style.display = withButtons ? "flex" : "none";
    el.style.display = "flex";
  }
  function hide() { const el = document.getElementById("psp-geo-lock"); if (el) el.style.display = "none"; clearCountdown(); }

  let countdown = null;
  function clearCountdown() { if (countdown) { clearInterval(countdown); countdown = null; } const c = document.getElementById("psp-geo-count"); if (c) c.textContent = ""; }
  function startCountdown(sec) {
    clearCountdown();
    let left = sec;
    const c = document.getElementById("psp-geo-count");
    const tick = () => { if (c) c.textContent = `Logging out in ${left} s…`; if (left-- <= 0) { clearCountdown(); logout(); } };
    tick(); countdown = setInterval(tick, 1000);
  }

  async function logout() {
    try { localStorage.removeItem("psp_logged_in_user"); } catch (e) {}
    try { if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) await firebase.auth().signOut(); } catch (e) {}
    window.location.href = "login.html";
  }

  function audit(text) {
    const u = getUser() || {};
    try { if (typeof createAuditLog === "function") createAuditLog(u.email || u.name || "operator", null, text); } catch (e) {}
  }

  // ---------- the check ----------
  let lastOk = 0, checking = false, blockedLogged = false;
  function block(reason, auditText) {
    show("⛔", "Dashboard not available here", reason +
      `<br><br><span style="opacity:.75; font-size:12.5px;">If you are at the plant: switch on location (GPS) and allow it for this site, then press <b>Try again</b>.</span>`, true);
    startCountdown(60);
    if (!blockedLogged) { blockedLogged = true; audit(auditText); }
  }

  function check(manual) {
    const u = getUser();
    if (!isRestricted(u)) { hide(); return; }
    if (checking) return;
    if (!withinHours(new Date())) {
      block(`Operators can use the dashboard only during working hours (${HOURS_LOCK.start}–${HOURS_LOCK.end}).`, "Geo-lock: blocked outside working hours");
      return;
    }
    if (!("geolocation" in navigator)) { block("This device cannot share its location.", "Geo-lock: blocked – device has no location support"); return; }
    checking = true;
    if (manual || !lastOk) show("📍", "Checking your location…", "The PSP dashboard can only be used at the plant.", false);
    navigator.geolocation.getCurrentPosition(p => {
      checking = false;
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      const acc = Math.min(Number(p.coords.accuracy) || 0, MAX_ACCURACY_ALLOWANCE_M);
      const near = nearestZone(pos);
      if (near.d <= RADIUS_M + acc) {
        lastOk = Date.now(); blockedLogged = false; hide();
      } else {
        const km = near.d >= 1000 ? (near.d / 1000).toFixed(1) + " km" : Math.round(near.d) + " m";
        block(`You are about <b>${km}</b> from the nearest PSP plant (${near.zone.name}).<br>The dashboard can only be used inside the plant premises.`,
          `Geo-lock: blocked – ${km} from ${near.zone.name} (accuracy ±${Math.round(p.coords.accuracy)} m)`);
      }
    }, err => {
      checking = false;
      const why = err.code === 1 ? "Location permission was refused."
        : err.code === 3 ? "Your location could not be found in time."
        : "Your location could not be read.";
      block(why + "<br>Operators must allow location to use the dashboard.", "Geo-lock: blocked – " + why);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  }

  function start() {
    if (!isRestricted(getUser())) return;
    check(false);
    setInterval(() => check(false), CHECK_EVERY_MIN * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - lastOk > 5 * 60 * 1000) check(false);
    });
  }

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
    window.PSPGeoLock = { check: () => check(true), zones: ZONES, radius: RADIUS_M };
    console.log("[PSP] geo-lock v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] geo-lock failed to load:", err);
  }
})();
