# Streakly — Calorie & Sugar Tracker (PWA)

An installable Android web app. Tracks calories and added sugar as two fully independent systems, keeps a streak that resets the moment you go over your sugar limit, and uses your Ollama Cloud account to estimate nutrition from a food photo, a typed description, or generate healthy recipes. Your account and data sync via Firebase (Auth + Firestore), so they're available across devices — everything is cached locally too, so the app still works offline.

## 1. Host it (needs HTTPS to install as an app)

Pick whichever is easiest:

- **GitHub Pages (free, recommended):** create a repo, upload all files in this folder to it, enable Pages in repo Settings → Pages → "Deploy from branch", then open the given `https://ash-171.github.io/repo/` URL on your phone.
- **Netlify Drop:** go to app.netlify.com/drop on a computer, drag this folder in, get an instant HTTPS link.
- **Local testing only:** `python3 -m http.server 8000` from this folder, then open `http://<your-computer-ip>:8000` on your phone while on the same WiFi. (Service worker/offline install needs HTTPS for a real domain, but works fine over `localhost`.)

## 2. Set up Firebase (free Spark plan — no billing required)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → Create a project.
2. **Build → Authentication** → Get started → Sign-in method tab → enable **Email/Password**.
3. **Build → Firestore Database** → Create database (production mode, any region).
4. Firestore → **Rules** tab → replace with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth.uid == uid;
       }
     }
   }
   ```
   Click Publish.
5. Project settings (gear icon) → scroll to "Your apps" → click **`</>`** (Web) → register an app → copy the config object into `firebase-config.js` in this folder (replace the placeholder values).

`firebase-config.js` is safe to commit to GitHub — it's a public client identifier, not a secret. Access is controlled by the Firestore rule above, not by hiding this file.

## 3. Install on Android

Open the hosted URL in Chrome → menu (⋮) → **Add to Home screen** / **Install app**. It behaves like a normal app icon, opens full-screen, and works offline for the interface (AI analysis and sync still need internet).

## 4. Sign up / sign in

First visit shows two side-by-side panels — **Sign in** (email + password) on the left, **Create account** (name + email + password) on the right. New passwords must be 8+ characters with letters and numbers. Data is scoped per account and synced to Firestore.

## 5. Connect Ollama Cloud

On first login (if no key is saved yet), a short setup wizard walks you through it: a direct link to `ollama.com/settings/keys`, then a "Test & Save" step. You can skip it and set it up later in **Settings**:

1. Create an API key at ollama.com/settings/keys.
2. In the app, go to Settings, paste the key, and tap Test connection.
3. Default models are set to a vision-capable model (for photos) and a text model (for descriptions/recipes). Cloud model names change over time — check ollama.com/search?c=cloud if a model errors out, and update the model fields in Settings.

**Note on CORS:** the app calls Ollama's API through the URL set in Settings → API Base URL. If you're hitting a CORS/network error, deploy a small CORS relay (a one-line Cloudflare Worker works well) and point API Base URL at it instead of `ollama.com` directly.

## 6. How the streak works

The sugar streak is fully independent from your calorie tracking — it never factors in calories at all. Every entry records added/refined sugar in grams (the AI is prompted to estimate only added sugar — sweets, syrups, soda — not natural sugar in fruit or milk). Your daily limit is set in Settings → Sugar streak (default 0g, meaning any added sugar breaks the streak; raise it if you want a small daily allowance). The moment your running total for the day exceeds that limit, the streak resets to 0 immediately. You can also reset just the streak (keeping your log) from Settings.

## 7. Calorie goal

Tracked completely separately from the sugar streak. Set your daily calorie goal in Settings → Calorie goal; the dashboard ring and banner show progress. Tapping **Enable calorie alerts** turns on a phone notification once you hit your goal for the day.

## 8. Recipes

The Add screen has a **Recipes** tab — describe what you want (e.g. "high-protein vegetarian breakfast under 400 kcal") and get a full healthy recipe back with per-ingredient calorie breakdown, total calories/added sugar, and step-by-step instructions. One tap logs the total as a meal entry.

## 9. Daily reminder

Settings → Daily reminder lets you set a time (e.g. 8 PM); if you haven't logged anything by then, you'll get a notification. Requires the app tab to be open and notification permission granted.

## 10. History & monthly view

The History tab shows a month-by-month breakdown with prev/next navigation, a monthly summary (total kcal, sugar-free days, entry count), and every entry grouped by day.

## 11. Account & data

Settings → Account lets you sign out or **permanently delete your account** (wipes your Firestore data and Firebase Auth account — this can't be undone). Settings → Data also has export/import (.json backup) and a separate "erase all data" option that keeps your account but clears everything in it.

## Files

- `index.html`, `styles.css`, `app.js` — the app
- `firebase-config.js` — your Firebase project config (fill in your own values)
- `manifest.json`, `sw.js` — make it installable/offline-capable
- `icon-192.png`, `icon-512.png` — app icon
