// ============================================================
// PSP DASHBOARD — GAMIFIED WEEKLY PERFORMANCE REPORTS ENGINE
// ============================================================
// Calculates 5-pillar star ratings, badges, streaks, and
// leaderboard data for production operators.
// ============================================================

// ---- CONSTANTS ----
const REPORT_PILLARS = {
  SPEED: { name: 'Speed', icon: '⚡', max: 20, description: 'Job completion within benchmark time' },
  QUEUE: { name: 'Queue Response', icon: '⏳', max: 20, description: 'How fast you pick up waiting jobs' },
  IDLE: { name: 'Idle Discipline', icon: '🎯', max: 20, description: 'Minimal idle time when jobs are available' },
  THROUGHPUT: { name: 'Throughput', icon: '📦', max: 20, description: 'Jobs completed vs jobs received' },
  QUALITY: { name: 'Quality', icon: '🔄', max: 20, description: 'First pass yield (no reworks)' }
};

const STAR_TIERS = [
  { minScore: 90, stars: 5, label: 'Elite Performer', badge: '🏆', color: '#fbbf24' },
  { minScore: 75, stars: 4, label: 'Top Operator', badge: '🥇', color: '#34d399' },
  { minScore: 55, stars: 3, label: 'On Track', badge: '🟢', color: '#60a5fa' },
  { minScore: 35, stars: 2, label: 'Needs Improvement', badge: '🟡', color: '#f59e0b' },
  { minScore: 0,  stars: 1, label: 'Critical', badge: '🔴', color: '#ef4444' }
];

const BADGES = [
  { id: 'speed_demon', name: 'Speed Demon', icon: '⚡', condition: 'All jobs completed under benchmark time' },
  { id: 'zero_idle', name: 'Zero Idle', icon: '🎯', condition: 'Idle ratio under 5% for the week' },
  { id: 'perfect_quality', name: 'Perfect Quality', icon: '💎', condition: 'Zero reworks for the week' },
  { id: 'queue_crusher', name: 'Queue Crusher', icon: '🏃', condition: 'Avg queue pickup under 5 minutes' },
  { id: 'iron_streak', name: 'Iron Streak', icon: '🔥', condition: '3+ consecutive weeks with 4+ stars' },
  { id: 'centurion', name: 'Centurion', icon: '💯', condition: '100+ jobs completed in a single week' }
];

const PRODUCTION_STAGES = ['Inspection', 'Masking', 'Spraying', 'Grinding', 'Polishing', 'Final Inspection', 'Dispatch'];
const STAGE_KEY_MAP = {
  'Inspection': 'inspection',
  'Masking': 'masking',
  'Spraying': 'spraying',
  'Grinding': 'grinding',
  'Polishing': 'polishing',
  'Final Inspection': 'finalInspection',
  'Dispatch': 'dispatch'
};

// ---- WEEK UTILITIES ----

function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function getWeekId(date = new Date()) {
  const { start } = getWeekRange(date);
  return start.toISOString().split('T')[0];
}

function formatDurationReport(seconds) {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getDayLabel(dateStr) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date(dateStr).getDay()];
}

// ---- DATA COLLECTION ----

