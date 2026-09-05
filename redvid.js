/**
 * Reddit Video Downloader - Vanilla JavaScript Client
 * Handles URL validation, API communication with Cloudflare Worker,
 * byte-range media streaming, audio synchronization, and file downloads.
 */

(function () {
  'use strict';

  // DOM Elements
  const downloadForm = document.getElementById('download-form');
  const urlInput = document.getElementById('reddit-url-input');
  const btnSubmit = document.getElementById('btn-submit-download');
  const btnPaste = document.getElementById('btn-paste');
  const btnClear = document.getElementById('btn-clear');
  const downloaderBox = document.getElementById('downloader-box');
  const themeToggle = document.getElementById('theme-toggle');

  // Status & Error Elements
  const statusContainer = document.getElementById('status-container');
  const statusMessage = document.getElementById('status-message');
  const progressBar = document.getElementById('progress-bar');
  const errorBanner = document.getElementById('error-banner');
  const errorText = document.getElementById('error-text');
  const errorCloseBtn = document.getElementById('error-close-btn');

  // Result Elements
  const resultCard = document.getElementById('result-card');
  const videoPlayer = document.getElementById('video-player');
  const audioSynced = document.getElementById('audio-synced');
  const resultTitle = document.getElementById('result-title');
  const resultSubreddit = document.getElementById('result-subreddit');
  const resultAuthor = document.getElementById('result-author');
  const resultResolution = document.getElementById('result-resolution');
  const resultDuration = document.getElementById('result-duration');
  const resultSource = document.getElementById('result-source');
  const badgeAudioStatus = document.getElementById('badge-audio-status');
  const qualityButtonsRow = document.getElementById('quality-buttons-row');
  const qualitySelectorGroup = document.getElementById('quality-selector-group');
  const btnDownloadVideo = document.getElementById('btn-download-video');
  const labelDownloadVideo = document.getElementById('label-download-video');
  const btnDownloadAudio = document.getElementById('btn-download-audio');
  const btnPermalink = document.getElementById('btn-permalink');
  const streamNoticeText = document.getElementById('stream-notice-text');

  // In-Player Error & Stream Controls
  const videoErrorOverlay = document.getElementById('video-error-overlay');
  const videoErrorDesc = document.getElementById('video-error-desc');
  const btnSwitchStreamMode = document.getElementById('btn-switch-stream-mode');
  const labelSwitchStream = document.getElementById('label-switch-stream');
  const btnOpenRawVideo = document.getElementById('btn-open-raw-video');
  const btnStreamWorker = document.getElementById('btn-stream-worker');
  const btnStreamDirect = document.getElementById('btn-stream-direct');

  // Remote Production Cloudflare Worker URL
  const REMOTE_WORKER_URL = 'https://whdp.romitkr361.workers.dev';

  // Dynamic API Base URL: auto-switches between remote worker and local endpoint
  // When running on Cloudflare Pages or production host, default directly to the Worker URL
  const isLocalDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  let activeApiBase = isLocalDev ? '' : REMOTE_WORKER_URL;
  let streamMode = 'worker'; // 'worker' (Anti-403 Proxy) or 'direct' (Reddit CDN)

  // Allowed Reddit Hostnames for client-side pre-validation
  const ALLOWED_DOMAINS = [
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'new.reddit.com',
    'm.reddit.com',
    'redd.it',
    'v.redd.it'
  ];

  let isProcessing = false;
  let loadingStepInterval = null;
  let currentPostData = null;
  let selectedVariant = null;

  /* --------------------------------------------------------------------------
     Theme Management (Dark / Light Mode)
     -------------------------------------------------------------------------- */
  function initTheme() {
    const savedTheme = localStorage.getItem('reddit_downloader_theme');
    if (savedTheme) {
      document.body.setAttribute('data-theme', savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }

  function toggleTheme() {
    const current = document.body.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('reddit_downloader_theme', next);
  }

  /* --------------------------------------------------------------------------
     URL Pre-Validation
     -------------------------------------------------------------------------- */
  function isValidRedditUrl(string) {
    if (!string || typeof string !== 'string') return false;
    const trimmed = string.trim();

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      const hostname = parsed.hostname.toLowerCase();
      const isAllowed = ALLOWED_DOMAINS.some(domain => 
        hostname === domain || hostname.endsWith(`.${domain}`)
      );

      if (!isAllowed) return false;

      // Reject common non-reddit media sites
      if (hostname.includes('youtube.com') || hostname.includes('facebook.com') || hostname.includes('instagram.com')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /* --------------------------------------------------------------------------
     Input Handling (Paste, Clear, Drag & Drop)
     -------------------------------------------------------------------------- */
  function updateInputControls() {
    if (urlInput.value.trim().length > 0) {
      btnClear.classList.remove('hidden');
    } else {
      btnClear.classList.add('hidden');
    }
  }

  async function handleClipboardPaste() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        urlInput.focus();
        showError('Clipboard access is restricted. Please press Ctrl+V or Cmd+V to paste.');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        urlInput.value = text.trim();
        updateInputControls();
        hideError();
        processDownload(text.trim());
      } else {
        showError('Clipboard is empty.');
      }
    } catch {
      urlInput.focus();
      showError('Please press Ctrl+V or Cmd+V to paste your Reddit link.');
    }
  }

  function handleClearInput() {
    urlInput.value = '';
    updateInputControls();
    urlInput.focus();
    hideError();
  }

  function setupDragAndDrop() {
    if (!downloaderBox) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      downloaderBox.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
      downloaderBox.addEventListener(eventName, () => {
        downloaderBox.classList.add('drag-over');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      downloaderBox.addEventListener(eventName, () => {
        downloaderBox.classList.remove('drag-over');
      }, false);
    });

    downloaderBox.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const text = dt.getData('text/plain') || dt.getData('text/uri-list');
      if (text && text.trim()) {
        urlInput.value = text.trim();
        updateInputControls();
        hideError();
        processDownload(text.trim());
      }
    }, false);
  }

  /* --------------------------------------------------------------------------
     Status and Notification UI
     -------------------------------------------------------------------------- */
  function showError(message) {
    hideLoading();
    errorText.textContent = message || 'An unexpected error occurred.';
    errorBanner.classList.remove('hidden');
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    errorBanner.classList.add('hidden');
  }

  function showLoading() {
    hideError();
    resultCard.classList.add('hidden');
    statusContainer.classList.remove('hidden');
    btnSubmit.disabled = true;

    // Reset video & audio players
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
    audioSynced.pause();
    audioSynced.removeAttribute('src');

    // Hide any error overlay
    if (videoErrorOverlay) videoErrorOverlay.classList.add('hidden');

    // Progressive loading step animation
    let step = 1;
    statusMessage.textContent = 'Finding Reddit video...';
    progressBar.style.width = '25%';

    clearInterval(loadingStepInterval);
    loadingStepInterval = setInterval(() => {
      step++;
      if (step === 2) {
        statusMessage.textContent = 'Extracting media streams...';
        progressBar.style.width = '65%';
      } else if (step === 3) {
        statusMessage.textContent = 'Preparing download links...';
        progressBar.style.width = '90%';
      }
    }, 700);
  }

  function hideLoading() {
    clearInterval(loadingStepInterval);
    statusContainer.classList.add('hidden');
    btnSubmit.disabled = false;
  }

  /* --------------------------------------------------------------------------
     Helper: Generate Media URLs (Stream & Download)
     -------------------------------------------------------------------------- */
  function getStreamUrl(rawMediaUrl) {
    if (!rawMediaUrl) return '';
    if (streamMode === 'direct') {
      return rawMediaUrl;
    }
    // Stream through worker proxy with inline content disposition
    const base = activeApiBase || (isLocalDev ? '' : REMOTE_WORKER_URL);
    return `${base}/api/reddit-stream?url=${encodeURIComponent(rawMediaUrl)}`;
  }

  function getDownloadUrl(rawMediaUrl, filename) {
    if (!rawMediaUrl) return '#';
    const base = activeApiBase || (isLocalDev ? '' : REMOTE_WORKER_URL);
    const nameParam = filename ? `&filename=${encodeURIComponent(filename)}` : '';
    return `${base}/api/reddit-download?url=${encodeURIComponent(rawMediaUrl)}${nameParam}`;
  }

  /* --------------------------------------------------------------------------
     Audio-Video Synchronized Playback Preview
     -------------------------------------------------------------------------- */
  function setupSyncedPlayback(videoElem, audioElem) {
    if (!videoElem || !audioElem) return;

    // Synchronize play
    videoElem.onplay = () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.currentTime = videoElem.currentTime;
        audioElem.play().catch(() => {});
      }
    };

    // Synchronize pause
    videoElem.onpause = () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.pause();
      }
    };

    // Synchronize seeking
    videoElem.onseeking = () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.currentTime = videoElem.currentTime;
      }
    };

    // Synchronize volume and mute
    videoElem.onvolumechange = () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.volume = videoElem.volume;
        audioElem.muted = videoElem.muted;
      }
    };

    // Synchronize playback rate
    videoElem.onratechange = () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.playbackRate = videoElem.playbackRate;
      }
    };
  }

  /* --------------------------------------------------------------------------
     In-Player Error Handler & Stream Switcher
     -------------------------------------------------------------------------- */
  function setupPlayerEventHandlers() {
    videoPlayer.onerror = () => {
      console.warn('Video preview playback issue. Code:', videoPlayer.error ? videoPlayer.error.code : 'unknown');

      if (videoErrorOverlay) {
        videoErrorOverlay.classList.remove('hidden');

        if (streamMode === 'direct') {
          if (videoErrorDesc) {
            videoErrorDesc.textContent = 'Reddit direct CDN blocked cross-origin playback in this browser. Switching to Worker Proxy will bypass this restriction.';
          }
          if (labelSwitchStream) labelSwitchStream.textContent = 'Switch to Worker Proxy (Recommended)';
        } else {
          if (videoErrorDesc) {
            videoErrorDesc.textContent = 'Browser blocked DASH video playback. You can switch to Direct CDN or download the full MP4 file directly below.';
          }
          if (labelSwitchStream) labelSwitchStream.textContent = 'Try Direct CDN Stream';
        }

        if (btnOpenRawVideo && selectedVariant) {
          btnOpenRawVideo.href = selectedVariant.videoUrl;
        }
      }
    };

    videoPlayer.onloadeddata = () => {
      if (videoErrorOverlay) {
        videoErrorOverlay.classList.add('hidden');
      }
    };

    videoPlayer.oncanplay = () => {
      if (videoErrorOverlay) {
        videoErrorOverlay.classList.add('hidden');
      }
    };
  }

  function setStreamMode(newMode) {
    streamMode = newMode;

    if (btnStreamWorker && btnStreamDirect) {
      if (streamMode === 'worker') {
        btnStreamWorker.classList.add('active');
        btnStreamDirect.classList.remove('active');
      } else {
        btnStreamDirect.classList.add('active');
        btnStreamWorker.classList.remove('active');
      }
    }

    if (currentPostData && selectedVariant) {
      applyCurrentStreamSource();
    }
  }

  function applyCurrentStreamSource() {
    if (!selectedVariant) return;

    if (videoErrorOverlay) {
      videoErrorOverlay.classList.add('hidden');
    }

    const wasPlaying = !videoPlayer.paused;
    const currentTime = videoPlayer.currentTime;

    const streamUrl = getStreamUrl(selectedVariant.videoUrl);
    videoPlayer.src = streamUrl;
    videoPlayer.load();

    if (currentPostData?.media?.audioUrl) {
      const audioStreamUrl = getStreamUrl(currentPostData.media.audioUrl);
      audioSynced.src = audioStreamUrl;
      audioSynced.load();
    }

    videoPlayer.currentTime = currentTime;
    if (wasPlaying) {
      videoPlayer.play().catch(() => {});
    }
  }

  /* --------------------------------------------------------------------------
     Render Results
     -------------------------------------------------------------------------- */
  function renderResult(data) {
    hideLoading();
    currentPostData = data;
    const post = data.post || {};
    const media = data.media || {};

    // Populate post information
    resultTitle.textContent = post.title || 'Reddit Video';
    resultSubreddit.textContent = post.subreddit || 'r/reddit';
    resultAuthor.textContent = post.author || '';
    btnPermalink.href = post.permalink || '#';

    // Populate metadata
    const width = media.width;
    const height = media.height;
    if (width && height) {
      resultResolution.textContent = `${width} × ${height}`;
    } else if (height) {
      resultResolution.textContent = `${height}p`;
    } else {
      resultResolution.textContent = 'Standard';
    }

    if (media.duration) {
      resultDuration.textContent = `${Math.round(media.duration)} seconds`;
    } else {
      resultDuration.textContent = 'N/A';
    }

    resultSource.textContent = media.videoUrl && media.videoUrl.includes('v.redd.it') ? 'Reddit Video (v.redd.it)' : 'Reddit CDN';

    // Thumbnail poster
    if (media.thumbnail) {
      videoPlayer.poster = media.thumbnail;
    } else {
      videoPlayer.removeAttribute('poster');
    }

    // Set active variant (highest quality by default)
    const variants = media.variants || [];
    selectedVariant = variants[0] || {
      quality: media.height ? `${media.height}p` : 'Source',
      videoUrl: media.videoUrl,
      height: media.height
    };

    // Load preview with active stream mode
    applyCurrentStreamSource();

    // Audio stream handling
    if (media.audioUrl) {
      badgeAudioStatus.textContent = 'Video + Audio Available';
      badgeAudioStatus.classList.remove('no-audio');
      btnDownloadAudio.classList.remove('hidden');

      // Set audio download link
      const audioSafeFilename = `reddit-${post.subreddit ? post.subreddit.replace('r/', '') : 'post'}-audio.mp4`;
      btnDownloadAudio.href = getDownloadUrl(media.audioUrl, audioSafeFilename);

      setupSyncedPlayback(videoPlayer, audioSynced);
      streamNoticeText.textContent = 'Reddit stores video and audio as separate DASH streams. Both streams are verified and downloadable in full quality.';
    } else {
      badgeAudioStatus.textContent = 'Video Only';
      badgeAudioStatus.classList.add('no-audio');
      btnDownloadAudio.classList.add('hidden');
      audioSynced.removeAttribute('src');

      streamNoticeText.textContent = 'This Reddit video is a silent video or animated media without a separate audio track.';
    }

    // Configure Video Download Button
    updateDownloadButton(selectedVariant, post);

    // Variants & Quality Selector
    qualityButtonsRow.innerHTML = '';
    if (variants.length > 1) {
      qualitySelectorGroup.classList.remove('hidden');
      variants.forEach((v, index) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `btn-quality-chip ${index === 0 ? 'active' : ''}`;
        chip.textContent = v.quality || `${v.height}p`;

        chip.addEventListener('click', () => {
          document.querySelectorAll('.btn-quality-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');

          selectedVariant = v;
          applyCurrentStreamSource();
          updateDownloadButton(v, post);
        });

        qualityButtonsRow.appendChild(chip);
      });
    } else {
      qualitySelectorGroup.classList.add('hidden');
    }

    // Reveal result card
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateDownloadButton(variant, post) {
    const subClean = (post?.subreddit || 'video').replace(/[^a-zA-Z0-9]/g, '');
    const qualityLabel = variant.quality || (variant.height ? `${variant.height}p` : 'HD');
    const variantFilename = `reddit-${subClean}-${qualityLabel}.mp4`;

    btnDownloadVideo.href = getDownloadUrl(variant.videoUrl, variantFilename);
    labelDownloadVideo.textContent = `Download Video (${qualityLabel})`;

    if (btnOpenRawVideo) {
      btnOpenRawVideo.href = variant.videoUrl;
    }
  }

  /* --------------------------------------------------------------------------
     Fetch Reddit Media from Cloudflare Worker API with Failover
     -------------------------------------------------------------------------- */
  async function processDownload(rawUrl) {
    if (isProcessing) return;

    const trimmedUrl = (rawUrl || '').trim();
    if (!trimmedUrl) {
      showError('Please paste a public Reddit post URL.');
      return;
    }

    if (!isValidRedditUrl(trimmedUrl)) {
      showError('Invalid Reddit post URL. Please enter a valid reddit.com or v.redd.it link.');
      return;
    }

    isProcessing = true;
    showLoading();

    try {
      let response = null;
      let usedRemote = false;

      // Tier 1: Try remote Cloudflare Worker
      try {
        const remoteUrl = `${REMOTE_WORKER_URL}/api/reddit-video?url=${encodeURIComponent(trimmedUrl)}`;
        const remoteRes = await fetch(remoteUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (remoteRes.ok) {
          response = remoteRes;
          activeApiBase = REMOTE_WORKER_URL;
          usedRemote = true;
        } else {
          console.warn('Remote worker responded with status', remoteRes.status, 'trying local endpoint...');
        }
      } catch (remoteErr) {
        console.warn('Remote worker fetch failed or offline, falling back to local endpoint:', remoteErr);
      }

      // Tier 2: Failover to local proxy endpoint
      if (!response) {
        const localUrl = `/api/reddit-video?url=${encodeURIComponent(trimmedUrl)}`;
        response = await fetch(localUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        activeApiBase = '';
      }

      let jsonResult;
      try {
        jsonResult = await response.json();
      } catch {
        throw new Error('Unable to parse server response. Please check your URL and try again.');
      }

      if (!response.ok || !jsonResult.success) {
        const errorMsg = jsonResult.error || 'No downloadable video was found in this Reddit post.';
        showError(errorMsg);
        return;
      }

      // Update worker health indicator if remote worker succeeded
      if (usedRemote) {
        const liveStatusText = document.getElementById('worker-live-status');
        if (liveStatusText) liveStatusText.textContent = 'Connected (whdp.workers.dev)';
      }

      renderResult(jsonResult);
    } catch (err) {
      showError(err.message || 'Network error occurred while communicating with the worker.');
    } finally {
      isProcessing = false;
      hideLoading();
    }
  }

  /* --------------------------------------------------------------------------
     Live Cloudflare Worker Health Probe
     -------------------------------------------------------------------------- */
  async function checkWorkerHealth() {
    const badge = document.getElementById('worker-status-badge');
    const liveStatusText = document.getElementById('worker-live-status');

    try {
      const startTime = performance.now();
      const res = await fetch(`${REMOTE_WORKER_URL}/api/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      const latency = Math.round(performance.now() - startTime);

      if (res.ok) {
        if (badge) {
          badge.innerHTML = `<span class="worker-pulse-dot" aria-hidden="true"></span> <span>whdp.romitkr361.workers.dev</span>`;
          badge.title = `Cloudflare Worker Online (${latency}ms)`;
        }
        if (liveStatusText) {
          liveStatusText.textContent = `Online (${latency}ms)`;
        }
        activeApiBase = REMOTE_WORKER_URL;
      }
    } catch {
      // Local fallback is active
      if (badge) {
        badge.innerHTML = `<span class="worker-pulse-dot" aria-hidden="true" style="background:#10B981;"></span> <span>Local / Edge Worker Ready</span>`;
      }
      if (liveStatusText) {
        liveStatusText.textContent = 'Active (Local Edge)';
      }
      activeApiBase = '';
    }
  }

  /* --------------------------------------------------------------------------
     Event Listeners
     -------------------------------------------------------------------------- */
  function initEvents() {
    // Form Submit
    downloadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      processDownload(urlInput.value);
    });

    // Paste & Clear buttons
    btnPaste.addEventListener('click', handleClipboardPaste);
    btnClear.addEventListener('click', handleClearInput);
    urlInput.addEventListener('input', updateInputControls);

    // Theme Toggle
    themeToggle.addEventListener('click', toggleTheme);

    // Error Close
    errorCloseBtn.addEventListener('click', hideError);

    // Example Chips
    document.querySelectorAll('.example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const sampleUrl = chip.getAttribute('data-url');
        if (sampleUrl) {
          urlInput.value = sampleUrl;
          updateInputControls();
          hideError();
          processDownload(sampleUrl);
        }
      });
    });

    // Stream Mode Switcher buttons
    if (btnStreamWorker) {
      btnStreamWorker.addEventListener('click', () => setStreamMode('worker'));
    }
    if (btnStreamDirect) {
      btnStreamDirect.addEventListener('click', () => setStreamMode('direct'));
    }

    // In-Player Fallback Action Button
    if (btnSwitchStreamMode) {
      btnSwitchStreamMode.addEventListener('click', () => {
        const nextMode = streamMode === 'worker' ? 'direct' : 'worker';
        setStreamMode(nextMode);
      });
    }

    // Setup Video Player events
    setupPlayerEventHandlers();

    // Setup drag and drop
    setupDragAndDrop();
  }

  // Initialize on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initEvents();
    updateInputControls();
    checkWorkerHealth();
  });
})();
