/* ============================================================
   Streakly — calorie & added-sugar tracker
   Synced to Firebase (Auth + Firestore) per signed-in user.
   localStorage is used only as an offline cache.
   ============================================================ */

const DEFAULTS = {
  settings: {
    apiKey: "",
    apiBase: "https://shrill-paper-0d87.mailaswathits.workers.dev/",
    visionModel: "gemma4:cloud",
    textModel: "gpt-oss:120b-cloud",
    calorieGoal: 2000,
    sugarLimit: 25,
    notifEnabled: false,
    notifiedDates: [],
    streakResetAt: null, // dateKey string; streak calc ignores days at/before this
    reminderEnabled: false,
    reminderTime: "20:00",
    reminderNotifiedDates: []
  },
  entries: [] // {id, ts, dateKey, name, calories, sugar, source}
};

let state = structuredClone(DEFAULTS);
let uid = null;
let saveTimer = null;

/* ---------------- Firebase ---------------- */
firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function cacheKey() { return `streakly_cache_${uid}`; }

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  } catch { return null; }
}

function saveLocalCache() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {}
}

function saveData() {
  saveLocalCache();
  if (!uid) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.collection("users").doc(uid).set(state, { merge: false }).catch((e) => {
      console.error("cloud save failed", e);
      showToast("Saved locally — cloud sync failed.");
    });
  }, 500);
}

async function loadFromCloud() {
  const cached = loadLocalCache();
  if (cached) state = cached; // show something instantly
  try {
    const doc = await db.collection("users").doc(uid).get();
    if (doc.exists) {
      const d = doc.data();
      state = {
        settings: { ...DEFAULTS.settings, ...(d.settings || {}) },
        entries: Array.isArray(d.entries) ? d.entries : []
      };
    } else {
      state = structuredClone(DEFAULTS);
      await db.collection("users").doc(uid).set(state);
    }
    saveLocalCache();
  } catch (e) {
    console.error("cloud load failed", e);
    if (!cached) state = structuredClone(DEFAULTS);
    showToast("Offline — showing locally cached data.");
  }
}

/* ---------------- Auth wiring ---------------- */
const loginScreen = document.getElementById("loginScreen");
const appRoot = document.getElementById("app");

document.getElementById("toggleSigninPw").addEventListener("click", () => {
  const pw = document.getElementById("signinPassword");
  pw.type = pw.type === "password" ? "text" : "password";
});
document.getElementById("toggleSignupPw").addEventListener("click", () => {
  const pw = document.getElementById("signupPassword");
  pw.type = pw.type === "password" ? "text" : "password";
});

function isStrongPassword(pw) {
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

["signinEmail", "signinPassword"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("loginBtn").click();
  });
});
["loginName", "signupEmail", "signupPassword"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("signupBtn").click();
  });
});

document.getElementById("loginBtn").addEventListener("click", () => {
  const email = document.getElementById("signinEmail").value.trim();
  const pw = document.getElementById("signinPassword").value;
  document.getElementById("signinError").innerHTML = "";
  auth.signInWithEmailAndPassword(email, pw).catch((e) => {
    const errEl = document.getElementById("signinError");
    if (e.code === "auth/invalid-credential" || e.code === "auth/user-not-found" || e.code === "auth/wrong-password") {
      errEl.innerHTML = `<div class="banner warn">⚠ No account found with that email/password. Please create an account on the right →</div>`;
      document.getElementById("signinPassword").value = "";
    } else {
      errEl.textContent = e.message;
    }
  });
});
document.getElementById("signupBtn").addEventListener("click", () => {
  const name = document.getElementById("loginName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const pw = document.getElementById("signupPassword").value;
  document.getElementById("signupError").textContent = "";
  if (!name) {
    document.getElementById("signupError").textContent = "Please enter your name.";
    return;
  }
  if (!isStrongPassword(pw)) {
    document.getElementById("signupError").textContent = "Password must be 8+ characters with letters and numbers.";
    return;
  }
  auth.createUserWithEmailAndPassword(email, pw)
    .then((cred) => cred.user.updateProfile({ displayName: name }))
    .catch((e) => {
      document.getElementById("signupError").textContent = e.message;
    });
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  auth.signOut().then(() => location.reload());
});
document.getElementById("deleteAccountBtn").addEventListener("click", async () => {
  if (!confirm("Permanently delete your account and ALL data? This can't be undone.")) return;
  try {
    if (uid) await db.collection("users").doc(uid).delete();
    localStorage.removeItem(cacheKey());
    await auth.currentUser.delete();
    showToast("Account deleted.");
  } catch (e) {
    if (e.code === "auth/requires-recent-login") {
      alert("For security, please sign out and sign in again, then retry deleting your account.");
    } else {
      showToast(e.message || "Delete failed.");
    }
  }
});

function hideLoadingScreen() {
  const el = document.getElementById("loadingScreen");
  if (el) el.style.display = "none";
}
// Safety net: if Firebase auth never resolves (offline, slow network,
// or a stale cached script), don't leave the user stuck on the spinner —
// fall back to showing the login screen after 6 seconds.
const authTimeoutId = setTimeout(() => {
  hideLoadingScreen();
  if (!uid) loginScreen.style.display = "flex";
}, 6000);

auth.onAuthStateChanged(async (user) => {
  clearTimeout(authTimeoutId);
  hideLoadingScreen();
  if (user) {
    uid = user.uid;
    loginScreen.style.display = "none";
    appRoot.style.display = "flex";
    document.getElementById("accountEmail").textContent = user.displayName ? `${user.displayName} · ${user.email}` : (user.email || "Signed in");
    await loadFromCloud();
    initAppUI();
  } else {
    uid = null;
    appRoot.style.display = "none";
    loginScreen.style.display = "flex";
    document.getElementById("signinEmail").value = "";
    document.getElementById("signinPassword").value = "";
    document.getElementById("signinError").innerHTML = "";
    document.getElementById("loginName").value = "";
    document.getElementById("signupEmail").value = "";
    document.getElementById("signupPassword").value = "";
    document.getElementById("signupError").textContent = "";
  }
});

/* ---------------- date helpers ---------------- */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyDate(key) {
  const today = dateKey();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = dateKey(y);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [yy, mm, dd] = key.split("-").map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function shiftKey(key, deltaDays) {
  const [yy, mm, dd] = key.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() + deltaDays);
  return dateKey(d);
}

/* ---------------- derived data ---------------- */
function totalsForDate(key) {
  let cal = 0, sugar = 0, count = 0;
  for (const e of state.entries) {
    if (e.dateKey === key) { cal += e.calories; sugar += e.sugar; count++; }
  }
  return { cal, sugar, count };
}

/* Sugar streak is fully independent of the calorie goal — it only
   ever looks at e.sugar per day vs sugarLimit. Set sugarLimit to 0
   in Settings to require zero added sugar for the streak to hold. */
function computeStreak() {
  const limit = state.settings.sugarLimit;
  const resetAt = state.settings.streakResetAt;
  const datesWithEntries = new Set(state.entries.map(e => e.dateKey));
  let key = dateKey();
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    if (resetAt && key <= resetAt) break;
    if (!datesWithEntries.has(key)) {
      if (i > 0) break;
      key = shiftKey(key, -1);
      continue;
    }
    const { sugar } = totalsForDate(key);
    if (sugar <= limit) { streak++; key = shiftKey(key, -1); }
    else break;
  }
  return streak;
}

