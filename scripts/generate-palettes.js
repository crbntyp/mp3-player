const fs = require('fs');
const path = require('path');

const MUSIC_DIR = path.join(__dirname, '../src/music');
const OUTPUT_FILE = path.join(__dirname, '../src/data/tracks.json');

// Pexels neon placeholders carry the artwork — embedded MP3 art is ignored
// by the player. Tracks ship with a default palette; the runtime swaps in
// the placeholder's own colour palette when a track is loaded.
const DEFAULT_COLORS = {
  primary: '#6366f1',
  secondary: '#4f46e5',
  accent: '#a78bfa',
  muted: '#94a3b8',
  dark: '#1e293b',
  light: '#e2e8f0',
};

async function generateTracks() {
  console.log('🎵 Generating tracks from MP3 metadata...\n');

  const { parseFile } = await import('music-metadata');

  const dataDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(MUSIC_DIR)) {
    console.log('❌ No music directory found at src/music/');
    console.log('💡 Create src/music/ and add MP3 files, then run this script again!');
    return;
  }

  const musicFiles = fs.readdirSync(MUSIC_DIR)
    .filter(file => /\.(mp3|m4a|wav|ogg|flac)$/i.test(file));

  if (musicFiles.length === 0) {
    console.log('❌ No music files found in src/music/');
    console.log('💡 Add MP3 files to src/music/ and run this script again!');
    return;
  }

  console.log(`Found ${musicFiles.length} music file(s)\n`);

  const tracks = [];

  for (let i = 0; i < musicFiles.length; i++) {
    const filename = musicFiles[i];
    const musicPath = path.join(MUSIC_DIR, filename);

    console.log(`Processing: ${filename}`);

    try {
      const metadata = await parseFile(musicPath);
      const { common, format } = metadata;

      const duration = format.duration
        ? `${Math.floor(format.duration / 60)}:${String(Math.floor(format.duration % 60)).padStart(2, '0')}`
        : '0:00';

      const audioFilename = filename.replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '.opus');

      const track = {
        id: i + 1,
        title: common.title || path.parse(filename).name.replace(/[-_]/g, ' '),
        artist: common.artist || common.artists?.join(', ') || 'Unknown Artist',
        album: common.album || 'Unknown Album',
        duration: duration,
        image: null,
        audio: `music/${audioFilename}`,
        colors: DEFAULT_COLORS,
      };

      tracks.push(track);
      console.log(`  ✓ Track: ${track.title} - ${track.artist}`);
      console.log(`  ✓ Duration: ${track.duration}\n`);

    } catch (error) {
      console.error(`  ❌ Error processing ${filename}:`, error.message);

      const audioFilename = filename.replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '.opus');
      tracks.push({
        id: i + 1,
        title: path.parse(filename).name.replace(/[-_]/g, ' '),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: '0:00',
        image: null,
        audio: `music/${audioFilename}`,
        colors: DEFAULT_COLORS,
      });
      console.log(`  ⚠️  Added track with basic info\n`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ tracks }, null, 2));

  console.log(`✅ Generated tracks.json with ${tracks.length} track(s)`);
  console.log(`📁 Saved to: ${OUTPUT_FILE}\n`);
  console.log(`🎉 Ready to play! Run 'npm run dev' to start the player.\n`);
}

generateTracks().catch(console.error);
