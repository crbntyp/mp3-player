# Context: MP3 Player Web Application

## Project Overview

A classic-style web-based MP3 player with vinyl record aesthetics and real-time audio visualization. Built with vanilla JavaScript, SCSS, and HTML, this application provides a nostalgic music playback experience with modern web technologies.

**Author:** Jonny Pyper / Carbontype
**License:** ISC

## Context File Maintenance

**IMPORTANT:** This context.md file must be kept up to date with all changes made to the project.

### Maintenance Protocol
- **When:** After every commit to the repository
- **What:** Review and update this context.md file to reflect:
  - New features or functionality added
  - Changes to existing components or architecture
  - Updates to dependencies or build tools
  - Modifications to data structures or APIs
  - Changes to development workflow or scripts
  - New performance optimizations or design decisions
  - Updates to file structure or organization

### Responsibility
This is a functional task for AI assistants working on this codebase. Before completing any work session where commits are made, ensure this context file accurately reflects the current state of the application.

### Purpose
Keeping this file current ensures:
- Accurate onboarding for new developers
- Clear documentation of architectural decisions
- Historical record of project evolution
- Reliable reference for AI assistants in future sessions

## Core Features

- Audio playback with play/pause, next/previous track controls
- Vinyl record slide-out animation on first play (cubic-bezier easing)
- Vinyl record rotation animation synchronized with playback
- Vinyl record slide in/out transitions during track changes and pause
- Vinyl record center label with album artwork
- Curved text around record label showing track title and artist (SVG textPath)
- Real-time audio visualizer (pulse/waveform style)
- Dynamic color palettes automatically generated from album artwork
- Smooth loading experience with progress tracking
- Responsive design (desktop and mobile)
- Keyboard controls (Space, Arrow Left/Right)
- Audio preloading for seamless track transitions
- Image caching for instant UI updates
- Opus audio format for optimized web delivery (67.4% size reduction)

## Technology Stack

### Frontend
- **HTML5** - Semantic markup with canvas-based visualizer
- **SCSS** - CSS preprocessor with modular styling
- **Vanilla JavaScript** - No framework dependencies
- **Web Audio API** - Audio analysis and visualization
- **Canvas API** - Real-time waveform rendering

### Build Tools
- **Sass** - SCSS compilation
- **Sharp** - Image optimization
- **FFmpeg** - Audio transcoding to Opus format
- **Node Vibrant** - Color palette extraction from images
- **music-metadata** - ID3 tag parsing
- **Chokidar** - File system watching for development
- **Live Server** - Development server with live reload
- **Concurrently** - Parallel task execution
- **cpx** - File copying for build pipeline

### Icons & Fonts
- **Inline SVG icons** - crbntyp style: stroke-based, `currentColor`, no icon
  font. Line Awesome was removed (it cost ~90KB of CSS and 1.27MB of font
  files to render four glyphs).
- **Space Mono** (Google Fonts) - Body typeface
- **Britanica** (self-hosted, weight 800 only) - The crbntyp credit logo

## Project Structure

```
player/
├── src/                          # Source files
│   ├── data/
│   │   └── tracks.json          # Track metadata and color palettes
│   ├── img/                     # Album artwork (extracted from MP3s)
│   ├── music/                   # Source MP3 files
│   ├── scripts/
│   │   ├── main.js             # Player class (core application)
│   │   └── visualizer.js       # AudioVisualizer class
│   ├── styles/
│   │   ├── main.scss           # Main stylesheet
│   │   └── vendor/line-awesome/ # Icon library styles
│   └── index.html              # Main HTML file
├── dist/                         # Build output (generated)
│   ├── music/                   # Optimized Opus audio files
│   ├── img/                     # Optimized album artwork
│   ├── styles/                  # Compiled CSS
│   ├── scripts/                 # Copied JavaScript
│   └── data/                    # Track metadata
├── scripts/                      # Build scripts
│   ├── generate-palettes.js    # Extract metadata and generate palettes
│   ├── optimize-images.js      # Image optimization with Sharp
│   ├── optimize-music.js       # MP3 to Opus conversion
│   └── watch-music.js          # File watcher for music files
└── package.json                 # Dependencies and scripts
```

## Key Components

### 1. Player Class (`src/scripts/main.js`)

The main application controller that manages:

- **Track Management**
  - Loading tracks from `tracks.json`
  - Track navigation (next/previous)
  - Current track state

- **Audio Playback**
  - Web Audio API integration
  - Play/pause/seek functionality
  - Auto-advance to next track
  - Preloading adjacent tracks (LRU cache with max 3 tracks)

- **UI Updates**
  - Album art display (with image caching)
  - Track information (title, artist)
  - Progress bar and time display
  - Play button icon state
  - Vinyl record slide and rotation animations

