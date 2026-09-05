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
  const btnMergeDownload = document.getElementById('btn-merge-download');
  const labelMergeDownload = document.getElementById('label-merge-download');
  const btnCancelMerge = document.getElementById('btn-cancel-merge');
  const mergeProgressContainer = document.getElementById('merge-progress-container');
  const mergeProgressText = document.getElementById('merge-progress-text');
  const mergeProgressBar = document.getElementById('merge-progress-bar');
  const mergeProgressHint = document.getElementById('merge-progress-hint');
  const btnFinalMerged = document.getElementById('btn-final-merged-download');
  const labelFinalMerged = document.getElementById('label-final-merged');
  const mergeGlobalContainer = document.getElementById('merge-global-container');
  const mergeGlobalText = document.getElementById('merge-global-text');
  const mergeGlobalPercent = document.getElementById('merge-global-percent');
  const mergeGlobalBar = document.getElementById('merge-global-bar');
  const btnCancelGlobalMerge = document.getElementById('merge-global-cancel');
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
  let mergeRecorder = null;
  let mergeVideoEl = null;
  let mergeAudioEl = null;
  let mergeTimer = null;
  let mergeDurationSec = 0;
  let isMerging = false;
  let mergedFinalBlob = null;
  let mergedFinalUrl = null;
  let mergedFinalFilename = '';
  let mergeVisibilityHandler = null;
  let mergeStallRecoveryTimer = null;
  let autoMergeQueued = false;
  let mergeAbortController = null;
  let mergeCancelled = false;
  let renderResultData = null;
  let resultCardPending = false;

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
    currentPostData = data;
    const post = data.post || {};
    const media = data.media || {};

    // Initialise quality variants + selected variant from API data
    const rawVariants = (media && media.variants && Array.isArray(media.variants) && media.variants.length)
      ? media.variants
      : [{
          quality: (media && media.quality) ? media.quality : ((media && media.height) ? `${media.height}p` : 'HD'),
          height: media && media.height ? media.height : null,
          width: media && media.width ? media.width : null,
          videoUrl: media && media.videoUrl ? media.videoUrl : '',
          bitrate: media && media.bitrate ? media.bitrate : null
        }];
    const variants = rawVariants.filter(v => v && v.videoUrl);
    if (!selectedVariant || !variants.some(v => v.videoUrl === selectedVariant.videoUrl)) {
      selectedVariant = variants[0] || null;
    }
    if (!selectedVariant) {
      hideLoading();
      showError('No playable video stream was found for this post.');
      return;
    }

    // Swap the progress UI directly from the API spinner → merge / processing progress
    // (no visible gap — hideLoading skipped when audio post will immediately start processing)
    const willProcess = !!media.audioUrl;
    if (willProcess) {
      clearInterval(loadingStepInterval);
      statusContainer.classList.add('hidden');
      btnSubmit.disabled = false;
      // Immediately show the processing progress bar under the input so user sees continuous progress
      setGlobalMergeProgress('Preparing media…', 1);
    } else {
      hideLoading();
    }

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

    // Store the render data so we can defer reveal until processing is complete
    renderResultData = { post, media, variants };

    // Hide separate download buttons — always only show the merged final button
    if (btnDownloadVideo) btnDownloadVideo.classList.add('hidden');
    if (btnDownloadAudio) btnDownloadAudio.classList.add('hidden');
    if (btnMergeDownload) btnMergeDownload.classList.add('hidden');

    // Always keep result card hidden until processing completes
    resultCard.classList.add('hidden');
    if (videoErrorOverlay) videoErrorOverlay.classList.add('hidden');
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    try { videoPlayer.load(); } catch {}
    audioSynced.pause();
    audioSynced.removeAttribute('src');
    if (btnFinalMerged) btnFinalMerged.classList.add('hidden');
    if (mergeProgressContainer) mergeProgressContainer.classList.add('hidden');
    if (btnCancelMerge) btnCancelMerge.classList.add('hidden');

    // For silent posts (no audio), still show progress under the paste input,
    // fetch the video blob with progress, then reveal the result + final CTA through showFinalDownloadButton.
    if (!media.audioUrl) {
      revokeMergedFinalUrl();
      mergedFinalBlob = null;
      mergedFinalFilename = '';
      // Show the under-input progress line immediately (consistent UX with audio posts)
      if (!mergeGlobalContainer || mergeGlobalContainer.classList.contains('hidden')) {
        setGlobalMergeProgress('Preparing video…', 1);
      }
    }

    // Audio stream handling
    if (media.audioUrl) {
      badgeAudioStatus.textContent = 'Video + Audio Available';
      badgeAudioStatus.classList.remove('no-audio');
      streamNoticeText.textContent = 'Merging audio + video into a single MP4. The preview and final download button will appear once processing is complete.';
    } else {
      badgeAudioStatus.textContent = 'Video Only';
      badgeAudioStatus.classList.add('no-audio');
      audioSynced.removeAttribute('src');
      streamNoticeText.textContent = 'This Reddit video is a silent video or animated media without a separate audio track.';
    }

    // Configure Video Download Button (kept for state; UI hidden)
    updateDownloadButton(selectedVariant, post);

    // Variants & Quality Selector
    qualityButtonsRow.innerHTML = '';
    if (variants.length > 1) {
      qualitySelectorGroup.classList.remove('hidden');
      variants.forEach((v) => {
        const isActive = selectedVariant && v.videoUrl === selectedVariant.videoUrl;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `btn-quality-chip ${isActive ? 'active' : ''}`;
        chip.textContent = v.quality || `${v.height}p`;

        chip.addEventListener('click', () => {
          document.querySelectorAll('.btn-quality-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');

          selectedVariant = v;
          updateDownloadButton(v, post);

          // Re-trigger processing for new quality — always show progress under input
          if (!isMerging) {
            resultCard.classList.add('hidden');
            if (btnFinalMerged) btnFinalMerged.classList.add('hidden');
            revokeMergedFinalUrl();
            mergedFinalBlob = null;
            mergedFinalFilename = '';
            setGlobalMergeProgress('Preparing media…', 1);
            startMergeDownload();
          }
        });

        qualityButtonsRow.appendChild(chip);
      });
    } else {
      qualitySelectorGroup.classList.add('hidden');
    }

    // Auto-start processing immediately for ALL posts (silent or with audio).
    // Shows the progress line directly below the paste input the whole time,
    // then reveals the result card + download section once 100% ready.
    if (!autoMergeQueued && !isMerging) {
      autoMergeQueued = true;
      startMergeDownload();
      autoMergeQueued = false;
    }
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

    if (btnMergeDownload && currentPostData?.media?.audioUrl) {
      const mergedFilename = `reddit-${subClean}-${qualityLabel}-with-audio.mp4`;
      btnMergeDownload.dataset.filename = mergedFilename;
      labelMergeDownload.textContent = `Merge & Download MP4 (${qualityLabel} + Audio)`;
      btnMergeDownload.classList.remove('hidden');
    } else if (btnMergeDownload) {
      btnMergeDownload.classList.add('hidden');
    }
  }

  /* --------------------------------------------------------------------------
     Merge Video + Audio into a single MP4 (client-side, NO playback during processing)
     Uses MP4Box.js via CDN for sample-accurate demux + mux. Falls back to live recording
     (MediaRecorder playback) only if MP4Box fails / isn't supported by the input.
     -------------------------------------------------------------------------- */
  function setGlobalMergeProgress(text, pct) {
    if (!mergeGlobalText || !mergeGlobalBar || !mergeGlobalPercent) return;
    pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    mergeGlobalText.textContent = text || '';
    mergeGlobalPercent.textContent = `${pct}%`;
    mergeGlobalBar.style.width = `${pct}%`;
    if (mergeGlobalContainer) mergeGlobalContainer.classList.remove('hidden');
  }

  function hideGlobalMergeProgress() {
    if (mergeGlobalContainer) mergeGlobalContainer.classList.add('hidden');
    setGlobalMergeProgress('', 0);
  }

  function formatBytes(n) {
    if (!n || !isFinite(n)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function abortMergeIfCancelled() {
    if (mergeCancelled) throw new Error('Merge cancelled.');
  }

  function fetchWithAbortAndProgress(url, onProgress, signal) {
    return fetch(url, { signal }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body) {
        const ab = await res.arrayBuffer();
        if (onProgress) onProgress(100, ab.byteLength);
        return new Blob([ab], { type: res.headers.get('content-type') || '' });
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) {
          const pct = total ? (received / total) * 100 : Math.min(99, received / (1024 * 1024));
          onProgress(pct, received);
        }
      }
      return new Blob(chunks, { type: res.headers.get('content-type') || '' });
    });
  }

  function revokeMergedFinalUrl() {
    if (mergedFinalUrl) {
      try { URL.revokeObjectURL(mergedFinalUrl); } catch {}
      mergedFinalUrl = null;
    }
  }

  async function blobToArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
      fr.readAsArrayBuffer(blob);
    });
  }

  function ensureMP4BoxReady() {
    if (window.MP4Box) return Promise.resolve(window.MP4Box);
    return new Promise((resolve, reject) => {
      if (window.__mp4boxLoadFailed) return reject(new Error('MP4Box library failed to load.'));
      let checks = 0;
      const iv = setInterval(() => {
        checks++;
        if (window.MP4Box) { clearInterval(iv); resolve(window.MP4Box); return; }
        if (checks > 60) { clearInterval(iv); reject(new Error('Timed out loading merge library.')); }
      }, 100);
    });
  }

  function cleanupMerge(alsoHideProgress = true) {
    // Clean up any legacy playback-based merge state
    if (mergeTimer) { clearInterval(mergeTimer); mergeTimer = null; }
    if (mergeStallRecoveryTimer) { clearTimeout(mergeStallRecoveryTimer); mergeStallRecoveryTimer = null; }
    if (mergeVisibilityHandler) {
      try { document.removeEventListener('visibilitychange', mergeVisibilityHandler); } catch {}
      mergeVisibilityHandler = null;
    }
    if (mergeRecorder && mergeRecorder.state !== 'inactive') {
      try { mergeRecorder.stop(); } catch {}
    }
    if (mergeVideoEl) {
      try { mergeVideoEl.pause(); } catch {}
      if (mergeVideoEl._objectUrl) { try { URL.revokeObjectURL(mergeVideoEl._objectUrl); } catch {} }
      mergeVideoEl.removeAttribute('src');
      try { mergeVideoEl.load(); } catch {}
      mergeVideoEl.onwaiting = mergeVideoEl.onstalled = mergeVideoEl.onplaying =
        mergeVideoEl.onpause = mergeVideoEl.onended = mergeVideoEl.onerror = null;
      mergeVideoEl = null;
    }
    if (mergeAudioEl) {
      try { mergeAudioEl.pause(); } catch {}
      if (mergeAudioEl._objectUrl) { try { URL.revokeObjectURL(mergeAudioEl._objectUrl); } catch {} }
      if (mergeAudioEl._audioCtx) { try { mergeAudioEl._audioCtx.close().catch(() => {}); } catch {} }
      mergeAudioEl.removeAttribute('src');
      try { mergeAudioEl.load(); } catch {}
      mergeAudioEl.onwaiting = mergeAudioEl.onstalled = mergeAudioEl.onplaying =
        mergeAudioEl.onpause = mergeAudioEl.onended = mergeAudioEl.onerror = null;
      mergeAudioEl = null;
    }
    mergeRecorder = null;
    isMerging = false;
    if (alsoHideProgress && !mergedFinalBlob) {
      hideGlobalMergeProgress();
      if (mergeProgressContainer) mergeProgressContainer.classList.add('hidden');
      if (btnFinalMerged) btnFinalMerged.classList.add('hidden');
    }
  }

  async function renderPendingResultCard(revealImmediately) {
    if (!renderResultData) return;
    // Move resultCard.classList.toggle('hidden', !revealImmediately);
    if (revealImmediately) {
      resultCard.classList.remove('hidden');
      setTimeout(() => resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }

  function showFinalDownloadButton(blob, filename) {
    revokeMergedFinalUrl();
    mergedFinalBlob = blob;
    mergedFinalFilename = filename;
    mergedFinalUrl = URL.createObjectURL(blob);

    if (mergeProgressContainer) {
      mergeProgressContainer.classList.remove('hidden');
      if (mergeProgressBar) mergeProgressBar.style.width = '100%';
      if (mergeProgressText) mergeProgressText.textContent = `Ready — ${formatBytes(blob.size)}`;
      if (mergeProgressHint) mergeProgressHint.textContent = 'Use the button below to download the final merged MP4.';
      if (btnCancelMerge) btnCancelMerge.classList.add('hidden');
    }

    if (btnFinalMerged) {
      btnFinalMerged.href = mergedFinalUrl;
      btnFinalMerged.download = filename;
      btnFinalMerged.target = '_blank';
      btnFinalMerged.classList.remove('hidden');
    }
    if (labelFinalMerged) {
      const ext = (filename.split('.').pop() || 'mp4').toUpperCase();
      labelFinalMerged.textContent = `Download Final ${ext} (${formatBytes(blob.size)})`;
    }

    // Preview = the final merged blob, NO autoplay
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.removeAttribute('src');
      try { videoPlayer.load(); } catch {}
      videoPlayer.src = mergedFinalUrl;
      audioSynced.removeAttribute('src');
      videoPlayer.controls = true;
      videoPlayer.controlslist = 'nodownload';
      try { videoPlayer.load(); } catch {}
      if (videoErrorOverlay) videoErrorOverlay.classList.add('hidden');
      videoPlayer.currentTime = 0;
      // Explicitly never autoplay
      try { videoPlayer.pause(); } catch {}
    }

    // Now that everything is ready, reveal the result card + fire any pending reveal
    renderPendingResultCard(true);
    hideGlobalMergeProgress();
  }

  async function muxWithMP4Box(MP4Box, videoBuffer, audioBuffer, onProgressTick) {
    return new Promise((resolve, reject) => {
      // MP4Box.appendBuffer() expects either:
      //   • an ArrayBuffer where byteOffset === 0 for the internal DataView, or
      //   • a Uint8Array whose underlying .buffer also begins at offset 0 for this slice.
      // A Blob→arrayBuffer() already gives us an offset-free ArrayBuffer, so we copy
      // any view into a fresh 0-offset typed array just to be safe against every browser.
      function toMP4BoxSafeBuffer(source) {
        if (!source) return null;
        if (source instanceof ArrayBuffer) {
          const v = new Uint8Array(source);
          v.fileStart = 0;
          return v;
        }
        if (ArrayBuffer.isView(source)) {
          const copy = new Uint8Array(source.byteLength);
          copy.set(new Uint8Array(source.buffer, source.byteOffset || 0, source.byteLength));
          copy.fileStart = 0;
          return copy;
        }
        return null;
      }

      const vbuf = toMP4BoxSafeBuffer(videoBuffer);
      const abuf = toMP4BoxSafeBuffer(audioBuffer);
      if (!vbuf) { reject(new Error('Invalid video buffer.')); return; }
      if (hasAudio && !abuf) { reject(new Error('Invalid audio buffer.')); return; }

      const vdmx = MP4Box.createFile(false);
      const admx = MP4Box.createFile(false);
      const outFile = MP4Box.createFile();

      let vTrack = null;
      let aTrack = null;
      let vSamplesSent = 0;
      let aSamplesSent = 0;
      let vTotalSamples = 0;
      let aTotalSamples = 0;
      let vDone = false;
      let aDone = false;

      function finishIfReady() {
        if (!(hasAudio ? vDone && aDone : vDone)) return;
        try {
          const ab = outFile.flush();
          if (ab && ab.byteLength) {
            resolve(new Blob([ab], { type: 'video/mp4' }));
          } else {
            reject(new Error('Muxer produced an empty output.'));
          }
        } catch (e) { reject(e); }
      }

      function maybeProgress() {
        const total = Math.max(1, vTotalSamples + aTotalSamples);
        const done = vSamplesSent + aSamplesSent;
        onProgressTick(80 + Math.min(19, Math.round((done / total) * 19)));
      }

      function processVideoSamples(track) {
        try {
          try { vdmx.extractSamples(track.id, 0, 1000000000); } catch {}
          const samples = vdmx.getSamples(track.id) || [];
          vTotalSamples = samples.length;
          for (let i = 0; i < samples.length; i++) {
            if (mergeCancelled) { reject(new Error('Merge cancelled.')); return; }
            try { outFile.addSample(vTrack, samples[i]); }
            catch (e) { reject(new Error('Video sample add failed: ' + ((e && e.message) || e))); return; }
            vSamplesSent++;
            maybeProgress();
          }
          vDone = true;
          finishIfReady();
        } catch (e) { reject(e); }
      }

      function processAudioSamples(track) {
        try {
          try { admx.extractSamples(track.id, 0, 1000000000); } catch {}
          const samples = admx.getSamples(track.id) || [];
          aTotalSamples = samples.length;
          for (let i = 0; i < samples.length; i++) {
            if (mergeCancelled) { reject(new Error('Merge cancelled.')); return; }
            try { outFile.addSample(aTrack, samples[i]); }
            catch (e) { reject(new Error('Audio sample add failed: ' + ((e && e.message) || e))); return; }
            aSamplesSent++;
            maybeProgress();
          }
          aDone = true;
          finishIfReady();
        } catch (e) { reject(e); }
      }

      vdmx.onReady = (info) => {
        try {
          const vi = info.videoTracks && info.videoTracks[0];
          if (!vi) { reject(new Error('No video track in input video.')); return; }
          const vmoov = vdmx.getTrackById(vi.id);
          vTrack = outFile.addTrack(vmoov);
          setTimeout(() => processVideoSamples(vmoov), 0);
        } catch (e) { reject(e); }
      };

      admx.onReady = (info) => {
        try {
          const ai = info.audioTracks && info.audioTracks[0];
          if (!ai) { reject(new Error('No audio track in input audio.')); return; }
          const amoof = admx.getTrackById(ai.id);
          aTrack = outFile.addTrack(amoof);
          processAudioSamples(amoof);
        } catch (e) { reject(e); }
      };

      vdmx.onError = (e) => reject(new Error('Video demux error: ' + ((typeof e === 'string') ? e : (e && e.message ? e.message : String(e)))));
      admx.onError = (e) => reject(new Error('Audio demux error: ' + ((typeof e === 'string') ? e : (e && e.message ? e.message : String(e)))));

      // Incremental append (safer for large/fragmented Reddit MP4s) + flush
      try {
        const CHUNK = 1024 * 1024; // 1 MB per append
        let vStart = 0;
        while (vStart < vbuf.byteLength) {
          const end = Math.min(vbuf.byteLength, vStart + CHUNK);
          const slice = vbuf.subarray(vStart, end);
          slice.fileStart = vStart;
          vdmx.appendBuffer(slice);
          vStart = end;
        }
        vdmx.flush();
      } catch (e) { reject(new Error('Video appendBuffer failed on video input: ' + ((e && e.message) || e))); return; }

      if (hasAudio) {
        try {
          const CHUNK_A = 1024 * 256;
          let aStart = 0;
          while (aStart < abuf.byteLength) {
            const end = Math.min(abuf.byteLength, aStart + CHUNK_A);
            const slice = abuf.subarray(aStart, end);
            slice.fileStart = aStart;
            admx.appendBuffer(slice);
            aStart = end;
          }
          admx.flush();
        } catch (e) { reject(new Error('Audio appendBuffer failed on audio input: ' + ((e && e.message) || e))); return; }
      } else {
        aDone = true;
        finishIfReady();
      }
    });
  }

  async function startMergeDownload() {
    if (isMerging) return;
    if (!selectedVariant) {
      showError('Missing video selection.');
      return;
    }

    if (mergeAbortController) { try { mergeAbortController.abort(); } catch {} }
    mergeAbortController = new AbortController();
    mergeCancelled = false;

    const hasAudio = !!currentPostData?.media?.audioUrl;
    const post = currentPostData?.post || {};
    const subClean = (post.subreddit || 'video').replace(/[^a-zA-Z0-9]/g, '');
    const qualityLabel = selectedVariant?.quality || (selectedVariant?.height ? `${selectedVariant.height}p` : 'HD');
    const finalFilename = `reddit-${subClean}-${qualityLabel}${hasAudio ? '-with-audio' : ''}.mp4`;

    revokeMergedFinalUrl();
    mergedFinalBlob = null;
    mergedFinalFilename = '';
    isMerging = true;

    // Keep result card HIDDEN until merge isMerging complete
    resultCardPending = true;
    resultCard.classList.add('hidden');
    if (btnCancelGlobalMerge) {
      btnCancelGlobalMerge.classList.remove('hidden');
    }

    setGlobalMergeProgress('Preparing…', 0);

    let videoBlob = null;
    let audioBlob = null;
    let legacyTried = false;

    try {
      const MP4Box = hasAudio ? await ensureMP4BoxReady().catch(() => null) : null;

      const videoFetchUrl = getDownloadUrl(selectedVariant.videoUrl, '') || getStreamUrl(selectedVariant.videoUrl);
      setGlobalMergeProgress(hasAudio ? 'Downloading video stream…' : 'Downloading video…', 0);
      abortMergeIfCancelled();
      videoBlob = await fetchWithAbortAndProgress(
        videoFetchUrl,
        (pct, got) => {
          const label = hasAudio
            ? `Downloading video stream… ${formatBytes(got) || ''}${got ? ' ' : ''}${hasAudio ? `(${Math.round(pct)}%)` : ''}`
            : `Downloading video… ${formatBytes(got)}`;
          const weight = hasAudio ? (0 + pct * 0.40) : (pct * 0.60);
          setGlobalMergeProgress(label, weight);
        },
        mergeAbortController.signal
      );

      if (!hasAudio) {
        // Silent video: no mux, just show the video directly via blob
        abortMergeIfCancelled();
        setGlobalMergeProgress('Finalizing…', 90);
        const buf = await blobToArrayBuffer(videoBlob);
        const finalBlob = new Blob([buf], { type: 'video/mp4' });
        setGlobalMergeProgress('Done', 100);
        isMerging = false;
        showFinalDownloadButton(finalBlob, finalFilename);
        return;
      }

      const audioFetchUrl = getDownloadUrl(currentPostData.media.audioUrl, '') || getStreamUrl(currentPostData.media.audioUrl);
      setGlobalMergeProgress('Downloading audio stream… (0%)', 40);
      abortMergeIfCancelled();
      audioBlob = await fetchWithAbortAndProgress(
        audioFetchUrl,
        (pct, got) => setGlobalMergeProgress(
          `Downloading audio stream… ${formatBytes(got)} (${Math.round(pct)}%)`,
          40 + pct * 0.35
        ),
        mergeAbortController.signal
      );

      // If MP4Box not available, fall back to MediaRecorder (with muted/playback method)
      if (!MP4Box) {
        abortMergeIfCancelled();
        legacyTried = true;
        return startMergeDownloadLegacy(videoBlob, audioBlob, finalFilename);
      }

      setGlobalMergeProgress('Merging video & audio into MP4…', 78);
      abortMergeIfCancelled();
      const [videoAB, audioAB] = await Promise.all([blobToArrayBuffer(videoBlob), blobToArrayBuffer(audioBlob)]);
      abortMergeIfCancelled();
      const merged = await muxWithMP4Box(
        MP4Box,
        videoAB,
        audioAB,
        (pct) => setGlobalMergeProgress('Merging video & audio into MP4…', pct)
      );
      setGlobalMergeProgress('Finalizing…', 99);
      abortMergeIfCancelled();
      isMerging = false;
      showFinalDownloadButton(merged, finalFilename);
      try { triggerBlobDownload(merged, finalFilename); } catch {}

    } catch (err) {
      // Graceful fallback: if MP4Box mux failed and we haven't tried MediaRecorder yet (and not an abort/cancel), do that now
      const wasAbort = !!(err && (err.name === 'AbortError' || mergeCancelled || (err && err.message && /cancel/i.test(err.message))));
      if (!wasAbort && hasAudio && videoBlob && audioBlob && !legacyTried && window.MediaRecorder) {
        try {
          setGlobalMergeProgress('MP4Box mux unavailable, retrying with MediaRecorder…', 76);
          legacyTried = true;
          return startMergeDownloadLegacy(videoBlob, audioBlob, finalFilename);
        } catch (legacyErr) {
          err = legacyErr;
        }
      }

      isMerging = false;
      resultCard.classList.add('hidden');
      hideGlobalMergeProgress();
      cleanupMerge(true);
      const msg = err && err.name === 'AbortError'
        ? 'Processing cancelled.'
        : (err && err.message ? err.message : 'Failed to process video.');
      if (err && err.name !== 'AbortError') {
        showError(msg);
      }
    } finally {
      mergeAbortController = null;
    }
  }

  async function startMergeDownloadLegacy(videoBlob, audioBlob, finalFilename) {
    // Fallback legacy MediaRecorder-based merge
    if (!window.MediaRecorder) {
      throw new Error('Neither MP4Box nor MediaRecorder available in this browser.');
    }

    const pickRecorderMime = () => {
      const options = [
        'video/mp4;codecs=h264,aac',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];
      for (const t of options) {
        try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return { mime: t, ext: t.indexOf('webm') >= 0 ? 'webm' : 'mp4' }; } catch {}
      }
      return { mime: '', ext: 'mp4' };
    };

    const { mime, ext } = pickRecorderMime();
    const fixedFilename = finalFilename.replace(/\.(mp4|webm)$/i, `.${ext}`);

    const captureMediaStream = (el) => {
      if (el.captureStream) return el.captureStream();
      if (el.mozCaptureStream) return el.mozCaptureStream();
      if (el.webkitCaptureStream) return el.webkitCaptureStream();
      return null;
    };

    const vurl = URL.createObjectURL(videoBlob);
    const aurl = URL.createObjectURL(audioBlob);
    mergeVideoEl = document.createElement('video');
    mergeAudioEl = document.createElement('audio');
    mergeVideoEl.muted = true;
    mergeVideoEl.playsInline = true;
    mergeAudioEl.playsInline = true;
    mergeVideoEl.setAttribute('playsinline', '');
    mergeVideoEl.setAttribute('webkit-playsinline', '');
    mergeAudioEl.setAttribute('playsinline', '');
    mergeAudioEl.setAttribute('webkit-playsinline', '');
    mergeVideoEl.preload = 'auto';
    mergeAudioEl.preload = 'auto';
    mergeVideoEl._objectUrl = vurl;
    mergeAudioEl._objectUrl = aurl;
    mergeVideoEl.src = vurl;
    mergeAudioEl.src = aurl;

    await Promise.all([
      new Promise((res, rej) => {
        mergeVideoEl.oncanplaythrough = () => res();
        mergeVideoEl.onerror = () => rej(new Error('Video buffer failed to load.'));
      }),
      new Promise((res, rej) => {
        mergeAudioEl.oncanplaythrough = () => res();
        mergeAudioEl.onerror = () => rej(new Error('Audio buffer failed to load.'));
      })
    ]);

    mergeDurationSec = Math.max(
      isFinite(mergeVideoEl.duration) ? mergeVideoEl.duration : 0,
      isFinite(mergeAudioEl.duration) ? mergeAudioEl.duration : 0
    );

    const combined = new MediaStream();
    const vStream = captureMediaStream(mergeVideoEl);
    const aStream = captureMediaStream(mergeAudioEl);
    if (!vStream || vStream.getVideoTracks().length === 0) throw new Error('Could not capture video stream.');
    vStream.getVideoTracks().forEach(t => combined.addTrack(t));
    if (aStream && aStream.getAudioTracks().length > 0) {
      aStream.getAudioTracks().forEach(t => combined.addTrack(t));
    } else {
      try {
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') await actx.resume();
        const src = actx.createMediaElementSource(mergeAudioEl);
        const dest = actx.createMediaStreamDestination();
        src.connect(dest);
        dest.stream.getAudioTracks().forEach(t => combined.addTrack(t));
        mergeAudioEl._audioCtx = actx;
      } catch {}
    }

    const chunks = [];
    try {
      mergeRecorder = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    } catch {
      mergeRecorder = new MediaRecorder(combined);
    }
    mergeRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const done = new Promise((resolve, reject) => {
      mergeRecorder.onstop = () => {
        const finalMime = mergeRecorder?.mimeType || mime || 'video/mp4';
        const blob = new Blob(chunks, { type: finalMime });
        if (blob.size < 4096) reject(new Error('Output empty.')); else resolve(blob);
      };
    });
    mergeRecorder.start(250);
    try { mergeAudioEl.play().catch(() => {}); mergeVideoEl.play().catch(() => {}); } catch {}
    mergeVideoEl.onended = () => { if (mergeRecorder && mergeRecorder.state !== 'inactive') { try { mergeRecorder.stop(); } catch {} } };
    mergeAudioEl.onended = mergeVideoEl.onended;

    mergeTimer = setInterval(() => {
      if (!mergeVideoEl) return;
      const cur = mergeVideoEl.currentTime || 0;
      const pct = mergeDurationSec > 0 ? Math.min(99, 75 + (cur / mergeDurationSec) * 24) : 75;
      setGlobalMergeProgress('Merging (legacy playback mode)…', pct);
    }, 250);

    const blob = await done;
    if (mergeTimer) { clearInterval(mergeTimer); mergeTimer = null; }
    isMerging = false;
    showFinalDownloadButton(blob, fixedFilename);
    try { triggerBlobDownload(blob, fixedFilename); } catch {}
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 2000);
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

    // Merge + Download Button
    if (btnMergeDownload) {
      btnMergeDownload.addEventListener('click', (e) => {
        e.preventDefault();
        startMergeDownload();
      });
    }
    if (btnCancelMerge) {
      btnCancelMerge.addEventListener('click', (e) => {
        e.preventDefault();
        cleanupMerge(true);
      });
    }
    if (btnCancelGlobalMerge) {
      btnCancelGlobalMerge.addEventListener('click', (e) => {
        e.preventDefault();
        mergeCancelled = true;
        if (mergeAbortController) { try { mergeAbortController.abort(); } catch {} }
        isMerging = false;
        cleanupMerge(true);
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