function collectWeeklyJobData(allJobs, operatorEmail, department, weekRange) {
  const stageKey = STAGE_KEY_MAP[department] || department.toLowerCase();
  const weekJobs = {
    received: [],
    started: [],
    completed: [],
    reworked: [],
    onHold: []
  };

  const allUsers = (typeof users !== 'undefined' && Array.isArray(users)) ? users : [];
  let matchEmail = "";
  let matchName = "";
  
  if (operatorEmail) {
    matchEmail = operatorEmail.toLowerCase().split('@')[0];
    const targetUser = allUsers.find(u => u.email && u.email.toLowerCase() === operatorEmail.toLowerCase());
    if (targetUser && targetUser.name) {
      matchName = targetUser.name.toLowerCase().trim();
    }
  }

  const isOperatorMatch = (opName) => {
    if (!operatorEmail) return true;
    if (!opName) return false;
    const cleanOpName = opName.toLowerCase().trim();
    if (cleanOpName === "") return false;
    if (operatorEmail.toLowerCase() === 'admin@plasmaspray.co.in' && cleanOpName.includes('supervisor a')) return true;
    if (cleanOpName.includes(matchEmail)) return true;
    if (matchName !== "" && (cleanOpName.includes(matchName) || matchName.includes(cleanOpName))) return true;
    return false;
  };

  allJobs.forEach(job => {
    const stageData = job[stageKey];
    if (!stageData) return;

    // Check if job was in this department during this week
    const startTime = stageData.startTime ? new Date(stageData.startTime) : null;
    const endTime = stageData.endTime ? new Date(stageData.endTime) : null;
    const queueEntry = stageData.queueEntryTime ? new Date(stageData.queueEntryTime) : null;

    // Job received during this week (entered the queue)
    if (queueEntry && queueEntry >= weekRange.start && queueEntry <= weekRange.end) {
      weekJobs.received.push(job);
    } else if (startTime && startTime >= weekRange.start && startTime <= weekRange.end) {
      weekJobs.received.push(job);
    }

    // Job started during this week
    if (startTime && startTime >= weekRange.start && startTime <= weekRange.end) {
      if (isOperatorMatch(stageData.operatorName)) {
        weekJobs.started.push(job);
      }
    }

    // Job completed during this week
    if (endTime && endTime >= weekRange.start && endTime <= weekRange.end && stageData.status === 'Completed') {
      if (isOperatorMatch(stageData.operatorName)) {
        weekJobs.completed.push(job);
      }
    }

    // Hold history check
    if (stageData.holdHistory && stageData.holdHistory.length > 0) {
      stageData.holdHistory.forEach(hold => {
        const holdTime = new Date(hold.holdTime);
        if (holdTime >= weekRange.start && holdTime <= weekRange.end) {
          weekJobs.onHold.push({ job, hold });
        }
      });
    }
  });

  return weekJobs;
}

// ---- SCORING FUNCTIONS ----

/**
 * Pillar 1: Speed Score (0-20)
 * Measures if jobs were completed within benchmark time
 */
function calculateSpeedScore(weekJobs, department) {
  const completed = weekJobs.completed;
  if (completed.length === 0) return { score: 10, onTimeCount: 0, delayedCount: 0, avgCycleMinutes: 0, benchmarkMinutes: 0 };

  const stageKey = STAGE_KEY_MAP[department] || department.toLowerCase();
  
  // Calculate cycle times for completed jobs
  const cycleTimes = [];
  completed.forEach(job => {
    const sd = job[stageKey];
    if (sd && sd.startTime && sd.endTime) {
      let cycleMs = new Date(sd.endTime).getTime() - new Date(sd.startTime).getTime();
      
      // Subtract hold durations
      if (sd.holdHistory && sd.holdHistory.length > 0) {
        sd.holdHistory.forEach(hold => {
          if (hold.holdTime && hold.resumeTime) {
            cycleMs -= (new Date(hold.resumeTime).getTime() - new Date(hold.holdTime).getTime());
          }
        });
      }
      
      if (cycleMs > 0) cycleTimes.push(cycleMs);
    }
  });

  if (cycleTimes.length === 0) return { score: 20, onTimeCount: 0, delayedCount: 0, avgCycleMinutes: 0, benchmarkMinutes: 0 };

  const avgCycleMs = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
  
  // Benchmark = rolling average (we use current average as benchmark for first week)
  const benchmarkMs = avgCycleMs * 1.15; // 15% buffer above average

  let onTimeCount = 0;
  let delayedCount = 0;
  cycleTimes.forEach(ct => {
    if (ct <= benchmarkMs) onTimeCount++;
    else delayedCount++;
  });

  const onTimeRatio = onTimeCount / cycleTimes.length;
  const score = Math.round(onTimeRatio * 20);

  return {
    score,
    onTimeCount,
    delayedCount,
    avgCycleMinutes: Math.round(avgCycleMs / 60000),
    benchmarkMinutes: Math.round(benchmarkMs / 60000)
  };
}

/**
 * Pillar 2: Queue Response Score (0-20)
 * Measures how fast operator picks up waiting jobs
 */
