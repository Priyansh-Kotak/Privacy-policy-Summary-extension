# Terms & Privacy Smart Summary

This project contains a Chrome extension and a Go backend that work together to detect Terms of Service, Privacy Policies, Cookie Policies, and similar legal content on webpages, then summarize that content with AI.

## Project Structure

- `extension/`
  - `manifest.json`: Chrome extension manifest (MV3)
  - `content.js`: content script that scans pages, detects policy links/sections, and renders inline badges
  - `background.js`: service worker that caches extracted text per tab and calls the backend for inline summaries
  - `popup/`: Vite + React popup UI
- `backend-go/`
  - `main.go`: Fiber backend that calls the Gemini API and returns structured summary JSON
  - `go.mod`: Go module definition
  - `.env.example`: example environment file for the Gemini API key

## How It Works

1. `content.js` scans the page for policy-related content such as terms, privacy, cookies, and legal notices.
2. The content script sends extracted policy text to `background.js`, which caches it per browser tab.
3. The extension popup reads the cached text and lets the user request a summary.
4. Inline policy badges on the page can also request summaries through the background service worker.
5. The backend sends the extracted text to Gemini and returns structured JSON with:
   - `summary`
   - `red_flags`
   - `important_points`
   - `green_flags`

## Backend Endpoint

The extension is currently configured to use the deployed Render backend:

`https://privacy-policy-summary-extension.onrender.com/summarize`

## Local Development

### 1. Run the backend locally

```bash
cd backend-go
go run main.go
```

Required environment variable:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

Notes:
- The backend uses `PORT` when provided by the hosting platform.
- If `PORT` is not set, it defaults to `8080`.

### 2. Build the popup

```bash
cd extension/popup
npm install
npm run build
```

### 3. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder

## Production Deployment

### Backend

The Go backend is ready for platforms like Render.

Recommended Render settings:

- Root directory: `backend-go`
- Build command: `go build -o app .`
- Start command: `./app`
- Environment variable: `GEMINI_API_KEY`

### Extension

If you change the backend URL in the future, update both:

- `extension/background.js`
- `extension/popup/src/App.jsx`

Then rebuild the popup:

```bash
cd extension/popup
npm run build
```

## Packaging For Chrome Web Store

Build the popup first, then create a ZIP from the `extension/` folder only:

```bash
cd extension
zip -r ../policy-scanner-extension.zip . -x "popup/node_modules/*" "*.DS_Store"
```

Make sure the ZIP contains:

- `manifest.json`
- `background.js`
- `content.js`
- `icons/`
- `popup/dist/`

## Privacy And Data Flow

- The extension analyzes webpage content to detect policy-related text.
- Relevant policy text may be sent to the backend for summarization.
- The backend uses Gemini to generate structured summaries.
- The extension does not require user login.

## Current Stack

- Chrome Extension Manifest V3
- React + Vite
- Go + Fiber
- Gemini (`gemini-2.5-flash-lite`)
- Render for backend hosting
