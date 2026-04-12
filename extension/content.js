const keywords = [
  "terms",
  "privacy",
  "policy",
  "conditions",
  "data use",
  "cookie",
  "legal",
  "agreement",
  "user agreement",
  "service terms",
  "privacy statement",
  "data policy",
  "terms of use",
  "privacy notice",
];
const summaryBubbles = new Map();
const policyBadges = new Map();
const targetSummaries = new WeakMap();
let autoSummaryTriggered = false;
let statusElement = null;
let badgePositionTimer = null;

injectStyles();
window.addEventListener("scroll", scheduleBadgeReposition);
window.addEventListener("resize", scheduleBadgeReposition);

window.addEventListener("load", () => {
  debounceScanPage();
});

const observer = new MutationObserver(debounceScanPage);
observer.observe(document.body, { childList: true, subtree: true });

let scanTimer;
function debounceScanPage() {
  if (scanTimer) {
    clearTimeout(scanTimer);
  }
  scanTimer = setTimeout(scanPage, 1200);
}

async function scanPage() {
  showScannerStatus("Policy scanner active");
  const scope = getActivePolicyScope();
  const extracted = await extractTermsAndPrivacyText(scope);
  console.log(
    "[Policy Scanner] extracted text length:",
    extracted.text?.length || 0,
  );
  if (extracted.text) {
    try {
      chrome.runtime.sendMessage({
        type: "page_detected",
        text: extracted.text,
        pageUrl: window.location.href,
      });
    } catch (error) {
      console.warn(
        "[Policy Scanner] page_detected message failed:",
        error?.message || error,
      );
    }
  }

  const candidates = findPolicyCandidates(scope);
  console.log("[Policy Scanner] candidates found:", candidates.length);
  candidates.forEach((candidate, index) => {
    console.log(
      `[Policy Scanner] Candidate ${index}:`,
      candidate.innerText.substring(0, 100) + "...",
    );
  });

  if (!autoSummaryTriggered && candidates.length > 0) {
    autoSummaryTriggered = true;
    const distinctTargets = chooseDistinctTargets(candidates, 3);
    console.log(
      "[Policy Scanner] Auto-summarizing candidate sections:",
      distinctTargets.length,
    );
    distinctTargets.forEach(addPolicyBadge);
    distinctTargets.forEach((target, index) => {
      setTimeout(() => autoSummarizeTarget(target), index * 800);
    });
    return;
  }

  if (!autoSummaryTriggered) {
    console.log("[Policy Scanner] No policy sections found for inline badges.");
  }
}

function chooseDistinctTargets(candidates, maxTargets) {
  const selected = [];
  const seen = new Set();
  const orderedCandidates = [...candidates].sort((a, b) => {
    const aIsLink = isPolicyLinkTarget(a);
    const bIsLink = isPolicyLinkTarget(b);
    if (aIsLink !== bIsLink) {
      return aIsLink ? -1 : 1;
    }
    return extractTextFromElement(b).length - extractTextFromElement(a).length;
  });

  for (const candidate of orderedCandidates) {
    if (candidate?.tagName === "A" && !isPolicyLinkTarget(candidate)) continue;
    const target = isPolicyLinkTarget(candidate)
      ? candidate
      : getBestPolicySection(candidate) || candidate;
    if (!isVisible(target) || hasIgnoredParent(target)) continue;
    if (!isPolicyLinkTarget(target) && containsVisiblePolicyLinks(target))
      continue;

    const text = extractTextFromElement(target)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);

    if (!text) continue;
    const fingerprint = getTargetFingerprint(target, text);
    if (seen.has(fingerprint)) continue;

    seen.add(fingerprint);
    selected.push(target);
    if (selected.length >= maxTargets) break;
  }

  return selected;
}