/* ---------------- rendering ---------------- */
let ringCalEl, ringSugarEl, CIRC_CAL, CIRC_SUGAR;

function renderHome() {
  const today = dateKey();
  const { cal, sugar, count } = totalsForDate(today);
  const goal = state.settings.calorieGoal;
  const limit = state.settings.sugarLimit;
  const streak = computeStreak();

  document.getElementById("topbarDate").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  document.getElementById("streakCount").textContent = streak;
  document.getElementById("calNum").textContent = Math.round(cal);
  document.getElementById("calGoalSub").textContent = `of ${goal} kcal`;
  document.getElementById("statCal").textContent = Math.round(cal);
  document.getElementById("statSugar").textContent = `${sugar.toFixed(1)}g`;
  document.getElementById("statEntries").textContent = count;

  const calFraction = Math.min(cal / goal, 1);
  ringCalEl.style.strokeDashoffset = `${CIRC_CAL * (1 - calFraction)}`;
  const sugarFrac = limit > 0 ? Math.min(sugar / limit, 1) : (sugar > 0 ? 1 : 0);
  ringSugarEl.style.strokeDashoffset = `${CIRC_SUGAR * (1 - sugarFrac)}`;

  let sugarColor = "var(--sugar-ok)";
  if (sugar > limit) sugarColor = "var(--sugar-over)";
  else if (limit > 0 && sugar > limit * 0.7) sugarColor = "var(--sugar-warn)";
  ringSugarEl.style.stroke = sugarColor;
  document.getElementById("sugarDot").style.background = sugarColor;

  renderBanners(cal, goal, sugar, limit);
  renderTodayList(today);
  maybeNotify(cal, goal);
}

/* Calorie and sugar banners are fully independent — one never
   mentions the other, matching the two independent systems. */
function renderBanners(cal, goal, sugar, limit) {
  const calEl = document.getElementById("alertBannerCal");
  const sugarEl = document.getElementById("alertBannerSugar");
  const pct = (cal / goal) * 100;
  let calHtml = "";
  if (pct >= 100) calHtml = `<div class="banner over">You've reached ${Math.round(pct)}% of your ${goal} kcal goal today.</div>`;
  else if (pct >= 85) calHtml = `<div class="banner warn">Heads up — ${Math.round(pct)}% of today's ${goal} kcal goal used.</div>`;
  calEl.innerHTML = calHtml;

  let sugarHtml = "";
  if (sugar > limit) sugarHtml = `<div class="banner over">⚠ Added sugar is over your ${limit}g limit today — streak reset to 0.</div>`;
  else if (limit > 0 && sugar > limit * 0.7) sugarHtml = `<div class="banner warn">You're close to today's ${limit}g sugar limit (${sugar.toFixed(1)}g so far).</div>`;
  sugarEl.innerHTML = sugarHtml;
}