- **Record Animation System**
  - Hidden behind album art on load
  - Slide-out animation on first play (cubic-bezier 0.8s easing with bounce)
  - Slide-in animation when pausing playback (0.6s)
  - Slide-out animation when resuming playback
  - Slide-in/out transitions during track changes (only when playing)
  - Rotation animation synchronized with playback state (3s linear infinite)
  - Animation pausing during slide transitions (stops spinning while sliding)
  - State tracking for visibility and slide status
  - CSS variables for responsive positioning (desktop: 200px/32px, mobile: 90px/25px)

- **Record Label Design**
  - Circular label (120px desktop, 75px mobile) with radial gradient background
  - Album artwork displayed in center (115px desktop, 62px mobile)
  - SVG curved text wrapping around label edges
  - Track title curved along top (8px font, uppercase, bold)
  - Artist name curved along bottom (8px font, uppercase, medium weight)
  - Text and artwork rotate with vinyl record
  - Dynamic color updates when tracks change

- **Theme Management**
  - Dynamic CSS custom properties
  - Color palette application
  - Background image with blur effect
  - Gradient overlays

- **Loading Experience**
  - Sequential cover image preloading
  - Progress bar and status updates
  - Fade-out animation on completion

- **Event Handling**
  - Mouse/touch events for seeking
  - Keyboard controls (Space, Arrow keys)
  - Audio events (timeupdate, ended, error)

### 2. AudioVisualizer Class (`src/scripts/visualizer.js`)

Manages real-time audio visualization:

- **Audio Analysis**
  - Web Audio API AnalyserNode
  - Frequency data analysis (FFT size: 512)
  - Smoothing for visual continuity

- **Rendering**
  - Canvas 2D rendering with device pixel ratio support
  - Pulse/waveform animation (heart rate monitor style)
  - Multiple lines for trail effect
  - Dynamic gradients based on color palette
  - Glow effects with shadow blur

- **State Management**
  - Waveform history buffer (last 100 frames)
  - Idle pulse animation when no audio playing
  - Show/hide transitions
  - Automatic AudioContext resume for browser policies

- **Performance**
  - RequestAnimationFrame for smooth 60fps rendering
  - Responsive canvas resizing
  - Efficient data sampling (32 points from frequency data)

### 3. Tracks Data Structure (`src/data/tracks.json`)

Generated by `scripts/generate-palettes.js` — never edited by hand.

`image` is the 720px cover and `label` the 240px vinyl-label derivative. Both
are `null` when the source file carried no artwork and no drop-in was
supplied, which is the player's signal to fall back to a neon placeholder.

```json
{
  "tracks": [
    {
      "id": 1,
      "title": "Track Title",
      "artist": "Artist Name",
      "album": "Album Name",
      "duration": "4:54",
      "image": "img/covers/track-slug.webp",
      "label": "img/covers/track-slug-label.webp",
      "audio": "music/track-slug.opus",
      "colors": {
        "primary": "#62b79f",
        "secondary": "#14646c",
        "accent": "#cadaaf",
        "muted": "#599386",
        "dark": "#28595d",
        "light": "#536830"
      }
    }
  ]
}
```

## Build Pipeline

### Automated Palette Generation (`scripts/generate-palettes.js`)

1. Scans `src/music/` for audio files (MP3, M4A, WAV, OGG, FLAC)
2. Extracts ID3 metadata (title, artist, album, duration) via music-metadata
3. Resolves artwork, drop-in first:
   - `src/covers/<slug>.(jpg|jpeg|png|webp)` — hand-supplied, wins if present
   - otherwise the file's own embedded picture
   - otherwise none, and the player falls back to a placeholder at runtime
4. Writes two WebP derivatives to `public/img/covers/`: a 720px cover and a
   240px vinyl-label version
5. Generates a colour palette from that artwork using Vibrant
6. Creates `tracks.json` with all metadata, artwork paths and palettes
7. Names audio paths from the shared slug in `scripts/lib/slug.js`, the same
   helper `optimize-music.js` uses — so the two cannot disagree about a
   track's filename, and URLs need no escaping

**Color Palette Extraction:**
- Primary: Vibrant color
- Secondary: Dark Vibrant
- Accent: Light Vibrant
- Muted: Muted color
- Dark: Dark Muted
- Light: Light Muted

### Audio Optimization (`scripts/optimize-music.js`)

1. Reads MP3 files from `src/music/`
2. Converts to Opus format using FFmpeg
3. Configuration:
   - Codec: libopus
   - Bitrate: 128kbps
   - Channels: 2 (stereo)
   - Sample rate: 48kHz
4. Outputs ONLY `.opus` files to `public/music/`, slug-named (MP3s are never
   copied to dist)
5. Passes `-vn` so the embedded cover isn't muxed into the Opus stream — the
   artwork is already extracted to a sized WebP by generate-palettes.js