function addPolicyBadge(target) {
  if (!target || policyBadges.has(target)) return;
  const badgeMeta = getPolicyBadgeMeta(target);
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = `policy-scanner-badge policy-scanner-badge-small policy-scanner-badge-loading policy-scanner-badge-${badgeMeta.variant}`;
  badge.innerHTML = getPolicyBadgeIconSvg(badgeMeta.variant);
  badge.dataset.policyTarget = "true";
  badge.dataset.policyType = badgeMeta.variant;
  badge.title = badgeMeta.loadingTitle;
  badge.setAttribute("aria-label", badgeMeta.loadingTitle);

  badge.addEventListener("mouseenter", () =>
    showBadgeTooltip(target, badgeMeta.loadingTitle),
  );
  badge.addEventListener("mouseleave", () => hideBadgeTooltip());
  badge.addEventListener("click", () => {
    const result = targetSummaries.get(target);
    if (result) {
      showSummaryBubble(target, result);
    } else {
      showBadgeTooltip(target, badgeMeta.loadingTitle);
    }
  });

  document.body.appendChild(badge);
  policyBadges.set(target, badge);
  positionBadge(badge, target);
  scheduleBadgeReposition();
}

function updatePolicyBadge(target, summary) {
  if (!target || !policyBadges.has(target)) return;
  targetSummaries.set(target, summary);
  const badge = policyBadges.get(target);
  if (badge) {
    const badgeMeta = getPolicyBadgeMeta(target);
    badge.title = badgeMeta.readyTitle;
    badge.setAttribute("aria-label", badgeMeta.readyTitle);
    badge.classList.remove("policy-scanner-badge-loading");
    badge.classList.add("policy-scanner-badge-ready");
  }
}

function positionBadge(badge, target) {
  const rect = target.getBoundingClientRect();
  badge.style.position = "absolute";

  if (
    !rect.width ||
    !rect.height ||
    Number.isNaN(rect.left) ||
    Number.isNaN(rect.top)
  ) {
    badge.style.top = `${window.scrollY + 12}px`;
    badge.style.left = `${window.scrollX + 12}px`;
    return;
  }

  const badgeWidth = badge.offsetWidth || 32;
  const badgeHeight = badge.offsetHeight || 32;
  const viewportLeft = window.scrollX + 8;
  const viewportRight = window.scrollX + window.innerWidth - badgeWidth - 8;
  const viewportTop = window.scrollY + 8;
  const viewportBottom = window.scrollY + window.innerHeight - badgeHeight - 8;
  const isLinkTarget = isPolicyLinkTarget(target);
  let left;
  let top;

  if (isLinkTarget) {
    left = window.scrollX + rect.right - badgeWidth * 0.2;
    if (left > viewportRight) {
      left = window.scrollX + rect.right - badgeWidth;
    }
    top = window.scrollY + rect.top - badgeHeight - 4;
    if (top < viewportTop) {
      top = window.scrollY + rect.bottom + 4;
    }
  } else {
    const preferredLeft = window.scrollX + rect.right - badgeWidth / 2;
    left = clamp(preferredLeft, viewportLeft, viewportRight);
    top = window.scrollY + rect.top - badgeHeight / 2;

    if (top < viewportTop) {
      top = window.scrollY + rect.bottom + 8;
    }
  }

  left = clamp(left, viewportLeft, viewportRight);
  top = clamp(top, viewportTop, Math.max(viewportTop, viewportBottom));
  badge.style.left = `${left}px`;
  badge.style.top = `${top}px`;
}

function scheduleBadgeReposition() {
  if (badgePositionTimer) return;
  badgePositionTimer = setTimeout(() => {
    policyBadges.forEach((badge, target) => {
      if (badge && target) positionBadge(badge, target);
    });
    summaryBubbles.forEach((bubble, target) => {
      if (bubble) positionSummaryBubble(bubble, target);
    });
    badgePositionTimer = null;
  }, 100);
}