function renderTodayList(today) {
  const list = state.entries.filter(e => e.dateKey === today).sort((a, b) => b.ts - a.ts);
  const el = document.getElementById("todayList");
  if (!list.length) {
    el.innerHTML = `<div class="empty">Nothing logged yet today. Tap Add to start.</div>`;
    return;
  }
  el.innerHTML = list.map(entryHtml).join("");
  attachDeleteHandlers(el);
}

function sourceIcon(source) {
  return source === "photo" ? "📷" : source === "describe" ? "✏️" : "🧮";
}

function entryHtml(e) {
  return `<div class="entry" data-id="${e.id}">
    <div class="icon">${sourceIcon(e.source)}</div>
    <div class="body">
      <div class="name">${escapeHtml(e.name)}</div>
      <div class="meta">${Math.round(e.calories)} kcal · ${e.sugar.toFixed(1)}g sugar</div>
    </div>
    <button class="del" data-id="${e.id}" aria-label="Delete">✕</button>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function attachDeleteHandlers(container) {
  container.querySelectorAll(".del").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      state.entries = state.entries.filter(e => e.id !== id);
      saveData();
      renderHome();
      renderHistory();
    });
  });
}

/* ---------------- History: Day / Week / Month ---------------- */
let historyViewMode = "day";      // "day" | "week" | "month"
let historyMonthOffset = 0;       // 0 = current month, -1 = last month, etc. (month view)
let selectedDayKey = dateKey();   // anchor date for day/week views

function monthBounds(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const startKey = dateKey(d);
  const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const endKey = dateKey(endD);
  const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { startKey, endKey, label };
}

function weekDays(anchorKey) {
  const [yy, mm, dd] = anchorKey.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() - d.getDay()); // back up to Sunday
  const start = dateKey(d);
  return Array.from({ length: 7 }, (_, i) => shiftKey(start, i));
}

/* Circle SIZE = calorie goal progress (bigger = closer to/over goal).
   Circle COLOR = sugar streak status vs limit (green/amber/red). */
function calorieFraction(cal, goal) {
  return goal > 0 ? Math.min(cal / goal, 1) : 0;
}
function sugarColorFor(sugar, limit) {
  if (limit > 0 && sugar > limit) return "var(--sugar-over)";
  if (limit > 0 && sugar > limit * 0.7) return "var(--sugar-warn)";
  return "var(--sugar-ok)";
}

function dayCircleHtml(key, { big = false, disabled = false } = {}) {
  const { cal, sugar, count } = totalsForDate(key);
  const goal = state.settings.calorieGoal;
  const limit = state.settings.sugarLimit;
  const base = big ? 34 : 28;
  const span = big ? 26 : 18;
  const size = count ? Math.round(base + calorieFraction(cal, goal) * span) : base - 6;
  const color = count ? sugarColorFor(sugar, limit) : "var(--surface-2)";
  const dd = parseInt(key.split("-")[2], 10);
  const isToday = key === dateKey() ? "today" : "";
  const isSelected = key === selectedDayKey ? "selected" : "";
  const future = key > dateKey();
  return `<button class="day-circle ${isToday} ${isSelected}" data-key="${key}"
      style="width:${size}px;height:${size}px;background:${count ? color : "transparent"};border-color:${color}"
      ${future || disabled ? "disabled" : ""}>${dd}</button>`;
}

function bindCalendarClicks() {
  document.getElementById("calendarGrid").querySelectorAll(".day-circle:not(:disabled)").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDayKey = btn.dataset.key;
      setHistoryView("day");
    });
  });
}

function setHistoryView(mode) {
  historyViewMode = mode;
  document.querySelectorAll("#historyViewSeg button").forEach(b => b.classList.toggle("active", b.dataset.view === mode));
  renderHistory();
}

document.getElementById("historyViewSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  setHistoryView(btn.dataset.view);
});

document.getElementById("monthPrevBtn").addEventListener("click", () => navHistory(-1));
document.getElementById("monthNextBtn").addEventListener("click", () => navHistory(1));

function navHistory(dir) {
  if (historyViewMode === "month") historyMonthOffset += dir;
  else if (historyViewMode === "week") selectedDayKey = shiftKey(selectedDayKey, dir * 7);
  else selectedDayKey = shiftKey(selectedDayKey, dir);
  renderHistory();
}

function setSummary(entries) {
  const limit = state.settings.sugarLimit;
  const byDate = {};
  for (const e of entries) (byDate[e.dateKey] ||= []).push(e);
  const cal = entries.reduce((s, e) => s + e.calories, 0);
  const okDays = Object.keys(byDate).filter(k => byDate[k].reduce((s, e) => s + e.sugar, 0) <= limit).length;
  document.getElementById("monthCal").textContent = Math.round(cal);
  document.getElementById("monthSugarDays").textContent = okDays;
  document.getElementById("monthEntries").textContent = entries.length;
}

// Tracks which day-groups are expanded in the history list, keyed by dateKey.
const expandedDayGroups = new Set();

function renderEntryListForKeys(keys) {
  const el = document.getElementById("historyList");
  const keySet = new Set(keys);
  const entries = state.entries.filter(e => keySet.has(e.dateKey));
  setSummary(entries);
  if (!entries.length) {
    el.innerHTML = `<div class="empty">No entries.</div>`;
    return;
  }
  const byDate = {};
  for (const e of entries) (byDate[e.dateKey] ||= []).push(e);
  const sortedKeys = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  // Single-day views (Day tab) start expanded automatically; otherwise default collapsed.
  if (sortedKeys.length === 1 && !expandedDayGroups.has(sortedKeys[0]) && !expandedDayGroups.has(`collapsed:${sortedKeys[0]}`)) {
    expandedDayGroups.add(sortedKeys[0]);
  }
  el.innerHTML = sortedKeys.map(key => {
    const items = byDate[key].sort((a, b) => b.ts - a.ts);
    const cal = items.reduce((s, e) => s + e.calories, 0);
    const sugar = items.reduce((s, e) => s + e.sugar, 0);
    const isOpen = expandedDayGroups.has(key);
    return `<div class="day-group">
      <button class="day-head" data-key="${key}">
        <span><span class="chev ${isOpen ? "open" : ""}">›</span>${prettyDate(key)} <span class="day-count">(${items.length})</span></span>
        <span>${Math.round(cal)} kcal · ${sugar.toFixed(1)}g sugar</span>
      </button>
      <div class="day-entries ${isOpen ? "open" : ""}">${items.map(entryHtml).join("")}</div>
    </div>`;
  }).join("");
  attachDeleteHandlers(el);
  el.querySelectorAll(".day-head").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      if (expandedDayGroups.has(key)) {
        expandedDayGroups.delete(key);
        expandedDayGroups.add(`collapsed:${key}`);
      } else {
        expandedDayGroups.add(key);
        expandedDayGroups.delete(`collapsed:${key}`);
      }
      renderEntryListForKeys(keys);
    });
  });
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function renderHistory() {
  const nextBtn = document.getElementById("monthNextBtn");
  const grid = document.getElementById("calendarGrid");

  if (historyViewMode === "month") {
    const { startKey, endKey, label } = monthBounds(historyMonthOffset);
    document.getElementById("monthLabel").textContent = label;
    nextBtn.disabled = historyMonthOffset >= 0;

    const [yy, mm] = startKey.split("-").map(Number);
    const firstDow = new Date(yy, mm - 1, 1).getDay();
    const daysInMonth = new Date(yy, mm, 0).getDate();
    let cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div class="day-cell"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${yy}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push(`<div class="day-cell">${dayCircleHtml(key)}</div>`);
    }
    grid.innerHTML = `
      <div class="cal-weekdays">${WEEKDAY_LABELS.map(d => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${cells.join("")}</div>`;
    bindCalendarClicks();

    const monthKeys = state.entries
      .filter(e => e.dateKey >= startKey && e.dateKey <= endKey)
      .map(e => e.dateKey);
    renderEntryListForKeys(monthKeys);

  } else if (historyViewMode === "week") {
    const days = weekDays(selectedDayKey);
    document.getElementById("monthLabel").textContent = `${prettyDate(days[0])} – ${prettyDate(days[6])}`;
    nextBtn.disabled = shiftKey(selectedDayKey, 7) > dateKey();

    grid.innerHTML = `
      <div class="cal-weekdays">${WEEKDAY_LABELS.map(d => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${days.map(k => `<div class="day-cell">${dayCircleHtml(k, { big: true })}</div>`).join("")}</div>`;
    bindCalendarClicks();
    renderEntryListForKeys(days);

  } else { // day
    document.getElementById("monthLabel").textContent = prettyDate(selectedDayKey);
    nextBtn.disabled = selectedDayKey >= dateKey();

    grid.innerHTML = `<div class="cal-grid single">${dayCircleHtml(selectedDayKey, { big: true, disabled: true })}</div>`;
    bindCalendarClicks();
    renderEntryListForKeys([selectedDayKey]);
  }
}

/* ---------------- notification helper ----------------
   On Android Chrome, `new Notification()` from page script throws
   ("Illegal constructor") — PWAs must show notifications through the
   active service worker registration instead. This works on both
   desktop and Android. */
async function sendNotification(title, options) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return;
    }
  } catch (e) {
    console.error("showNotification failed, falling back", e);
  }
  try { new Notification(title, options); } catch (e) { console.error("Notification fallback failed", e); }
}

/* ---------------- notifications ---------------- */
function maybeNotify(cal, goal) {
  if (!state.settings.notifEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = dateKey();
  if (cal >= goal && !state.settings.notifiedDates.includes(today)) {
    sendNotification("Calorie goal reached", {
      body: `You've hit ${Math.round(cal)} of ${goal} kcal today.`,
      icon: "icon-192.png"
    });
    state.settings.notifiedDates.push(today);
    state.settings.notifiedDates = state.settings.notifiedDates.slice(-30);
    saveData();
  }
}

/* ---------------- daily reminder ---------------- */
function checkReminder() {
  const s = state.settings;
  if (!s.reminderEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = dateKey();
  if (s.reminderNotifiedDates.includes(today)) return;
  const { count } = totalsForDate(today);
  if (count > 0) return;
  const [h, m] = (s.reminderTime || "20:00").split(":").map(Number);
  const now = new Date();
  const target = new Date(); target.setHours(h, m, 0, 0);
  if (now < target) return;
  sendNotification("Don't forget to log today", {
    body: "You haven't logged any food yet today.",
    icon: "icon-192.png"
  });
  s.reminderNotifiedDates.push(today);
  s.reminderNotifiedDates = s.reminderNotifiedDates.slice(-30);
  saveData();
}
setInterval(checkReminder, 5 * 60 * 1000);


const screens = ["home", "history", "add", "settings"];
function showScreen(name) {
  screens.forEach(s => document.getElementById(`screen-${s}`)?.classList.toggle("active", s === name));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.screen === name));
  document.getElementById("topbarTitle").textContent =
    name === "home" ? "Streakly" : name.charAt(0).toUpperCase() + name.slice(1);
  if (name === "history") renderHistory();
  if (name === "home") renderHome();
}

