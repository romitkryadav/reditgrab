/**
 * Reddit Image Downloader - Client-Side Application
 * 
 * Vanilla JavaScript implementation for Cloudflare Pages / Static Hosting.
 * Coordinates with the Cloudflare Worker API to extract, preview, inspect,
 * and download high-resolution Reddit images and multi-image galleries.
 */

// ==========================================================================
// Configuration
// ==========================================================================
// Determine Worker API base URL:
// On Cloudflare Pages (*.pages.dev or custom domain), dev server, or preview environments,
// the /api/* endpoints are served directly from the same origin via _worker.js.
// Default to '' (same-origin relative paths) so it always works seamlessly on any domain.
const API_BASE_URL = (typeof window !== 'undefined' && window.location.protocol === 'file:')
  ? 'https://reimg.romitkr5539.workers.dev'
  : '';

// State management
const state = {
  currentImages: [],
  currentPostUrl: '',
  currentPostTitle: '',
  modalActiveIndex: 0,
  isFetching: false,
  isDownloadingAll: false,
  loadingInterval: null,
};

// DOM Elements
const elements = {
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  form: document.getElementById('reddit-form'),
  urlInput: document.getElementById('reddit-url-input'),
  clearBtn: document.getElementById('clear-btn'),
  pasteBtn: document.getElementById('paste-btn'),
  submitBtn: document.getElementById('submit-btn'),
  submitBtnText: document.getElementById('submit-btn-text'),
  sampleGalleryBtn: document.getElementById('sample-gallery-btn'),
  sampleDirectBtn: document.getElementById('sample-direct-btn'),
  samplePostBtn: document.getElementById('sample-post-btn'),
  loadingContainer: document.getElementById('loading-container'),
  loadingPrimaryText: document.getElementById('loading-primary-text'),
  loadingSubText: document.getElementById('loading-sub-text'),
  errorBanner: document.getElementById('error-banner'),
  errorMessageText: document.getElementById('error-message-text'),
  errorDismissBtn: document.getElementById('error-dismiss-btn'),
  resultsContainer: document.getElementById('results-container'),
  resultsCount: document.getElementById('results-count'),
  resultsPostTitle: document.getElementById('results-post-title'),
  downloadAllBtn: document.getElementById('download-all-btn'),
  downloadAllText: document.getElementById('download-all-text'),
  imageGrid: document.getElementById('image-grid'),
  embedContainer: document.getElementById('embed-container'),
  embedTitle: document.getElementById('embed-title'),
  embedAuthor: document.getElementById('embed-author'),
  embedLink: document.getElementById('embed-link'),
  embedFrameTarget: document.getElementById('embed-frame-target'),
  embedPasteBtn: document.getElementById('embed-paste-btn'),
  previewModal: document.getElementById('preview-modal'),
  modalBackdrop: document.getElementById('modal-backdrop'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalImage: document.getElementById('modal-image'),
  modalSpinner: document.getElementById('modal-spinner'),
  modalCounter: document.getElementById('modal-counter'),
  modalResolution: document.getElementById('modal-resolution'),
  modalFormat: document.getElementById('modal-format'),
  modalDownloadBtn: document.getElementById('modal-download-btn'),
  modalOpenBtn: document.getElementById('modal-open-btn'),
  modalPrevBtn: document.getElementById('modal-prev-btn'),
  modalNextBtn: document.getElementById('modal-next-btn'),
  currentYearSpan: document.getElementById('current-year'),
};

// ==========================================================================
// Theme Initialization & Toggle
// ==========================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('reddit_downloader_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }

  // Listen to OS theme changes if user has no explicit override
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('reddit_downloader_theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('reddit_downloader_theme', next);
}

// ==========================================================================
// Loading Experience & Button States
// ==========================================================================
const loadingMessages = [
  'Checking Reddit post metadata...',
  'Finding image attachments...',
  'Resolving highest original quality...',
  'Preparing preview grid...',
];

function startLoading() {
  state.isFetching = true;
  elements.submitBtn.disabled = true;
  elements.submitBtnText.textContent = 'Finding Images...';
  elements.loadingContainer.classList.remove('hidden');
  hideError();

  let msgIndex = 0;
  elements.loadingSubText.textContent = loadingMessages[0];
  state.loadingInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % loadingMessages.length;
    elements.loadingSubText.textContent = loadingMessages[msgIndex];
  }, 1400);
}