function calculateQueueScore(weekJobs, department) {
  const started = weekJobs.started;
  if (started.length === 0) return { score: 20, avgPickupMinutes: 0, longestWaitMinutes: 0, avoidableDelays: 0 };

  const stageKey = STAGE_KEY_MAP[department] || department.toLowerCase();
  const pickupTimes = [];
  let avoidableDelays = 0;

  started.forEach(job => {
    const sd = job[stageKey];
    if (!sd) return;

    const queueEntry = sd.queueEntryTime ? new Date(sd.queueEntryTime) : null;
    const startTime = sd.startTime ? new Date(sd.startTime) : null;

    if (queueEntry && startTime && startTime > queueEntry) {
      const waitMs = startTime.getTime() - queueEntry.getTime();
      const waitMinutes = waitMs / 60000;
      pickupTimes.push(waitMinutes);
      
      // If wait > 10 minutes, count as avoidable delay
      if (waitMinutes > 10) avoidableDelays++;
    }
  });

  if (pickupTimes.length === 0) return { score: 20, avgPickupMinutes: 0, longestWaitMinutes: 0, avoidableDelays: 0 };

  const avgPickup = pickupTimes.reduce((a, b) => a + b, 0) / pickupTimes.length;
  const longestWait = Math.max(...pickupTimes);

  // Score: full points if avg pickup < 5 min, deduct for delays
  const totalAvoidableMinutes = pickupTimes.filter(t => t > 10).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(20, 20 - Math.floor(totalAvoidableMinutes / 10)));

  return {
    score,
    avgPickupMinutes: Math.round(avgPickup),
    longestWaitMinutes: Math.round(longestWait),
    avoidableDelays
  };
}

/**
 * Pillar 3: Idle Discipline Score (0-20)
 * Measures idle time ratio when jobs are available
 */