/* ---------------- toast ---------------- */
let toastTimer;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ---------------- Ollama Cloud calls ---------------- */
function getOllamaUrl() { return (state.settings.apiBase || "https://ollama.com").replace(/\/+$/, "") + "/api/chat"; }

const JSON_INSTRUCTION = `You are a precise nutrition estimator trained on standard food composition databases (USDA FoodData Central style values). Think step by step internally about the specific ingredients, typical serving size, and cooking method — but output ONLY a single JSON object as your final answer. No markdown, no explanation, no code fences, no text before or after the JSON. Schema:
{"name": string, "calories": number, "sugar_g": number, "confidence": "low"|"medium"|"high"}

Rules:
- Base calories on realistic, typical restaurant/home-cooked portion sizes for the specific food(s) named or shown — do not round to generic guesses like 100 or 200.
- "sugar_g" is ONLY added/refined sugar (table sugar, syrup, honey used as sweetener, sweets, soda, packaged sweet sauces) — exclude naturally occurring sugars in fruit, vegetables, or plain milk/dairy.
- If multiple food items are present, sum them into one combined entry.
- If uncertain about exact recipe/preparation, make your best realistic estimate and set "confidence" accordingly rather than defaulting to round numbers.`;

const OLLAMA_OPTIONS = { temperature: 0.15, seed: 42 };