function stopLoading(status = 'default') {
  state.isFetching = false;
  elements.submitBtn.disabled = false;
  elements.loadingContainer.classList.add('hidden');

  if (state.loadingInterval) {
    clearInterval(state.loadingInterval);
    state.loadingInterval = null;
  }

  if (status === 'success') {
    elements.submitBtnText.textContent = 'Images Found';
    setTimeout(() => {
      elements.submitBtnText.textContent = 'Get Images';
    }, 3000);
  } else if (status === 'error') {
    elements.submitBtnText.textContent = 'Try Again';
  } else {
    elements.submitBtnText.textContent = 'Get Images';
  }
}

function showError(msg) {
  elements.errorMessageText.textContent = msg;
  elements.errorBanner.classList.remove('hidden');
  elements.errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  elements.errorBanner.classList.add('hidden');
}

// ==========================================================================
// Client-Side URL Validation & Direct Image Extraction
// ==========================================================================
/**
 * Resolves a Reddit direct image link into a standardized image payload client-side.
 * Works for:
 * - i.redd.it/{id}.{ext}
 * - preview.redd.it/{id}.{ext}
 * - external-preview.redd.it/...
 * - reddit.com/media?url=...
 * - i.imgur.com/{id}.{ext}
 */
function resolveDirectRedditImage(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const trimmed = rawUrl.trim();
    const withProto = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProto);
    const host = parsed.hostname.toLowerCase();

    // 1. Reddit media redirect wrapper: https://www.reddit.com/media?url=...
    if (host.includes('reddit.com') && parsed.pathname === '/media' && parsed.searchParams.has('url')) {
      const innerUrl = parsed.searchParams.get('url');
      if (innerUrl) return resolveDirectRedditImage(innerUrl);
    }

    // 2. preview.redd.it or external-preview.redd.it -> upgrade to full-res i.redd.it master
    if (host === 'preview.redd.it' || host === 'external-preview.redd.it') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const filename = parts.pop() || 'reddit-image.jpg';
      const cleanUrl = `https://i.redd.it/${filename}`;
      const format = filename.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        masterUrl: cleanUrl,
        originalUrl: parsed.toString(),
        format: format.replace(/[^a-z0-9]/g, '') || 'jpg',
      };
    }

    // 3. i.redd.it or i.imgur.com
    if (host === 'i.redd.it' || host === 'i.imgur.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const filename = parts.pop() || 'reddit-image.jpg';
      const format = filename.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        masterUrl: parsed.toString(),
        originalUrl: parsed.toString(),
        format: format.replace(/[^a-z0-9]/g, '') || 'jpg',
      };
    }

    // 4. Any direct image on reddit domains
    const pathLower = parsed.pathname.toLowerCase();
    if ((host.includes('reddit') || host === 'redd.it') && /\.(jpe?g|png|webp|gif)$/i.test(pathLower)) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const filename = parts.pop() || 'reddit-image.jpg';
      const format = filename.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        masterUrl: parsed.toString(),
        originalUrl: parsed.toString(),
        format: format.replace(/[^a-z0-9]/g, '') || 'jpg',
      };
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

