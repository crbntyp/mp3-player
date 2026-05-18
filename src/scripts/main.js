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

        // No URL hash → fall back to persisted state. If the persisted
        // source is a Drive folder, switch to it first; otherwise stay
        // on local. Then resume the persisted track index + position.
        if (!hashLoaded && this.tracks.length > 0) {
            const restored = await this.#restoreFromPersistence();
            if (!restored) {
                this.loadTrack(0);
            }
            this.preloadAdjacentTracks();
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

            if (audioPosition > 0) {
                // Audio.currentTime is only writable after enough data is
                // loaded — seekable ranges are empty before then. Wait
                // for one canplay event, then jump.
                const onCanPlay = () => {
                    try {
                        this.audio.currentTime = audioPosition;
                    } catch (_) { /* range not seekable yet — give up */ }
                    this.audio.removeEventListener('canplay', onCanPlay);
                };
                this.audio.addEventListener('canplay', onCanPlay);
            }
            return true;
        }
        return false;
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
        overlay.innerHTML = `<div style="text-align: center;">
            <i class="las la-spinner la-spin" style="font-size: 48px; display: block; margin-bottom: 16px;"></i>
            ${message}
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

        const totalImages = this.tracks.length;
        let loadedImages = 0;

        console.log(`🖼️  Preloading ${totalImages} cover image(s)...`);

        // Update initial status
        loadingStatus.textContent = `Loading cover images... ${loadedImages}/${totalImages}`;

        // Load images sequentially (one at a time) for visible progress
        for (const track of this.tracks) {
            if (!track.image) {
                // Skip if no image
                loadedImages++;
                const progress = (loadedImages / totalImages) * 100;
                loadingProgressBar.style.width = `${progress}%`;
                loadingStatus.textContent = `Loading cover images... ${loadedImages}/${totalImages}`;
                continue;
            }

            // Load image and wait for it to complete
            await new Promise((resolve) => {
                const img = new Image();

                img.onload = () => {
                    // Store the loaded image in cache
                    this.imageCache.set(track.image, img);

                    loadedImages++;
                    const progress = (loadedImages / totalImages) * 100;
                    loadingProgressBar.style.width = `${progress}%`;
                    loadingStatus.textContent = `Loading cover images... ${loadedImages}/${totalImages}`;
                    console.log(`✓ Loaded: ${track.image} (${loadedImages}/${totalImages})`);
                    resolve();
                };

                img.onerror = () => {
                    loadedImages++;
                    const progress = (loadedImages / totalImages) * 100;
                    loadingProgressBar.style.width = `${progress}%`;
                    loadingStatus.textContent = `Loading cover images... ${loadedImages}/${totalImages}`;
                    console.warn(`✗ Failed to load: ${track.image}`);
                    resolve(); // Continue even if image fails
                };

                img.src = track.image;
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

        // Always use random neon image for all tracks
        if (this.placeholderImages.length > 0) {
            const randomIndex = Math.floor(Math.random() * this.placeholderImages.length);
            const placeholder = this.placeholderImages[randomIndex];
            this.currentPlaceholder = placeholder; // Store for updateAlbumArt

            // Update UI with neon image and its colors
            this.updateAlbumArt(null); // Pass null to force placeholder usage
            this.updateTrackInfo(track);
            this.updateTheme(placeholder.colors);
            this.mediaSession.updateMetadata();
        } else {
            // Fallback to original behavior if placeholders not loaded
            this.currentPlaceholder = null;
            this.updateAlbumArt(track.image);
            this.updateTrackInfo(track);
            this.updateTheme(track.colors);
            this.mediaSession.updateMetadata();
        }

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

    preloadAdjacentTracks() {
        // Preload next track
        const nextIndex = (this.currentTrackIndex + 1) % this.tracks.length;
        this.preloadTrack(nextIndex);

        // Preload previous track
        const prevIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
        this.preloadTrack(prevIndex);
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

    updateAlbumArt(imageSrc) {
        // Always use neon image from currentPlaceholder (set in loadTrack)
        let imageUrl = imageSrc;
        if (!imageUrl && this.currentPlaceholder) {
            imageUrl = this.currentPlaceholder.url;
        }

        const img = document.getElementById('album-art');
        if (img) {
            // Check if we have this image cached
            if (this.imageCache.has(imageSrc)) {
                console.log('✓ Using cached image');
                const cachedImg = this.imageCache.get(imageSrc);
                // Use the cached image's src which is already loaded
                img.src = cachedImg.src;
            } else {
                // Fall back to regular loading
                img.src = imageUrl;
            }
            img.alt = 'Album Art';
        }

        // Update record label art
        const recordLabelArt = document.getElementById('record-label-art');
        if (recordLabelArt) {
            if (this.imageCache.has(imageSrc)) {
                const cachedImg = this.imageCache.get(imageSrc);
                recordLabelArt.src = cachedImg.src;
            } else {
                recordLabelArt.src = imageUrl;
            }
            recordLabelArt.alt = 'Album Art';
        }

        // Set body background to blurred, faded album art
        // Create or update style element for ::before pseudo-element
        let styleEl = document.getElementById('body-bg-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'body-bg-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = `
            body::before {
                background-image: url(${imageUrl}) !important;
            }
        `;
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

            const albumImg = document.getElementById('album-art');
            const recordLabelArt = document.getElementById('record-label-art');
            if (albumImg) albumImg.src = track.artProbe;
            if (recordLabelArt) recordLabelArt.src = track.artProbe;

            const styleEl = document.getElementById('body-bg-style');
            if (styleEl) {
                styleEl.textContent = `body::before { background-image: url(${track.artProbe}) !important; }`;
            }
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

        // Update body background with gradient using palette colors
        document.body.style.background = `linear-gradient(135deg, ${colors.dark} 0%, ${colors.secondary} 50%, ${colors.dark} 100%)`;
        document.body.style.transition = 'background 0.5s ease, background-image 0.5s ease';

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
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

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
                case 'Escape':
                    document.getElementById('era-menu')?.classList.remove('open');
                    break;
            }
        });
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