function calculateIdleScore(operatorEmail, department, weekRange) {
  let totalActive = 0;
  let totalIdle = 0;
  let totalNoWork = 0;

  // Aggregate OEE data for each day of the week
  const currentDate = new Date(weekRange.start);
  while (currentDate <= weekRange.end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const key = `psp_oee_${department.toLowerCase()}_${operatorEmail}_${dateStr}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const state = JSON.parse(stored);
        totalActive += state.active || 0;
        totalIdle += state.idle || 0;
        totalNoWork += state.noWork || 0;
      } catch (e) {}
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const workTime = totalActive + totalIdle;
  if (workTime === 0) return { score: 10, idleRatio: 0, activeHours: 0, idleHours: 0, noWorkHours: 0 };

  const idleRatio = totalIdle / workTime;

  let score;
  if (idleRatio <= 0.10) score = 20;
  else if (idleRatio <= 0.20) score = 16;
  else if (idleRatio <= 0.35) score = 12;
  else if (idleRatio <= 0.50) score = 8;
  else score = 4;

  return {
    score,
    idleRatio: Math.round(idleRatio * 100),
    activeHours: (totalActive / 3600).toFixed(1),
    idleHours: (totalIdle / 3600).toFixed(1),
    noWorkHours: (totalNoWork / 3600).toFixed(1)
  };
}

/**
 * Pillar 4: Throughput Score (0-20)
 * Measures jobs completed vs jobs received
 */
function calculateThroughputScore(weekJobs) {
  const received = weekJobs.received.length;
  const completed = weekJobs.completed.length;

  if (received === 0 && completed === 0) return { score: 10, completionRate: 0, jobsReceived: 0, jobsCompleted: 0 };
  if (received === 0) return { score: 20, completionRate: 100, jobsReceived: 0, jobsCompleted: completed };

  const completionRate = (completed / received) * 100;

  let score;
  if (completionRate >= 95) score = 20;
  else if (completionRate >= 85) score = 16;
  else if (completionRate >= 70) score = 12;
  else if (completionRate >= 50) score = 8;
  else score = 4;

  return {
    score,
    completionRate: Math.round(completionRate),
    jobsReceived: received,
    jobsCompleted: completed
  };
}

/**
 * Pillar 5: Quality Score (0-20)
 * Measures first pass yield (jobs without rework)
 */
function calculateQualityScore(weekJobs) {
  const completed = weekJobs.completed.length;
  const reworked = weekJobs.reworked.length;

  if (completed === 0) return { score: 10, firstPassYield: 100, reworkCount: 0 };

  const firstPassYield = ((completed - reworked) / completed) * 100;

  let score;
  if (firstPassYield >= 98) score = 20;
  else if (firstPassYield >= 90) score = 16;
  else if (firstPassYield >= 80) score = 12;
  else if (firstPassYield >= 60) score = 8;
  else score = 4;

  return {
    score,
    firstPassYield: Math.round(firstPassYield),
    reworkCount: reworked
  };
}

// ---- COMPOSITE RATING ----

function calculateTotalRating(pillarScores) {
  const total = pillarScores.speed.score + pillarScores.queue.score +
    pillarScores.idle.score + pillarScores.throughput.score + pillarScores.quality.score;

  const tier = STAR_TIERS.find(t => total >= t.minScore) || STAR_TIERS[STAR_TIERS.length - 1];

  return {
    totalScore: total,
    stars: tier.stars,
    label: tier.label,
    badge: tier.badge,
    color: tier.color
  };
}

// ---- BADGE EVALUATOR ----

function evaluateBadges(pillarScores, weekJobs, streakCount) {
  const earned = [];

  // Speed Demon: All jobs on time
  if (pillarScores.speed.delayedCount === 0 && pillarScores.speed.onTimeCount > 0) {
    earned.push(BADGES.find(b => b.id === 'speed_demon'));
  }

  // Zero Idle: Idle ratio under 5%
  if (pillarScores.idle.idleRatio < 5 && parseFloat(pillarScores.idle.activeHours) > 0) {
    earned.push(BADGES.find(b => b.id === 'zero_idle'));
  }

  // Perfect Quality: Zero reworks
  if (pillarScores.quality.reworkCount === 0 && weekJobs.completed.length > 0) {
    earned.push(BADGES.find(b => b.id === 'perfect_quality'));
  }

  // Queue Crusher: Avg pickup under 5 minutes
  if (pillarScores.queue.avgPickupMinutes < 5 && weekJobs.started.length > 0) {
    earned.push(BADGES.find(b => b.id === 'queue_crusher'));
  }

  // Iron Streak: 3+ consecutive weeks with 4+ stars
  if (streakCount >= 3) {
    earned.push(BADGES.find(b => b.id === 'iron_streak'));
  }

  // Centurion: 100+ jobs completed
  if (weekJobs.completed.length >= 100) {
    earned.push(BADGES.find(b => b.id === 'centurion'));
  }

  return earned.filter(Boolean);
}

// ---- STREAK MANAGEMENT ----

function getStreakKey(operatorEmail) {
  return `psp_report_streak_${operatorEmail}`;
}

function loadStreak(operatorEmail) {
  const key = getStreakKey(operatorEmail);
  const stored = localStorage.getItem(key);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) {}
  }
  return { count: 0, lastWeekId: null };
}

function updateStreak(operatorEmail, currentWeekId, stars) {
  const streak = loadStreak(operatorEmail);
  
  if (streak.lastWeekId === currentWeekId) {
    // Already updated this week
    return streak;
  }

  if (stars >= 4) {
    streak.count = streak.count + 1;
  } else {
    streak.count = 0;
  }
  streak.lastWeekId = currentWeekId;
  
  localStorage.setItem(getStreakKey(operatorEmail), JSON.stringify(streak));
  return streak;
}

// ---- DAILY BREAKDOWN ----

function calculateDailyBreakdown(allJobs, operatorEmail, department, weekRange) {
  const stageKey = STAGE_KEY_MAP[department] || department.toLowerCase();
  const dailyData = {};

  // Initialize 7 days
  const currentDate = new Date(weekRange.start);
  while (currentDate <= weekRange.end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    dailyData[dateStr] = {
      date: dateStr,
      dayLabel: getDayLabel(dateStr),
      jobsCompleted: 0,
      activeSeconds: 0,
      idleSeconds: 0,
      noWorkSeconds: 0
    };
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Count completed jobs per day
  allJobs.forEach(job => {
    const sd = job[stageKey];
    if (!sd || !sd.endTime || sd.status !== 'Completed') return;
    
    const endDate = sd.endTime.split('T')[0];
    if (dailyData[endDate]) {
      dailyData[endDate].jobsCompleted++;
    }
  });

  // Load OEE data per day
  Object.keys(dailyData).forEach(dateStr => {
    const key = `psp_oee_${department.toLowerCase()}_${operatorEmail}_${dateStr}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const state = JSON.parse(stored);
        dailyData[dateStr].activeSeconds = state.active || 0;
        dailyData[dateStr].idleSeconds = state.idle || 0;
        dailyData[dateStr].noWorkSeconds = state.noWork || 0;
      } catch (e) {}
    }
  });

  return Object.values(dailyData);
}

// ---- LEADERBOARD ----

