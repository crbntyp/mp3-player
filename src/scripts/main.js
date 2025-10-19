// Player Application
class Player {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.audio = new Audio();
        this.isPlaying = false;
        this.preloadCache = new Map(); // Cache for preloaded audio elements
        this.imageCache = new Map(); // Cache for preloaded images
        this.visualizer = null; // Audio visualizer instance
        this.init();
    }

    async init() {
        console.log('🎵 Player application initializing...');
        await this.loadTracks();

        // Preload all cover images before showing player
        await this.preloadCoverImages();

        // Initialize visualizer
        this.initVisualizer();

        this.setupAudioEvents();
        this.setupEventListeners();
        if (this.tracks.length > 0) {
            this.loadTrack(0);
            // Start preloading adjacent tracks
            this.preloadAdjacentTracks();
        }
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
            console.log(`✓ Loaded ${this.tracks.length} track(s)`);
        } catch (error) {
            console.error('Error loading tracks:', error);
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
            if (this.audio.duration) {
                const progress = (this.audio.currentTime / this.audio.duration) * 100;
                this.updateProgress(progress);
                this.updateTimeDisplay();
            }
        });

        // Auto-advance to next track
        this.audio.addEventListener('ended', () => {
            this.nextTrack();
        });

        // Handle loading
        this.audio.addEventListener('loadedmetadata', () => {
            this.updateDuration();
        });

        // Handle errors
        this.audio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            const track = this.tracks[this.currentTrackIndex];
            if (!track.audio) {
                console.log('ℹ️  No audio file linked to this track');
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

        // Update UI
        this.updateAlbumArt(track.image);
        this.updateTrackInfo(track);
        this.updateTheme(track.colors);

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
        // Use placeholder if no image provided
        const imageUrl = imageSrc || 'https://placehold.co/1024x1024/000000/FFF?text=No+Cover+Image';

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
            this.updateRecordRotation();
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updatePlayButton();
        this.updateRecordRotation();
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    nextTrack() {
        const nextIndex = (this.currentTrackIndex + 1) % this.tracks.length;
        this.loadTrack(nextIndex, this.isPlaying);
    }

    previousTrack() {
        const prevIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
        this.loadTrack(prevIndex, this.isPlaying);
    }

    seek(percent) {
        if (this.audio.duration) {
            this.audio.currentTime = (percent / 100) * this.audio.duration;
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
        if (durationEl && this.audio.duration) {
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
            if (this.isPlaying) {
                recordEl.classList.add('playing');
            } else {
                recordEl.classList.remove('playing');
            }
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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
        });
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
