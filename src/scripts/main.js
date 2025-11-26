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
        this.recordVisible = false; // Track if record is visible
        this.isSliding = false; // Track if record is currently sliding
        this.placeholderImages = []; // Neon images (used for all tracks)
        this.localTracks = []; // Store local tracks separately
        this.currentSource = 'local'; // 'local' or folder ID
        this.driveSource = null; // Drive integration
        this.init();
    }

    async init() {
        console.log('🎵 Player application initializing...');

        // Initialize Drive source
        this.initDriveSource();

        await this.loadTracks();
        await this.loadPlaceholders();

        // Preload all cover images before showing player
        await this.preloadCoverImages();

        // Initialize visualizer
        this.initVisualizer();

        this.setupMediaSession();
        this.setupAudioEvents();
        this.setupEventListeners();
        this.setupEraSelector();

        // Check for URL hash to load specific track
        const hashLoaded = await this.loadFromHash();

        if (!hashLoaded && this.tracks.length > 0) {
            this.loadTrack(0);
            // Start preloading adjacent tracks
            this.preloadAdjacentTracks();
        }
    }

    async loadFromHash() {
        const hash = window.location.hash.slice(1); // Remove #
        if (!hash) return false;

        const parts = hash.split('/');
        if (parts.length < 2) return false;

        const source = parts[0];
        const trackIndex = parseInt(parts[1]) - 1; // Convert to 0-based

        if (isNaN(trackIndex) || trackIndex < 0) return false;

        console.log(`🔗 Loading from hash: ${source}/${trackIndex + 1}`);

        if (source === 'local') {
            // Load local track
            if (trackIndex < this.tracks.length) {
                this.loadTrack(trackIndex);
                return true;
            }
        } else {
            // Find matching Drive folder by label
            if (this.driveSource) {
                const folder = this.driveSource.getFolders().find(f => f.label === source);
                if (folder) {
                    await this.switchToDrive(folder.id);
                    if (trackIndex < this.tracks.length) {
                        this.loadTrack(trackIndex);
                    }
                    return true;
                }
            }
        }

        return false;
    }

    updateHash() {
        let source = 'local';

        if (this.currentSource !== 'local' && this.driveSource) {
            const folder = this.driveSource.getFolders().find(f => f.id === this.currentSource);
            if (folder) {
                source = folder.label;
            }
        }

        const trackNum = this.currentTrackIndex + 1; // 1-based for URLs
        const newHash = `${source}/${trackNum}`;

        // Update URL without triggering page reload
        history.replaceState(null, '', `#${newHash}`);
    }

    initDriveSource() {
        console.log('🔧 Initializing Drive source...');
        if (typeof DriveSource !== 'undefined') {
            try {
                this.driveSource = new DriveSource();
                console.log('✓ Drive source initialized');
                console.log('📂 Folders:', this.driveSource.getFolders());
                this.populateEraMenu();
            } catch (error) {
                console.error('❌ Failed to create DriveSource:', error);
            }
        } else {
            console.error('❌ DriveSource class not found - drive.js may not have loaded');
        }
    }

    populateEraMenu() {
        console.log('🔧 Populating era menu...');
        const menu = document.getElementById('era-menu');

        if (!menu) {
            console.error('❌ Era menu element not found');
            return;
        }

        if (!this.driveSource) {
            console.error('❌ DriveSource not available');
            return;
        }

        // Add Drive folder options
        const folders = this.driveSource.getFolders();
        console.log(`📂 Adding ${folders.length} folders to menu`);

        folders.forEach(folder => {
            const btn = document.createElement('button');
            btn.className = 'era-option';
            btn.dataset.source = 'drive';
            btn.dataset.folderId = folder.id;
            btn.innerHTML = `
                <i class="las la-calendar"></i>
                <span>${folder.label}</span>
            `;
            menu.appendChild(btn);
            console.log(`  + Added: ${folder.label}`);
        });

        console.log(`✓ Era menu populated with ${folders.length} folders`);
    }

    setupEraSelector() {
        const eraBtn = document.getElementById('era-btn');
        const eraMenu = document.getElementById('era-menu');

        if (!eraBtn || !eraMenu) return;

        // Toggle menu on button click
        eraBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            eraMenu.classList.toggle('open');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!eraMenu.contains(e.target) && !eraBtn.contains(e.target)) {
                eraMenu.classList.remove('open');
            }
        });

        // Handle option selection
        eraMenu.addEventListener('click', async (e) => {
            const option = e.target.closest('.era-option');
            if (!option) return;

            const source = option.dataset.source;
            const folderId = option.dataset.folderId;

            // Update active state
            eraMenu.querySelectorAll('.era-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            // Update button label
            const label = document.getElementById('era-label');
            if (label) {
                label.textContent = option.querySelector('span').textContent;
            }

            // Close menu
            eraMenu.classList.remove('open');

            // Switch source
            if (source === 'local') {
                await this.switchToLocal();
            } else if (source === 'drive' && folderId) {
                await this.switchToDrive(folderId);
            }
        });
    }

    async switchToLocal() {
        if (this.currentSource === 'local') return;

        console.log('📂 Switching to local tracks...');
        this.currentSource = 'local';

        // Stop current playback
        this.pause();

        // Restore local tracks
        this.tracks = [...this.localTracks];

        // Reset wheel
        this.wheelRendered = false;

        if (this.tracks.length > 0) {
            this.loadTrack(0);
        }

        console.log(`✓ Loaded ${this.tracks.length} local track(s)`);
    }

    async switchToDrive(folderId) {
        if (this.currentSource === folderId) return;

        console.log(`📂 Switching to Drive folder: ${folderId}`);

        // Show loading state
        this.showLoadingState('Loading from Google Drive...');

        try {
            // Stop current playback
            this.pause();

            // Fetch tracks from Drive
            const driveTracks = await this.driveSource.fetchTracks(folderId);

            if (driveTracks.length === 0) {
                this.hideLoadingState();
                alert('No audio files found in this folder.');
                return;
            }

            this.currentSource = folderId;
            this.tracks = driveTracks;

            // Reset wheel
            this.wheelRendered = false;

            // Load first track
            this.loadTrack(0);

            console.log(`✓ Loaded ${this.tracks.length} track(s) from Drive`);

            // Show toast notification
            this.showToast(`${this.tracks.length} songs loaded`);
        } catch (error) {
            console.error('Failed to load from Drive:', error);
            alert(`Failed to load tracks: ${error.message}`);
        }

        this.hideLoadingState();
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

    setupMediaSession() {
        if (!('mediaSession' in navigator)) {
            console.warn('Media Session API not supported');
            return;
        }

        // Set up action handlers for lock screen / notification controls
        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());

        // Seekto for scrubbing
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.audio.currentTime = details.seekTime;
            }
        });

        console.log('✓ Media Session API configured');
    }

    updateMediaSessionMetadata() {
        if (!('mediaSession' in navigator)) return;

        const track = this.tracks[this.currentTrackIndex];
        if (!track) return;

        // Get artwork URL - use placeholder if available
        let artworkUrl = track.image;
        if (this.currentPlaceholder) {
            artworkUrl = this.currentPlaceholder.url;
        }

        // Make artwork URL absolute if it's relative
        if (artworkUrl && !artworkUrl.startsWith('http')) {
            artworkUrl = new URL(artworkUrl, window.location.href).href;
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: 'plyr',
            artwork: artworkUrl ? [
                { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
            ] : []
        });

        console.log('✓ Media Session metadata updated:', track.title);
    }

    setupAudioEvents() {
        // Update progress bar as audio plays
        this.audio.addEventListener('timeupdate', () => {
            const duration = this.getTrackDuration();
            if (duration > 0) {
                const progress = (this.audio.currentTime / duration) * 100;
                this.updateProgress(progress);
                this.updateTimeDisplay();

                // Update Media Session position state for lock screen scrubbing
                if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
                    try {
                        navigator.mediaSession.setPositionState({
                            duration: duration,
                            playbackRate: this.audio.playbackRate,
                            position: this.audio.currentTime
                        });
                    } catch (e) {
                        // Ignore errors from invalid state
                    }
                }
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
            this.updateMediaSessionMetadata();
        } else {
            // Fallback to original behavior if placeholders not loaded
            this.currentPlaceholder = null;
            this.updateAlbumArt(track.image);
            this.updateTrackInfo(track);
            this.updateTheme(track.colors);
            this.updateMediaSessionMetadata();
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
        this.updateHash();

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
            if (!this.recordVisible) {
                this.slideRecordOut();
            } else {
                // If already visible, just start spinning
                this.updateRecordRotation();
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
        if (this.recordVisible) {
            this.slideRecordIn();
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

        // If playing, slide in then out for visual effect
        if (wasPlaying && this.recordVisible) {
            await this.slideRecordIn();
            this.loadTrack(nextIndex, wasPlaying);
            await this.slideRecordOut();
        } else {
            // If not playing, just load the track without animation
            this.loadTrack(nextIndex, wasPlaying);
        }
    }

    async previousTrack() {
        const wasPlaying = this.isPlaying;
        const prevIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;

        // If playing, slide in then out for visual effect
        if (wasPlaying && this.recordVisible) {
            await this.slideRecordIn();
            this.loadTrack(prevIndex, wasPlaying);
            await this.slideRecordOut();
        } else {
            // If not playing, just load the track without animation
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
            currentTimeEl.textContent = this.formatTime(this.audio.currentTime);
        }
    }

    updateDuration() {
        const durationEl = document.getElementById('duration');
        // Only update if audio.duration is valid (not Infinity or NaN)
        if (durationEl && this.audio.duration && isFinite(this.audio.duration)) {
            durationEl.textContent = this.formatTime(this.audio.duration);
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

    updateRecordRotation() {
        const recordEl = document.getElementById('rotate-record');
        if (recordEl) {
            if (this.isPlaying && !this.isSliding) {
                recordEl.classList.add('playing');
            } else {
                recordEl.classList.remove('playing');
            }
        }
    }

    slideRecordOut() {
        return new Promise((resolve) => {
            const recordEl = document.getElementById('rotate-record');
            if (!recordEl) {
                resolve();
                return;
            }

            this.isSliding = true;
            this.recordVisible = true;

            // Remove any existing animation classes
            recordEl.classList.remove('slide-in', 'hidden', 'playing');

            // Add slide-out animation
            recordEl.classList.add('slide-out');

            // Wait for animation to complete
            const handleAnimationEnd = () => {
                recordEl.removeEventListener('animationend', handleAnimationEnd);
                recordEl.classList.remove('slide-out');
                recordEl.classList.add('visible');
                this.isSliding = false;

                // Start spinning if playing
                if (this.isPlaying) {
                    this.updateRecordRotation();
                }

                resolve();
            };

            recordEl.addEventListener('animationend', handleAnimationEnd);
        });
    }

    slideRecordIn() {
        return new Promise((resolve) => {
            const recordEl = document.getElementById('rotate-record');
            if (!recordEl) {
                resolve();
                return;
            }

            this.isSliding = true;

            // Stop spinning and remove visible state
            recordEl.classList.remove('playing', 'visible', 'slide-out');

            // Add slide-in animation
            recordEl.classList.add('slide-in');

            // Wait for animation to complete
            const handleAnimationEnd = () => {
                recordEl.removeEventListener('animationend', handleAnimationEnd);
                recordEl.classList.remove('slide-in');
                recordEl.classList.add('hidden');
                this.recordVisible = false;
                this.isSliding = false;
                resolve();
            };

            recordEl.addEventListener('animationend', handleAnimationEnd);
        });
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Parse duration string (e.g., "8:22") to seconds
    parseDuration(durationStr) {
        if (!durationStr) return 0;
        const parts = durationStr.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
        return 0;
    }

    // Get valid duration - prefer track JSON data, but fall back to audio element
    getTrackDuration() {
        const track = this.tracks[this.currentTrackIndex];

        // Try track metadata first (only if it has a real duration, not "0:00")
        if (track && track.duration) {
            const parsed = this.parseDuration(track.duration);
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

    // Track Wheel Methods
    renderTrackWheel() {
        const wheel = document.getElementById('track-wheel');
        if (!wheel || this.wheelRendered) return;

        wheel.innerHTML = '';

        // Match CSS: 140px desktop, 110px mobile
        this.itemHeight = window.innerWidth <= 768 ? 110 : 140;

        this.tracks.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'track-wheel-item';
            item.dataset.index = index;

            item.innerHTML = `
                <div class="track-wheel-content">
                    <div class="track-wheel-name">${track.title}</div>
                    <div class="track-wheel-artist">${track.artist}</div>
                </div>
            `;

            item.addEventListener('click', () => {
                this.selectTrack(index);
            });

            wheel.appendChild(item);
        });

        this.wheelRendered = true;
        this.wheelSelectedIndex = this.currentTrackIndex;
        this.wheelOffset = -this.currentTrackIndex * this.itemHeight;
        this.updateWheelPosition();
        console.log('✓ Track wheel rendered');
    }

    updateWheelPosition() {
        const wheel = document.getElementById('track-wheel');
        if (wheel) {
            // Apply scroll offset only - CSS handles centering
            wheel.style.transform = `translateY(${this.wheelOffset}px)`;
            this.updateWheelDepth();
        }
    }

    updateWheelDepth() {
        const items = document.querySelectorAll('.track-wheel-item');
        const centerIndex = -this.wheelOffset / this.itemHeight; // Current center position as float

        items.forEach((item) => {
            const idx = parseInt(item.dataset.index);
            const distanceFromCenter = Math.abs(idx - centerIndex);

            // Only show prev, current, next (within 1.5 of center during scroll)
            if (distanceFromCenter > 1.5) {
                item.style.opacity = '0';
                item.style.pointerEvents = 'none';
            } else {
                // Scale: center = 1.3, adjacent = 0.7
                const scale = distanceFromCenter < 0.5
                    ? 1.3
                    : 1.3 - (distanceFromCenter * 0.6);

                // Opacity: center = 1, adjacent = 0.4
                const opacity = distanceFromCenter < 0.5
                    ? 1
                    : 1 - (distanceFromCenter * 0.6);

                item.style.transform = `scale(${Math.max(0.7, scale)})`;
                item.style.opacity = Math.max(0.4, opacity);
                item.style.pointerEvents = 'auto';
            }

            // Mark as active (currently playing)
            if (idx === this.currentTrackIndex) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    setupWheelScroll() {
        const overlay = document.getElementById('track-wheel-overlay');
        if (!overlay || this.wheelScrollSetup) return;

        let scrollTimeout;
        let touchStartY = 0;
        let touchLastY = 0;
        let velocity = 0;

        // Mouse wheel scrolling
        overlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.isSnapping = false;
            this.scrollWheel(e.deltaY * 0.15);

            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => this.snapWheel(), 200);
        }, { passive: false });

        // Touch start
        overlay.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
            touchLastY = touchStartY;
            velocity = 0;
        }, { passive: true });

        // Touch move
        overlay.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.isSnapping = false;
            const touchY = e.touches[0].clientY;
            const deltaY = touchLastY - touchY;
            velocity = deltaY;
            touchLastY = touchY;

            this.scrollWheel(deltaY * 0.5);
        }, { passive: false });

        // Touch end
        overlay.addEventListener('touchend', () => {
            // Add momentum
            if (Math.abs(velocity) > 5) {
                this.scrollWheel(velocity * 0.8);
            }

            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => this.snapWheel(), 200);
        }, { passive: true });

        this.wheelScrollSetup = true;
    }

    scrollWheel(delta) {
        this.wheelOffset -= delta;

        // Clamp to valid range
        const maxOffset = 0;
        const minOffset = -(this.tracks.length - 1) * this.itemHeight;
        this.wheelOffset = Math.max(minOffset, Math.min(maxOffset, this.wheelOffset));

        this.updateWheelPosition();
    }

    snapWheel() {
        // Find nearest snap point
        const nearestIndex = Math.round(-this.wheelOffset / this.itemHeight);
        const clampedIndex = Math.max(0, Math.min(this.tracks.length - 1, nearestIndex));

        const targetOffset = -clampedIndex * this.itemHeight;

        // Animate to snap position
        this.isSnapping = true;
        const wheel = document.getElementById('track-wheel');
        if (wheel) {
            wheel.classList.add('snapping');
        }

        this.wheelOffset = targetOffset;
        this.wheelSelectedIndex = clampedIndex;
        this.updateWheelPosition();

        // Remove snapping class after animation
        setTimeout(() => {
            if (wheel) {
                wheel.classList.remove('snapping');
            }
            this.isSnapping = false;
        }, 400);
    }

    openTrackWheel() {
        const overlay = document.getElementById('track-wheel-overlay');
        if (overlay) {
            this.renderTrackWheel();
            this.setupWheelScroll();
            // Reset to current track
            this.wheelOffset = -this.currentTrackIndex * this.itemHeight;
            this.wheelSelectedIndex = this.currentTrackIndex;
            this.updateWheelPosition();
            overlay.classList.add('open');
            console.log('🎰 Track wheel opened');
        }
    }

    closeTrackWheel() {
        const overlay = document.getElementById('track-wheel-overlay');
        if (overlay) {
            overlay.classList.remove('open');
            console.log('🎰 Track wheel closed');
        }
    }

    toggleTrackWheel() {
        const overlay = document.getElementById('track-wheel-overlay');
        if (overlay && overlay.classList.contains('open')) {
            this.closeTrackWheel();
        } else {
            this.openTrackWheel();
        }
    }

    async selectTrack(index) {
        this.closeTrackWheel();

        const wasPlaying = this.isPlaying;

        // If playing, slide in then out for visual effect (like next/prev)
        if (wasPlaying && this.recordVisible) {
            await this.slideRecordIn();
            this.loadTrack(index, true);
            this.updateActiveTrack();
            await this.slideRecordOut();
        } else {
            // If not playing, just load and autoplay
            this.loadTrack(index, true);
            this.updateActiveTrack();
        }
    }

    updateActiveTrack() {
        const items = document.querySelectorAll('.track-item');
        items.forEach((item) => {
            const idx = parseInt(item.dataset.index);
            if (idx === this.currentTrackIndex) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
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
            libraryBtn.addEventListener('click', () => this.toggleTrackWheel());
        }

        // Wheel close button
        const wheelClose = document.getElementById('wheel-close');
        if (wheelClose) {
            wheelClose.addEventListener('click', () => this.closeTrackWheel());
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
                this.closeTrackWheel();
            }
        });
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