const RECIPE_JSON_INSTRUCTION = `You are a nutrition-focused recipe assistant using realistic food composition data (USDA FoodData Central style values). Respond with ONLY a single JSON object, no markdown, no explanation, no code fences. Schema:
{
  "name": string,
  "description": string,
  "servings": number,
  "ingredients": [ {"item": string, "amount": string, "calories": number} ],
  "steps": [string],
  "total_calories": number,
  "total_sugar_g": number
}
Rules:
- Recipe must be genuinely healthy: whole-food ingredients, minimal added sugar/refined carbs, balanced macros.
- Give per-ingredient calories for the full recipe (not per serving), based on realistic quantities for the stated amount.
- total_calories = sum of ingredient calories, for the whole recipe (all servings combined).
- total_sugar_g = ONLY added/refined sugar across all ingredients (exclude natural sugars in fruit/dairy/veg).
- 4-8 clear, concise steps.
- Keep ingredient list to what's realistically needed — no filler items.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in model response");
  return JSON.parse(match[0]);
}

async function callOllamaChat(model, messages) {
  const key = state.settings.apiKey.trim();
  if (!key) throw new Error("Add your Ollama API key in Settings first.");

  let resp;
  try {
    resp = await fetch(getOllamaUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model, messages, stream: false, options: OLLAMA_OPTIONS })
    });
  } catch (netErr) {
    throw new Error(
      "Network error — if you're on http:// (not https://), CORS blocks the call. " +
      "Host the app on HTTPS (e.g. GitHub Pages) to fix this. Original: " + netErr.message
    );
  }

  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch {}
    if (resp.status === 401 || resp.status === 403) throw new Error(`Auth failed (${resp.status}) — check your API key.`);
    if (resp.status === 404) throw new Error(`Model not found (404) — check the model name in Settings.`);
    throw new Error(`Ollama API error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.message?.content;
  if (!content) throw new Error("Empty response from model.");
  return extractJson(content);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let pendingPhotoBase64 = null;
let pendingSource = "manual";

function saveEntry({ name, calories, sugar, source }) {
  const wasOk = totalsForDate(dateKey()).sugar <= state.settings.sugarLimit;
  state.entries.push({ id: crypto.randomUUID(), ts: Date.now(), dateKey: dateKey(), name, calories, sugar, source });
  saveData();
  const isOk = totalsForDate(dateKey()).sugar <= state.settings.sugarLimit;
  if (wasOk && !isOk) showToast("⚠ Added sugar limit exceeded — streak reset.");
}

function openConfirmModal(result, source, note) {
  pendingSource = source;
  document.getElementById("confirmAiNote").textContent = note;
  document.getElementById("confName").value = result.name || "Food entry";
  document.getElementById("confCal").value = Math.round(result.calories) || 0;
  document.getElementById("confSugar").value = (Math.round((result.sugar_g || 0) * 10) / 10) || 0;
  document.getElementById("confirmModalBg").classList.add("show");
}