function showBadgeTooltip(target, message) {
  let tooltip = document.getElementById("policy-scanner-badge-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "policy-scanner-badge-tooltip";
    tooltip.className = "policy-scanner-badge-tooltip";
    document.body.appendChild(tooltip);
  }

  const summary = typeof message === "string" ? message : "Loading summary...";
  const stored = targetSummaries.get(target);
  tooltip.innerHTML = `<div>${escapeHtml(stored?.summary || summary)}</div>`;
  tooltip.style.display = "block";
  tooltip.style.visibility = "hidden";
  tooltip.style.opacity = "0";
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";

  const badge = policyBadges.get(target);
  const rect = badge
    ? badge.getBoundingClientRect()
    : target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let left =
    window.scrollX +
    Math.min(rect.left, window.innerWidth - tooltipRect.width - 12);
  let top = window.scrollY + rect.top - tooltipRect.height - 10;

  if (top < window.scrollY + 8) {
    top = window.scrollY + rect.bottom + 10;
  }

  if (left < window.scrollX + 8) {
    left = window.scrollX + 8;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.visibility = "visible";
  tooltip.style.opacity = "0.98";
}

function hideBadgeTooltip() {
  const tooltip = document.getElementById("policy-scanner-badge-tooltip");
  if (tooltip) {
    tooltip.style.opacity = "0";
    tooltip.style.display = "none";
  }
}

function findPolicyCandidates(scope = document.body) {
  const candidates = new Set();
  const root = scope || document.body;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || hasIgnoredParent(parent)) continue;

    const text = node.textContent.trim();
    if (text.length < 5) continue;

    const lower = text.toLowerCase();
    if (!keywords.some((word) => lower.includes(word))) continue;

    const anchor = parent.closest("a");
    if (
      anchor &&
      isVisible(anchor) &&
      !hasIgnoredParent(anchor) &&
      isPolicyLinkTarget(anchor)
    ) {
      candidates.add(anchor);
      continue;
    }

    const section = findNearestPolicySection(parent);
    if (
      !section ||
      !isVisible(section) ||
      section.tagName === "BODY" ||
      section.tagName === "HTML"
    )
      continue;

    if (
      section.closest(
        "header, nav, .header, .navbar, .topbar, .menu, .cookie-banner, .banner",
      )
    )
      continue;

    const sectionText = extractTextFromElement(section);
    if (
      sectionText.length < 40 &&
      !/terms|privacy|policy|agreement/.test(sectionText.toLowerCase())
    )
      continue;

    candidates.add(section);
  }

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const label = (anchor.innerText || "").trim().toLowerCase();
    if (
      keywords.some((word) => label.includes(word)) &&
      isVisible(anchor) &&
      !hasIgnoredParent(anchor) &&
      isPolicyLinkTarget(anchor)
    ) {
      candidates.add(anchor);
    }
  });

  const list = [...candidates];
  list.sort(
    (a, b) =>
      extractTextFromElement(b).length - extractTextFromElement(a).length,
  );
  return list.slice(0, 4);
}