6. Reports file size reduction statistics

**Important:** Source MP3 files remain in `src/music/` only. The `dist/music/` directory contains exclusively Opus-encoded files for web delivery. This ensures optimal performance and smaller bundle sizes.

**Benefits of Opus:**
- Better compression than MP3
- Smaller file sizes (typically 30-50% reduction)
- Optimized for web streaming
- Superior quality at lower bitrates

### Fallback Sleeves (`scripts/generate-sleeves.mjs` + `scripts/build-sleeves.js`)

Tracks with no artwork wear a sleeve from a generated set rather than a stock
photo. Two steps, the first run rarely:

1. `generate-sleeves.mjs` — one-off, costs credits. Calls `gpt-image-2` through
   the shared Kie CLI (`_tools/kie/kie.mjs raw`, because the `image` command
   requires a `vendor/model` id and this model has none). Masters land in
   `_sleeves/`, which is gitignored.
2. `build-sleeves.js` (`npm run build-sleeves`) — resizes masters to 1024px
   JPEG in `public/img/placeholders/`, extracts each one's palette with
   Vibrant, and writes `src/data/placeholders.json`.

The shipped JPEGs and `placeholders.json` are committed, so an ordinary build
never regenerates anything.

This replaced `fetch-placeholders.js`, which pulled Pexels stairwell photography
and ran `modulate({ brightness: 0.85, saturation: 0.85 })` over it to force a
monochrome look — the reason the fallback set read as dead next to real cover
art, and why palettes derived from it came out grey. That script is deleted;
do not reintroduce a desaturation pass.

**Never use Higgsfield for generation.** Kie has no Midjourney endpoint despite
the `mj` command in the CLI.

### Image Optimization (`scripts/optimize-images.js`)

Uses Sharp to convert any loose images in `src/img/` to optimized JPEG in
`public/img/`. Cover art does not go through here — `generate-palettes.js`
sizes and encodes covers itself, straight from the audio file's tags.

## Development Workflow

### Development Server

```bash
npm run dev
```

Runs concurrently:
- SCSS compilation with watch mode
- HTML file copying with watch mode
- JavaScript file copying with watch mode
- Image optimization with watch mode
- Music transcoding with watch mode
- Data file copying with watch mode
- Live server on `http://localhost:8080`

### Production Build

```bash
npm run build
```

Executes in sequence:
1. `generate-palettes` - Extract metadata and colors
2. `build:scss` - Compile SCSS to CSS
3. `build:html` - Copy HTML files
4. `build:js` - Copy JavaScript files
5. `build:img` - Optimize images
6. `build:music` - Convert to Opus format
7. `build:data` - Copy JSON data
8. `build:fonts` - Copy Line Awesome fonts

## Data Flow

### Application Initialization

1. DOM loads → Player class instantiates
2. Load `tracks.json` via fetch
3. Preload all cover images sequentially (with progress UI)
4. Initialize AudioVisualizer
5. Load first track (without autoplay)
6. Preload adjacent tracks (next and previous)
7. Hide loading overlay with fade animation

### Track Playback Flow

1. User clicks play/next/previous
2. Player pauses current audio
3. Update UI elements:
   - Album art (from image cache if available)
   - Track info (title, artist)
   - Color palette (CSS custom properties)
   - Background gradient and blurred image
4. Load new audio source
5. Connect visualizer to audio (on first play)
6. Start playback if autoplay enabled
7. Preload adjacent tracks in background
8. Manage preload cache (max 3 tracks, LRU eviction)

### Visualization Flow

1. AudioContext analyzes audio in real-time
2. AnalyserNode provides frequency data
3. Visualizer samples 32 points from frequency data
4. Waveform stored in history buffer
5. Canvas renders:
   - Current waveform with dynamic amplitude
   - 4 previous frames with fading opacity
   - Center baseline
   - Dynamic gradients using color palette
   - Glow effects based on audio intensity
6. RequestAnimationFrame schedules next frame (60fps)

## UI/UX Features

### Loading Experience
- Full-screen overlay with spinning disc icon
- Progress bar tracking image loading
- Status text showing current progress (e.g., "Loading cover images... 3/7")
- Smooth fade-out when complete

### Artwork Resolution

`Player.#resolveArtwork(track)` decides what a track wears, in order:

1. `track.image` — a real cover, from the file's embedded art or a drop-in in
   `src/covers/`. Its palette drives the UI.
2. A random sleeve from `placeholders.json`, re-rolled on each load, so artless
   tracks look different between visits by design.

Drive tracks additionally probe `proxy.php?action=art` once the audio has
buffered; a 200 swaps the real embedded art in, a 404 leaves the sleeve.

### Dynamic Theming
- Color palette extracted from each track's artwork
- Smooth transitions between color schemes (0.5s ease)
- Blurred background image for depth
- Gradient overlays for visual richness
- Visualizer colors sync with palette