function resetAddScreen() {
  document.getElementById("photoPreview").style.display = "none";
  document.getElementById("analyzePhotoBtn").style.display = "none";
  document.getElementById("describeInput").value = "";
  pendingPhotoBase64 = null;
}

/* ---------------- Settings screen ---------------- */
function loadSettingsForm() {
  const s = state.settings;
  document.getElementById("setApiKey").value = s.apiKey;
  document.getElementById("setApiBase").value = s.apiBase || "https://ollama.com";
  document.getElementById("setVisionModel").value = s.visionModel;
  document.getElementById("setTextModel").value = s.textModel;
  document.getElementById("setCalGoal").value = s.calorieGoal;
  document.getElementById("setSugarLimit").value = s.sugarLimit;
  document.getElementById("setReminderTime").value = s.reminderTime || "20:00";
  document.getElementById("reminderStatus").textContent = s.reminderEnabled ? "Reminder is on." : "Reminder is off.";
  document.getElementById("enableReminderBtn").textContent = s.reminderEnabled ? "Disable reminder" : "Enable reminder";
  document.getElementById("notifStatus").textContent = s.notifEnabled ? "Calorie alerts are on." : "Calorie alerts are off.";
  document.getElementById("enableNotifBtn").textContent = s.notifEnabled ? "Disable calorie alerts" : "Enable calorie alerts";
}

