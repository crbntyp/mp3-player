import '../styles/main.scss';
import { AudioVisualizer } from './visualizer.js';
import { HashRouter } from './hash-router.js';
import { MediaSession } from './media-session.js';
import { RecordAnimator } from './record-animator.js';
import { EraSelector } from './era-selector.js';
import { Persistence } from './persistence.js';
import { formatTime, parseDuration } from './utils/time.js';

// Player Application
class Player {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.audio = new Audio();
        // iOS-friendly audio settings
        this.audio.setAttribute('playsinline', '');
        this.audio.setAttribute('webkit-playsinline', '');
        this.audio.preload = 'auto';
        this.isPlaying = false;
        this.preloadCache = new Map(); // Cache for preloaded audio elements
        this.imageCache = new Map(); // Cache for preloaded images
        this.visualizer = null; // Audio visualizer instance
        this.placeholderImages = []; // Neon images (used for all tracks)
        this.localTracks = []; // Store local tracks separately
        this.currentSource = 'local'; // 'local' or folder ID
        this.driveSource = null; // Drive integration (set by EraSelector.init)

        // Persistence — read on construction so volume/shuffle/repeat
        // are correct from the very first track load. Last source +
        // track index + audio position are applied later in init().
        this.persistence = new Persistence();
        this.audio.volume = this.persistence.state.muted ? 0 : this.persistence.state.volume;
        this.shuffle = this.persistence.state.shuffle;
        this.repeat  = this.persistence.state.repeat;           // 'off' | 'one' | 'all'
        this.shuffleOrder = null;                                // lazily computed when shuffle is on

        // Sub-controllers — each owns its slice of state and DOM. The Player
        // orchestrates and holds shared concerns (tracks list, audio element).
        this.recordAnimator = new RecordAnimator(this);
        this.hashRouter = new HashRouter(this);
        this.mediaSession = new MediaSession(this);
        this.eraSelector = new EraSelector(this);