### Responsive Design
- Breakpoint at 768px for mobile
- Player container: 465px (desktop) → 300px (mobile)
- Visualizer canvas: 300px → 200px
- Touch-friendly controls
- Mobile-optimized touch events for seeking

### Audio Preloading Strategy
- Adjacent tracks (next and previous) preloaded automatically
- LRU cache prevents memory bloat (max 3 tracks)
- Instant playback on track change
- Reduced buffering and latency

### Image Caching
- All cover images preloaded during initialization
- Map-based cache for instant retrieval
- Eliminates flickering on track changes
- Improved perceived performance

## Performance Considerations

### Optimization Strategies
- Opus audio format reduces bandwidth by 30-50%
- Image preloading eliminates loading delays
- Audio preloading provides seamless transitions
- Canvas rendering uses device pixel ratio for sharp visuals
- Event delegation for efficient DOM manipulation
- RequestAnimationFrame for smooth 60fps animations

### Memory Management
- Preload cache limited to 3 tracks (LRU eviction)
- Canvas cleared between frames
- Event listeners cleaned up on animation stop
- AudioContext reused across tracks

## Known Limitations & Design Decisions

1. **No Playlist UI**: Simple auto-advance through tracks in order
2. **Sequential Image Loading**: Deliberate choice to show visible progress
3. **Browser AudioContext Policy**: Requires user interaction before audio plays
4. **Static Track List**: Tracks loaded from JSON, no dynamic adding
5. **No Shuffle/Repeat**: Simplified controls for classic aesthetic

## Dependencies

### Production
None. The app ships no runtime dependencies — icons are inline SVG and the
player is vanilla JS.

### Development
- `@ffmpeg-installer/ffmpeg@^1.1.0` - FFmpeg binary
- `music-metadata@^11.9.0` - ID3 tag + embedded artwork parsing
- `node-vibrant@^4.0.3` - Color palette extraction
- `sass-embedded@^1.99.0` - SCSS compilation
- `sharp@^0.34.4` - Image optimization
- `vite@^8.0.13` - Dev server and bundler

## CSS Architecture

### CSS Custom Properties (Theme Variables)
```scss
:root {
  --color-primary: #6366f1;
  --color-secondary: #4f46e5;
  --color-accent: #a78bfa;
  --color-muted: #94a3b8;
  --color-dark: #1e293b;
  --color-light: #e2e8f0;
}
```

Dynamically updated via JavaScript when tracks change.

### Key Styling Features
- Flexbox layout for centering
- CSS animations for vinyl record rotation
- Backdrop blur effects for depth
- Gradient overlays
- Smooth transitions (0.5s ease)
- Mobile-first responsive breakpoints

## Future Enhancement Opportunities

1. **Playlist Management**: Add/remove tracks dynamically
2. **Shuffle & Repeat**: Additional playback modes
3. **Volume Control**: Slider for audio level
4. **Equalizer**: Frequency band controls
5. **Visualizer Options**: Multiple visualization styles
6. **Keyboard Shortcuts**: More hotkeys (volume, shuffle, etc.)
7. **Drag & Drop**: Add tracks via file upload
8. **Local Storage**: Remember playback position and preferences
9. **Social Sharing**: Share current track
10. **Lyrics Display**: Synchronized lyrics if available
11. **Full-Screen Mode**: Immersive playback experience
12. **Spectrum Analyzer**: Additional visualizer option

## References

- **HTML5 Audio API**: [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- **Canvas 2D Rendering**: [MDN Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- **Opus Audio Format**: [Opus Codec](https://opus-codec.org/)
- **Vibrant Color Extraction**: [node-vibrant](https://github.com/Vibrant-Colors/node-vibrant)
- **Line Awesome Icons**: [Line Awesome](https://icons8.com/line-awesome)

## Quick Start for New Developers

1. **Clone and Install**
   ```bash
   npm install
   ```

2. **Add Music**
   - Place MP3 files in `src/music/`
   - Run `npm run generate-palettes` to extract metadata

3. **Development**
   ```bash
   npm run dev
   ```
   Opens browser at `http://localhost:8080`

4. **Production Build**
   ```bash
   npm run build
   ```
   Outputs optimized files to `dist/`

5. **File Organization**
   - Source files: `src/`
   - Build scripts: `scripts/`
   - Output: `dist/` (gitignored, generated)
   - Configuration: `package.json`

## Code Style & Conventions

- **JavaScript**: ES6+ classes, async/await, arrow functions
- **SCSS**: BEM-inspired naming, nested selectors, mixins
- **Comments**: Emoji-prefixed log messages for visual clarity
- **Naming**: camelCase for JavaScript, kebab-case for CSS
- **File Naming**: Descriptive, lowercase with hyphens