function validateClientUrl(input) {
  if (!input || !input.trim()) {
    return { valid: false, error: 'Please enter a valid Reddit post or image URL.' };
  }

  const trimmed = input.trim();
  let parsed;
  try {
    const withProto = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    parsed = new URL(withProto);
  } catch {
    return { valid: false, error: 'Please enter a valid URL.' };
  }

  const host = parsed.hostname.toLowerCase();
  const isReddit = host === 'reddit.com' ||
    host.endsWith('.reddit.com') ||
    host === 'redd.it' ||
    host === 'i.redd.it' ||
    host === 'preview.redd.it' ||
    host === 'external-preview.redd.it' ||
    host === 'i.imgur.com' ||
    host === 'imgur.com';

  if (!isReddit) {
    return { valid: false, error: 'Please enter a URL from reddit.com, redd.it, or i.redd.it.' };
  }

  return { valid: true, url: parsed.toString() };
}

// ==========================================================================
// Media Extraction API Call (With Instant Direct Image & Multi-Tier Fallback)
// ==========================================================================
async function fetchRedditImages(redditUrl) {
  startLoading();

  // Hide previous containers
  if (elements.resultsContainer) elements.resultsContainer.classList.add('hidden');
  if (elements.embedContainer) elements.embedContainer.classList.add('hidden');

  // --------------------------------------------------------------------------
  // Step 1: Instant Client-Side Direct Image Detection
  // If user provided a direct Reddit image URL (i.redd.it / preview.redd.it / media?url=),
  // resolve and display it immediately with zero backend dependency!
  // --------------------------------------------------------------------------
  const directImg = resolveDirectRedditImage(redditUrl);
  if (directImg) {
    const previewUrl = `/api/reddit-image-preview?url=${encodeURIComponent(directImg.masterUrl)}`;
    state.currentImages = [
      {
        url: directImg.masterUrl,
        originalUrl: directImg.originalUrl,
        previewUrl: previewUrl,
        thumbnailUrl: directImg.masterUrl,
        format: directImg.format,
        width: null,
        height: null,
        index: 1,
      }
    ];
    state.currentPostUrl = directImg.originalUrl;
    state.currentPostTitle = 'Reddit Image (High-Resolution Master)';
    stopLoading('success');
    renderResults();
    return;
  }

  // Helper to fetch from a candidate API base URL
  async function fetchCandidate(base) {
    const endpoint = `${base}/api/reddit-images?url=${encodeURIComponent(redditUrl)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(9000),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Server returned status ${response.status} with non-JSON response`);
    }

    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  }

  try {
    let result = null;
    let lastError = null;

    const primaryBase = API_BASE_URL; // '' on same-origin / Pages
    const fallbackBase = 'https://reimg.romitkr5539.workers.dev';

    // ------------------------------------------------------------------------
    // Tier 1: Try Primary Backend
    // ------------------------------------------------------------------------
    try {
      result = await fetchCandidate(primaryBase);
    } catch (err1) {
      console.warn('Primary backend request failed:', err1.message);
      lastError = err1;

      // Tier 2: Try Fallback Worker Backend if primary is different
      if (primaryBase !== fallbackBase) {
        try {
          result = await fetchCandidate(fallbackBase);
        } catch (err2) {
          console.warn('Fallback worker backend failed:', err2.message);
          lastError = err2;
        }
      }
    }

    // Process successful backend response
    if (result) {
      const { ok, data } = result;

      if (!ok || !data.success) {
        const errorMsg = data.error || 'Something went wrong while retrieving the images. Please try again.';
        showError(errorMsg);
        stopLoading('error');
        return;
      }

      // Check if post was verified via oEmbed without direct image links
      if (data.isPostResolved && (!data.images || data.images.length === 0)) {
        state.currentImages = [];
        state.currentPostUrl = data.postUrl || redditUrl;
        state.currentPostTitle = data.postTitle || '';
        stopLoading('success');
        renderPostEmbed(data);
        return;
      }

      if (!data.images || data.images.length === 0) {
        showError('No downloadable images were found in this Reddit post.');
        stopLoading('error');
        return;
      }

      // Success with images!
      state.currentImages = data.images;
      state.currentPostUrl = data.postUrl || redditUrl;
      state.currentPostTitle = data.postTitle || '';

      stopLoading('success');
      renderResults();
      return;
    }

    // ------------------------------------------------------------------------
    // Tier 3: Browser Direct Fallback via Reddit oEmbed
    // ------------------------------------------------------------------------
    try {
      const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(redditUrl)}`;
      const oembedResp = await fetch(oembedUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000),
      });

      if (oembedResp.ok) {
        const oembed = await oembedResp.json();
        if (oembed && (oembed.title || oembed.html)) {
          if (oembed.thumbnail_url) {
            const upgraded = resolveDirectRedditImage(oembed.thumbnail_url);
            const imgMaster = upgraded ? upgraded.masterUrl : oembed.thumbnail_url;
            state.currentImages = [
              {
                url: imgMaster,
                originalUrl: oembed.thumbnail_url,
                previewUrl: `/api/reddit-image-preview?url=${encodeURIComponent(imgMaster)}`,
                thumbnailUrl: oembed.thumbnail_url,
                format: 'jpg',
                width: oembed.thumbnail_width || null,
                height: oembed.thumbnail_height || null,
                index: 1,
              }
            ];
            state.currentPostUrl = redditUrl;
            state.currentPostTitle = oembed.title || '';
            stopLoading('success');
            renderResults();
            return;
          }

          // Render verified Reddit Post embed
          state.currentImages = [];
          state.currentPostUrl = redditUrl;
          state.currentPostTitle = oembed.title || '';
          stopLoading('success');
          renderPostEmbed({
            postTitle: oembed.title,
            author: oembed.author_name,
            postUrl: redditUrl,
            embedHtml: oembed.html,
          });
          return;
        }
      }
    } catch (oembedErr) {
      console.warn('oEmbed direct fallback failed:', oembedErr);
    }

    // ------------------------------------------------------------------------
    // All tiers exhausted: show helpful diagnostic error
    // ------------------------------------------------------------------------
    showError('Could not connect to downloader backend. If you want to download a single image, you can right-click or long-press the Reddit image, choose "Copy image address", and paste that direct link here for instant download.');
    stopLoading('error');

  } catch (err) {
    console.error('Fetch error:', err);
    showError('Network error connecting to downloader backend. Please check your connection and try again.');
    stopLoading('error');
  }
}

// ==========================================================================
// Post Embed Rendering (When verified Reddit post contains embedded media)
// ==========================================================================
function renderPostEmbed(data) {
  if (!elements.embedContainer) return;

  if (elements.resultsContainer) {
    elements.resultsContainer.classList.add('hidden');
  }

  if (elements.embedTitle) {
    elements.embedTitle.textContent = data.postTitle || 'Reddit Post';
  }

  if (elements.embedAuthor) {
    elements.embedAuthor.textContent = data.author ? `Posted by u/${data.author}` : '';
  }

  if (elements.embedLink) {
    elements.embedLink.href = data.postUrl || '#';
  }

  if (elements.embedFrameTarget) {
    elements.embedFrameTarget.innerHTML = data.embedHtml || `
      <div style="padding: 2rem; text-align: center; color: var(--text-secondary);">
        <p>Reddit post: <strong>${escapeHtml(data.postTitle || '')}</strong></p>
        <a href="${escapeHtml(data.postUrl)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline; display: inline-block; margin-top: 0.5rem;">Open post on Reddit</a>
      </div>
    `;

    // Re-trigger Reddit embed widget script if present
    if (!document.getElementById('reddit-widget-script')) {
      const script = document.createElement('script');
      script.id = 'reddit-widget-script';
      script.src = 'https://embed.reddit.com/widgets.js';
      script.async = true;
      script.charset = 'UTF-8';
      document.body.appendChild(script);
    }
  }

  elements.embedContainer.classList.remove('hidden');
  elements.embedContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==========================================================================
// Results Rendering
// ==========================================================================
function renderResults() {
  const count = state.currentImages.length;
  elements.resultsCount.textContent = count;

  if (state.currentPostTitle) {
    elements.resultsPostTitle.textContent = state.currentPostTitle;
    elements.resultsPostTitle.classList.remove('hidden');
  } else {
    elements.resultsPostTitle.classList.add('hidden');
  }

  // Clear existing grid
  elements.imageGrid.innerHTML = '';

  state.currentImages.forEach((img, index) => {
    const card = document.createElement('article');
    card.className = 'image-card';
    card.id = `image-card-${index + 1}`;

    const resolutionText = img.width && img.height 
      ? `${img.width} × ${img.height}` 
      : 'Original Size';

    const formatText = (img.format || 'IMG').toUpperCase();
    const downloadUrl = `${API_BASE_URL}/api/reddit-image-download?url=${encodeURIComponent(img.url)}&index=${img.index || index + 1}`;
    const previewUrl = img.previewUrl 
      ? (img.previewUrl.startsWith('http') ? img.previewUrl : `${API_BASE_URL}${img.previewUrl}`)
      : `${API_BASE_URL}/api/reddit-image-preview?url=${encodeURIComponent(img.url)}`;
    const directFallbackUrl = img.originalUrl || img.url;

    card.innerHTML = `
      <div class="image-preview-container" data-index="${index}" role="button" tabindex="0" aria-label="Open preview for image ${index + 1}">
        <span class="image-index-badge">#${index + 1}</span>
        <div class="image-skeleton" aria-hidden="true"></div>
        <img
          src="${escapeHtml(previewUrl)}"
          data-direct-src="${escapeHtml(directFallbackUrl)}"
          alt="Reddit image ${index + 1}"
          class="card-img"
          ${index > 3 ? 'loading="lazy"' : ''}
          referrerpolicy="no-referrer"
          decoding="async"
        />
        <div class="preview-overlay-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>
            <line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>
          </svg>
          <span>View Fullscreen</span>
        </div>
      </div>
      <div class="card-details">
        <div class="card-meta-tags">
          <span class="meta-pill resolution">${escapeHtml(resolutionText)}</span>
          <span class="meta-pill">${escapeHtml(formatText)}</span>
        </div>
        <div class="card-actions">
          <button type="button" class="card-download-btn" data-url="${escapeHtml(downloadUrl)}" data-filename="reddit-image-${index + 1}.${img.format || 'jpg'}" title="Download high-resolution image to device">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" x2="12" y1="15" y2="3"/>
            </svg>
            <span>Download</span>
          </button>
          <a href="${escapeHtml(img.originalUrl || img.url)}" target="_blank" rel="noopener noreferrer" class="card-open-link" title="Open original image in new tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
      </div>
    `;

    const cardImg = card.querySelector('.card-img');
    const skeleton = card.querySelector('.image-skeleton');
    const resPill = card.querySelector('.meta-pill.resolution');

    // On successful image load
    cardImg.addEventListener('load', () => {
      if (skeleton) skeleton.classList.add('hidden');
      cardImg.classList.add('loaded');
      if (cardImg.naturalWidth && cardImg.naturalHeight) {
        img.width = cardImg.naturalWidth;
        img.height = cardImg.naturalHeight;
        if (resPill) {
          resPill.textContent = `${cardImg.naturalWidth} × ${cardImg.naturalHeight}`;
        }
      }
    });

    // If proxied preview fails or is blocked, fallback to direct Reddit link
    cardImg.addEventListener('error', () => {
      const fallback = cardImg.getAttribute('data-direct-src');
      if (fallback && cardImg.src !== fallback) {
        cardImg.src = fallback;
      } else {
        if (skeleton) skeleton.classList.add('hidden');
      }
    });

    // Click preview to open modal
    const previewContainer = card.querySelector('.image-preview-container');
    previewContainer.addEventListener('click', () => openModal(index));
    previewContainer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(index);
      }
    });

    // Individual download button
    const downloadBtn = card.querySelector('.card-download-btn');
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerDownload(downloadUrl, `reddit-image-${index + 1}.${img.format || 'jpg'}`, downloadBtn, img.originalUrl || img.url);
    });

    elements.imageGrid.appendChild(card);
  });

  // Show results container
  elements.resultsContainer.classList.remove('hidden');
  elements.resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Image Download Mechanics (Direct Blob & Same-Origin Saving)
// ==========================================================================
/**
 * Reliable cross-browser image download mechanism.
 * Fetches the raw image bytes via our CORS-enabled proxy Worker, creates a
 * same-origin Blob Object URL, and triggers immediate browser file saving.
 */
async function triggerDownload(url, filename, buttonEl, directImgUrl) {
  let originalBtnHtml = '';
  if (buttonEl) {
    originalBtnHtml = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;animation:spin 0.8s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor"/>
      </svg>
      <span>Downloading...</span>
    `;
  }

  try {
    // 1. Fetch image binary through our CORS-enabled proxy worker
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Proxy responded with status ${response.status}`);
    }
    const blob = await response.blob();

    // 2. Generate local same-origin Blob URL (modern browsers strictly require
    // same-origin target for <a download="filename">)
    const blobUrl = URL.createObjectURL(blob);

    // 3. Trigger immediate native save dialog
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // 4. Clean up Object URL
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 1500);

    if (buttonEl) {
      buttonEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Downloaded!</span>
      `;
      setTimeout(() => {
        buttonEl.disabled = false;
        buttonEl.innerHTML = originalBtnHtml;
      }, 2000);
    }
  } catch (err) {
    console.warn('Proxy blob download failed, trying direct image fetch / new tab fallback:', err);

    let directSaved = false;
    // Fallback 1: Try fetching the direct original image URL as a blob
    if (directImgUrl && directImgUrl !== url) {
      try {
        const directResp = await fetch(directImgUrl, { mode: 'cors' });
        if (directResp.ok) {
          const directBlob = await directResp.blob();
          const directBlobUrl = URL.createObjectURL(directBlob);
          const a = document.createElement('a');
          a.href = directBlobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(directBlobUrl);
          }, 1500);
          directSaved = true;
        }
      } catch (directErr) {
        // Direct fetch failed
      }
    }

    // Fallback 2: If blob creation was blocked (e.g. strict sandbox or CORS failure),
    // open the image directly in a new tab so user can right click / tap to save
    if (!directSaved) {
      const fallbackUrl = directImgUrl || url;
      const opened = window.open(fallbackUrl, '_blank');
      if (!opened) {
        const fallbackA = document.createElement('a');
        fallbackA.href = fallbackUrl;
        fallbackA.target = '_blank';
        fallbackA.rel = 'noopener noreferrer';
        fallbackA.download = filename;
        document.body.appendChild(fallbackA);
        fallbackA.click();
        setTimeout(() => document.body.removeChild(fallbackA), 200);
      }
    }

    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.innerHTML = originalBtnHtml;
    }
  }
}

