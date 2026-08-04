# 🎓 University Timetable Web App

A production-quality, mobile-first, PWA-ready timetable application built with vanilla HTML, CSS, and JavaScript. It automatically fetches data from a Google Sheet, making updates as easy as editing a spreadsheet.

## ✨ Features

- 📱 **Responsive Design**: Optimized for both desktop and mobile devices.
- 🌑 **Material Design**: Modern, clean UI with Dark Mode by default.
- 🔄 **Real-time Updates**: Automatically refreshes data every 5 minutes.
- ⏳ **Smart Display**: Shows only today's classes, highlights the current class, and provides a countdown to the next one.
- 🔢 **Multi-Section Support**: Filter by section (e.g. Section 2 / 3). The last selection is remembered; first-time visitors are asked once. New sections are picked up automatically from the sheet — no code changes needed.
- 📶 **PWA Support**: Installable on your home screen and works offline (cached). The service worker disables itself on local/dev hosts so Live Server never serves stale files.
- 💾 **Theme Persistence**: Remembers your light/dark mode preference.
- 🚀 **Zero Backend**: Uses Google Sheets as a lightweight database.

---

## 🛠️ Setup Instructions

### 1. Prepare your Google Sheet

The sheet is a grid timetable. Each class cell must contain the section label and the faculty, e.g. `Linear Algebra (Sec 3)  Tamilarasi`. The room for a class goes in the same column in the row below the class.

| Day | Time | Class |
| :--- | :--- | :--- |
| Monday | 11.15 AM - 12.10 PM | Linear Algebra (Sec 3)  Tamilarasi |
| | | AB2 - 202 |
| Monday | 11.15 AM - 12.10 PM | Web Technology (Sec 2)  Rupam Sah |
| | | AB2 - 203 |

**Important Notes for Sheet:**
- **Day**: Must be the full name of the day (e.g., `Monday`, `Tuesday`, etc.).
- **Time**: `H:MM AM/PM - H:MM AM/PM` (also accepts dots like `11.15 AM`).
- **Sections**: A class belongs to a section via its `(Sec N)` label. **Adding a new section to the sheet automatically adds it to the app** — you never need to touch the JavaScript.

### 2. Publish the Sheet

To allow the web app to read the data without an API key:
1. In your Google Sheet, go to **File** > **Share** > **Publish to web**.
2. In the dialog, change "Entire Document" to your specific sheet name (e.g., `Sheet1`).
3. Change "Web page" to **Comma-separated values (.csv)**.
4. Click **Publish** and confirm.
5. Copy the URL provided.

### 3. Configure the Web App

1. Open `js/config.js` in your code editor.
2. Locate the `CONFIG` object at the top of the file.
3. Replace `'YOUR_GOOGLE_SHEET_ID_HERE'` with your actual Google Sheet ID.

> **How to find your Sheet ID?**
> Look at your Google Sheet URL:
> `https://docs.google.com/spreadsheets/d/1abc12345xyz_ABC/edit#gid=0`
> Your ID is: `1abc12345xyz_ABC`

### 4. Add Icons

For the PWA to work perfectly, you should place two square PNG icons in the `icons/` folder:
- `icons/icon-192x192.png`
- `icons/icon-512x512.png`

---

## 🧱 Project Structure

```
index.html        App shell (header, timeline, section modal)
style.css         Design system + component styles
manifest.json     PWA manifest
sw.js             Service worker (self-disarms on localhost / dev hosts)
js/
  app.js          Bootstrap, fetch, section state, interactivity
  config.js       Sheet ID + tuning knobs
  parser.js       CSV parsing (all sections, data-driven)
  ui.js           DOM rendering
  storage.js      localStorage cache, theme, section preference
  utils.js        Time helpers
```

---

## 🚀 Deployment (GitHub Pages)

This app is ready to be hosted for free on GitHub Pages.

1. Create a new repository on GitHub.
2. Push your files to the repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```
3. On GitHub, go to your repository **Settings**.
4. Click on **Pages** in the left sidebar.
5. Under **Build and deployment** > **Branch**, select `main` and folder `/ (root)`.
6. Click **Save**.
7. Your site will be live at `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/` in a few minutes!

---

## 🐛 Live Server / Local Development

The service worker only activates on real (HTTPS) deployments. When serving locally
with Live Server (or any static server), the worker unregisters itself so your edits
always show up immediately — no stale cache, no hard-refresh needed.

If you were ever stuck with a stale service worker from an old version, just open the
app once after this update: the new worker self-destructs on localhost and frees the
origin.

---

## 📝 License

MIT
