
function startAutoRefresh() {
  setInterval(async () => {
    if (!isMockMode()) {
      return; // Skip auto-refresh completely if in Firebase mode to prevent redundant renderAll lag spikes
    }
    if (pendingSyncCount > 0) {
      console.log("Skipping auto-refresh because backend sync is in progress.");
      return;
    }
    try {
      await loadState();
      renderAll();
      console.log("Auto-refreshed state from Google Sheets database.");
    } catch (e) {
      console.warn("Auto-refresh failed:", e);
    }
  }, 15000); // Poll every 15 seconds
}


function updateClock() {
  const now = new Date();
  const formatDigit = (num) => num.toString().padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${formatDigit(now.getMonth() + 1)}-${formatDigit(now.getDate())}`;
  const timeStr = `${formatDigit(now.getHours())}:${formatDigit(now.getMinutes())}:${formatDigit(now.getSeconds())}`;
  clockElement.textContent = `${dateStr} ${timeStr}`;
}

// 3. NAVIGATION SWITCHER
function setupNav() {
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      if (!targetTab) return;
      const hash = targetTab.replace('tab-', '');
      window.location.hash = `#/${hash}`;
    });
  });
}