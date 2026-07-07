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
    streakResetAt: null // dateKey string; streak calc ignores days at/before this
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

document.getElementById("loginBtn").addEventListener("click", () => {
  const email = document.getElementById("loginEmail").value.trim();
  const pw = document.getElementById("loginPassword").value;
  document.getElementById("loginError").textContent = "";
  auth.signInWithEmailAndPassword(email, pw).catch((e) => {
    document.getElementById("loginError").textContent = e.message;
  });
});
document.getElementById("signupBtn").addEventListener("click", () => {
  const email = document.getElementById("loginEmail").value.trim();
  const pw = document.getElementById("loginPassword").value;
  document.getElementById("loginError").textContent = "";
  auth.createUserWithEmailAndPassword(email, pw).catch((e) => {
    document.getElementById("loginError").textContent = e.message;
  });
});
document.getElementById("logoutBtn").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  if (user) {
    uid = user.uid;
    loginScreen.style.display = "none";
    appRoot.style.display = "flex";
    document.getElementById("accountEmail").textContent = user.email || "Signed in";
    await loadFromCloud();
    initAppUI();
  } else {
    uid = null;
    appRoot.style.display = "none";
    loginScreen.style.display = "flex";
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

  const calFrac = Math.min(cal / goal, 1);
  ringCalEl.style.strokeDashoffset = `${CIRC_CAL * (1 - calFrac)}`;
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

/* ---------------- History: month view ---------------- */
let historyMonthOffset = 0; // 0 = current month, -1 = last month, etc.

function monthBounds(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const startKey = dateKey(d);
  const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const endKey = dateKey(endD);
  const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { startKey, endKey, label };
}

document.getElementById("monthPrevBtn").addEventListener("click", () => { historyMonthOffset--; renderHistory(); });
document.getElementById("monthNextBtn").addEventListener("click", () => {
  if (historyMonthOffset < 0) historyMonthOffset++;
  renderHistory();
});

function renderHistory() {
  const { startKey, endKey, label } = monthBounds(historyMonthOffset);
  document.getElementById("monthLabel").textContent = label;
  document.getElementById("monthNextBtn").disabled = historyMonthOffset >= 0;

  const monthEntries = state.entries.filter(e => e.dateKey >= startKey && e.dateKey <= endKey);
  const monthCal = monthEntries.reduce((s, e) => s + e.calories, 0);
  const byDate = {};
  for (const e of monthEntries) (byDate[e.dateKey] ||= []).push(e);
  const limit = state.settings.sugarLimit;
  const sugarFreeDays = Object.keys(byDate).filter(k => {
    const sugar = byDate[k].reduce((s, e) => s + e.sugar, 0);
    return sugar <= limit;
  }).length;

  document.getElementById("monthCal").textContent = Math.round(monthCal);
  document.getElementById("monthSugarDays").textContent = sugarFreeDays;
  document.getElementById("monthEntries").textContent = monthEntries.length;

  const el = document.getElementById("historyList");
  if (!monthEntries.length) {
    el.innerHTML = `<div class="empty">No entries this month.</div>`;
    return;
  }
  const keys = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  el.innerHTML = keys.map(key => {
    const items = byDate[key].sort((a, b) => b.ts - a.ts);
    const cal = items.reduce((s, e) => s + e.calories, 0);
    const sugar = items.reduce((s, e) => s + e.sugar, 0);
    return `<div class="day-group">
      <div class="day-head"><span>${prettyDate(key)}</span><span>${Math.round(cal)} kcal · ${sugar.toFixed(1)}g sugar</span></div>
      ${items.map(entryHtml).join("")}
    </div>`;
  }).join("");
  attachDeleteHandlers(el);
}

/* ---------------- notifications ---------------- */
function maybeNotify(cal, goal) {
  if (!state.settings.notifEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = dateKey();
  if (cal >= goal && !state.settings.notifiedDates.includes(today)) {
    new Notification("Calorie goal reached", {
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
  new Notification("Don't forget to log today", {
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

const JSON_INSTRUCTION = `You are a nutrition estimator. Respond with ONLY a single JSON object, no markdown, no explanation, no code fences. Schema:
{"name": string, "calories": number, "sugar_g": number, "confidence": "low"|"medium"|"high"}
"sugar_g" must be ONLY added/refined sugar grams (e.g. table sugar, syrups, sweets, soda, packaged sweet sauces) — exclude naturally occurring sugars in fruit, vegetables, or plain milk/dairy. Estimate for the single portion described or shown. If multiple food items are present, sum them into one combined entry. Use your best nutritional estimate even if uncertain.`;

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
      body: JSON.stringify({ model, messages, stream: false })
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

  const modeCards = { photo: "modePhoto", describe: "modeDescribe", manual: "modeManual" };
  document.getElementById("addModeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    document.querySelectorAll("#addModeSeg button").forEach(b => b.classList.toggle("active", b === btn));
    Object.entries(modeCards).forEach(([mode, id]) => {
      document.getElementById(id).style.display = mode === btn.dataset.mode ? "block" : "none";
    });
  });

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

  document.getElementById("confirmCancelBtn").addEventListener("click", () => {
    document.getElementById("confirmModalBg").classList.remove("show");
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
    const perm = await Notification.requestPermission();
    state.settings.notifEnabled = perm === "granted";
    saveData();
    showToast(perm === "granted" ? "Calorie alerts enabled." : "Permission not granted.");
  });

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
    const perm = await Notification.requestPermission();
    state.settings.reminderEnabled = perm === "granted";
    saveData();
    document.getElementById("reminderStatus").textContent = state.settings.reminderEnabled ? "Reminder is on." : "Permission not granted.";
    showToast(state.settings.reminderEnabled ? "Reminder enabled." : "Permission not granted.");
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