function findNearestPolicySection(element) {
  let node = element;
  while (node && node !== document.body) {
    if (
      ["P", "LI", "SECTION", "ARTICLE", "MAIN", "DIV"].includes(node.tagName)
    ) {
      const text = extractTextFromElement(node);
      if (text.length >= 40) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function hasIgnoredParent(element) {
  let node = element;
  while (node && node !== document.body) {
    const tag = node.tagName;
    if (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "NOSCRIPT" ||
      tag === "CODE" ||
      tag === "PRE"
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function showScannerStatus(message) {
  if (!statusElement) {
    statusElement = document.createElement("div");
    statusElement.className =
      "policy-scanner-status policy-scanner-status-active";
    document.body.appendChild(statusElement);
  }
  statusElement.textContent = message;
}

async function autoSummarizeTarget(target) {
  console.log(
    "[Policy Scanner] Starting auto-summarize for target:",
    target.innerText.substring(0, 50) + "...",
  );
  const text = await resolveSummaryText(target);
  console.log("[Policy Scanner] Extracted text length:", text.length);

  if (!text) {
    console.log("[Policy Scanner] No text found for target");
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "summarize_text", text }, (response) => {
      console.log(
        "[Policy Scanner] Received response from background:",
        response,
      );
      if (chrome.runtime.lastError || !response || !response.result) {
        console.error(
          "[Policy Scanner] Summarization failed for target:",
          chrome.runtime.lastError?.message || response?.error || "No result",
        );
        return;
      }

      updatePolicyBadge(target, response.result);
      targetSummaries.set(target, response.result);
    });
  } catch (error) {
    console.error(
      "[Policy Scanner] summarize_text sendMessage failed:",
      error?.message || error,
    );
  }
}

async function autoSummarizeText(text) {
  console.log(
    "[Policy Scanner] Page-level auto-summary disabled for inline badge mode.",
  );
}

function showMockSummary(loadingBubble) {
  const mockResult = {
    summary:
      "This is a mock summary for testing. The extension detected policy text but the backend is not responding. Check the console for errors and ensure the Go server is running.",
    red_flags: [
      "Backend not responding",
      "Check API key",
      "Verify server is running",
    ],
    important_points: [
      "Extension UI is working",
      "Detection logic is active",
      "Backend integration needed",
    ],
    green_flags: ["Extension loaded successfully", "Page scanning active"],
  };
  showSummaryBubble(null, mockResult, loadingBubble);
}

function createLoadingBubble(target) {
  const bubble = document.createElement("div");
  bubble.className = "policy-scanner-summary policy-scanner-summary-loading";
  bubble.innerHTML = `
    <div class="policy-scanner-summary-header">
      <strong>Policy Summary</strong>
      <button class="policy-scanner-close">×</button>
    </div>
    <div class="policy-scanner-summary-body">
      <p>Detecting terms and summarizing the policy for you...</p>
    </div>
  `;

  const closeButton = bubble.querySelector(".policy-scanner-close");
  closeButton.addEventListener("click", () => bubble.remove());

  document.body.appendChild(bubble);
  positionSummaryBubble(bubble, target);
  summaryBubbles.set(target, bubble);
  return bubble;
}

function updateBubbleError(bubble, message) {
  if (!bubble) return;
  bubble.classList.add("policy-scanner-summary-error");
  bubble.innerHTML = `
    <div class="policy-scanner-summary-header">
      <strong>Policy Summary</strong>
      <button class="policy-scanner-close">×</button>
    </div>
    <div class="policy-scanner-summary-body">
      <p><strong>Error:</strong> ${escapeHtml(message)}</p>
    </div>
  `;
  const closeButton = bubble.querySelector(".policy-scanner-close");
  closeButton.addEventListener("click", () => bubble.remove());
}

function showStatus(badge, message) {
  const status = document.createElement("div");
  status.className = "policy-scanner-status";
  status.textContent = message;
  document.body.appendChild(status);
  const rect = badge.getBoundingClientRect();
  status.style.left = `${window.scrollX + rect.left}px`;
  status.style.top = `${window.scrollY + rect.bottom + 8}px`;
  setTimeout(() => status.remove(), 3500);
}

function getBestPolicySection(element) {
  if (isPolicyLinkTarget(element)) {
    return element;
  }

  let best = null;
  let bestSize = Infinity;
  let node = element;

  while (node && node !== document.body) {
    if (
      ["P", "LI", "SECTION", "ARTICLE", "MAIN", "DIV"].includes(node.tagName)
    ) {
      const text = extractTextFromElement(node);
      const lower = text.toLowerCase();
      if (text.length >= 120 && keywords.some((word) => lower.includes(word))) {
        if (text.length < bestSize) {
          best = node;
          bestSize = text.length;
        }
      }
    }
    node = node.parentElement;
  }

  return best || element;
}

function extractTextFromElement(element) {
  if (!element) return "";
  return (element.innerText || element.textContent || "").trim();
}

function isPolicyLinkTarget(element) {
  if (!element || element.tagName !== "A") return false;
  return getPolicyLinkVariant(element) !== null;
}

function matchesPolicyText(text) {
  const normalized = String(text || "").toLowerCase();
  return keywords.some((word) => normalized.includes(word));
}

function containsVisiblePolicyLinks(element) {
  if (!element || typeof element.querySelectorAll !== "function") return false;
  return [...element.querySelectorAll("a[href]")].some(
    (anchor) =>
      isVisible(anchor) &&
      !hasIgnoredParent(anchor) &&
      isPolicyLinkTarget(anchor),
  );
}

function getTargetFingerprint(target, fallbackText) {
  if (isPolicyLinkTarget(target)) {
    return `link:${target.href || fallbackText.toLowerCase()}`;
  }
  return `section:${fallbackText.toLowerCase()}`;
}

function getPolicyBadgeMeta(target) {
  const variant =
    target?.tagName === "A"
      ? getPolicyLinkVariant(target)
      : getSectionPolicyVariant(target);

  if (variant === "privacy") {
    return {
      variant: "privacy",
      loadingTitle: "Loading privacy summary...",
      readyTitle: "Privacy summary ready - hover for preview",
    };
  }

  if (variant === "cookie") {
    return {
      variant: "cookie",
      loadingTitle: "Loading cookie policy summary...",
      readyTitle: "Cookie policy summary ready - hover for preview",
    };
  }

  if (variant === "terms") {
    return {
      variant: "terms",
      loadingTitle: "Loading terms summary...",
      readyTitle: "Terms summary ready - hover for preview",
    };
  }

  return {
    variant: "legal",
    loadingTitle: "Loading policy summary...",
    readyTitle: "Policy summary ready - hover for preview",
  };
}

function getPolicyLinkVariant(element) {
  const text = normalizePolicyText(extractTextFromElement(element));
  const href = normalizePolicyText(element?.getAttribute?.("href") || "");
  const combined = `${text} ${href}`.trim();
  const footerLike = isFooterLikePolicyLink(element);
  const consentLike = isConsentPolicyLink(element);

  if (
    matchesAnyPhrase(combined, [
      "privacy policy",
      "privacy notice",
      "privacy statement",
      "data policy",
    ])
  ) {
    return "privacy";
  }

  if (
    matchesAnyPhrase(combined, [
      "terms of service",
      "terms of use",
      "terms and conditions",
      "conditions of use",
      "user agreement",
      "service terms",
    ])
  ) {
    return "terms";
  }

  if (
    matchesAnyPhrase(combined, [
      "cookie policy",
      "cookie notice",
      "cookie statement",
    ])
  ) {
    return "cookie";
  }

  if (
    /\bprivacy\b/.test(text) &&
    (/\bprivacy\b/.test(href) || footerLike || consentLike)
  ) {
    return "privacy";
  }

  if (
    /\bterms\b/.test(text) &&
    (/\bterms\b/.test(href) || footerLike || consentLike)
  ) {
    return "terms";
  }

  if (
    /\bcookie\b/.test(text) &&
    (/\bcookie\b/.test(href) || footerLike || consentLike)
  ) {
    return "cookie";
  }

  if (/\blegal\b/.test(text) && (/\blegal\b/.test(href) || footerLike)) {
    return "legal";
  }

  return null;
}

function getSectionPolicyVariant(element) {
  const normalized = normalizePolicyText(extractTextFromElement(element));

  if (
    matchesAnyPhrase(normalized, [
      "privacy policy",
      "privacy notice",
      "privacy statement",
      "data policy",
    ])
  ) {
    return "privacy";
  }

  if (
    matchesAnyPhrase(normalized, [
      "terms of service",
      "terms of use",
      "terms and conditions",
      "user agreement",
      "service terms",
    ])
  ) {
    return "terms";
  }

  if (
    matchesAnyPhrase(normalized, [
      "cookie policy",
      "cookie notice",
      "cookie statement",
    ])
  ) {
    return "cookie";
  }

  return "legal";
}

function normalizePolicyText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAnyPhrase(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function isFooterLikePolicyLink(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const inFooterTree = Boolean(
    element.closest('footer, [role="contentinfo"], .footer, .site-footer'),
  );
  const nearBottom = rect.bottom >= window.innerHeight * 0.82;
  const compactText = extractTextFromElement(element).length <= 24;
  return compactText && (inFooterTree || nearBottom);
}

function isConsentPolicyLink(element) {
  if (!element) return false;
  const text = normalizePolicyText(
    extractTextFromElement(
      element.closest("label, p, li, small, div") || element,
    ),
  );
  return /\bi agree\b|\bby continuing\b|\bby signing up\b|\bby creating\b|\baccept\b|\bconsent\b/.test(
    text,
  );
}

function getPolicyBadgeIconSvg(variant) {
  const icons = {
    privacy: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3l7 3v5c0 4.4-2.6 8.4-7 10-4.4-1.6-7-5.6-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `,
    cookie: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M13 3a4 4 0 003 4 4 4 0 004 4 7 7 0 11-7-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="9" cy="13" r="1" fill="currentColor"></circle>
        <circle cx="12.5" cy="16" r="1" fill="currentColor"></circle>
        <circle cx="15" cy="10.5" r="1" fill="currentColor"></circle>
      </svg>
    `,
    legal: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 3h6l4 4v14H8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M10.5 12.5h5M10.5 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `,
    terms: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 4h12v16H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M9 8.5h6M9 12h6M9 15.5h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `,
  };

  return icons[variant] || icons.legal;
}

async function resolveSummaryText(target) {
  if (isPolicyLinkTarget(target) && target.href) {
    const linkedText = await fetchLinkedText(target.href);
    if (linkedText) {
      return linkedText;
    }

    const inlineContext = extractInlinePolicyContext(target);
    if (inlineContext) {
      return inlineContext;
    }
  }

  const section = getBestPolicySection(target);
  return extractTextFromElement(section || target);
}

function extractInlinePolicyContext(target) {
  const context = target.closest("label, p, li, small, div, section, article");
  const text = extractTextFromElement(context);
  return text.length >= 30 ? text : "";
}

function showSummaryBubble(target, result, existingBubble) {
  if (existingBubble) {
    existingBubble.remove();
  }

  hideSummaryBubble(target);

  if (typeof result === "string") {
    result = {
      summary: result,
      red_flags: [],
      important_points: [],
      green_flags: [],
    };
  }

  if (!result || !result.summary) {
    const fallbackText = result?.text || JSON.stringify(result || {}, null, 2);
    result = {
      summary: fallbackText || "Summary unavailable",
      red_flags: [],
      important_points: [],
      green_flags: [],
    };
  }

  const bubble = document.createElement("div");
  bubble.className = "policy-scanner-summary";
  bubble.innerHTML = `
    <div class="policy-scanner-summary-header">
      <strong>Policy Summary</strong>
      <button class="policy-scanner-close">×</button>
    </div>
    <div class="policy-scanner-summary-body">
      <div class="policy-scanner-summary-section">
        <h4>Summary</h4>
        <p>${escapeHtml(result.summary)}</p>
      </div>
      <div class="policy-scanner-summary-section section-red">
        <h4>Red flags</h4>
        ${formatList(result.red_flags)}
      </div>
      <div class="policy-scanner-summary-section section-yellow">
        <h4>Important points</h4>
        ${formatList(result.important_points)}
      </div>
      <div class="policy-scanner-summary-section section-green">
        <h4>Green flags</h4>
        ${formatList(result.green_flags)}
      </div>
    </div>
  `;

  const closeButton = bubble.querySelector(".policy-scanner-close");
  closeButton.addEventListener("click", () => hideSummaryBubble(target));

  document.body.appendChild(bubble);
  positionSummaryBubble(bubble, target);
  summaryBubbles.set(target, bubble);
}

function hideSummaryBubble(target) {
  const existing = summaryBubbles.get(target);
  if (existing) {
    existing.remove();
    summaryBubbles.delete(target);
  }
}

function positionSummaryBubble(bubble, target) {
  bubble.style.zIndex = "2147483647";
  bubble.style.maxWidth = "360px";

  if (!target) {
    bubble.style.position = "fixed";
    bubble.style.top = "100px";
    bubble.style.right = "24px";
    bubble.style.left = "auto";
    bubble.style.bottom = "auto";
    return;
  }

  const anchor = policyBadges.get(target) || target;
  const rect = anchor.getBoundingClientRect();
  const bubbleWidth = bubble.offsetWidth || 340;
  const bubbleHeight = bubble.offsetHeight || 320;
  const gutter = 12;
  const viewportLeft = window.scrollX + 10;
  const viewportRight = window.scrollX + window.innerWidth - bubbleWidth - 10;
  const viewportTop = window.scrollY + 10;
  const viewportBottom =
    window.scrollY + window.innerHeight - bubbleHeight - 10;
  const fitsRight = rect.right + gutter + bubbleWidth <= window.innerWidth - 10;
  const fitsLeft = rect.left - gutter - bubbleWidth >= 10;
  let left;

  if (fitsRight || !fitsLeft) {
    left = window.scrollX + rect.right + gutter;
  } else {
    left = window.scrollX + rect.left - bubbleWidth - gutter;
  }

  let top = window.scrollY + rect.top + rect.height / 2 - bubbleHeight / 2;
  top = clamp(top, viewportTop, Math.max(viewportTop, viewportBottom));
  left = clamp(left, viewportLeft, Math.max(viewportLeft, viewportRight));

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.position = "absolute";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<em>No items found.</em>";
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function extractTermsAndPrivacyText(scope = document.body) {
  const textPieces = new Set();
  const links = new Set();
  const root = scope || document.body;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (
      !parent ||
      ["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"].includes(parent.tagName)
    )
      continue;
    const trimmed = node.textContent.trim();
    if (!trimmed || trimmed.length < 20) continue;

    const lower = trimmed.toLowerCase();
    if (keywords.some((word) => lower.includes(word))) {
      textPieces.add(trimmed);
    }
  }

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const label = anchor.innerText.trim().toLowerCase();
    if (keywords.some((word) => label.includes(word))) {
      links.add(anchor.href);
    }
  });

  const containers = [
    ...root.querySelectorAll(
      'dialog, .modal, [role="dialog"], details, section, footer',
    ),
  ];
  containers.forEach((element) => {
    const text = extractTextFromElement(element);
    if (keywords.some((word) => text.toLowerCase().includes(word))) {
      textPieces.add(text);
    }
  });

  root
    .querySelectorAll("footer, nav, section, article, main")
    .forEach((section) => {
      const text = extractTextFromElement(section);
      if (keywords.some((word) => text.toLowerCase().includes(word))) {
        textPieces.add(text);
      }
    });

  if (links.size && textPieces.size < 3) {
    for (const href of links) {
      const additional = await fetchLinkedText(href);
      if (additional) {
        textPieces.add(additional);
      }
    }
  }

  const text = [...textPieces].join("\n\n");
  return { text: text || null, links: [...links] };
}

function showTestSummaryBubble() {
  const bubble = document.createElement("div");
  bubble.className = "policy-scanner-summary";
  bubble.innerHTML = `
    <div class="policy-scanner-summary-header">
      <strong>Policy Scanner Test</strong>
      <button class="policy-scanner-close">×</button>
    </div>
    <div class="policy-scanner-summary-body">
      <p>This is a test bubble to verify the UI works. If you see this, the extension is loaded correctly!</p>
      <p>Scanner is looking for Terms/Privacy text...</p>
    </div>
  `;

  const closeButton = bubble.querySelector(".policy-scanner-close");
  closeButton.addEventListener("click", () => bubble.remove());

  document.body.appendChild(bubble);
  bubble.style.position = "fixed";
  bubble.style.top = "100px";
  bubble.style.right = "24px";
  bubble.style.left = "auto";
  bubble.style.bottom = "auto";
  bubble.style.zIndex = "999999";
}

function getActivePolicyScope() {
  const modalSelectors = [
    "dialog[open]",
    '[role="dialog"]',
    '[aria-modal="true"]',
    ".modal",
    ".dialog",
    ".Dialog",
  ];

  const candidates = [...document.querySelectorAll(modalSelectors.join(", "))]
    .filter((element) => isVisible(element))
    .filter((element) => containsPolicyText(element));

  if (!candidates.length) {
    return document.body;
  }

  candidates.sort((a, b) => getScopePriority(b) - getScopePriority(a));
  return candidates[0];
}

function containsPolicyText(element) {
  const text = extractTextFromElement(element);
  return text.length > 0 && matchesPolicyText(text);
}

function getScopePriority(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const zIndex = Number.parseInt(style.zIndex, 10);
  const normalizedZIndex = Number.isNaN(zIndex) ? 0 : zIndex;
  const fixedBonus = style.position === "fixed" ? 100000 : 0;
  const areaPenalty = rect.width * rect.height;
  return normalizedZIndex + fixedBonus - areaPenalty / 1000;
}

function injectStyles() {
  if (document.getElementById("policy-scanner-inline-styles")) return;

  const style = document.createElement("style");
  style.id = "policy-scanner-inline-styles";
  style.textContent = `
    .policy-scanner-badge {
      position: absolute;
      z-index: 999999;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 10px 30px rgba(0,0,0,0.12);
    }
    .policy-scanner-summary {
      position: absolute;
      z-index: 999999;
      width: 340px;
      max-height: 460px;
      overflow: auto;
      background: rgba(255,255,255,0.98);
      border: 1px solid rgba(148,163,184,0.3);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 24px 60px rgba(15,23,42,0.22);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      color: #0f172a;
      backdrop-filter: blur(8px);
    }
    .policy-scanner-summary-loading {
      opacity: 0.96;
    }
    .policy-scanner-summary-error {
      border-color: #fca5a5;
      background: #fef2f2;
    }
    .policy-scanner-badge-small {
      position: absolute;
      z-index: 2147483648;
      width: 24px;
      height: 24px;
      min-width: 24px;
      min-height: 24px;
      padding: 0;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.92);
      background: rgba(15,23,42,0.88);
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(15,23,42,0.16);
      transition: transform 0.15s ease, opacity 0.15s ease;
      opacity: 0.94;
    }
    .policy-scanner-badge-small:hover {
      transform: translateY(-1px);
      opacity: 1;
    }
    .policy-scanner-badge-small svg {
      width: 12px;
      height: 12px;
      display: block;
    }
    .policy-scanner-badge-small.policy-scanner-badge-loading {
      background: rgba(15,23,42,0.72);
    }
    .policy-scanner-badge-small.policy-scanner-badge-terms {
      background: #2563eb;
    }
    .policy-scanner-badge-small.policy-scanner-badge-privacy {
      background: #0f766e;
    }
    .policy-scanner-badge-small.policy-scanner-badge-cookie {
      background: #b45309;
    }
    .policy-scanner-badge-small.policy-scanner-badge-legal {
      background: #475569;
    }
    .policy-scanner-badge-small.policy-scanner-badge-ready {
      filter: saturate(1.08) brightness(1.02);
    }
    .policy-scanner-badge-tooltip {
      position: absolute;
      z-index: 2147483650;
      max-width: 280px;
      background: rgba(15,23,42,0.96);
      color: white;
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      box-shadow: 0 20px 40px rgba(0,0,0,0.25);
      pointer-events: none;
      display: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: normal;
      word-break: break-word;
    }
    .policy-scanner-summary-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .policy-scanner-summary-header strong {
      font-size: 1rem;
      letter-spacing: 0.02em;
    }
    .policy-scanner-close {
      border: none;
      background: none;
      color: #334155;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
    }
    .policy-scanner-summary-body {
      display: grid;
      gap: 12px;
    }
    .policy-scanner-summary-section {
      border-radius: 16px;
      padding: 12px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
    }
    .policy-scanner-summary-section h4 {
      margin: 0 0 8px;
      font-size: 0.95rem;
      color: #0f172a;
    }
    .policy-scanner-summary-section p {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.55;
      color: #334155;
    }
    .policy-scanner-summary-section.section-red {
      background: #fef2f2;
      border-color: #fecaca;
    }
    .policy-scanner-summary-section.section-yellow {
      background: #fffbeb;
      border-color: #fef08a;
    }
    .policy-scanner-summary-section.section-green {
      background: #ecfdf5;
      border-color: #bbf7d0;
    }
    .policy-scanner-summary-body ul {
      padding-left: 18px;
      margin: 0;
    }
    .policy-scanner-summary-body li {
      margin-bottom: 6px;
      font-size: 0.92rem;
      line-height: 1.5;
      color: #334155;
    }
    .policy-scanner-status {
      position: fixed;
      bottom: 18px;
      right: 18px;
      top: auto;
      z-index: 999999;
      background: rgba(15,23,42,0.92);
      color: white;
      border-radius: 14px;
      padding: 10px 14px;
      font-size: 12px;
      box-shadow: 0 16px 36px rgba(15,23,42,0.25);
      backdrop-filter: blur(8px);
      pointer-events: none;
    }
    .policy-scanner-status-active {
      animation: fadeIn 0.3s ease forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

async function fetchLinkedText(url) {
  try {
    const sameOrigin =
      new URL(url, window.location.href).origin === window.location.origin;
    if (!sameOrigin) {
      return null;
    }

    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
    });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const bodyText = doc.body ? doc.body.innerText.trim() : "";
    if (bodyText.length > 300) {
      return bodyText;
    }
  } catch (error) {
    // Ignore fetch errors due to CORS or network restrictions.
  }
  return null;
}
