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
  const heroHeader = document.getElementById('hero-header');
  const downloaderGlowWrap = document.getElementById('downloader-glow-wrap');
  const btnAnotherVideo = document.getElementById('btn-another-video');
  const btnAnotherVideoTop = document.getElementById('btn-another-video-top');
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
  const videoContainer = document.getElementById('video-container');
  const videoPlayer = document.getElementById('video-player');
  const audioSynced = document.getElementById('audio-synced');
  const btnEnableAudio = document.getElementById('btn-enable-audio');
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
  const dlSpinnerPrimary = document.getElementById('dl-spinner-primary');
  const btnDownloadMergedBackup = document.getElementById('btn-download-merged-backup');
  const labelDownloadBackup = document.getElementById('label-download-backup');
  const dlSpinnerBackup = document.getElementById('dl-spinner-backup');
  const btnCopyPostLink = document.getElementById('btn-copy-post-link');
  const labelCopyLink = document.getElementById('label-copy-link');
  const streamNoticeText = document.getElementById('stream-notice-text');

  // In-Player Error & Stream Controls
  const videoErrorOverlay = document.getElementById('video-error-overlay');
  const videoErrorDesc = document.getElementById('video-error-desc');
  const btnSwitchStreamMode = document.getElementById('btn-switch-stream-mode');
  const labelSwitchStream = document.getElementById('label-switch-stream');
  const btnRetryPlayer = document.getElementById('btn-retry-player');
  const btnStreamWorker = document.getElementById('btn-stream-worker');
  const btnStreamDirect = document.getElementById('btn-stream-direct');

  // State for in-page download actions
  let isDownloading = false;
  let lastDownloadTime = 0;
  let activeDownloadState = {
    primaryUrl: '',
    backupUrl: '',
    filename: 'reddit-video.mp4',
    permalink: ''
  };

  // Remote Production Cloudflare Worker URL
  const REMOTE_WORKER_URL = 'https://whdp.romitkr361.workers.dev';

  // Dynamic API Base URL: auto-switches between local full-stack server and remote worker
  // Full-stack environments (Vite/Node backend, Cloud Run, localhost, iframe previews) have the native FFmpeg backend.
  // Static hosts (Cloudflare Pages) use the remote worker.
  let isHostedWithBackend = typeof window !== 'undefined' && (
    window.location.hostname !== 'whdp.romitkr361.workers.dev' &&
    !window.location.hostname.endsWith('.pages.dev') &&
    !window.location.hostname.endsWith('.github.io')
  );
  let activeApiBase = isHostedWithBackend ? '' : REMOTE_WORKER_URL;
  let streamMode = 'worker'; // 'worker' (Anti-403 Proxy) or 'direct' (Reddit CDN)
  let isRetryingMerged = false;

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
  function getStreamUrl(rawMediaUrl, audioUrl, permalink, forceUnmerged = false) {
    if (!rawMediaUrl) return '';
    if (streamMode === 'direct') {
      return rawMediaUrl;
    }
    const base = activeApiBase;
    const cleanAudio = (audioUrl && audioUrl !== 'null' && audioUrl !== 'undefined') ? audioUrl : '';

    // If running in full-stack Node environment with FFmpeg available, and user hasn't failed a merge:
    if (isHostedWithBackend && cleanAudio && !forceUnmerged) {
      const audioParam = `&audioUrl=${encodeURIComponent(cleanAudio)}`;
      const permalinkParam = permalink ? `&permalink=${encodeURIComponent(permalink)}` : '';
      return `${base}/api/reddit-stream?url=${encodeURIComponent(rawMediaUrl)}${audioParam}${permalinkParam}&merge=1&disposition=inline`;
    }

    // Otherwise proxy raw video through worker to bypass Reddit CDN 403 blocks cleanly
    return `${base}/api/reddit-stream?url=${encodeURIComponent(rawMediaUrl)}&disposition=inline`;
  }

  function getDownloadUrl(rawMediaUrl, audioUrl, permalink, filename) {
    if (!rawMediaUrl) return '#';
    const base = activeApiBase;
    const cleanAudioUrl = (audioUrl && audioUrl !== 'null' && audioUrl !== 'undefined') ? audioUrl : null;
    const audioParam = cleanAudioUrl ? `&audioUrl=${encodeURIComponent(cleanAudioUrl)}` : '';
    const permalinkParam = permalink ? `&permalink=${encodeURIComponent(permalink)}` : '';
    const nameParam = filename ? `&filename=${encodeURIComponent(filename)}` : '';

    // If audio is present, always request merged stream
    if (cleanAudioUrl) {
      if (base === '') {
        // App server FFmpeg merge pipeline
        return `/api/reddit-download?url=${encodeURIComponent(rawMediaUrl)}${audioParam}${permalinkParam}${nameParam}`;
      } else {
        // On static hosting (uploaded to website), use RapidSave merged MP4 service directly:
        // RapidSave merges audio & video and returns the merged .mp4 file directly to the device
        const postLink = permalink || 'https://www.reddit.com/';
        return `https://sd.rapidsave.com/download.php?permalink=${encodeURIComponent(postLink)}&video_url=${encodeURIComponent(rawMediaUrl)}&audio_url=${encodeURIComponent(cleanAudioUrl)}`;
      }
    }

    if (base === '') {
      return `/api/reddit-download?url=${encodeURIComponent(rawMediaUrl)}${nameParam}`;
    }
    return rawMediaUrl;
  }

  /* --------------------------------------------------------------------------
     Audio-Video Synchronized Playback Preview
     -------------------------------------------------------------------------- */
  let isPlaybackSyncInitialized = false;

  function setupSyncedPlayback(videoElem, audioElem) {
    if (!videoElem || !audioElem) return;
    if (isPlaybackSyncInitialized) return;
    isPlaybackSyncInitialized = true;

    // Helper to start or resume synchronized audio playback
    const syncAndPlayAudio = () => {
      if (!audioElem.src || audioElem.src === window.location.href) return;

      // Align audio to video position
      if (Math.abs(audioElem.currentTime - videoElem.currentTime) > 0.12) {
        audioElem.currentTime = videoElem.currentTime;
      }
      audioElem.volume = videoElem.volume;
      audioElem.muted = videoElem.muted;
      audioElem.playbackRate = videoElem.playbackRate;

      const p = audioElem.play();
      if (p !== undefined) {
        p.then(() => {
          if (btnEnableAudio) btnEnableAudio.classList.add('hidden');
        }).catch((err) => {
          console.warn('Audio autoplay deferred until user gesture:', err);
          if (btnEnableAudio && !videoElem.muted) {
            btnEnableAudio.classList.remove('hidden');
          }
        });
      }
    };

    // Synchronize play
    videoElem.addEventListener('play', () => {
      syncAndPlayAudio();
    });

    // Synchronize playing (when video actually begins playing frames)
    videoElem.addEventListener('playing', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        syncAndPlayAudio();
      }
    });

    // Synchronize pause
    videoElem.addEventListener('pause', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.pause();
      }
    });

    // Synchronize seeking
    videoElem.addEventListener('seeking', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.currentTime = videoElem.currentTime;
      }
    });

    // Synchronize seeked
    videoElem.addEventListener('seeked', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.currentTime = videoElem.currentTime;
        if (!videoElem.paused) {
          syncAndPlayAudio();
        }
      }
    });

    // Synchronize waiting / buffering (pause audio while video buffers)
    videoElem.addEventListener('waiting', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.pause();
      }
    });

    // Synchronize time updates to prevent audio-video drift
    videoElem.addEventListener('timeupdate', () => {
      if (audioElem.src && audioElem.src !== window.location.href && !videoElem.paused) {
        if (Math.abs(audioElem.currentTime - videoElem.currentTime) > 0.18) {
          audioElem.currentTime = videoElem.currentTime;
        }
        if (audioElem.paused) {
          syncAndPlayAudio();
        }
      }
    });

    // Synchronize volume and mute
    videoElem.addEventListener('volumechange', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.volume = videoElem.volume;
        audioElem.muted = videoElem.muted;
        if (videoElem.muted && btnEnableAudio) {
          btnEnableAudio.classList.add('hidden');
        }
      }
    });

    // Synchronize playback rate
    videoElem.addEventListener('ratechange', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.playbackRate = videoElem.playbackRate;
      }
    });

    // Synchronize ended
    videoElem.addEventListener('ended', () => {
      if (audioElem.src && audioElem.src !== window.location.href) {
        audioElem.pause();
        audioElem.currentTime = 0;
      }
    });

    // User gesture unlocking on video container
    if (videoContainer) {
      const unlockAudio = () => {
        if (audioElem && audioElem.src && audioElem.src !== window.location.href) {
          if (!videoElem.paused && audioElem.paused) {
            syncAndPlayAudio();
          }
        }
      };
      videoContainer.addEventListener('click', unlockAudio);
      videoContainer.addEventListener('touchstart', unlockAudio, { passive: true });
    }

    // Global capture-phase gesture listener to ensure browser autoplay restrictions are unlocked
    // even when user clicks inside native video controls shadow DOM
    const unlockDualAudioCapture = () => {
      if (audioElem && audioElem.src && audioElem.src !== window.location.href && !videoElem.paused && audioElem.paused) {
        audioElem.currentTime = videoElem.currentTime;
        audioElem.volume = videoElem.volume;
        audioElem.muted = videoElem.muted;
        audioElem.playbackRate = videoElem.playbackRate;
        audioElem.play().then(() => {
          if (btnEnableAudio) btnEnableAudio.classList.add('hidden');
        }).catch(() => {});
      }
    };

    ['pointerdown', 'click', 'touchstart', 'keydown'].forEach((evtType) => {
      window.addEventListener(evtType, unlockDualAudioCapture, { capture: true, passive: true });
    });

    // Unmute overlay button
    if (btnEnableAudio) {
      btnEnableAudio.addEventListener('click', (e) => {
        e.stopPropagation();
        if (audioElem && audioElem.src) {
          videoElem.muted = false;
          audioElem.muted = false;
          audioElem.currentTime = videoElem.currentTime;
          audioElem.play().then(() => {
            btnEnableAudio.classList.add('hidden');
            showToast('Preview audio enabled 🔊');
          }).catch(() => {});
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     In-Player Error Handler & Stream Switcher
     -------------------------------------------------------------------------- */
  function setupPlayerEventHandlers() {
    videoPlayer.onerror = () => {
      console.warn('Video preview playback issue. Code:', videoPlayer.error ? videoPlayer.error.code : 'unknown');

      // Only fallback to raw dual audio if merged stream threw permanent format decode errors (code 3 or 4)
      if (streamMode === 'worker' && isHostedWithBackend && !isRetryingMerged) {
        if (videoPlayer.error && (videoPlayer.error.code === 3 || videoPlayer.error.code === 4)) {
          console.info('Merged stream decode issue; falling back to worker-proxied stream...');
          isRetryingMerged = true;
          applyCurrentStreamSource();
          return;
        }
      }

      if (videoErrorOverlay) {
        videoErrorOverlay.classList.remove('hidden');
        if (videoErrorDesc) {
          videoErrorDesc.textContent = 'Browser blocked video stream. You can download the full video directly below or switch stream mode.';
        }
        if (labelSwitchStream) {
          labelSwitchStream.textContent = streamMode === 'worker' ? 'Try Direct CDN' : 'Try Worker Proxy';
        }
      }
    };

    if (audioSynced) {
      audioSynced.onerror = () => {
        console.warn('Audio preview playback error.');
        const cleanAudio = (currentPostData?.media?.audioUrl && currentPostData.media.audioUrl !== 'null' && currentPostData.media.audioUrl !== 'undefined')
          ? currentPostData.media.audioUrl
          : null;
        // If worker stream proxy failed for audio, fallback to direct audio stream
        if (cleanAudio && audioSynced.src && audioSynced.src !== cleanAudio) {
          audioSynced.src = cleanAudio;
          audioSynced.load();
          if (!videoPlayer.paused) {
            audioSynced.currentTime = videoPlayer.currentTime;
            audioSynced.play().catch(() => {});
          }
        }
      };
    }

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
    if (btnEnableAudio) {
      btnEnableAudio.classList.add('hidden');
    }

    const wasPlaying = !videoPlayer.paused;
    const currentTime = videoPlayer.currentTime;
    const cleanAudioUrl = (currentPostData?.media?.audioUrl && currentPostData.media.audioUrl !== 'null' && currentPostData.media.audioUrl !== 'undefined')
      ? currentPostData.media.audioUrl
      : null;

    let videoStreamUrl = selectedVariant.videoUrl;
    let shouldUseDualAudio = false;

    if (streamMode === 'worker') {
      const shouldUseMerged = isHostedWithBackend && cleanAudioUrl && !isRetryingMerged;

      if (shouldUseMerged) {
        // Backend with native FFmpeg auto-merge: single unified stream with embedded audio
        videoStreamUrl = getStreamUrl(selectedVariant.videoUrl, cleanAudioUrl, currentPostData?.post?.permalink, false);
        if (audioSynced) {
          audioSynced.pause();
          audioSynced.removeAttribute('src');
        }
      } else {
        // Worker proxy mode: proxy raw video through worker to bypass Reddit CDN 403 blocks
        videoStreamUrl = getStreamUrl(selectedVariant.videoUrl, cleanAudioUrl, currentPostData?.post?.permalink, true);
        shouldUseDualAudio = !!cleanAudioUrl;
      }
    } else {
      // Direct CDN mode (v.redd.it)
      videoStreamUrl = selectedVariant.videoUrl;
      shouldUseDualAudio = !!cleanAudioUrl;
    }

    // Set up synchronized audio stream if separate audio track is needed
    if (shouldUseDualAudio && audioSynced) {
      const audioStreamUrl = streamMode === 'worker'
        ? `${activeApiBase}/api/reddit-stream?url=${encodeURIComponent(cleanAudioUrl)}&disposition=inline`
        : cleanAudioUrl;

      if (audioSynced.src !== audioStreamUrl) {
        audioSynced.src = audioStreamUrl;
        audioSynced.preload = 'auto';
        audioSynced.volume = videoPlayer.volume;
        audioSynced.muted = videoPlayer.muted;
        audioSynced.load();
      }
    } else if (audioSynced && !shouldUseDualAudio) {
      audioSynced.pause();
      audioSynced.removeAttribute('src');
    }

    videoPlayer.src = videoStreamUrl;
    videoPlayer.load();

    if (currentTime > 0) {
      videoPlayer.currentTime = currentTime;
      if (shouldUseDualAudio && audioSynced) {
        audioSynced.currentTime = currentTime;
      }
    }

    if (wasPlaying) {
      videoPlayer.play().catch(() => {});
      if (shouldUseDualAudio && audioSynced) {
        audioSynced.play().catch(() => {});
      }
    }
  }

  /* --------------------------------------------------------------------------
     Render Results
     -------------------------------------------------------------------------- */
  function renderResult(data) {
    hideLoading();
    isRetryingMerged = false;
    currentPostData = data;
    const post = data.post || {};
    const media = data.media || {};

    // Populate post information
    resultTitle.textContent = post.title || 'Reddit Video';
    resultSubreddit.textContent = post.subreddit || 'r/reddit';
    resultAuthor.textContent = post.author || '';
    activeDownloadState.permalink = post.permalink || '';
    if (btnCopyPostLink) {
      btnCopyPostLink.title = post.permalink ? `Copy link: ${post.permalink}` : 'Copy post link';
    }

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

    // Merged audio status & notice
    if (media.audioUrl) {
      badgeAudioStatus.textContent = '🔊 Auto-Merged Video + Audio';
      badgeAudioStatus.classList.remove('no-audio');
      streamNoticeText.textContent = 'Video and audio tracks are automatically merged with faststart streaming so preview and download both have full native audio.';
    } else {
      badgeAudioStatus.textContent = 'Silent Video (No Audio)';
      badgeAudioStatus.classList.add('no-audio');
      streamNoticeText.textContent = 'This Reddit video is a silent video or GIF without an audio track.';
    }

    // Load preview with active stream mode (merged stream)
    applyCurrentStreamSource();

    // Configure Video Download Button (downloads merged video + audio)
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

    // Auto-hide input box and h2 heading above input box as requested
    if (heroHeader) heroHeader.classList.add('hidden');
    if (downloaderGlowWrap) downloaderGlowWrap.classList.add('hidden');
    if (downloaderBox) downloaderBox.classList.add('hidden');

    // Reveal result card
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function hideVideoError() {
    if (videoErrorOverlay) {
      videoErrorOverlay.classList.add('hidden');
    }
  }

  function showToast(message, duration = 3000) {
    const existing = document.querySelector('.toast-message');
    if (existing) {
      if (typeof existing.remove === 'function') {
        existing.remove();
      } else if (existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    }

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10B981" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);
  }

  async function triggerInPageDownload(url, filename, btnEl, labelEl, spinnerEl) {
    if (!url || url === '#' || url === 'undefined' || url === 'null') return;

    // Strict debounce: ignore rapid clicks if already downloading or within 3 seconds of previous click
    const now = Date.now();
    if (isDownloading || (now - lastDownloadTime < 3000)) {
      console.info('Download already in progress or debounced; duplicate trigger ignored.');
      return;
    }

    isDownloading = true;
    lastDownloadTime = now;

    const normalIcon = btnEl ? btnEl.querySelector('.dl-icon-normal') : null;
    const originalLabel = labelEl ? labelEl.textContent : 'Download';

    if (btnEl) btnEl.disabled = true;
    if (spinnerEl) spinnerEl.classList.remove('hidden');
    if (normalIcon) normalIcon.classList.add('hidden');
    if (labelEl) labelEl.textContent = 'Starting Download...';

    const cleanFilename = filename || 'reddit-video.mp4';

    try {
      // Execute exactly ONE native stream download action via programmatic anchor click
      // Since server returns Content-Disposition: attachment, browser downloads directly to disk without leaving page
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.setAttribute('download', cleanFilename);
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();

      setTimeout(() => {
        if (anchor.parentNode) {
          anchor.parentNode.removeChild(anchor);
        }
      }, 1000);

      if (labelEl) labelEl.textContent = 'Download Started! ✓';
      showToast(`Downloading "${cleanFilename}" to your device`);
    } catch (err) {
      console.warn('Anchor download exception, attempting iframe stream fallback:', err);
      // Fallback: ONLY if anchor click threw an exception, use single iframe navigation
      let iframe = document.getElementById('hidden-download-iframe');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'hidden-download-iframe';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
      }
      iframe.src = url;

      if (labelEl) labelEl.textContent = 'Download Started! ✓';
      showToast('Download started');
    } finally {
      // Hold cooldown lock for 3 seconds before restoring button to prevent rapid double-clicks
      setTimeout(() => {
        isDownloading = false;
        if (btnEl) btnEl.disabled = false;
        if (spinnerEl) spinnerEl.classList.add('hidden');
        if (normalIcon) normalIcon.classList.remove('hidden');
        if (labelEl) labelEl.textContent = originalLabel;
      }, 3000);
    }
  }

  function updateDownloadButton(variant, post) {
    const subClean = (post?.subreddit || 'video').replace(/[^a-zA-Z0-9]/g, '');
    const qualityLabel = variant.quality || (variant.height ? `${variant.height}p` : 'HD');
    const variantFilename = `reddit-${subClean}-${qualityLabel}.mp4`;
    const cleanAudio = (currentPostData?.media?.audioUrl && currentPostData.media.audioUrl !== 'null' && currentPostData.media.audioUrl !== 'undefined')
      ? currentPostData.media.audioUrl
      : null;
    const hasAudio = Boolean(cleanAudio);

    // Save download details into state
    activeDownloadState.primaryUrl = getDownloadUrl(
      variant.videoUrl,
      cleanAudio,
      currentPostData?.post?.permalink,
      variantFilename
    );
    activeDownloadState.filename = variantFilename;
    activeDownloadState.permalink = currentPostData?.post?.permalink || 'https://www.reddit.com';

    if (labelDownloadVideo) {
      labelDownloadVideo.textContent = hasAudio
        ? `Download Merged Video (${qualityLabel})`
        : `Download Video (${qualityLabel})`;
    }

    if (btnDownloadMergedBackup) {
      if (hasAudio) {
        btnDownloadMergedBackup.classList.remove('hidden');
        activeDownloadState.backupUrl = activeApiBase === ''
          ? `https://sd.rapidsave.com/download.php?permalink=${encodeURIComponent(currentPostData?.post?.permalink || 'https://www.reddit.com/')}&video_url=${encodeURIComponent(variant.videoUrl)}&audio_url=${encodeURIComponent(cleanAudio)}`
          : `${activeApiBase}/api/reddit-download?url=${encodeURIComponent(variant.videoUrl)}&audioUrl=${encodeURIComponent(cleanAudio)}&permalink=${encodeURIComponent(currentPostData?.post?.permalink || '')}&filename=${encodeURIComponent(variantFilename)}`;
      } else {
        btnDownloadMergedBackup.classList.add('hidden');
        activeDownloadState.backupUrl = '';
      }
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

      // Tier 1: Try local full-stack server first if running in Node/Cloud Run
      if (isHostedWithBackend) {
        try {
          const localUrl = `/api/reddit-video?url=${encodeURIComponent(trimmedUrl)}`;
          const localRes = await fetch(localUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });

          if (localRes.ok) {
            response = localRes;
            activeApiBase = '';
          }
        } catch {
          // Fallback to remote worker below
        }
      }

      // Tier 2: Try remote Cloudflare Worker if local server is not responding (e.g. Cloudflare Pages)
      if (!response) {
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
          }
        } catch (remoteErr) {
          console.warn('Remote worker fetch failed or offline:', remoteErr);
        }
      }

      // Tier 3: If remote worker failed, try local endpoint as last resort
      if (!response) {
        try {
          const localUrl = `/api/reddit-video?url=${encodeURIComponent(trimmedUrl)}`;
          const localRes = await fetch(localUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });
          if (localRes.ok) {
            response = localRes;
            activeApiBase = '';
          }
        } catch {}
      }

      if (!response) {
        throw new Error('Unable to connect to Reddit downloader service. Please check your internet connection.');
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

      // Guarantee audio detection for Reddit videos even if older remote worker returned null
      if (jsonResult.media) {
        let audio = jsonResult.media.audioUrl;
        if (!audio || audio === 'null' || audio === 'undefined') {
          const videoSrc = jsonResult.media.videoUrl || trimmedUrl || '';
          const match = videoSrc.match(/(?:v|preview)\.redd\.it\/([a-zA-Z0-9]+)/i);
          if (match) {
            jsonResult.media.audioUrl = `https://v.redd.it/${match[1]}/DASH_audio.mp4`;
            jsonResult.media.hasAudio = true;
          }
        }
      }

      // Update worker health indicator
      const liveStatusText = document.getElementById('worker-live-status');
      if (liveStatusText) {
        liveStatusText.textContent = usedRemote ? 'Connected (whdp.workers.dev)' : 'Server Online (FFmpeg Merged)';
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

    // Check if local full-stack server is responsive
    let isLocalServerAvailable = false;
    try {
      const localRes = await fetch('/api/health', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (localRes.ok) {
        isLocalServerAvailable = true;
        isHostedWithBackend = true;
        activeApiBase = '';
      }
    } catch {
      isLocalServerAvailable = false;
    }

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
          liveStatusText.textContent = isLocalServerAvailable ? 'Server Online (FFmpeg Auto-Merge)' : `Online (${latency}ms)`;
        }
        if (!isLocalServerAvailable) {
          isHostedWithBackend = false;
          activeApiBase = REMOTE_WORKER_URL;
        }
      }
    } catch {
      // Local fallback is active
      if (badge) {
        badge.innerHTML = `<span class="worker-pulse-dot" aria-hidden="true" style="background:#10B981;"></span> <span>Local Server Online</span>`;
      }
      if (liveStatusText) {
        liveStatusText.textContent = 'Active (FFmpeg Auto-Merge)';
      }
      isHostedWithBackend = true;
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

    if (btnRetryPlayer) {
      btnRetryPlayer.addEventListener('click', (e) => {
        e.preventDefault();
        hideVideoError();
        applyCurrentStreamSource();
        if (videoPlayer) {
          videoPlayer.load();
          videoPlayer.play().catch(() => {});
        }
      });
    }

    // In-Page Download Buttons (Strictly zero new tabs opened)
    if (btnDownloadVideo) {
      btnDownloadVideo.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerInPageDownload(
          activeDownloadState.primaryUrl,
          activeDownloadState.filename,
          btnDownloadVideo,
          labelDownloadVideo,
          dlSpinnerPrimary
        );
      });
    }

    if (btnDownloadMergedBackup) {
      btnDownloadMergedBackup.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerInPageDownload(
          activeDownloadState.backupUrl,
          activeDownloadState.filename,
          btnDownloadMergedBackup,
          labelDownloadBackup,
          dlSpinnerBackup
        );
      });
    }

    // In-Page Copy Post Link (Zero tabs opened)
    if (btnCopyPostLink) {
      btnCopyPostLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const urlToCopy = activeDownloadState.permalink || urlInput.value.trim();
        if (!urlToCopy) return;

        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(urlToCopy);
          } else {
            const temp = document.createElement('textarea');
            temp.value = urlToCopy;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
          }
          if (labelCopyLink) labelCopyLink.textContent = 'Copied! ✓';
          showToast('Reddit post link copied to clipboard');
          setTimeout(() => {
            if (labelCopyLink) labelCopyLink.textContent = 'Copy Post Link';
          }, 2500);
        } catch {
          showToast('Link copied: ' + urlToCopy);
        }
      });
    }

    // Download Another Video handlers (re-shows input box and heading)
    function resetToDownloadAnother() {
      // Pause and clear player media
      if (videoPlayer) {
        try {
          videoPlayer.pause();
          videoPlayer.removeAttribute('src');
          videoPlayer.load();
        } catch {}
      }
      if (audioSynced) {
        try {
          audioSynced.pause();
          audioSynced.removeAttribute('src');
          audioSynced.load();
        } catch {}
      }

      // Hide the result card
      if (resultCard) {
        resultCard.classList.add('hidden');
      }

      // Reveal the input box and heading above input box
      if (heroHeader) {
        heroHeader.classList.remove('hidden');
      }
      if (downloaderGlowWrap) {
        downloaderGlowWrap.classList.remove('hidden');
      }
      if (downloaderBox) {
        downloaderBox.classList.remove('hidden');
      }

      // Hide error & status overlays
      if (statusContainer) {
        statusContainer.classList.add('hidden');
      }
      if (errorBanner) {
        errorBanner.classList.add('hidden');
      }

      // Reset and focus the input field
      if (urlInput) {
        urlInput.value = '';
      }
      updateInputControls();

      // Scroll smoothly back to input box and focus
      const target = downloaderBox || document.getElementById('hero-section');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (urlInput) {
        setTimeout(() => urlInput.focus(), 250);
      }
    }

    if (btnAnotherVideo) {
      btnAnotherVideo.addEventListener('click', (e) => {
        e.preventDefault();
        resetToDownloadAnother();
      });
    }

    if (btnAnotherVideoTop) {
      btnAnotherVideoTop.addEventListener('click', (e) => {
        e.preventDefault();
        resetToDownloadAnother();
      });
    }

    // Setup Video Player events and synchronized audio playback
    setupPlayerEventHandlers();
    setupSyncedPlayback(videoPlayer, audioSynced);

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