/* ---------------- one-time UI wiring after login ---------------- */
let uiInitialized = false;
function initAppUI() {
  if (uiInitialized) { loadSettingsForm(); renderHome(); renderHistory(); return; }
  uiInitialized = true;

  ringCalEl = document.getElementById("ringCal");
  ringSugarEl = document.getElementById("ringSugar");
  const RAD_CAL = 95, RAD_SUGAR = 72;
  CIRC_CAL = 2 * Math.PI * RAD_CAL;
  CIRC_SUGAR = 2 * Math.PI * RAD_SUGAR;
  ringCalEl.style.strokeDasharray = `${CIRC_CAL}`;
  ringSugarEl.style.strokeDasharray = `${CIRC_SUGAR}`;

  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => showScreen(t.dataset.screen)));

  const modeCards = { photo: "modePhoto", describe: "modeDescribe", manual: "modeManual", recipes: "modeRecipes" };
  const modeOrder = ["photo", "describe", "manual", "recipes"];

  function setAddMode(mode) {
    const btn = document.querySelector(`#addModeSeg button[data-mode="${mode}"]`);
    if (!btn) return;
    document.querySelectorAll("#addModeSeg button").forEach(b => b.classList.toggle("active", b === btn));
    Object.entries(modeCards).forEach(([m, id]) => {
      document.getElementById(id).style.display = m === mode ? "block" : "none";
    });
  }

  document.getElementById("addModeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    setAddMode(btn.dataset.mode);
  });

  const addScreen = document.getElementById("screen-add");
  let touchStartX = null, touchStartY = null;
  addScreen.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  addScreen.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // ignore short/vertical swipes
    const current = document.querySelector("#addModeSeg button.active")?.dataset.mode || "photo";
    const idx = modeOrder.indexOf(current);
    if (dx < 0 && idx < modeOrder.length - 1) setAddMode(modeOrder[idx + 1]); // swipe left -> next
    else if (dx > 0 && idx > 0) setAddMode(modeOrder[idx - 1]); // swipe right -> prev
  }, { passive: true });

  document.getElementById("cameraInput").addEventListener("change", e => handlePhotoFile(e.target.files[0]));
  document.getElementById("galleryInput").addEventListener("change", e => handlePhotoFile(e.target.files[0]));

  function handlePhotoFile(file) {
    if (!file) return;
    const preview = document.getElementById("photoPreview");
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
    document.getElementById("analyzePhotoBtn").style.display = "block";
    fileToBase64(file).then(b64 => { pendingPhotoBase64 = b64; });
  }

  document.getElementById("analyzePhotoBtn").addEventListener("click", async () => {
    if (!pendingPhotoBase64) return;
    const analyzing = document.getElementById("photoAnalyzing");
    analyzing.style.display = "flex";
    document.getElementById("analyzePhotoBtn").disabled = true;
    try {
      const result = await callOllamaChat(state.settings.visionModel, [
        { role: "user", content: JSON_INSTRUCTION + "\nIdentify the food in this image and estimate its nutrition.", images: [pendingPhotoBase64] }
      ]);
      openConfirmModal(result, "photo", "Estimated from your photo — review before saving.");
    } catch (err) {
      showToast(err.message || "Couldn't analyze photo.");
    } finally {
      analyzing.style.display = "none";
      document.getElementById("analyzePhotoBtn").disabled = false;
    }
  });

  document.getElementById("analyzeDescribeBtn").addEventListener("click", async () => {
    const text = document.getElementById("describeInput").value.trim();
    if (!text) { showToast("Describe what you ate first."); return; }
    const analyzing = document.getElementById("describeAnalyzing");
    analyzing.style.display = "flex";
    document.getElementById("analyzeDescribeBtn").disabled = true;
    try {
      const result = await callOllamaChat(state.settings.textModel, [
        { role: "user", content: `${JSON_INSTRUCTION}\nMeal description: "${text}"` }
      ]);
      openConfirmModal(result, "describe", "Estimated from your description — review before saving.");
    } catch (err) {
      showToast(err.message || "Couldn't analyze description.");
    } finally {
      analyzing.style.display = "none";
      document.getElementById("analyzeDescribeBtn").disabled = false;
    }
  });

  document.getElementById("manualSaveBtn").addEventListener("click", () => {
    const name = document.getElementById("manName").value.trim() || "Food entry";
    const cal = parseFloat(document.getElementById("manCal").value) || 0;
    const sugar = parseFloat(document.getElementById("manSugar").value) || 0;
    saveEntry({ name, calories: cal, sugar, source: "manual" });
    document.getElementById("manName").value = "";
    document.getElementById("manCal").value = "";
    document.getElementById("manSugar").value = "";
    showToast("Entry saved.");
    showScreen("home");
  });

  document.getElementById("generateRecipeBtn").addEventListener("click", async () => {
    const text = document.getElementById("recipeInput").value.trim();
    if (!text) { showToast("Describe what kind of recipe you want."); return; }
    const analyzing = document.getElementById("recipeAnalyzing");
    const resultEl = document.getElementById("recipeResult");
    analyzing.style.display = "flex";
    resultEl.innerHTML = "";
    document.getElementById("generateRecipeBtn").disabled = true;
    try {
      const recipe = await callOllamaChat(state.settings.textModel, [
        { role: "user", content: `${RECIPE_JSON_INSTRUCTION}\nRequest: "${text}"` }
      ]);
      renderRecipeResult(recipe);
    } catch (err) {
      showToast(err.message || "Couldn't generate a recipe.");
    } finally {
      analyzing.style.display = "none";
      document.getElementById("generateRecipeBtn").disabled = false;
    }
  });

  function renderRecipeResult(r) {
    const resultEl = document.getElementById("recipeResult");
    const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
    const steps = Array.isArray(r.steps) ? r.steps : [];
    resultEl.innerHTML = `
      <div class="recipe-card">
        <h3>${escapeHtml(r.name || "Recipe")}</h3>
        <div class="hint">${escapeHtml(r.description || "")}</div>
        <div class="recipe-total">${Math.round(r.total_calories || 0)} kcal total · ${(r.total_sugar_g || 0).toFixed(1)}g added sugar · serves ${r.servings || 1}</div>
        <ul class="recipe-ingredients">
          ${ingredients.map(i => `<li><span>${escapeHtml(i.item || "")} (${escapeHtml(i.amount || "")})</span><span>${Math.round(i.calories || 0)} kcal</span></li>`).join("")}
        </ul>
        <ol class="recipe-steps">${steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
        <button class="btn secondary" id="logRecipeBtn">Log this as a meal</button>
        <button class="btn secondary" id="discardRecipeBtn" style="margin-top:10px;">Not interested — discard</button>
      </div>`;
    document.getElementById("discardRecipeBtn").addEventListener("click", () => {
      resultEl.innerHTML = "";
      document.getElementById("recipeInput").value = "";
    });
    document.getElementById("logRecipeBtn").addEventListener("click", () => {
      saveEntry({
        name: r.name || "Recipe",
        calories: Math.round(r.total_calories || 0),
        sugar: Math.round((r.total_sugar_g || 0) * 10) / 10,
        source: "manual"
      });
      showToast("Logged.");
      showScreen("home");
    });
  }

  document.getElementById("confirmCancelBtn").addEventListener("click", () => {
    document.getElementById("confirmModalBg").classList.remove("show");
    resetAddScreen();
  });
  document.getElementById("confirmSaveBtn").addEventListener("click", () => {
    const name = document.getElementById("confName").value.trim() || "Food entry";
    const cal = parseFloat(document.getElementById("confCal").value) || 0;
    const sugar = parseFloat(document.getElementById("confSugar").value) || 0;
    saveEntry({ name, calories: cal, sugar, source: pendingSource });
    document.getElementById("confirmModalBg").classList.remove("show");
    resetAddScreen();
    showToast("Entry saved.");
    showScreen("home");
  });

  function bindSettingsAutosave() {
    const map = {
      setApiKey: "apiKey", setApiBase: "apiBase", setVisionModel: "visionModel", setTextModel: "textModel",
      setCalGoal: "calorieGoal", setSugarLimit: "sugarLimit"
    };
    Object.entries(map).forEach(([id, key]) => {
      document.getElementById(id).addEventListener("change", (e) => {
        let v = e.target.value;
        if (key === "calorieGoal" || key === "sugarLimit") v = parseFloat(v) || 0;
        state.settings[key] = v;
        saveData();
        renderHome();
      });
    });
  }
  bindSettingsAutosave();

  document.getElementById("testApiBtn").addEventListener("click", async () => {
    const key = document.getElementById("setApiKey").value.trim();
    if (!key) { showToast("Enter an API key first."); return; }
    state.settings.apiKey = key; saveData();
    const model = document.getElementById("setTextModel").value.trim() || "gpt-oss:120b";
    showToast("Testing…");
    try {
      const resp = await fetch(getOllamaUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ok" }], stream: false })
      });
      if (!resp.ok) throw new Error(`Error ${resp.status}`);
      showToast("Connected ✓");
    } catch (err) {
      showToast(err.message || "Connection failed.");
      console.error("Test connection error:", err);
    }
  });

  document.getElementById("enableNotifBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) { showToast("Notifications not supported here."); return; }
    if (state.settings.notifEnabled) {
      state.settings.notifEnabled = false;
      saveData();
      updateNotifStatus();
      showToast("Calorie alerts turned off.");
      return;
    }
    const perm = await Notification.requestPermission();
    state.settings.notifEnabled = perm === "granted";
    saveData();
    updateNotifStatus();
    if (state.settings.notifEnabled) {
      showToast("Calorie alerts enabled.");
      sendNotification("Calorie alerts on", { body: "You'll be notified when you hit your daily goal.", icon: "icon-192.png" });
    } else {
      showToast("Permission not granted — check your browser/phone notification settings.");
    }
  });
  function updateNotifStatus() {
    const s = state.settings;
    document.getElementById("notifStatus").textContent = s.notifEnabled ? "Calorie alerts are on." : "Calorie alerts are off.";
    document.getElementById("enableNotifBtn").textContent = s.notifEnabled ? "Disable calorie alerts" : "Enable calorie alerts";
  }

  document.getElementById("resetStreakBtn").addEventListener("click", () => {
    const current = computeStreak();
    if (!confirm(`Reset your current ${current}-day streak to 0? Your logged entries and history will NOT be deleted.`)) return;
    state.settings.streakResetAt = dateKey();
    saveData();
    renderHome();
    showToast("Streak reset.");
  });

  document.getElementById("setReminderTime").addEventListener("change", (e) => {
    state.settings.reminderTime = e.target.value;
    saveData();
  });
  document.getElementById("enableReminderBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) { showToast("Notifications not supported here."); return; }
    if (state.settings.reminderEnabled) {
      state.settings.reminderEnabled = false;
      saveData();
      document.getElementById("reminderStatus").textContent = "Reminder is off.";
      document.getElementById("enableReminderBtn").textContent = "Enable reminder";
      showToast("Reminder turned off.");
      return;
    }
    const perm = await Notification.requestPermission();
    state.settings.reminderEnabled = perm === "granted";
    saveData();
    document.getElementById("reminderStatus").textContent = state.settings.reminderEnabled ? "Reminder is on." : "Permission not granted.";
    document.getElementById("enableReminderBtn").textContent = state.settings.reminderEnabled ? "Disable reminder" : "Enable reminder";
    if (state.settings.reminderEnabled) {
      showToast("Reminder enabled.");
      sendNotification("Reminders on", { body: "We'll nudge you if you haven't logged by your set time.", icon: "icon-192.png" });
    } else {
      showToast("Permission not granted — check your browser/phone notification settings.");
    }
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `streakly-backup-${dateKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        state = {
          settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
          entries: Array.isArray(parsed.entries) ? parsed.entries : []
        };
        saveData();
        loadSettingsForm();
        renderHome(); renderHistory();
        showToast("Backup imported.");
      } catch {
        showToast("That file isn't a valid backup.");
      }
    };
    reader.readAsText(file);
  });
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Erase ALL entries and settings (including your API key), on this device and in the cloud? This can't be undone.")) return;
    state = structuredClone(DEFAULTS);
    saveData();
    loadSettingsForm();
    renderHome(); renderHistory();
    showToast("All data erased.");
  });

  loadSettingsForm();
  renderHome();
  checkReminder();
  maybeShowApiWizard();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  function maybeShowApiWizard() {
    if (state.settings.apiKey) return;
    document.getElementById("wizardStep1").style.display = "block";
    document.getElementById("wizardStep2").style.display = "none";
    document.getElementById("wizardModalBg").classList.add("show");
  }
  document.getElementById("wizardNextBtn").addEventListener("click", () => {
    document.getElementById("wizardStep1").style.display = "none";
    document.getElementById("wizardStep2").style.display = "block";
  });
  document.getElementById("wizardBackBtn").addEventListener("click", () => {
    document.getElementById("wizardStep2").style.display = "none";
    document.getElementById("wizardStep1").style.display = "block";
  });
  document.getElementById("wizardSkipBtn").addEventListener("click", () => {
    document.getElementById("wizardModalBg").classList.remove("show");
  });
  document.getElementById("wizardTestSaveBtn").addEventListener("click", async () => {
    const key = document.getElementById("wizardApiKey").value.trim();
    const statusEl = document.getElementById("wizardStatus");
    if (!key) { statusEl.textContent = "Paste your key first."; return; }
    statusEl.textContent = "Testing…";
    const model = state.settings.textModel || "gpt-oss:120b-cloud";
    try {
      const resp = await fetch(getOllamaUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ok" }], stream: false })
      });
      if (!resp.ok) throw new Error(`Error ${resp.status}`);
      state.settings.apiKey = key;
      saveData();
      loadSettingsForm();
      document.getElementById("wizardModalBg").classList.remove("show");
      showToast("Connected ✓ — you're all set!");
    } catch (err) {
      statusEl.textContent = "Couldn't connect — check your key and try again.";
    }
  });
}