function generateLeaderboard(allJobs, allOperators, department, weekRange) {
  const leaderboard = [];

  allOperators.forEach(op => {
    if (op.department !== department && department !== 'All') return;
    
    const dept = op.department || department;
    const weekJobs = collectWeeklyJobData(allJobs, op.email, dept, weekRange);
    const speedScore = calculateSpeedScore(weekJobs, dept);
    const queueScore = calculateQueueScore(weekJobs, dept);
    const idleScore = calculateIdleScore(op.email, dept, weekRange);
    const throughputScore = calculateThroughputScore(weekJobs);
    const qualityScore = calculateQualityScore(weekJobs);

    const pillarScores = {
      speed: speedScore,
      queue: queueScore,
      idle: idleScore,
      throughput: throughputScore,
      quality: qualityScore
    };

    const rating = calculateTotalRating(pillarScores);

    leaderboard.push({
      name: op.name || op.email.split('@')[0],
      email: op.email,
      department: dept,
      totalScore: rating.totalScore,
      stars: rating.stars,
      label: rating.label,
      jobsCompleted: weekJobs.completed.length,
      trend: '→' // TODO: Compare with previous week
    });
  });

  // Sort by total score descending
  leaderboard.sort((a, b) => b.totalScore - a.totalScore);

  // Add rank
  leaderboard.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return leaderboard;
}

// ---- PREVIOUS WEEK COMPARISON ----

function loadPreviousWeekReport(operatorEmail) {
  const key = `psp_weekly_report_${operatorEmail}_prev`;
  const stored = localStorage.getItem(key);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) {}
  }
  return null;
}

function saveCurrentWeekReport(operatorEmail, reportData) {
  const key = `psp_weekly_report_${operatorEmail}_prev`;
  localStorage.setItem(key, JSON.stringify(reportData));
}

// ---- MAIN REPORT GENERATOR ----

function generateWeeklyReport(allJobs, operatorEmail, department, allOperators, weekDate = new Date()) {
  const weekRange = getWeekRange(weekDate);
  const weekId = getWeekId(weekDate);

  // Collect job data
  const weekJobs = collectWeeklyJobData(allJobs, operatorEmail, department, weekRange);

  // Calculate all 5 pillar scores
  const speedScore = calculateSpeedScore(weekJobs, department);
  const queueScore = calculateQueueScore(weekJobs, department);
  const idleScore = calculateIdleScore(operatorEmail, department, weekRange);
  const throughputScore = calculateThroughputScore(weekJobs);
  const qualityScore = calculateQualityScore(weekJobs);

  const pillarScores = {
    speed: speedScore,
    queue: queueScore,
    idle: idleScore,
    throughput: throughputScore,
    quality: qualityScore
  };

  // Calculate total rating
  const rating = calculateTotalRating(pillarScores);

  // Update streak
  const streak = updateStreak(operatorEmail, weekId, rating.stars);

  // Evaluate badges
  const earnedBadges = evaluateBadges(pillarScores, weekJobs, streak.count);

  // Daily breakdown
  const dailyBreakdown = calculateDailyBreakdown(allJobs, operatorEmail, department, weekRange);

  // Find best day
  let bestDay = dailyBreakdown[0];
  dailyBreakdown.forEach(day => {
    if (day.jobsCompleted > bestDay.jobsCompleted) bestDay = day;
  });

  // Leaderboard (only for admin views)
  const leaderboard = allOperators ? generateLeaderboard(allJobs, allOperators, department, weekRange) : [];

  // Previous week comparison
  const prevReport = loadPreviousWeekReport(operatorEmail);
  let trend = '→';
  if (prevReport) {
    if (rating.totalScore > prevReport.totalScore) trend = '↑';
    else if (rating.totalScore < prevReport.totalScore) trend = '↓';
  }

  const report = {
    weekId,
    weekRange: {
      start: weekRange.start.toISOString(),
      end: weekRange.end.toISOString(),
      label: `${weekRange.start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${weekRange.end.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`
    },
    operator: {
      email: operatorEmail,
      department: department
    },
    rating,
    pillarScores,
    streak,
    earnedBadges,
    dailyBreakdown,
    bestDay,
    trend,
    leaderboard,
    summary: {
      totalJobsCompleted: weekJobs.completed.length,
      totalJobsReceived: weekJobs.received.length,
      totalJobsStarted: weekJobs.started.length,
      totalHoldEvents: weekJobs.onHold.length,
      activeHours: idleScore.activeHours,
      idleHours: idleScore.idleHours,
      noWorkHours: idleScore.noWorkHours,
      avgCycleMinutes: speedScore.avgCycleMinutes,
      reworkCount: qualityScore.reworkCount
    }
  };

  // Save for next week comparison
  saveCurrentWeekReport(operatorEmail, { totalScore: rating.totalScore, weekId });

  return report;
}

// ---- UI RENDERER ----

