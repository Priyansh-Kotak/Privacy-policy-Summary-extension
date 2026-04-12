// Store the latest extracted text per tab so popup can read it later.
const tabCache = {}; // Cache by tabId

// Listen for messages from content scripts or popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'page_detected') {
    // Save the latest extracted text for this tab.
    if (sender.tab?.id != null) {
      tabCache[sender.tab.id] = {
        text: message.text,
        sourceUrl: message.pageUrl,
        timestamp: Date.now()
      };
    }
    sendResponse({ok:true});
    return true;
  }

  if (message?.type === 'get_cached_text') {
    // Return cached text to popup if available.
    const tabId = sender.tab?.id;
    if (tabId != null && tabCache[tabId]?.text) {
      sendResponse({text: tabCache[tabId].text, sourceUrl: tabCache[tabId].sourceUrl});
    } else {
      sendResponse({text: null});
    }
    return true;
  }

  if (message?.type === 'clear_cache') {
    // Optional helper to clear stored tab data.
    const tabId = sender.tab?.id;
    if (tabId != null) {
      delete tabCache[tabId];
    }
    sendResponse({ok:true});
    return true;
  }

  if (message?.type === 'summarize_text') {
    const apiUrl = 'https://privacy-policy-summary-extension.onrender.com/summarize';
    fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message.text })
    })
      .then(async (response) => {
        const body = await response.text();
        try {
          const json = JSON.parse(body);
          sendResponse({ ok: response.ok, status: response.status, result: json, body });
        } catch (parseError) {
          sendResponse({ ok: false, status: response.status, error: `Failed to parse backend response: ${body}` });
        }
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
});
