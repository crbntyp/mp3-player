import '../styles/main.scss';
import { AudioVisualizer } from './visualizer.js';
import { HashRouter } from './hash-router.js';
import { MediaSession } from './media-session.js';
import { RecordAnimator } from './record-animator.js';
import { TrackWheel } from './track-wheel.js';
import { EraSelector } from './era-selector.js';
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

        // Sub-controllers — each owns its slice of state and DOM. The Player
        // orchestrates and holds shared concerns (tracks list, audio element).
        this.recordAnimator = new RecordAnimator(this);
        this.hashRouter = new HashRouter(this);
        this.mediaSession = new MediaSession(this);
        this.trackWheel = new TrackWheel(this);
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

        if (!hashLoaded && this.tracks.length > 0) {
            this.loadTrack(0);
            // Start preloading adjacent tracks
            this.preloadAdjacentTracks();
        }
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
            }
        });

        // Auto-advance to next track
        this.audio.addEventListener('ended', () => {
            this.nextTrack();
        });

        // Handle loading - set duration once
        this.audio.addEventListener('loadedmetadata', () => {
            this.updateDuration();
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

    updateTrackInfo(track) {
        const titleEl = document.getElementById('track-title');
        const artistEl = document.getElementById('track-artist');

        if (titleEl) titleEl.textContent = track.title;
        if (artistEl) artistEl.textContent = track.artist;

        // Update record label text
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

    async nextTrack() {
        const wasPlaying = this.isPlaying;
        const nextIndex = (this.currentTrackIndex + 1) % this.tracks.length;

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
        const prevIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;

        if (wasPlaying && this.recordAnimator.visible) {
            await this.recordAnimator.slideIn();
            this.loadTrack(prevIndex, wasPlaying);
            await this.recordAnimator.slideOut();
        } else {
            this.loadTrack(prevIndex, wasPlaying);
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
        const playIcon = playBtn?.querySelector('i');
        if (playIcon) {
            if (this.isPlaying) {
                playIcon.className = 'las la-pause text-white text-3xl';
            } else {
                playIcon.className = 'las la-play text-white text-3xl';
            }
        }
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

        // Library button
        const libraryBtn = document.getElementById('library-btn');
        if (libraryBtn) {
            libraryBtn.addEventListener('click', () => this.trackWheel.toggle());
        }

        // Wheel close button
        const wheelClose = document.getElementById('wheel-close');
        if (wheelClose) {
            wheelClose.addEventListener('click', () => this.trackWheel.close());
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

        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') this.nextTrack();
            if (e.key === 'ArrowLeft') this.previousTrack();
            if (e.key === ' ') {
                e.preventDefault();
                this.togglePlayPause();
            }
            if (e.key === 'Escape') {
                this.trackWheel.close();
            }
        });
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