function renderWeeklyReportUI(report) {
  const container = document.getElementById('report-content-area');
  if (!container) return;

  const isAdmin = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'production_admin');
  const isHR = currentUser && currentUser.role === 'hr_admin';

  container.innerHTML = `
    <!-- REPORT HEADER -->
    <div class="report-header-card">
      <div class="report-header-left">
        <h2 class="report-title">Weekly Performance Report</h2>
        <p class="report-subtitle">${report.operator.email.split('@')[0]} &bull; ${report.operator.department} &bull; ${report.weekRange.label}</p>
      </div>
      <div class="report-header-right">
        <div class="report-stars-display">
          ${renderStars(report.rating.stars)}
        </div>
        <div class="report-score-badge" style="background: ${report.rating.color}20; border-color: ${report.rating.color};">
          <span class="score-number" style="color: ${report.rating.color};">${report.rating.totalScore}</span>
          <span class="score-label">/100</span>
        </div>
        <span class="report-tier-label" style="color: ${report.rating.color};">${report.rating.badge} ${report.rating.label}</span>
        ${report.streak.count > 0 ? `<span class="streak-badge">🔥 ${report.streak.count} Week Streak</span>` : ''}
        <span class="trend-indicator trend-${report.trend === '↑' ? 'up' : report.trend === '↓' ? 'down' : 'same'}">${report.trend}</span>
      </div>
    </div>

    <!-- SUMMARY SCORECARDS -->
    <div class="report-scorecards">
      <div class="report-scorecard">
        <div class="scorecard-icon">📦</div>
        <div class="scorecard-value">${report.summary.totalJobsCompleted}</div>
        <div class="scorecard-label">Jobs Done</div>
      </div>
      <div class="report-scorecard">
        <div class="scorecard-icon">⏱️</div>
        <div class="scorecard-value">${report.summary.activeHours}h</div>
        <div class="scorecard-label">Active Time</div>
      </div>
      <div class="report-scorecard">
        <div class="scorecard-icon">💤</div>
        <div class="scorecard-value">${report.summary.idleHours}h</div>
        <div class="scorecard-label">Idle Time</div>
      </div>
      <div class="report-scorecard">
        <div class="scorecard-icon">🔄</div>
        <div class="scorecard-value">${report.summary.reworkCount}</div>
        <div class="scorecard-label">Reworks</div>
      </div>
      <div class="report-scorecard">
        <div class="scorecard-icon">⚡</div>
        <div class="scorecard-value">${report.summary.avgCycleMinutes}m</div>
        <div class="scorecard-label">Avg Cycle</div>
      </div>
    </div>

    <!-- 5 PILLAR PROGRESS BARS -->
    <div class="report-pillars-card">
      <h3 class="report-section-title">Performance Pillars</h3>
      <div class="report-pillars">
        ${renderPillarBar('speed', '⚡ Speed', report.pillarScores.speed.score, 20, report.pillarScores.speed)}
        ${renderPillarBar('queue', '⏳ Queue Response', report.pillarScores.queue.score, 20, report.pillarScores.queue)}
        ${renderPillarBar('idle', '🎯 Idle Discipline', report.pillarScores.idle.score, 20, report.pillarScores.idle)}
        ${renderPillarBar('throughput', '📦 Throughput', report.pillarScores.throughput.score, 20, report.pillarScores.throughput)}
        ${renderPillarBar('quality', '🔄 Quality', report.pillarScores.quality.score, 20, report.pillarScores.quality)}
      </div>
    </div>

    <!-- BADGES -->
    ${report.earnedBadges.length > 0 ? `
    <div class="report-badges-card">
      <h3 class="report-section-title">🏅 Badges Earned This Week</h3>
      <div class="report-badges-grid">
        ${report.earnedBadges.map(b => `
          <div class="report-badge-item earned">
            <span class="badge-icon-large">${b.icon}</span>
            <span class="badge-name">${b.name}</span>
            <span class="badge-condition">${b.condition}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- DAILY BREAKDOWN -->
    <div class="report-daily-card">
      <h3 class="report-section-title">📈 Daily Breakdown</h3>
      <div class="report-daily-bars">
        ${report.dailyBreakdown.map(day => `
          <div class="daily-bar-group">
            <div class="daily-bar-container">
              <div class="daily-bar-fill" style="height: ${Math.max(5, (day.jobsCompleted / Math.max(1, report.bestDay.jobsCompleted)) * 100)}%;">
                <span class="daily-bar-value">${day.jobsCompleted}</span>
              </div>
            </div>
            <span class="daily-bar-label">${day.dayLabel}</span>
            ${day.date === report.bestDay.date && day.jobsCompleted > 0 ? '<span class="best-day-badge">🏆</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- QUEUE RESPONSE STATS -->
    <div class="report-queue-card">
      <h3 class="report-section-title">⏳ Queue Response Times</h3>
      <div class="report-queue-stats">
        <div class="queue-stat">
          <span class="queue-stat-value">${report.pillarScores.queue.avgPickupMinutes}m</span>
          <span class="queue-stat-label">Avg Pickup</span>
        </div>
        <div class="queue-stat">
          <span class="queue-stat-value">${report.pillarScores.queue.longestWaitMinutes}m</span>
          <span class="queue-stat-label">Longest Wait</span>
        </div>
        <div class="queue-stat">
          <span class="queue-stat-value">${report.pillarScores.queue.avoidableDelays}</span>
          <span class="queue-stat-label">Avoidable Delays</span>
        </div>
      </div>
    </div>

    <!-- LEADERBOARD (Admin Only) -->
    ${(isAdmin || isHR) && report.leaderboard.length > 0 ? `
    <div class="report-leaderboard-card">
      <h3 class="report-section-title">🏆 Department Leaderboard — ${report.operator.department}</h3>
      <div class="report-leaderboard-table-wrap">
        <table class="report-leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Operator</th>
              <th>Stars</th>
              <th>Score</th>
              <th>Jobs</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            ${report.leaderboard.map(entry => `
              <tr class="${entry.email === report.operator.email ? 'leaderboard-highlight' : ''}">
                <td class="rank-cell">${entry.rank <= 3 ? ['🥇','🥈','🥉'][entry.rank - 1] : entry.rank}</td>
                <td>${entry.name}</td>
                <td>${renderStarsSmall(entry.stars)}</td>
                <td><strong>${entry.totalScore}</strong>/100</td>
                <td>${entry.jobsCompleted}</td>
                <td class="trend-${entry.trend === '↑' ? 'up' : entry.trend === '↓' ? 'down' : 'same'}">${entry.trend}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;
}

// ---- HELPER RENDERERS ----

function renderStars(count) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= count ? 'star-filled' : 'star-empty'}">★</span>`;
  }
  return html;
}

