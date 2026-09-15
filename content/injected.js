// Main world script: intercepts YouTube player and caption tracks data
(function() {
  console.log('[YouTube Translator] Injected MAIN world script active.');

  function getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get('v');
  }

  function getPlayer() {
    return document.getElementById('movie_player');
  }

  function extractCaptionTracks() {
    const videoId = getCurrentVideoId();
    if (!videoId) return [];

    const player = getPlayer();

    // Proactively initialize captions module if player is ready
    if (player && typeof player.loadModule === 'function') {
      try {
        player.loadModule('captions');
      } catch (e) {}
    }

    let rawTracks = [];
    let videoTitle = document.title.replace(' - YouTube', '');

    // Helper: validate tracks have baseUrl
    const hasValidTracks = (arr) => Array.isArray(arr) && arr.length > 0 && arr.some(t => Boolean(t.baseUrl));

    // 1. Try movie_player.getPlayerResponse() (Most accurate for current video)
    if (player && typeof player.getPlayerResponse === 'function') {
      try {
        const resp = player.getPlayerResponse();
        if (resp && resp.videoDetails?.videoId === videoId) {
          videoTitle = resp.videoDetails?.title || videoTitle;
          const ct = resp.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (hasValidTracks(ct)) {
            rawTracks = ct;
          }
        }
      } catch (e) {}
    }

    // 2. Try window.ytInitialPlayerResponse (has full signed baseUrl)
    if (rawTracks.length === 0 && window.ytInitialPlayerResponse) {
      try {
        const resp = window.ytInitialPlayerResponse;
        if (resp.videoDetails?.videoId === videoId) {
          videoTitle = resp.videoDetails?.title || videoTitle;
          const ct = resp.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (hasValidTracks(ct)) {
            rawTracks = ct;
          }
        }
      } catch (e) {}
    }

    // 3. Try ytd-watch-flexy component data (has full signed baseUrl)
    if (rawTracks.length === 0) {
      try {
        const flexy = document.querySelector('ytd-watch-flexy');
        const flexyData = flexy?.playerData;
        if (flexyData && flexyData.videoDetails?.videoId === videoId) {
          videoTitle = flexyData.videoDetails?.title || videoTitle;
          const ct = flexyData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (hasValidTracks(ct)) {
            rawTracks = ct;
          }
        }
      } catch (e) {}
    }

    // 4. Try ytplayer config args
    if (rawTracks.length === 0 && window.ytplayer?.config?.args?.raw_player_response) {
      try {
        const raw = typeof window.ytplayer.config.args.raw_player_response === 'string'
          ? JSON.parse(window.ytplayer.config.args.raw_player_response)
          : window.ytplayer.config.args.raw_player_response;
        if (raw?.videoDetails?.videoId === videoId) {
          const ct = raw.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (hasValidTracks(ct)) {
            rawTracks = ct;
          }
        }
      } catch (e) {}
    }

    // 5. If still no tracks with baseUrl, try player option tracklist and trigger player load
    if (rawTracks.length === 0 && player && typeof player.getOption === 'function') {
      try {
        const optTracks = player.getOption('captions', 'tracklist') || player.getOption('captions', 'captionTracks');
        if (Array.isArray(optTracks) && optTracks.length > 0) {
          if (hasValidTracks(optTracks)) {
            rawTracks = optTracks;
          } else if (typeof player.setOption === 'function') {
            // Tell player to select track so YouTube initiates the signed timedtext request
            const target = optTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || optTracks[0];
            if (target) {
              player.setOption('captions', 'track', target);
            }
          }
        }
      } catch (e) {}
    }

    // Normalize tracks - only keep tracks that have a genuine signed baseUrl from YouTube
    const tracks = rawTracks
      .filter(t => t && typeof t.baseUrl === 'string' && t.baseUrl.startsWith('http'))
      .map(t => {
        const langCode = t.languageCode || t.lang || (t.vssId ? t.vssId.replace(/^a?\./, '') : '');
        const kind = t.kind || (t.vssId?.startsWith('a.') ? 'asr' : '');
        return {
          baseUrl: t.baseUrl,
          name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageName || t.name || langCode,
          vssId: t.vssId,
          languageCode: langCode,
          kind,
          isTranslatable: t.isTranslatable ?? true
        };
      });

    return tracks;
  }

  let lastDispatchedVideoId = null;
  let pollTimer = null;
  let pollCount = 0;

  function dispatchTracks(videoId, videoTitle, tracks) {
    if (!tracks || tracks.length === 0) return;
    lastDispatchedVideoId = videoId;
    console.log(`[YouTube Translator] Extracted ${tracks.length} caption tracks for ${videoId}`);
    window.postMessage({
      source: 'YT_TRANSLATOR_MAIN',
      type: 'CAPTION_TRACKS_FOUND',
      payload: {
        videoId,
        title: videoTitle,
        tracks
      }
    }, '*');
  }

  function pollCaptionTracks(force = false) {
    const currentV = getCurrentVideoId();
    if (!currentV) return;

    if (force) {
      clearTimeout(pollTimer);
      pollCount = 0;
      lastDispatchedVideoId = null;
    } else if (currentV === lastDispatchedVideoId) {
      return; // Already extracted and dispatched for this video
    }

    pollCount++;
    const tracks = extractCaptionTracks();

    if (tracks && tracks.length > 0) {
      clearTimeout(pollTimer);
      const player = getPlayer();
      let videoTitle = document.title.replace(' - YouTube', '');
      try {
        const resp = player?.getPlayerResponse?.();
        if (resp?.videoDetails?.title) videoTitle = resp.videoDetails.title;
      } catch (e) {}
      dispatchTracks(currentV, videoTitle, tracks);
      return;
    }

    if (pollCount < 25) {
      pollTimer = setTimeout(() => pollCaptionTracks(false), 400);
    }
  }

  // Intercept network requests for timedtext to grab active caption URL & data
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.includes('/api/timedtext')) {
      this.addEventListener('load', function() {
        try {
          if (this.responseText && this.responseText.length > 20) {
            window.postMessage({
              source: 'YT_TRANSLATOR_MAIN',
              type: 'TIMEDTEXT_DATA_CAPTURED',
              payload: { url, rawText: this.responseText }
            }, '*');
          }
        } catch (e) {}
      });

      window.postMessage({
        source: 'YT_TRANSLATOR_MAIN',
        type: 'TIMEDTEXT_URL_DETECTED',
        payload: { url }
      }, '*');
    }
    return origOpen.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    const response = await origFetch.apply(this, arguments);
    if (typeof url === 'string' && url.includes('/api/timedtext')) {
      try {
        const clone = response.clone();
        clone.text().then(rawText => {
          if (rawText && rawText.length > 20) {
            window.postMessage({
              source: 'YT_TRANSLATOR_MAIN',
              type: 'TIMEDTEXT_DATA_CAPTURED',
              payload: { url, rawText }
            }, '*');
          }
        }).catch(() => {});
      } catch (e) {}

      window.postMessage({
        source: 'YT_TRANSLATOR_MAIN',
        type: 'TIMEDTEXT_URL_DETECTED',
        payload: { url }
      }, '*');
    }
    return response;
  };

  // Listen for requests from content script
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'YT_TRANSLATOR_CONTENT') {
      if (event.data.type === 'REQUEST_CAPTION_TRACKS') {
        pollCaptionTracks(true);
      } else if (event.data.type === 'SEEK_TO') {
        const seconds = event.data.payload?.seconds;
        if (typeof seconds === 'number') {
          const player = getPlayer();
          if (player && typeof player.seekTo === 'function') {
            player.seekTo(seconds, true);
            if (typeof player.playVideo === 'function') {
              player.playVideo();
            }
          } else {
            const video = document.querySelector('video');
            if (video) {
              video.currentTime = seconds;
              video.play();
            }
          }
        }
      } else if (event.data.type === 'TOGGLE_NATIVE_CC') {
        const forceState = event.data.payload?.state;
        const ccBtn = document.querySelector('.ytp-subtitles-button');
        const isPressed = ccBtn?.getAttribute('aria-pressed') === 'true';

        if (forceState === 'on' && isPressed) return;
        if (forceState === 'off' && !isPressed) return;

        const player = getPlayer();
        if (player && typeof player.toggleSubtitles === 'function') {
          player.toggleSubtitles();
        } else if (ccBtn) {
          ccBtn.click();
        }
      }
    }
  });

  // Check on load and on YouTube page changes
  window.addEventListener('yt-navigate-finish', () => pollCaptionTracks(true));
  window.addEventListener('yt-page-data-updated', () => pollCaptionTracks(false));
  window.addEventListener('spfdone', () => pollCaptionTracks(true));

  // Initial attempt
  pollCaptionTracks(true);
})();
