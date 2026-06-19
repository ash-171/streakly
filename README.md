Streakly — Calorie & Sugar Tracker (PWA)
A installable Android web app. Tracks calories and added sugar, keeps a streak that resets the moment you go over your sugar limit, and uses your Ollama Cloud account to estimate nutrition from a food photo or a typed description. All your data (entries, settings, API key) stays in your phone's local storage — nothing is sent anywhere except the food photo/description, which goes straight from your browser to ollama.com.
1. Host it (needs HTTPS to install as an app)
Pick whichever is easiest:
·	GitHub Pages (free, recommended): create a repo, upload all files in this folder to it, enable Pages in repo Settings → Pages → "Deploy from branch", then open the given https://ash-171.github.io/calories_app/ URL on your phone.
·	Netlify Drop: go to app.netlify.com/drop on a computer, drag this folder in, get an instant HTTPS link.
2. Install on Android
Open the hosted URL in Chrome → menu (⋮) → Add to Home screen / Install app. It now behaves like a normal app icon, opens full-screen, and works offline for the interface (AI analysis still needs internet).
3. Connect Ollama Cloud
1.	Create an API key at ollama.com/settings/keys.
2.	In the app, go to Settings, paste the key, and tap Test connection.
3.	Default models are set to a vision-capable model (for photos) and a text model (for typed descriptions). Cloud model names change over time — check ollama.com/search?c=cloud if a model errors out, and update the model fields in Settings.
Note on CORS: the app calls ollama.com's API directly from your phone's browser. If you see a network/connection error in Settings → Test connection despite a valid key, your browser may be blocking the cross-origin request. In that case you'd need a small relay (e.g., a one-line Cloudflare Worker or Vercel function that forwards to ollama.com and adds CORS headers) — happy to build that if you hit this.
4. How the streak works
Every entry you log records added/refined sugar in grams (the AI is prompted to estimate only added sugar — sweets, syrups, soda — not natural sugar in fruit or milk). Your daily limit is set in Settings (default 25g, the WHO's stricter guideline). The moment your running total for the day exceeds that limit, the streak resets to 0 immediately — it doesn't wait for the day to end. Each full day at or under the limit adds 1 to the streak.
5. Calorie alerts
Set your daily calorie goal in Settings. The dashboard ring and a banner show progress; tapping Enable calorie alerts turns on a phone notification once you hit your goal for the day (requires notification permission).
Files
·	index.html, styles.css, app.js — the app
·	manifest.json, sw.js — make it installable/offline-capable
·	icon-192.png, icon-5
