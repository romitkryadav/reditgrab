/**
 * Reddit DP Downloader - Vanilla JavaScript Frontend
 * Zero dependencies, high performance, accessible
 */

// Worker Pool — add more Cloudflare Worker URLs here to distribute traffic.
// The pool is shuffled on load so each session hits a different worker first.
const WORKER_POOL = [
  "https://reddp.romitkr361.workers.dev",
  "https://reddp2.ajeetkr0920.workers.dev/",  
  // "https://reddp-worker3.yourdomain.workers.dev",
];

// Shuffle pool on page load for natural traffic distribution
(function shufflePool() {
  for (let i = WORKER_POOL.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [WORKER_POOL[i], WORKER_POOL[j]] = [WORKER_POOL[j], WORKER_POOL[i]];
  }
})();

// Backwards-compat alias — always the first entry after shuffle
const WORKER_DEPLOYMENT_URL = WORKER_POOL[0];

// On localhost / workers.dev dev environments use relative same-origin paths,
// otherwise default to the first worker in the pool.
const API_BASE_URL = (typeof window !== 'undefined' && window.location && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  (typeof window.location.hostname === 'string' && window.location.hostname.endsWith('workers.dev'))
))
  ? ""
  : WORKER_DEPLOYMENT_URL;

(function() {
  'use strict';

  // DOM Elements
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const searchForm = document.getElementById('search-form');
  const redditInput = document.getElementById('reddit-input');
  const findDpBtn = document.getElementById('find-dp-btn');
  const loadingContainer = document.getElementById('loading-container');
  const loadingDetailText = document.getElementById('loading-status-detail');
  const errorContainer = document.getElementById('error-container');
  const errorMessageEl = document.getElementById('error-message');
  const errorActionBtn = document.getElementById('error-action-btn');
  const resultContainer = document.getElementById('result-container');
  const resultAvatarImg = document.getElementById('result-avatar-img');
  const resultUsername = document.getElementById('result-username');
  const resultProfileLink = document.getElementById('result-profile-link');
  const resultDimensionPill = document.getElementById('result-dim-pill');
  const resultFormatPill = document.getElementById('result-format-pill');
  const resultUpdatedTimestamp = document.getElementById('result-timestamp');
  const downloadBtn = document.getElementById('download-btn');
  const openOriginalBtn = document.getElementById('open-original-btn');
  const avatarPreviewWrap = document.getElementById('avatar-preview-wrap');
  const avatarImgLoader = document.getElementById('avatar-img-loader');
  const avatarFallbackBadge = document.getElementById('avatar-fallback-badge');
  const avatarFallbackLink = document.getElementById('avatar-fallback-link');
  const zoomHint = document.getElementById('zoom-hint');
  
  // Modal Elements
  const previewModal = document.getElementById('preview-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalAvatarImg = document.getElementById('modal-avatar-img');
  const modalImgLoader = document.getElementById('modal-img-loader');
  const modalTitle = document.getElementById('modal-title');
  const modalDownloadBtn = document.getElementById('modal-download-btn');
  const modalOpenOriginalBtn = document.getElementById('modal-open-original-btn');

  // State
  let isLoading = false;
  let statusInterval = null;
  let currentAvatarData = null;

  /* ==========================================================================
     1. Theme Management (Light / Dark)
     ========================================================================== */
  function getSafeStorage(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch {
      // Storage access blocked by browser policy
    }
    return null;
  }

  function setSafeStorage(key, val) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, val);
      }
    } catch {
      // Storage access blocked by browser policy
    }
  }

  function initTheme() {
    const savedTheme = getSafeStorage('reddit_downloader_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      applyTheme(savedTheme);
    } else {
      const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }
  }

  function applyTheme(theme) {
    if (document && document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    setSafeStorage('reddit_downloader_theme', theme);
    updateThemeIcon(theme);
  }

  function updateThemeIcon(theme) {
    if (!themeToggleBtn) return;
    if (theme === 'dark') {
      themeToggleBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2"></path>
          <path d="M12 20v2"></path>
          <path d="m4.93 4.93 1.41 1.41"></path>
          <path d="m17.66 17.66 1.41 1.41"></path>
          <path d="M2 12h2"></path>
          <path d="M20 12h2"></path>
          <path d="m6.34 17.66-1.41 1.41"></path>
          <path d="m19.07 4.93-1.41 1.41"></path>
        </svg>
      `;
      themeToggleBtn.setAttribute('aria-label', 'Switch to light mode');
      themeToggleBtn.setAttribute('title', 'Switch to light mode');
    } else {
      themeToggleBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
        </svg>
      `;
      themeToggleBtn.setAttribute('aria-label', 'Switch to dark mode');
      themeToggleBtn.setAttribute('title', 'Switch to dark mode');
    }
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  /* ==========================================================================
     2. Input Normalization & Validation
     ========================================================================== */
  function normalizeRedditInput(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let trimmed = raw.trim();
    if (!trimmed || trimmed.length > 300) return null;

    // Strip leading/trailing slashes
    trimmed = trimmed.replace(/^\/+|\/+$/g, '');

    // If user pasted a URL without protocol (e.g. reddit.com/user/spez or www.reddit.com/u/spez)
    let urlCandidate = trimmed;
    if (!urlCandidate.startsWith('http://') && !urlCandidate.startsWith('https://')) {
      if (/^(?:[a-zA-Z0-9-]+\.)?reddit\.com\//i.test(urlCandidate) || /^redd\.it\//i.test(urlCandidate)) {
        urlCandidate = 'https://' + urlCandidate;
      }
    }

    // Check if it's a URL
    if (urlCandidate.startsWith('http://') || urlCandidate.startsWith('https://')) {
      try {
        const parsed = new URL(urlCandidate);
        const host = parsed.hostname.toLowerCase();
        if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') {
          const match = parsed.pathname.match(/\/(?:user|u)\/([A-Za-z0-9_-]{2,30})/i);
          if (match) return match[1];
        }
      } catch {
        // Fall through to pattern matching
      }
    }

    // Handle @username notation
    if (trimmed.startsWith('@')) {
      trimmed = trimmed.slice(1).trim();
    }

    // Handle (user/ | u/) prefix, optional trailing slash, 2-30 chars
    const prefixMatch = trimmed.match(/^(?:(?:user|u)\/)?([A-Za-z0-9_-]{2,30})\/?$/i);
    if (prefixMatch) {
      return prefixMatch[1];
    }

    return null;
  }

  /* ==========================================================================
     3. Loading Experience & Status Cycling
     ========================================================================== */
  const STATUS_MESSAGES = [
    'Checking username...',
    'Checking public profile...',
    'Looking for profile image...',
    'Preparing preview...'
  ];

  function startLoading() {
    isLoading = true;
    findDpBtn.disabled = true;
    findDpBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spinner" style="width: 18px; height: 18px; margin: 0; border-width: 2px;" aria-hidden="true">
      </svg>
      <span>Finding Profile...</span>
    `;

    // Hide results & errors
    if (errorContainer) errorContainer.style.display = 'none';
    if (resultContainer) resultContainer.style.display = 'none';
    
    // Show loading
    if (loadingContainer) {
      loadingContainer.style.display = 'block';
      let stepIndex = 0;
      if (loadingDetailText) loadingDetailText.textContent = STATUS_MESSAGES[0];
      statusInterval = setInterval(() => {
        stepIndex = (stepIndex + 1) % STATUS_MESSAGES.length;
        if (loadingDetailText) loadingDetailText.textContent = STATUS_MESSAGES[stepIndex];
      }, 700);
    }
  }

  function stopLoading(buttonState = 'default') {
    isLoading = false;
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
    if (loadingContainer) loadingContainer.style.display = 'none';
    findDpBtn.disabled = false;

    if (buttonState === 'success') {
      findDpBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>DP Found</span>
      `;
      setTimeout(() => {
        findDpBtn.innerHTML = `<span>Find DP</span>`;
      }, 2500);
    } else if (buttonState === 'error') {
      findDpBtn.innerHTML = `<span>Try Again</span>`;
    } else {
      findDpBtn.innerHTML = `<span>Find DP</span>`;
    }
  }

  /* ==========================================================================
     4. Display States: Error & Success
     ========================================================================== */
  function showError(message) {
    stopLoading('error');
    if (resultContainer) resultContainer.style.display = 'none';
    if (errorContainer) {
      errorMessageEl.textContent = message || 'Something went wrong. Please try again.';
      errorContainer.style.display = 'flex';
      errorContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function showResult(data, apiBase = '') {
    stopLoading('success');
    currentAvatarData = data;

    if (errorContainer) errorContainer.style.display = 'none';

    // Username display
    if (resultUsername) {
      if (data.displayName && data.displayName !== data.username) {
        resultUsername.textContent = `${data.displayName} (u/${data.username})`;
      } else {
        resultUsername.textContent = `u/${data.username}`;
      }
    }
    if (resultProfileLink) {
      resultProfileLink.textContent = data.profileUrl || `https://www.reddit.com/user/${data.username}/`;
      resultProfileLink.href = data.profileUrl || `https://www.reddit.com/user/${data.username}/`;
    }

    // Avatar preview with multi-tier loading & resilient fallback
    const activeBase = (typeof apiBase === 'string' && apiBase !== '') ? apiBase : WORKER_DEPLOYMENT_URL;
    const directUrl = data.avatar.url;
    const proxyUrl = data.avatar.proxyUrl
      ? (activeBase ? `${activeBase}${data.avatar.proxyUrl}` : data.avatar.proxyUrl)
      : `${activeBase}/api/reddit-dp-image?url=${encodeURIComponent(directUrl)}&username=${encodeURIComponent(data.username)}`;

    if (resultAvatarImg) {
      // Reset visual states
      resultAvatarImg.classList.add('loading');
      if (avatarImgLoader) avatarImgLoader.style.display = 'flex';
      if (avatarFallbackBadge) avatarFallbackBadge.style.display = 'none';
      if (zoomHint) zoomHint.style.display = 'none';

      resultAvatarImg.onload = () => {
        resultAvatarImg.classList.remove('loading');
        if (avatarImgLoader) avatarImgLoader.style.display = 'none';
        if (zoomHint) zoomHint.style.display = 'flex';
      };

      resultAvatarImg.onerror = () => {
        // Fallback tier 1: try loading via edge proxy endpoint
        if (!resultAvatarImg.dataset.triedProxy) {
          resultAvatarImg.dataset.triedProxy = 'true';
          console.warn('[RedditDP] Direct avatar blocked or failed to load. Retrying via proxy endpoint...');
          resultAvatarImg.src = proxyUrl;
        } else {
          // Fallback tier 2: reveal fallback badge with direct clickable link
          resultAvatarImg.classList.remove('loading');
          if (avatarImgLoader) avatarImgLoader.style.display = 'none';
          if (avatarFallbackBadge) avatarFallbackBadge.style.display = 'flex';
          if (avatarFallbackLink) avatarFallbackLink.href = directUrl;
          if (zoomHint) zoomHint.style.display = 'none';
        }
      };

      // Clear any prior retry flag and initiate load
      delete resultAvatarImg.dataset.triedProxy;
      resultAvatarImg.src = directUrl;
      resultAvatarImg.alt = `Reddit avatar for u/${data.username}`;
    }

    // Dimensions Pill
    if (resultDimensionPill) {
      if (data.avatar.width && data.avatar.height) {
        resultDimensionPill.textContent = `${data.avatar.width} × ${data.avatar.height} px`;
        resultDimensionPill.style.display = 'inline-block';
      } else {
        resultDimensionPill.textContent = 'Original Aspect';
        resultDimensionPill.style.display = 'inline-block';
      }
    }

    // Format Pill
    if (resultFormatPill) {
      if (data.avatar.format) {
        resultFormatPill.textContent = data.avatar.format.toUpperCase();
        resultFormatPill.style.display = 'inline-block';
      } else {
        resultFormatPill.style.display = 'none';
      }
    }

    // Timestamp
    if (resultUpdatedTimestamp && data.updatedAt) {
      try {
        const d = new Date(data.updatedAt);
        resultUpdatedTimestamp.textContent = `Retrieved: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } catch {
        resultUpdatedTimestamp.textContent = '';
      }
    }

    // Download URL: Worker endpoint with safe filename
    const downloadUrl = `${activeBase}/api/reddit-dp-download?url=${encodeURIComponent(data.avatar.url)}&username=${encodeURIComponent(data.username)}`;
    if (downloadBtn) {
      downloadBtn.onclick = () => triggerDownload(downloadUrl, data.username, data.avatar.format, downloadBtn, data.avatar.url);
    }

    // Open original URL in new tab
    if (openOriginalBtn) {
      openOriginalBtn.href = data.avatar.url;
      openOriginalBtn.target = '_blank';
      openOriginalBtn.rel = 'noopener noreferrer';
    }

    // Prepare modal
    if (modalAvatarImg) {
      modalAvatarImg.classList.add('loading');
      if (modalImgLoader) modalImgLoader.style.display = 'flex';

      modalAvatarImg.onload = () => {
        modalAvatarImg.classList.remove('loading');
        if (modalImgLoader) modalImgLoader.style.display = 'none';
      };

      modalAvatarImg.onerror = () => {
        if (!modalAvatarImg.dataset.triedProxy) {
          modalAvatarImg.dataset.triedProxy = 'true';
          modalAvatarImg.src = proxyUrl;
        } else {
          modalAvatarImg.classList.remove('loading');
          if (modalImgLoader) modalImgLoader.style.display = 'none';
        }
      };

      delete modalAvatarImg.dataset.triedProxy;
      modalAvatarImg.src = directUrl;
      modalAvatarImg.alt = `Enlarged avatar for u/${data.username}`;
    }
    if (modalTitle) {
      modalTitle.textContent = `u/${data.username}`;
    }
    if (modalDownloadBtn) {
      modalDownloadBtn.onclick = () => triggerDownload(downloadUrl, data.username, data.avatar.format, modalDownloadBtn, data.avatar.url);
    }
    if (modalOpenOriginalBtn) {
      modalOpenOriginalBtn.href = data.avatar.url;
    }

    if (resultContainer) {
      resultContainer.style.display = 'block';
      if (typeof resultContainer.scrollIntoView === 'function') {
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  /* ==========================================================================
     5. Safe Image Download Handler with Direct Fallback
     ========================================================================== */
  async function triggerDownload(downloadUrl, username, format, btnEl, directUrl) {
    const ext = format ? format.toLowerCase() : 'png';
    const safeName = `reddit-dp-${(username || 'user').replace(/[^a-zA-Z0-9_-]/g, '')}.${ext}`;
    const originalBtnHtml = btnEl ? btnEl.innerHTML : null;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spinner" aria-hidden="true" style="width:16px;height:16px;margin:0;border-width:2px;"></svg>
        <span>Downloading...</span>
      `;
    }

    let downloadSucceeded = false;

    // Strategy 1: Fetch through worker download endpoint as a Blob
    try {
      const response = await fetch(downloadUrl);
      if (response.ok) {
        const blob = await response.blob();
        if (blob && blob.size > 0) {
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = safeName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
          downloadSucceeded = true;
        }
      }
    } catch (e) {
      console.warn('[RedditDP] Proxy download failed, falling back to direct URL:', e);
    }

    // Strategy 2: Direct image download via Blob or programmatic link
    if (!downloadSucceeded && directUrl) {
      try {
        const res = await fetch(directUrl, { mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = safeName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
          downloadSucceeded = true;
        }
      } catch {
        // Browser fallback: direct anchor navigation
        const link = document.createElement('a');
        link.href = directUrl;
        link.download = safeName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        downloadSucceeded = true;
      }
    }

    if (btnEl) {
      btnEl.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Saved!</span>
      `;
      setTimeout(() => {
        btnEl.disabled = false;
        btnEl.innerHTML = originalBtnHtml;
      }, 2000);
    }
  }

  /* ==========================================================================
     6. Main Search / Retrieval Workflow (Multi-Tier Resilience)
     ========================================================================== */
  async function handleSearch(rawInput) {
    if (isLoading) return;

    if (!rawInput || !rawInput.trim()) {
      showError('Please enter a valid Reddit username or profile URL.');
      return;
    }

    const username = normalizeRedditInput(rawInput);
    if (!username) {
      showError('Please enter a valid Reddit username or profile URL.');
      return;
    }

    startLoading();

    // Build endpoint list: same-origin first, then every worker in the
    // (shuffled) pool. This means traffic spreads across all pool workers
    // while same-origin Pages deployments still get priority.
    const endpointsToTry = [
      { base: '', url: `/api/reddit-dp?username=${encodeURIComponent(username)}` },
      ...WORKER_POOL.map(w => ({
        base: w,
        url: `${w}/api/reddit-dp?username=${encodeURIComponent(username)}`
      }))
    ];

    let resultJson = null;
    let resultStatus = 0;
    let workingBase = WORKER_DEPLOYMENT_URL;
    let lastNetworkError = null;

    for (const item of endpointsToTry) {
      try {
        console.log(`[RedditDP] Querying endpoint: ${item.url}`);
        const response = await fetch(item.url, {
          headers: {
            'Accept': 'application/json'
          }
        });

        resultStatus = response.status;
        const contentType = response.headers.get('content-type') || '';

        // If returned non-JSON (e.g. static HTML 404 page), try next candidate
        if (!contentType.includes('application/json')) {
          console.warn(`[RedditDP] Endpoint ${item.url} returned non-JSON (${contentType}, status ${resultStatus}), checking next candidate...`);
          continue;
        }

        const json = await response.json();
        resultJson = json;
        workingBase = item.base;
        break; // Valid JSON received
      } catch (err) {
        console.warn(`[RedditDP] Endpoint ${item.url} network error:`, err);
        lastNetworkError = err;
      }
    }

    if (!resultJson) {
      console.error('[RedditDP] All endpoints failed. Last network error:', lastNetworkError);
      showError('Unable to connect to the profile service. Please check your network connection or ad-blocker and try again.');
      return;
    }

    if (resultStatus === 404 || (resultJson && resultJson.error && resultJson.error.toLowerCase().includes('not be found'))) {
      showError('That Reddit profile could not be found.');
      return;
    }

    if (resultStatus === 410 || (resultJson && resultJson.error && resultJson.error.toLowerCase().includes('no longer be available'))) {
      showError('This Reddit profile may no longer be available.');
      return;
    }

    if (!resultJson.success) {
      const errorMsg = resultJson.error || 'No publicly accessible profile picture was found.';
      showError(errorMsg);
      return;
    }

    if (!resultJson.avatar || !resultJson.avatar.url) {
      showError('No publicly accessible profile picture was found.');
      return;
    }

    showResult(resultJson, workingBase);
  }

  // Form submission
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = redditInput ? redditInput.value : '';
      handleSearch(val);
    });
  }

  if (errorActionBtn) {
    errorActionBtn.addEventListener('click', () => {
      if (redditInput) {
        redditInput.focus();
        redditInput.select();
      }
      if (errorContainer) errorContainer.style.display = 'none';
      findDpBtn.innerHTML = `<span>Find DP</span>`;
    });
  }

  // Quick chip click handlers
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-value');
      if (redditInput && val) {
        redditInput.value = val;
        handleSearch(val);
      }
    });
  });

  /* ==========================================================================
     7. Click-to-Enlarge Modal
     ========================================================================== */
  function openModal() {
    if (!previewModal) return;
    previewModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    if (modalCloseBtn) modalCloseBtn.focus();
  }

  function closeModal() {
    if (!previewModal) return;
    previewModal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }

  if (avatarPreviewWrap) {
    avatarPreviewWrap.addEventListener('click', openModal);
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }

  if (previewModal) {
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) {
        closeModal();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && previewModal && previewModal.style.display === 'flex') {
      closeModal();
    }
  });

  /* ==========================================================================
     8. FAQ Accordion
     ========================================================================== */
  document.querySelectorAll('.faq-item').forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    if (questionBtn) {
      questionBtn.addEventListener('click', () => {
        const wasActive = item.classList.contains('active');
        // Close all other items for neat accordion feel
        document.querySelectorAll('.faq-item').forEach(other => {
          if (other !== item) other.classList.remove('active');
        });
        if (!wasActive) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }
  });

  // Initialize theme on load
  initTheme();

})();
