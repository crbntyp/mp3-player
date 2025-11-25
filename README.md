# plyr

A music player with vinyl record aesthetics, audio visualizer, and Google Drive integration.

### Check it out

[![MP3 Player Demo](music-player.png)](https://www.instagram.com/p/DP_AT0-Dyol214AZknSKSb_9EnxukBWTg9_kF80/)

## Features

- Audio playback with play/pause, next/previous track controls
- Vinyl record rotation animation with sliding effect
- Real-time audio visualizer
- Dynamic color palettes from album artwork or placeholders
- **Google Drive integration** - Stream music from Drive folders organized by year/era
- Server-side proxy with caching for Drive files
- Track wheel for browsing library
- Responsive design

## Music Sources

### Local Tracks
Place MP3 files in `src/music/`. Run `npm run generate-palettes` to extract metadata and album art, then build.

### Google Drive
Stream from public Google Drive folders. Configured in `src/scripts/drive.js`:

```javascript
this.folders = [
    { id: 'FOLDER_ID', label: '1993-97', years: '1993-97' },
    { id: 'FOLDER_ID', label: '1998', years: '1998' },
    // ...
];
```

**Requirements:**
- Google Cloud project with Drive API enabled
- API key with domain restrictions
- Folders shared as "Anyone with the link"

**File naming:** `Artist - Track Title.mp3` (parsed automatically)

## Prerequisites

- Node.js (v14+)
- npm
- FFmpeg (for audio optimization)

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Watches all files and serves at `http://localhost:8080`

## Build

```bash
npm run build
```

Runs all tasks: palette generation, SCSS, HTML, JS, images, music optimization, data, fonts.

## Project Structure

```
plyr/
├── src/
│   ├── data/           # Track metadata (JSON)
│   ├── img/            # Album artwork and assets
│   ├── music/          # MP3 source files
│   ├── scripts/
│   │   ├── main.js     # Player class
│   │   ├── drive.js    # Google Drive integration
│   │   └── visualizer.js
│   ├── styles/         # SCSS
│   ├── proxy.php       # Drive caching proxy
│   └── index.html
├── dist/               # Build output
│   ├── cache/          # Cached Drive files (server-side)
│   └── music/          # Optimized Opus files
├── scripts/            # Build scripts
│   ├── generate-palettes.js
│   ├── optimize-images.js
│   ├── optimize-music.js
│   └── watch-music.js
└── package.json
```

## Google Drive Proxy

The proxy (`proxy.php`) handles CORS issues and caches Drive files:

- First play: fetches from Drive, caches locally
- Subsequent plays: served from cache
- Auto-cleanup when cache exceeds 2GB
- 30-day cache expiry

Cache location: `/var/www/crbntyp/plyr/cache/`

## Technologies

- Sass
- Line Awesome icons
- Sharp (image optimization)
- Node Vibrant (color extraction)
- FFmpeg/Fluent-FFmpeg (audio transcoding)
- Live Server

## Author

Jonny Pyper / Carbontype

Music copyright belongs to respective owners.

## License

ISC