function renderStarsSmall(count) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += i <= count ? '⭐' : '☆';
  }
  return html;
}

function renderPillarBar(key, label, score, max, details) {
  const pct = (score / max) * 100;
  let barColor = '#34d399'; // green
  if (pct < 40) barColor = '#ef4444'; // red
  else if (pct < 60) barColor = '#f59e0b'; // yellow
  else if (pct < 80) barColor = '#60a5fa'; // blue

  let detailText = '';
  if (key === 'speed') detailText = `${details.onTimeCount} on-time, ${details.delayedCount} delayed`;
  if (key === 'queue') detailText = `Avg pickup: ${details.avgPickupMinutes}m`;
  if (key === 'idle') detailText = `Idle ratio: ${details.idleRatio}%`;
  if (key === 'throughput') detailText = `${details.jobsCompleted}/${details.jobsReceived} jobs (${details.completionRate}%)`;
  if (key === 'quality') detailText = `First pass yield: ${details.firstPassYield}%`;

  return `
    <div class="pillar-row">
      <div class="pillar-label">${label}</div>
      <div class="pillar-bar-track">
        <div class="pillar-bar-fill" style="width: ${pct}%; background: ${barColor};"></div>
      </div>
      <div class="pillar-score">${score}/${max}</div>
      <div class="pillar-detail">${detailText}</div>
    </div>
  `;
}

// ---- INTERACTIVE LOGIC & EVENT HANDLERS ----

let reportInitialized = false;