        this.init();
    }

    // Backwards-compat shims: a few code paths still read these as flat
    // properties on the player. Forward to the animator until those call
    // sites get refactored.
    get recordVisible() { return this.recordAnimator.visible; }
    get isSliding() { return this.recordAnimator.sliding; }

    async init() {
        console.log('🎵 Player application initializing...');

        this.eraSelector.init();

        await this.loadTracks();
        await this.loadPlaceholders();
        await this.preloadCoverImages();

        this.initVisualizer();
        this.mediaSession.setup();
        this.setupAudioEvents();
        this.setupEventListeners();
        this.eraSelector.setup();

        const hashLoaded = await this.hashRouter.load();

        // Two restore paths, and the hash used to swallow the other one.
        //
        // loadTrack() replaceState()s a hash on every track change, so after
        // the first load the URL *always* has one — which meant persistence
        // never ran again and the saved audio position was dead code.
        //
        // Now: the hash decides source + track (that's what a shared link
        // carries), and persistence still contributes the playback position,
        // but only when it points at the very track the hash selected. A
        // shared link to someone else's track starts at 0:00; your own reload
        // picks up where you left off.
        if (!hashLoaded && this.tracks.length > 0) {
            // Only resume a persisted Drive crate. 'local' is the default value
            // of that field and now means "no crate chosen yet", since local
            // tracks are a fallback rather than somewhere you navigate to.
            const persistedDrive = this.persistence.state.source
                && this.persistence.state.source !== 'local';

            const restored = persistedDrive ? await this.#restoreFromPersistence() : false;
            if (!restored) {
                await this.#openDefaultCrate();
            }
            this.preloadAdjacentTracks();
        } else if (hashLoaded) {
            this.#restorePositionIfSameTrack();
        }

        // Apply persisted UI state (volume slider, shuffle/repeat icons).
        this.updateVolumeUI();
        this.updateModeButtons();

        // Flush the latest position on tab close so refresh resumes near
        // where the user actually was, not whichever timeupdate tick the
        // debouncer last persisted.
        window.addEventListener('pagehide', () => this.persistence.flush());
    }

    async #restoreFromPersistence() {
        const { source, trackIndex, audioPosition } = this.persistence.state;

        // Switch to the persisted Drive folder if applicable. switchToDrive
        // lives on the era selector — call it directly rather than
        // populating the menu UI.
        if (source && source !== 'local' && this.eraSelector?.switchToDrive) {
            await this.eraSelector.switchToDrive(source);
        }

        if (trackIndex >= 0 && trackIndex < this.tracks.length) {
            this.loadTrack(trackIndex, /* autoplay */ false);
            this.#seekWhenReady(audioPosition);
            return true;
        }
        return false;
    }

    // Open the first Drive era on a cold start. The bundled local tracks stay
    // as a genuine fallback: if the proxy is down, the API key is missing or
    // there's no network, switchToDrive leaves currentSource as 'local' and we
    // play what's on disk rather than showing an empty player.
    async #openDefaultCrate() {
        const folders = this.driveSource?.getFolders?.() ?? [];

        if (folders.length) {
            await this.eraSelector.switchToDrive(folders[0].id);
            if (this.currentSource !== 'local') return;
            console.warn('Drive unavailable — falling back to the bundled local tracks.');
        }

        this.loadTrack(0);
    }

    // Apply the saved position on top of a hash-selected track, but only if
    // the hash landed on the same track we were last playing. Otherwise the
    // link came from somewhere else and should start at the beginning.
    #restorePositionIfSameTrack() {
        const { source, trackIndex, audioPosition } = this.persistence.state;
        if (source !== this.currentSource || trackIndex !== this.currentTrackIndex) return;
        this.#seekWhenReady(audioPosition);
    }

    // Audio.currentTime is only writable once enough data is loaded —
    // seekable ranges are empty before then.
    //
    // Waiting unconditionally for `canplay` isn't enough: when the file is
    // already buffered (served from cache, or preloaded into this element)
    // canplay has fired before we get here and never fires again, so the
    // listener sits there forever and the position is silently dropped.
    // Check readyState first and only fall back to the event.
    #seekWhenReady(position) {
        if (!(position > 0)) return;

        const audio = this.audio;

        // Seeking past the end of the seekable range doesn't fail — it
        // silently clamps. Early in a load the range may only cover the first
        // few seconds, so "readyState is high enough" isn't the question;
        // "does the range actually reach where we're going" is.
        const attempt = () => {
            if (!audio.seekable.length) return false;
            if (audio.seekable.end(audio.seekable.length - 1) < position) return false;
            try {
                audio.currentTime = position;
            } catch (_) {
                return false;
            }
            return Math.abs(audio.currentTime - position) < 1;
        };

        if (attempt()) return;

        // Otherwise retry as more of the file arrives.
        const onBuffer = () => { if (attempt()) cleanup(); };
        const cleanup = () => {
            clearTimeout(timer);
            audio.removeEventListener('progress', onBuffer);
            audio.removeEventListener('canplay', onBuffer);
            audio.removeEventListener('loadedmetadata', onBuffer);
            audio.removeEventListener('play', cleanup);
        };

        // Bail out if the user starts playback first — yanking them back to a
        // restored position after they've already begun listening is worse
        // than losing the position. Also time-boxed so a stalled load doesn't
        // leave listeners attached for the life of the page.
        const timer = setTimeout(cleanup, 15000);
        audio.addEventListener('progress', onBuffer);
        audio.addEventListener('canplay', onBuffer);
        audio.addEventListener('loadedmetadata', onBuffer);
        audio.addEventListener('play', cleanup, { once: true });
    }

    showLoadingState(message) {
        // Create a simple loading overlay
        let overlay = document.getElementById('drive-loading');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'drive-loading';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                color: white;
                font-size: 18px;
            `;
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<div class="drive-loading-inner">
            <svg class="drive-loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="9" opacity=".25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke-linecap="round" />
            </svg>
            <span>${message}</span>
        </div>`;
        overlay.style.display = 'flex';
    }

    hideLoadingState() {
        const overlay = document.getElementById('drive-loading');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    initVisualizer() {
        if (typeof AudioVisualizer !== 'undefined') {
            this.visualizer = new AudioVisualizer();
            // Don't connect audio yet - wait until first track loads
            // Show visualizer by default - always visible
            this.visualizer.show();
            console.log('✓ Visualizer initialized and shown');
        } else {
            console.warn('AudioVisualizer not loaded');
        }
    }

    async loadTracks() {
        try {
            const response = await fetch('data/tracks.json');
            const data = await response.json();
            this.tracks = data.tracks;
            this.localTracks = [...data.tracks]; // Store copy for switching back
            console.log(`✓ Loaded ${this.tracks.length} track(s)`);
        } catch (error) {
            console.error('Error loading tracks:', error);
        }
    }

    async loadPlaceholders() {
        try {
            const response = await fetch('data/placeholders.json');
            const data = await response.json();
            this.placeholderImages = data.images;
            console.log(`✓ Loaded ${this.placeholderImages.length} neon images`);
        } catch (error) {
            console.error('Error loading neon images:', error);
            this.placeholderImages = [];
        }
    }

    async preloadCoverImages() {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingProgressBar = document.getElementById('loading-progress-bar');
        const loadingStatus = document.getElementById('loading-status');

        if (!loadingOverlay || !loadingProgressBar || !loadingStatus) {
            console.warn('Loading overlay elements not found');
            return;
        }

        // Only tracks that actually have cover art are worth waiting on.
        // Counting the whole track list here used to make the bar sprint
        // through skipped entries and report progress for work never done.
        const covers = [...new Set(this.tracks.map((t) => t.image).filter(Boolean))];
        const totalImages = covers.length;

        if (totalImages === 0) {
            loadingOverlay.classList.add('hidden');
            setTimeout(() => loadingOverlay.remove(), 500);
            return;
        }

        let loadedImages = 0;
        console.log(`🖼️  Preloading ${totalImages} cover image(s)...`);
        loadingStatus.textContent = `Loading artwork ${loadedImages}/${totalImages}`;

        // Sequential so the progress bar reflects real work rather than
        // finishing all at once.
        for (const src of covers) {
            await new Promise((resolve) => {
                const img = new Image();

                const done = (ok) => {
                    if (ok) this.imageCache.set(src, img);
                    else console.warn(`✗ Failed to load: ${src}`);
                    loadedImages++;
                    loadingProgressBar.style.width = `${(loadedImages / totalImages) * 100}%`;
                    loadingStatus.textContent = `Loading artwork ${loadedImages}/${totalImages}`;
                    resolve();
                };

                img.onload  = () => done(true);
                img.onerror = () => done(false);
                img.src = src;
            });
        }

        console.log('✅ All cover images preloaded');

        // Hide loading overlay with fade out
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            // Remove from DOM after transition
            setTimeout(() => {
                loadingOverlay.remove();
            }, 500);
        }, 300); // Small delay to show 100% complete
    }

    setupAudioEvents() {
        // Update progress bar as audio plays
        this.audio.addEventListener('timeupdate', () => {
            const duration = this.getTrackDuration();
            if (duration > 0) {
                const progress = (this.audio.currentTime / duration) * 100;
                this.updateProgress(progress);
                this.updateTimeDisplay();
                this.mediaSession.updatePosition(duration);
                if (this.audio.currentTime > 0) {
                    this.persistence.save({ audioPosition: this.audio.currentTime });
                }
            }
        });

        // End-of-track behaviour respects repeat mode. 'one' replays the
        // current track; 'off' stops at the final track of the queue;
        // anything else advances (shuffle reshuffles when it wraps).
        this.audio.addEventListener('ended', () => {
            if (this.repeat === 'one') {
                this.audio.currentTime = 0;
                this.audio.play();
                return;
            }
            const atEnd = this.peekNextIndex() === null;
            if (atEnd && this.repeat === 'off') {
                this.pause();
                return;
            }
            this.nextTrack();
        });

        // Handle loading - set duration once
        this.audio.addEventListener('loadedmetadata', () => {
            this.updateDuration();
        });

        // Once the audio has fully buffered the proxy will also have the
        // file cached on disk, which is the precondition for art
        // extraction. Probe for embedded album art at that point — a 200
        // swaps it in, a 404 leaves the neon placeholder alone.
        this.audio.addEventListener('canplaythrough', () => {
            const track = this.tracks[this.currentTrackIndex];
            if (track) this.tryEmbeddedArt(track);
        });

        // Handle duration change - only update if we don't have a valid duration yet
        this.audio.addEventListener('durationchange', () => {
            const durationEl = document.getElementById('duration');
            // Only update if current display is 0:00 or empty
            if (durationEl && (durationEl.textContent === '0:00' || !durationEl.textContent)) {
                this.updateDuration();
            }
        });

        // Handle errors
        this.audio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            const track = this.tracks[this.currentTrackIndex];
            if (!track.audio) {
                console.log('ℹ️  No audio file linked to this track');
            }
        });

        // Handle visibility change for iOS background audio
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.isPlaying) {
                // Resume audio context if suspended
                if (this.visualizer?.audioContext?.state === 'suspended') {
                    this.visualizer.audioContext.resume();
                }
                // Sync Media Session state
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                }
            }
        });

        // iOS auto-resume: when audio gets paused by the system, try to resume
        this.audio.addEventListener('pause', () => {
            // Only auto-resume if we think we should be playing
            if (this.isPlaying && !this.audio.ended) {
                console.log('⚠️ Audio paused unexpectedly, attempting resume...');
                setTimeout(() => {
                    if (this.isPlaying && this.audio.paused && !this.audio.ended) {
                        this.audio.play().catch(e => {
                            console.log('Could not auto-resume:', e);
                        });
                        // Also resume audio context
                        if (this.visualizer?.audioContext?.state === 'suspended') {
                            this.visualizer.audioContext.resume();
                        }
                    }
                }, 100);
            }
        });
    }

    loadTrack(index, autoplay = false) {
        if (index < 0 || index >= this.tracks.length) return;

        this.currentTrackIndex = index;
        this.persistence.save({ trackIndex: index, source: this.currentSource });
        const track = this.tracks[index];

        console.log(`🎵 Loading track: ${track.title}`);

        // Stop current audio
        this.pause();

        // Artwork + palette for this track. Real cover art always wins; the
        // placeholder set is only a stand-in for files with none.
        const art = this.#resolveArtwork(track);
        this.currentArt = art;
        this.updateAlbumArt(art);
        this.updateTrackInfo(track);
        this.updateTheme(art.colors);
        this.mediaSession.updateMetadata();

        // Set duration from track data (more reliable than audio metadata for opus)
        const durationEl = document.getElementById('duration');
        if (durationEl && track.duration) {
            durationEl.textContent = track.duration;
        }

        // Load audio if available
        if (track.audio) {
            // Connect visualizer to audio on first track load
            if (this.visualizer && !this.visualizer.audioContext) {
                this.visualizer.connectAudio(this.audio);
            }

            // Check if we have a preloaded version
            if (this.preloadCache.has(track.audio)) {
                console.log('✓ Using preloaded audio');
                const preloadedAudio = this.preloadCache.get(track.audio);
                this.audio.src = preloadedAudio.src;
            } else {
                this.audio.src = track.audio;
            }
            this.audio.preload = 'auto';
            this.audio.load();
            if (autoplay) {
                this.play();
            }
        } else {
            this.audio.src = '';
            console.log('ℹ️  No audio file for this track');
        }

        this.updatePlayButton();

        // Update URL hash for sharing
        this.hashRouter.update();

        // Preload next/previous tracks
        this.preloadAdjacentTracks();
    }

    // Warm the track the user is most likely to reach next.
    //
    // Uses peekNextIndex() rather than index+1 so shuffle actually benefits —
    // preloading the sequential neighbour while shuffle sends you elsewhere
    // was pure waste. Only the *next* track is warmed: on the Drive path each
    // preload is a full server-side download through proxy.php, so
    // speculatively pulling the previous track too doubled the bandwidth for
    // a direction people rarely go.
    preloadAdjacentTracks() {
        const nextIndex = this.peekNextIndex();
        if (nextIndex !== null) this.preloadTrack(nextIndex);
    }

    preloadTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;

        const track = this.tracks[index];
        if (!track.audio) return;

        // Skip if already preloaded
        if (this.preloadCache.has(track.audio)) {
            return;
        }

        console.log(`⏳ Preloading: ${track.title}`);

        // Create a new Audio element for preloading
        const preloadAudio = new Audio();
        preloadAudio.preload = 'auto'; // Preload entire file
        preloadAudio.src = track.audio;

        // Store in cache
        this.preloadCache.set(track.audio, preloadAudio);

        // Clean up old entries if cache gets too large (keep max 3 tracks)
        if (this.preloadCache.size > 3) {
            const firstKey = this.preloadCache.keys().next().value;
            this.preloadCache.delete(firstKey);
        }

        // Log when preload is complete
        preloadAudio.addEventListener('canplaythrough', () => {
            console.log(`✓ Preloaded: ${track.title}`);
        }, { once: true });
    }

    // Resolve which image and palette a track should wear.
    //
    // A track's own embedded cover art always wins — generate-palettes.js
    // extracts it at build time and derives the palette from it, so the whole
    // UI recolours to the artwork. The neon placeholder set is the fallback
    // for files that shipped without art; picking randomly among them is
    // deliberate, so those tracks look different each visit.
    #resolveArtwork(track) {
        if (track.image) {
            return {
                cover: track.image,
                label: track.label || track.image,
                colors: track.colors,
                isPlaceholder: false,
            };
        }

        if (this.placeholderImages.length > 0) {
            const p = this.placeholderImages[Math.floor(Math.random() * this.placeholderImages.length)];
            return { cover: p.url, label: p.url, colors: p.colors, isPlaceholder: true };
        }

        return { cover: null, label: null, colors: track.colors, isPlaceholder: false };
    }

    updateAlbumArt(art) {
        if (!art?.cover) return;

        // Prefer the decoded element from the preload pass — its bytes are
        // already in memory, so swapping src paints without a flash.
        const cached = this.imageCache.get(art.cover);
        const coverSrc = cached ? cached.src : art.cover;

        const img = document.getElementById('album-art');
        if (img) {
            img.src = coverSrc;
            img.alt = art.isPlaceholder ? '' : 'Album artwork';
        }

        // The vinyl centre label gets the small derivative — it renders at
        // ~90px and shouldn't decode the full-size cover.
        const recordLabelArt = document.getElementById('record-label-art');
        if (recordLabelArt) {
            recordLabelArt.src = art.label || coverSrc;
            recordLabelArt.alt = '';
        }

        this.setBackdrop(coverSrc);
    }

    // Drive the full-viewport blurred wash behind everything. A custom
    // property beats the old injected <style> block with !important — the
    // styling stays in SCSS and there's no per-track stylesheet churn.
    setBackdrop(url) {
        document.documentElement.style.setProperty('--backdrop-image', `url("${url}")`);
    }

    // Drive tracks ship with a placeholder neon image — replace it with
    // the file's embedded cover art if one is present. The probe is the
    // proxy.php art endpoint; a 200 fires onload, a 404 fires onerror and
    // we leave the neon placeholder in place. Palette stays random by
    // design — user prefers the neon-derived colour per visit.
    tryEmbeddedArt(track) {
        if (!track.artProbe) return;

        const trackIndex = this.currentTrackIndex;
        const probe = new Image();
        probe.onload = () => {
            if (this.currentTrackIndex !== trackIndex) return;

            this.updateAlbumArt({
                cover: track.artProbe,
                label: track.artProbe,
                colors: track.colors,
                isPlaceholder: false,
            });
            console.log('✓ Embedded art swapped in');
        };
        probe.onerror = () => { /* 404 — no embedded art, neon stays */ };
        probe.src = track.artProbe;
    }

    updateTrackInfo(track) {
        const titleEl = document.getElementById('track-title');
        const artistEl = document.getElementById('track-artist');

        if (titleEl) {
            // Rebuild the title element so "(Original Mix)" / "(Club Mix)"
            // gets pushed to its own line below the title — easier to
            // read at a glance than one long string.
            titleEl.replaceChildren();
            titleEl.appendChild(document.createTextNode(track.title));
            if (track.version) {
                titleEl.appendChild(document.createElement('br'));
                const versionEl = document.createElement('span');
                versionEl.className = 'track-version';
                versionEl.textContent = `(${track.version})`;
                titleEl.appendChild(versionEl);
            }
        }
        if (artistEl) artistEl.textContent = track.artist;

        // Record-label SVG textPath can only carry one curved line, so
        // we keep the version off it.
        const recordLabelTitle = document.getElementById('record-label-title-path');
        const recordLabelArtist = document.getElementById('record-label-artist-path');
        if (recordLabelTitle) recordLabelTitle.textContent = track.title;
        if (recordLabelArtist) recordLabelArtist.textContent = track.artist;
    }

    updateTheme(colors) {
        console.log('🎨 Applying color palette:', colors);

        // Update CSS custom properties
        document.documentElement.style.setProperty('--color-primary', colors.primary);
        document.documentElement.style.setProperty('--color-secondary', colors.secondary);
        document.documentElement.style.setProperty('--color-accent', colors.accent);
        document.documentElement.style.setProperty('--color-muted', colors.muted);
        document.documentElement.style.setProperty('--color-dark', colors.dark);
        document.documentElement.style.setProperty('--color-light', colors.light);

        // The body wash is painted in SCSS from these same variables — JS sets
        // state, the stylesheet decides appearance. Assigning an inline
        // background here used to override the stylesheet's own layering.

        // Update visualizer colors
        if (this.visualizer) {
            this.visualizer.updateColors(colors);
        }
    }

    play() {
        if (this.audio.src) {
            // Resume AudioContext if suspended (required by browsers)
            if (this.visualizer && this.visualizer.audioContext && this.visualizer.audioContext.state === 'suspended') {
                this.visualizer.audioContext.resume().then(() => {
                    console.log('✓ AudioContext resumed');
                });
            }

            this.audio.play();
            this.isPlaying = true;
            this.updatePlayButton();

            // Update Media Session playback state
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }

            // Slide record out if not already visible
            if (!this.recordAnimator.visible) {
                this.recordAnimator.slideOut();
            } else {
                // If already visible, just start spinning
                this.recordAnimator.updateRotation();
            }
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updatePlayButton();

        // Update Media Session playback state
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }

        // Slide record in when pausing
        if (this.recordAnimator.visible) {
            this.recordAnimator.slideIn();
        }
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    // Position in the queue we'd land on next, honouring shuffle but not
    // repeat. Returns null at the end of the queue (caller decides what
    // to do based on repeat mode).
    peekNextIndex() {
        if (this.tracks.length === 0) return null;
        if (this.shuffle) {
            this.#ensureShuffleOrder();
            const pos = this.shuffleOrder.indexOf(this.currentTrackIndex);
            const nextPos = pos + 1;
            if (nextPos >= this.shuffleOrder.length) {
                return this.repeat === 'all' ? this.shuffleOrder[0] : null;
            }
            return this.shuffleOrder[nextPos];
        }
        const next = this.currentTrackIndex + 1;
        if (next >= this.tracks.length) {
            return this.repeat === 'all' ? 0 : null;
        }
        return next;
    }

    peekPrevIndex() {
        if (this.tracks.length === 0) return null;
        if (this.shuffle) {
            this.#ensureShuffleOrder();
            const pos = this.shuffleOrder.indexOf(this.currentTrackIndex);
            const prevPos = pos - 1;
            if (prevPos < 0) return this.shuffleOrder[this.shuffleOrder.length - 1];
            return this.shuffleOrder[prevPos];
        }
        return (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
    }

    async nextTrack() {
        const wasPlaying = this.isPlaying;
        const nextIndex = this.peekNextIndex();
        if (nextIndex === null) return; // end of queue, repeat off

        if (wasPlaying && this.recordAnimator.visible) {
            await this.recordAnimator.slideIn();
            this.loadTrack(nextIndex, wasPlaying);
            await this.recordAnimator.slideOut();
        } else {
            this.loadTrack(nextIndex, wasPlaying);
        }
    }

    async previousTrack() {
        const wasPlaying = this.isPlaying;
        const prevIndex = this.peekPrevIndex();
        if (prevIndex === null) return;

        if (wasPlaying && this.recordAnimator.visible) {
            await this.recordAnimator.slideIn();
            this.loadTrack(prevIndex, wasPlaying);
            await this.recordAnimator.slideOut();
        } else {
            this.loadTrack(prevIndex, wasPlaying);
        }
    }

    // Fisher–Yates shuffle of indices [0..tracks.length-1]. Re-computed
    // when shuffle toggles on or the source changes; persists in memory
    // only — refresh starts a new shuffle.
    #ensureShuffleOrder() {
        if (this.shuffleOrder && this.shuffleOrder.length === this.tracks.length) return;
        const order = this.tracks.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        // Pin the current track to position 0 so toggling shuffle on
        // mid-track doesn't immediately re-shuffle past where you are.
        const here = order.indexOf(this.currentTrackIndex);
        if (here > 0) [order[0], order[here]] = [order[here], order[0]];
        this.shuffleOrder = order;
    }

    toggleShuffle() {
        this.shuffle = !this.shuffle;
        this.shuffleOrder = null; // recompute on next read
        this.persistence.save({ shuffle: this.shuffle });
        this.updateModeButtons();
    }

    // Repeat cycles off → all → one → off. 'all' is the more useful
    // default state on first toggle (loop the queue), 'one' is the
    // niche state for putting a track on loop.
    toggleRepeat() {
        const order = ['off', 'all', 'one'];
        this.repeat = order[(order.indexOf(this.repeat) + 1) % order.length];
        this.persistence.save({ repeat: this.repeat });
        this.updateModeButtons();
    }

    // Reflect current shuffle/repeat state in their toolbar icons.
    updateModeButtons() {
        const shuffleBtn = document.getElementById('shuffle-btn');
        if (shuffleBtn) shuffleBtn.classList.toggle('control-btn--active', this.shuffle);

        const repeatBtn = document.getElementById('repeat-btn');
        if (repeatBtn) {
            repeatBtn.classList.toggle('control-btn--active', this.repeat !== 'off');
            repeatBtn.dataset.mode = this.repeat;
        }
    }

    setVolume(value, opts = {}) {
        const v = Math.max(0, Math.min(1, value));
        this.audio.muted = false;
        this.audio.volume = v;
        if (!opts.skipPersist) {
            this.persistence.save({ volume: v, muted: false });
        }
        this.updateVolumeUI();
    }

    toggleMute() {
        const muted = !this.audio.muted;
        this.audio.muted = muted;
        this.persistence.save({ muted });
        this.updateVolumeUI();
    }

    updateVolumeUI() {
        const slider = document.getElementById('volume-slider');
        const effectiveVolume = this.audio.muted ? 0 : this.audio.volume;
        if (slider) {
            if (document.activeElement !== slider) {
                slider.value = String(effectiveVolume);
            }
            // Drive the fill gradient via a CSS variable — the slider's
            // background uses --volume as the stop position so the
            // primary/accent fill matches the thumb live.
            slider.style.setProperty('--volume', `${effectiveVolume * 100}%`);
        }
        const speakerBtn = document.getElementById('volume-btn');
        if (speakerBtn) {
            const level = this.audio.muted || this.audio.volume === 0
                ? 'mute'
                : this.audio.volume < 0.5 ? 'low' : 'high';
            speakerBtn.dataset.level = level;
        }
    }

    seek(percent) {
        const duration = this.getTrackDuration();
        if (duration > 0) {
            this.audio.currentTime = (percent / 100) * duration;
        }
    }

    updateProgress(percent) {
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
    }

    updateTimeDisplay() {
        const currentTimeEl = document.getElementById('current-time');
        if (currentTimeEl && this.audio.currentTime) {
            currentTimeEl.textContent = formatTime(this.audio.currentTime);
        }
    }

    updateDuration() {
        const durationEl = document.getElementById('duration');
        // Only update if audio.duration is valid (not Infinity or NaN)
        if (durationEl && this.audio.duration && isFinite(this.audio.duration)) {
            durationEl.textContent = formatTime(this.audio.duration);
        }
    }

    updatePlayButton() {
        const playBtn = document.getElementById('play-btn');
        const path = playBtn?.querySelector('svg.control-icon path');
        if (!path) return;
        // Play triangle vs pause two-bars — swapping the path `d` instead
        // of rebuilding the SVG keeps focus state and avoids reflow.
        path.setAttribute(
            'd',
            this.isPlaying
                ? 'M6 4h4v16H6V4zm8 0h4v16h-4V4z'
                : 'M7 5v14l12-7L7 5z',
        );
    }


    // Get valid duration - prefer track JSON data, but fall back to audio element
    getTrackDuration() {
        const track = this.tracks[this.currentTrackIndex];

        // Try track metadata first (only if it has a real duration, not "0:00")
        if (track && track.duration) {
            const parsed = parseDuration(track.duration);
            if (parsed > 0) {
                return parsed;
            }
        }

        // Fall back to audio.duration (works for Drive tracks after loading)
        if (this.audio.duration && isFinite(this.audio.duration)) {
            return this.audio.duration;
        }

        return 0;
    }

    setupEventListeners() {
        // Play/Pause button
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => this.togglePlayPause());
        }

        // Previous button
        const prevBtn = document.getElementById('prev-btn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.previousTrack());
        }

        // Next button
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextTrack());
        }

        // Shuffle + repeat toggles.
        document.getElementById('shuffle-btn')?.addEventListener('click', () => this.toggleShuffle());
        document.getElementById('repeat-btn')?.addEventListener('click', () => this.toggleRepeat());

        // Volume — speaker button toggles mute; slider sets volume live.
        document.getElementById('volume-btn')?.addEventListener('click', () => this.toggleMute());
        const volumeSlider = document.getElementById('volume-slider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => this.setVolume(parseFloat(e.target.value)));
        }

        // Progress bar click and drag to seek
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            let isDragging = false;

            const updateProgress = (e) => {
                const rect = progressContainer.getBoundingClientRect();
                const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                this.seek(percent);
            };

            // Mouse events
            progressContainer.addEventListener('mousedown', (e) => {
                isDragging = true;
                updateProgress(e);
            });

            document.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    updateProgress(e);
                }
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
            });

            // Touch events for mobile
            progressContainer.addEventListener('touchstart', (e) => {
                isDragging = true;
                updateProgress(e);
            });

            document.addEventListener('touchmove', (e) => {
                if (isDragging) {
                    updateProgress(e);
                }
            });

            document.addEventListener('touchend', () => {
                isDragging = false;
            });
        }

        // Keyboard controls. Ignored when focus is in an input/slider so
        // dragging the volume slider with the keyboard still works.
        document.addEventListener('keydown', (e) => {
            const target = e.target;
            const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

            // Escape works even while typing — it's the way out of the era
            // menu's search box, and the generic typing guard below used to
            // swallow it there, trapping you in the popup.
            if (e.key === 'Escape') {
                const menu = document.getElementById('era-menu');
                if (menu?.classList.contains('open')) {
                    menu.classList.remove('open');
                    document.getElementById('era-btn')?.focus();
                } else if (typing) {
                    target.blur();
                }
                return;
            }

            if (typing) return;

            switch (e.key) {
                case 'ArrowRight': this.nextTrack(); break;
                case 'ArrowLeft':  this.previousTrack(); break;
                case ' ':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.setVolume(this.audio.volume + 0.05);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.setVolume(this.audio.volume - 0.05);
                    break;
                case 'm':
                case 'M':
                    this.toggleMute();
                    break;
                case 's':
                case 'S':
                    this.toggleShuffle();
                    break;
                case 'r':
                case 'R':
                    this.toggleRepeat();
                    break;
            }
        });
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
