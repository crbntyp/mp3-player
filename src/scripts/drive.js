// Google Drive Integration for plyr
export class DriveSource {
    constructor() {
        this.API_KEY = 'AIzaSyAghiQd7JdtMk0x9iWzdbYZsAihcK8Pvb4';
        this.API_BASE = 'https://www.googleapis.com/drive/v3';

        // Folder configuration
        this.folders = [
            { id: '1YiPSorLbLyYQ0yhDctUPvuldy5AuBO7N', label: '1993-97', years: '1993-97' },
            { id: '1jG4ecT8-rYbzAtjtODdsQJGZk-py8Xkp', label: '1998', years: '1998' },
            { id: '1bxnKmycwXKgpq4cszhDCrin_GWrNiAgL', label: '1999', years: '1999' },
            { id: '1IE0SIW5g2ASNW9alhjPY1vVSjQ1j_MZV', label: '2000', years: '2000' },
            { id: '1ns2mhWgCZ7lJ_ZN23JfHlLhcljkJYiG5', label: '2001-04', years: '2001-04' }
        ];

        this.currentFolder = null;
        this.cachedTracks = new Map(); // Cache tracks per folder
    }

    /**
     * Get list of available folders/eras
     */
    getFolders() {
        return this.folders;
    }

    /**
     * Fetch audio files from a Google Drive folder
     * @param {string} folderId - Google Drive folder ID
     * @returns {Promise<Array>} - Array of track objects
     */
    async fetchTracks(folderId) {
        // Check cache first
        if (this.cachedTracks.has(folderId)) {
            console.log('✓ Using cached tracks for folder');
            return this.cachedTracks.get(folderId);
        }

        console.log(`📂 Fetching tracks from Drive folder: ${folderId}`);

        try {
            // Query for audio files in the folder
            const query = `'${folderId}' in parents and (mimeType contains 'audio/')`;
            const fields = 'files(id,name,mimeType,size,webContentLink)';

            const url = `${this.API_BASE}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&key=${this.API_KEY}&pageSize=100`;

            const response = await fetch(url);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Failed to fetch from Drive');
            }

            const data = await response.json();

            if (!data.files || data.files.length === 0) {
                console.warn('No audio files found in folder');
                return [];
            }

            console.log(`✓ Found ${data.files.length} audio file(s)`);

            // Transform Drive files to track format
            const tracks = data.files.map((file, index) => this.fileToTrack(file, index));

            // Cache the results
            this.cachedTracks.set(folderId, tracks);

            return tracks;
        } catch (error) {
            console.error('Drive API error:', error);
            throw error;
        }
    }

    /**
     * Convert a Drive file to a track object
     * @param {Object} file - Google Drive file object
     * @param {number} index - Track index
     * @returns {Object} - Track object compatible with Player
     */
    fileToTrack(file, index) {
        // Parse filename for metadata
        // Expected formats: "Artist - Title.mp3" or just "Title.mp3"
        const metadata = this.parseFilename(file.name);

        // Use proxy to bypass CORS and cache files on server
        const audioUrl = `proxy.php?id=${file.id}`;
        console.log(`✓ Using proxy for: ${file.name}`);

        // Generate random colors from a nice palette
        const colors = this.generateColors();

        return {
            id: index + 1,
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album || 'Google Drive',
            duration: '0:00', // Will be updated when audio loads
            image: null, // Will use placeholder images
            audio: audioUrl,
            colors: colors,
            driveId: file.id,
            fileName: file.name
        };
    }

    /**
     * Parse filename to extract artist and title
     * @param {string} filename - Original filename
     * @returns {Object} - { artist, title, album }
     */
    parseFilename(filename) {
        // Remove file extension
        let name = filename.replace(/\.(mp3|wav|flac|ogg|opus|m4a|aac)$/i, '');

        // Try to parse "Artist - Title" format
        const separators = [' - ', ' – ', ' — ', ' _ '];

        for (const sep of separators) {
            if (name.includes(sep)) {
                const parts = name.split(sep);
                if (parts.length >= 2) {
                    return {
                        artist: parts[0].trim(),
                        title: parts.slice(1).join(sep).trim(),
                        album: null
                    };
                }
            }
        }

        // If no separator found, use filename as title
        return {
            artist: 'Unknown Artist',
            title: name.trim(),
            album: null
        };
    }

    /**
     * Generate a random color palette
     * @returns {Object} - Color palette object
     */
    generateColors() {
        // Predefined color palettes that look good
        const palettes = [
            { primary: '#ff6b6b', secondary: '#4ecdc4', accent: '#ffe66d', muted: '#95a5a6', dark: '#2c3e50', light: '#ecf0f1' },
            { primary: '#a855f7', secondary: '#6366f1', accent: '#ec4899', muted: '#8b5cf6', dark: '#1e1b4b', light: '#e0e7ff' },
            { primary: '#22c55e', secondary: '#14b8a6', accent: '#84cc16', muted: '#10b981', dark: '#064e3b', light: '#d1fae5' },
            { primary: '#f97316', secondary: '#ef4444', accent: '#fbbf24', muted: '#fb923c', dark: '#7c2d12', light: '#ffedd5' },
            { primary: '#3b82f6', secondary: '#8b5cf6', accent: '#06b6d4', muted: '#60a5fa', dark: '#1e3a8a', light: '#dbeafe' },
            { primary: '#ec4899', secondary: '#f43f5e', accent: '#f472b6', muted: '#db2777', dark: '#831843', light: '#fce7f3' },
            { primary: '#14b8a6', secondary: '#0891b2', accent: '#2dd4bf', muted: '#0d9488', dark: '#134e4a', light: '#ccfbf1' },
            { primary: '#f59e0b', secondary: '#d97706', accent: '#fbbf24', muted: '#b45309', dark: '#78350f', light: '#fef3c7' }
        ];

        return palettes[Math.floor(Math.random() * palettes.length)];
    }

    /**
     * Clear the track cache
     */
    clearCache() {
        this.cachedTracks.clear();
    }
}