// Sequential Download All with delay
async function handleDownloadAll() {
  if (state.isDownloadingAll || state.currentImages.length === 0) return;

  state.isDownloadingAll = true;
  elements.downloadAllBtn.disabled = true;

  const total = state.currentImages.length;
  for (let i = 0; i < total; i++) {
    const img = state.currentImages[i];
    elements.downloadAllText.textContent = `Downloading ${i + 1} of ${total}...`;

    const downloadUrl = `${API_BASE_URL}/api/reddit-image-download?url=${encodeURIComponent(img.url)}&index=${img.index || i + 1}`;
    await triggerDownload(
      downloadUrl,
      `reddit-image-${i + 1}.${img.format || 'jpg'}`,
      null,
      img.originalUrl || img.url
    );

    // Wait 350ms between downloads so browser doesn't throttle or block multi-file requests
    if (i < total - 1) {
      await new Promise(res => setTimeout(res, 350));
    }
  }

  elements.downloadAllText.textContent = 'All Downloaded!';
  setTimeout(() => {
    elements.downloadAllBtn.disabled = false;
    elements.downloadAllText.textContent = 'Download All Images';
    state.isDownloadingAll = false;
  }, 2500);
}

// ==========================================================================
// Lightbox Modal Controls
// ==========================================================================
function openModal(index) {
  if (!state.currentImages[index]) return;
  state.modalActiveIndex = index;
  updateModalContent();
  elements.previewModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  elements.modalCloseBtn.focus();
}

