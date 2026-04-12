import { useEffect, useState } from 'react';

export default function App() {
  const [pageText, setPageText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cachedText, setCachedText] = useState('');
  const [cachedResult, setCachedResult] = useState(null);

  useEffect(() => {
    loadPageText();
  }, []);

  function handleChromeError(message) {
    setError(message);
  }

  function executeContentScript(tabId, callback) {
    if (!chrome.scripting) {
      callback(new Error('Chrome scripting API unavailable'));
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => {
        if (chrome.runtime.lastError) {
          callback(new Error(chrome.runtime.lastError.message));
          return;
        }
        callback(null);
      }
    );
  }

  function extractTextByScript(tabId, callback) {
    if (!chrome.scripting) {
      callback(null, new Error('Chrome scripting API unavailable'));
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => {
          const keywords = ['terms', 'privacy', 'policy', 'conditions', 'data use', 'cookie'];
          const textPieces = new Set();

          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const trimmed = node.textContent.trim();
            if (!trimmed || trimmed.length < 20) continue;
            const lower = trimmed.toLowerCase();
            if (keywords.some((word) => lower.includes(word))) {
              textPieces.add(trimmed);
            }
          }

          document.querySelectorAll('a[href]').forEach((anchor) => {
            const label = anchor.innerText.trim().toLowerCase();
            if (keywords.some((word) => label.includes(word))) {
              textPieces.add(anchor.innerText.trim());
            }
          });

          const containers = [...document.querySelectorAll('dialog, .modal, [role="dialog"], details, section, footer')];
          containers.forEach((element) => {
            if (!element) return;
            const text = element.innerText || element.textContent || '';
            if (keywords.some((word) => text.toLowerCase().includes(word))) {
              textPieces.add(text.trim());
            }
          });

          document.querySelectorAll('footer, nav, section, article, main').forEach((section) => {
            const text = section.innerText || section.textContent || '';
            if (keywords.some((word) => text.toLowerCase().includes(word))) {
              textPieces.add(text.trim());
            }
          });

          return [...textPieces].join('\n\n');
        }
      },
      (results) => {
        if (chrome.runtime.lastError) {
          callback(null, new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!results || !results[0]) {
          callback(null, new Error('No result from injected extraction script'));
          return;
        }
        callback(results[0].result || '', null);
      }
    );
  }

  function loadPageText() {
    chrome.runtime.sendMessage({ type: 'get_cached_text' }, (response) => {
      if (chrome.runtime.lastError) {
        handleChromeError(chrome.runtime.lastError.message);
        return;
      }
      if (response?.text) {
        setPageText(response.text);
        setSourceUrl(response.sourceUrl || '');
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs || !tabs.length) {
            handleChromeError('No active tab found.');
            return;
          }

          const tabId = tabs[0].id;
          const requestExtract = (retry = false) => {
            chrome.tabs.sendMessage(tabId, { type: 'extract_text' }, (pageResponse) => {
              if (chrome.runtime.lastError) {
                if (!retry) {
                  executeContentScript(tabId, (injectError) => {
                    if (injectError) {
                      extractTextByScript(tabId, (text, directError) => {
                        if (directError) {
                          handleChromeError('Could not inject content script: ' + injectError.message + '. Direct extraction failed: ' + directError.message);
                          return;
                        }
                        if (text) {
                          setPageText(text);
                          setSourceUrl(tabs[0].url || '');
                        } else {
                          setError('No terms or privacy text detected yet.');
                        }
                      });
                      return;
                    }
                    requestExtract(true);
                  });
                  return;
                }
                extractTextByScript(tabId, (text, directError) => {
                  if (directError) {
                    handleChromeError('Could not reach content script. Reload the page. ' + directError.message);
                    return;
                  }
                  if (text) {
                    setPageText(text);
                    setSourceUrl(tabs[0].url || '');
                  } else {
                    setError('No terms or privacy text detected yet.');
                  }
                });
                return;
              }
              if (pageResponse?.text) {
                setPageText(pageResponse.text);
                setSourceUrl(tabs[0].url || '');
              } else {
                setError('No terms or privacy text detected yet.');
              }
            });
          };

          requestExtract();
        });
      }
    });
  }

  async function summarizeText() {
    setError(null);
    if (!pageText) {
      setError('No extracted text is available to summarize.');
      return;
    }
    if (cachedText === pageText && cachedResult) {
      setResult(cachedResult);
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('http://localhost:8080/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pageText })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const json = await response.json();
      setResult(json);
      setCachedText(pageText);
      setCachedResult(json);
    } catch (err) {
      setError(err.message || 'Failed to summarize text.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header>
        <h1>Policy Scanner</h1>
        <p>Detects Terms, Privacy, and Policy content on the active page.</p>
      </header>

      <section className="card">
        <h2>Extracted Text</h2>
        <p className="source-url">{sourceUrl ? `Source: ${sourceUrl}` : 'No source URL available.'}</p>
        <textarea readOnly value={pageText || 'Waiting for page detection...'} />
        <button onClick={summarizeText} disabled={loading || !pageText}>
          {loading ? 'Summarizing...' : 'Summarize Now'}
        </button>
        <button className="secondary" onClick={loadPageText} disabled={loading}>
          Refresh Extraction
        </button>
        {error && <p className="error-message">{error}</p>}
      </section>

      {result && (
        <section className="card results-card">
          <div className="section-block">
            <h2>Summary</h2>
            <p>{result.summary}</p>
          </div>
          <div className="section-block red">
            <h3>Red Flags</h3>
            <ul>{result.red_flags?.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
          <div className="section-block yellow">
            <h3>Important Points</h3>
            <ul>{result.important_points?.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
          <div className="section-block green">
            <h3>Green Flags</h3>
            <ul>{result.green_flags?.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
        </section>
      )}
    </div>
  );
}
