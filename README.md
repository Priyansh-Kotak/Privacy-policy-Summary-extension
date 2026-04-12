# Terms & Privacy Smart Summary

This workspace contains a Chrome Extension and a Golang backend that work together to detect Terms & Conditions, Privacy Policy, and similar content on web pages, then summarize it with AI.

## Structure

- `extension/`
  - `manifest.json`: Chrome extension manifest for MV3.
  - `content.js`: Content script to detect policy text and extract it from the page.
  - `background.js`: Service worker that caches latest extraction and communicates with the popup.
  - `popup/`: Vite + React app for the extension UI.

- `backend-go/`
  - `main.go`: Fiber backend that calls Hugging Face to summarize text.
  - `go.mod`: Go module definition.
  - `.env.example`: Example environment file for the Hugging Face API key.

## How it works

1. `content.js` scans the page for keywords and policy text.
2. `background.js` caches the extraction per tab.
3. The popup sends a request to get the extracted text.
4. The React popup sends text to the Go backend at `http://localhost:8080/summarize`.
5. The backend calls Hugging Face inference and returns structured summary JSON.

## Run the extension

### Backend

```bash
cd backend-go
go run main.go
```

Set `HUGGINGFACE_API_KEY` in your environment first.

### Popup (React)

```bash
cd extension/popup
npm install
npm run build
```

Then load `extension/` as an unpacked Chrome extension.

## Deployment notes

- Update the backend URL in `extension/popup/src/App.jsx` when deploying.
- Use a hosted service like Railway, Render, or Fly.io for the backend.
- Build the popup before loading the extension.