function closeModal() {
  elements.previewModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function updateModalContent() {
  const current = state.currentImages[state.modalActiveIndex];
  if (!current) return;

  const total = state.currentImages.length;
  const previewUrl = current.previewUrl 
    ? (current.previewUrl.startsWith('http') ? current.previewUrl : `${API_BASE_URL}${current.previewUrl}`)
    : `${API_BASE_URL}/api/reddit-image-preview?url=${encodeURIComponent(current.url)}`;

  if (elements.modalSpinner) elements.modalSpinner.classList.remove('hidden');
  elements.modalImage.classList.remove('loaded');
  elements.modalImage.referrerPolicy = 'no-referrer';
  elements.modalImage.src = previewUrl;

  elements.modalImage.onload = () => {
    if (elements.modalSpinner) elements.modalSpinner.classList.add('hidden');
    elements.modalImage.classList.add('loaded');
    if (elements.modalImage.naturalWidth && elements.modalImage.naturalHeight) {
      current.width = elements.modalImage.naturalWidth;
      current.height = elements.modalImage.naturalHeight;
      elements.modalResolution.textContent = `${elements.modalImage.naturalWidth} × ${elements.modalImage.naturalHeight}`;
    }
  };

  elements.modalImage.onerror = () => {
    const directFallback = current.originalUrl || current.url;
    if (elements.modalImage.src !== directFallback) {
      elements.modalImage.src = directFallback;
    } else {
      if (elements.modalSpinner) elements.modalSpinner.classList.add('hidden');
    }
  };

  elements.modalCounter.textContent = `${state.modalActiveIndex + 1} of ${total}`;

  const resText = current.width && current.height 
    ? `${current.width} × ${current.height}` 
    : 'Original Resolution';
  elements.modalResolution.textContent = resText;
  elements.modalFormat.textContent = (current.format || 'IMG').toUpperCase();

  if (elements.modalOpenBtn) {
    elements.modalOpenBtn.href = current.originalUrl || current.url;
  }

  // Navigation button visibility
  if (total > 1) {
    elements.modalPrevBtn.classList.remove('hidden');
    elements.modalNextBtn.classList.remove('hidden');
  } else {
    elements.modalPrevBtn.classList.add('hidden');
    elements.modalNextBtn.classList.add('hidden');
  }
}

function prevModalImage() {
  if (state.currentImages.length <= 1) return;
  state.modalActiveIndex = (state.modalActiveIndex - 1 + state.currentImages.length) % state.currentImages.length;
  updateModalContent();
}

function nextModalImage() {
  if (state.currentImages.length <= 1) return;
  state.modalActiveIndex = (state.modalActiveIndex + 1) % state.currentImages.length;
  updateModalContent();
}

function handleModalDownload() {
  const current = state.currentImages[state.modalActiveIndex];
  if (!current) return;
  const idx = state.modalActiveIndex + 1;
  const downloadUrl = `${API_BASE_URL}/api/reddit-image-download?url=${encodeURIComponent(current.url)}&index=${idx}`;
  triggerDownload(
    downloadUrl,
    `reddit-image-${idx}.${current.format || 'jpg'}`,
    elements.modalDownloadBtn,
    current.originalUrl || current.url
  );
}

// ==========================================================================
// Event Listeners & Setup
// ==========================================================================
function setupEventListeners() {
  // Theme toggle (guarded — button may not be present in all layouts)
  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Form submission
  elements.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = elements.urlInput.value;
    const validation = validateClientUrl(url);

    if (!validation.valid) {
      showError(validation.error);
      return;
    }

    fetchRedditImages(validation.url);
  });

  // Input changes for clear button visibility
  elements.urlInput.addEventListener('input', () => {
    if (elements.urlInput.value.length > 0) {
      elements.clearBtn.classList.remove('hidden');
    } else {
      elements.clearBtn.classList.add('hidden');
    }
  });

  // Clear button
  elements.clearBtn.addEventListener('click', () => {
    elements.urlInput.value = '';
    elements.clearBtn.classList.add('hidden');
    elements.urlInput.focus();
    hideError();
  });

  // Paste from clipboard button
  elements.pasteBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          elements.urlInput.value = text.trim();
          elements.clearBtn.classList.remove('hidden');
          elements.urlInput.focus();
        }
      } else {
        elements.urlInput.focus();
      }
    } catch {
      elements.urlInput.focus();
    }
  });

  // Sample Demonstration Buttons
  if (elements.sampleGalleryBtn) {
    elements.sampleGalleryBtn.addEventListener('click', () => {
      const sample = 'https://www.reddit.com/r/EarthPorn/comments/sample_gallery/yosemite_national_park_gallery/';
      elements.urlInput.value = sample;
      elements.clearBtn.classList.remove('hidden');
      fetchRedditImages(sample);
    });
  }

  if (elements.sampleDirectBtn) {
    elements.sampleDirectBtn.addEventListener('click', () => {
      const sample = 'https://i.redd.it/sample_master_landscape.jpg';
      elements.urlInput.value = sample;
      elements.clearBtn.classList.remove('hidden');
      fetchRedditImages(sample);
    });
  }

  if (elements.samplePostBtn) {
    elements.samplePostBtn.addEventListener('click', () => {
      const sample = 'https://www.reddit.com/r/SuperActionStatue/comments/1i5n33k/psa_johnny_is_starting_to_sell_out/';
      elements.urlInput.value = sample;
      elements.clearBtn.classList.remove('hidden');
      fetchRedditImages(sample);
    });
  }

  // Embed Paste Button
  if (elements.embedPasteBtn) {
    elements.embedPasteBtn.addEventListener('click', async () => {
      try {
        let text = '';
        if (navigator.clipboard && navigator.clipboard.readText) {
          text = await navigator.clipboard.readText();
        }
        if (!text) {
          text = window.prompt('Paste the copied Reddit image link here (e.g. https://i.redd.it/...):') || '';
        }
        if (text && text.trim()) {
          const clean = text.trim();
          elements.urlInput.value = clean;
          elements.clearBtn.classList.remove('hidden');
          const validation = validateClientUrl(clean);
          if (validation.valid) {
            fetchRedditImages(validation.url);
          } else {
            showError('Please paste a direct image URL from reddit (e.g., https://i.redd.it/...)');
          }
        }
      } catch {
        const text = window.prompt('Paste the copied Reddit image link here:') || '';
        if (text && text.trim()) {
          elements.urlInput.value = text.trim();
          elements.clearBtn.classList.remove('hidden');
          fetchRedditImages(text.trim());
        }
      }
    });
  }

  // Error dismiss
  elements.errorDismissBtn.addEventListener('click', hideError);

  // Download All
  elements.downloadAllBtn.addEventListener('click', handleDownloadAll);

  // Modal actions
  elements.modalCloseBtn.addEventListener('click', closeModal);
  elements.modalBackdrop.addEventListener('click', closeModal);
  elements.modalPrevBtn.addEventListener('click', prevModalImage);
  elements.modalNextBtn.addEventListener('click', nextModalImage);
  elements.modalDownloadBtn.addEventListener('click', handleModalDownload);

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (!elements.previewModal.classList.contains('hidden')) {
      if (e.key === 'Escape') {
        closeModal();
      } else if (e.key === 'ArrowLeft') {
        prevModalImage();
      } else if (e.key === 'ArrowRight') {
        nextModalImage();
      }
    }
  });

  // Auto set copyright year
  if (elements.currentYearSpan) {
    elements.currentYearSpan.textContent = new Date().getFullYear();
  }
}

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
});