function parseHTMLWeek(weekStr) {
  if (!weekStr) return new Date();
  const parts = weekStr.split('-W');
  if (parts.length !== 2) return new Date();
  const year = parseInt(parts[0], 10);
  const week = parseInt(parts[1], 10);
  
  // January 4th is always in week 1
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay();
  const jan4Monday = new Date(jan4.setDate(jan4.getDate() - day + (day === 0 ? -6 : 1)));
  
  return new Date(jan4Monday.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

function getWeekStringForInput(date = new Date()) {
  const d = new Date(date);
  // Get Thursday of the target week to identify the correct ISO year
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const year = d.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const weekNum = Math.ceil((((d - firstJan) / 86400000) + firstJan.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

function initReportsTab() {
  if (!currentUser) return;

  const weekSelect = document.getElementById('report-week-select');
  const opSelectContainer = document.getElementById('report-operator-select-container');
  const opSelect = document.getElementById('report-operator-select');
  const generateBtn = document.getElementById('btn-generate-report');

  // 1. Initialize Week Input default to current week
  if (weekSelect && !weekSelect.value) {
    weekSelect.value = getWeekStringForInput();
  }

  const isAdminView = currentUser.role === 'super_admin' || currentUser.role === 'production_admin' || currentUser.role === 'hr_admin' || currentUser.role === 'quality_admin';

  // 2. Populate and show Operator selector for Admins/HR/Quality
  if (isAdminView && opSelectContainer && opSelect) {
    opSelectContainer.style.display = 'flex';
    
    const allUsers = (typeof users !== 'undefined' && Array.isArray(users)) ? users : [];
    
    // Only populate if dropdown is empty or only has 1 option AND we have users loaded
    if (opSelect.options.length <= 1 && allUsers.length > 0) {
      const prevVal = opSelect.value || currentUser.email;
      opSelect.innerHTML = '';
      
      const operatorUsers = allUsers.filter(u => u.role === 'operator' || u.department);
      
      if (operatorUsers.length === 0) {
        opSelect.innerHTML = `<option value="${currentUser.email}">${currentUser.name || currentUser.email.split('@')[0]} (Self)</option>`;
      } else {
        operatorUsers.forEach(u => {
          const selectedAttr = u.email === prevVal ? 'selected' : '';
          opSelect.innerHTML += `<option value="${u.email}" data-dept="${u.department || 'Masking'}" ${selectedAttr}>${u.name || u.email.split('@')[0]} (${u.department || 'No Dept'})</option>`;
        });
      }
    }
  }

  // 3. Render report
  triggerReportGeneration();

  // 4. Bind event listeners once
  if (!reportInitialized) {
    if (generateBtn) {
      generateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerReportGeneration();
      });
    }
    const exportPdfBtn = document.getElementById('btn-export-pdf');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.print();
      });
    }
    if (opSelect) {
      opSelect.addEventListener('change', () => {
        triggerReportGeneration();
      });
    }
    if (weekSelect) {
      weekSelect.addEventListener('change', () => {
        triggerReportGeneration();
      });
    }
    reportInitialized = true;
  }
}

function triggerReportGeneration() {
  if (!currentUser) return;

  const weekSelect = document.getElementById('report-week-select');
  const opSelect = document.getElementById('report-operator-select');

  let targetEmail = currentUser.email;
  let targetDept = currentUser.department || 'Masking';
  let targetWeekDate = new Date();

  // 1. Read operator selection
  const isAdminView = currentUser.role === 'super_admin' || currentUser.role === 'production_admin' || currentUser.role === 'hr_admin' || currentUser.role === 'quality_admin';
  if (isAdminView && opSelect && opSelect.value) {
    targetEmail = opSelect.value;
    const selectedOpt = opSelect.options[opSelect.selectedIndex];
    if (selectedOpt) {
      targetDept = selectedOpt.getAttribute('data-dept') || 'Masking';
    }
  }

  // 2. Read week selection
  if (weekSelect && weekSelect.value) {
    targetWeekDate = parseHTMLWeek(weekSelect.value);
  }

  // 3. Gather operators list for leaderboard (only departments matching selection)
  const allUsers = (typeof users !== 'undefined' && Array.isArray(users)) ? users : [];
  const deptOperators = allUsers.filter(u => u.department === targetDept);

  // 4. Generate & Render
  try {
    const report = generateWeeklyReport(jobs, targetEmail, targetDept, deptOperators, targetWeekDate);
    renderWeeklyReportUI(report);
    if (typeof showToast === 'function') {
      showToast("Report Generated", `Successfully loaded report for ${targetEmail.split('@')[0]}`, "success");
      if (report.summary.totalJobsCompleted === 0 && report.summary.totalJobsStarted === 0) {
        showToast("No Weekly Activity", "No production jobs were active or completed during this week.", "warning");
      }
    }
  } catch (err) {
    console.error("Failed to generate weekly report:", err);
    const contentArea = document.getElementById('report-content-area');
    if (contentArea) {
      contentArea.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--status-hold);">
          <h3>⚠️ Error Generating Report</h3>
          <p>${err.message || err}</p>
        </div>
      `;
    }
    if (typeof showToast === 'function') {
      showToast("Error", `Failed to generate report: ${err.message || err}`, "danger");
    }
  }
}
