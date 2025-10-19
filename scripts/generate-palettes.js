const { Vibrant } = require('node-vibrant/node');
const { parseFile } = require('music-metadata');
const fs = require('fs');
const path = require('path');

const MUSIC_DIR = path.join(__dirname, '../src/music');
const IMG_DIR = path.join(__dirname, '../src/img');
const OUTPUT_FILE = path.join(__dirname, '../src/data/tracks.json');

async function generatePalettes() {
  console.log('🎵 Generating tracks from MP3 metadata and album art...\n');

  // Ensure output directory exists
  const dataDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Ensure img directory exists for extracted album art
  if (!fs.existsSync(IMG_DIR)) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
  }

  // Get all music files
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
      // Parse ID3 tags
      const metadata = await parseFile(musicPath);
      const { common, format } = metadata;

      // Extract album art
      let imagePath = null;
      let imageFilename = null;

      if (common.picture && common.picture.length > 0) {
        const picture = common.picture[0];
        const ext = picture.format.split('/')[1] || 'jpg';
        // Sanitize filename: replace spaces and special characters
        const sanitizedName = path.parse(filename).name
          .replace(/\s+/g, '_')           // Replace spaces with underscores
          .replace(/[()[\]{}]/g, '')      // Remove parentheses and brackets
          .replace(/[&]/g, 'and');        // Replace & with 'and'
        imageFilename = `${sanitizedName}.${ext}`;
        imagePath = path.join(IMG_DIR, imageFilename);

        // Reference will be .jpg in tracks.json since we optimize to JPG
        imageFilename = `${sanitizedName}.jpg`;

        // Write album art to img directory
        fs.writeFileSync(imagePath, picture.data);
        console.log(`  ✓ Extracted album art: ${imageFilename}`);
      } else {
        console.log(`  ⚠️  No album art found in MP3 - will use placeholder`);
      }

      // Generate color palette from album art
      let colors = {
        primary: '#6366f1',
        secondary: '#4f46e5',
        accent: '#a78bfa',
        muted: '#94a3b8',
        dark: '#1e293b',
        light: '#e2e8f0'
      };

      if (imagePath && fs.existsSync(imagePath)) {
        try {
          const palette = await Vibrant.from(imagePath).getPalette();
          colors = {
            primary: palette.Vibrant?.hex || colors.primary,
            secondary: palette.DarkVibrant?.hex || colors.secondary,
            accent: palette.LightVibrant?.hex || colors.accent,
            muted: palette.Muted?.hex || colors.muted,
            dark: palette.DarkMuted?.hex || colors.dark,
            light: palette.LightMuted?.hex || colors.light
          };
          console.log(`  ✓ Generated color palette`);
          console.log(`    Primary: ${colors.primary}`);
        } catch (error) {
          console.log(`  ⚠️  Could not generate palette: ${error.message}`);
        }
      }

      // Format duration
      const duration = format.duration
        ? `${Math.floor(format.duration / 60)}:${String(Math.floor(format.duration % 60)).padStart(2, '0')}`
        : '0:00';

      // Create track object
      const track = {
        id: i + 1,
        title: common.title || path.parse(filename).name.replace(/[-_]/g, ' '),
        artist: common.artist || common.artists?.join(', ') || 'Unknown Artist',
        album: common.album || 'Unknown Album',
        duration: duration,
        image: imageFilename ? `img/${imageFilename}` : null,
        audio: `music/${filename}`,
        colors: colors
      };

      tracks.push(track);
      console.log(`  ✓ Track: ${track.title} - ${track.artist}`);
      console.log(`  ✓ Duration: ${track.duration}\n`);

    } catch (error) {
      console.error(`  ❌ Error processing ${filename}:`, error.message);

      // Create a basic track entry even if metadata extraction fails
      const track = {
        id: i + 1,
        title: path.parse(filename).name.replace(/[-_]/g, ' '),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: '0:00',
        image: null,
        audio: `music/${filename}`,
        colors: {
          primary: '#6366f1',
          secondary: '#4f46e5',
          accent: '#a78bfa',
          muted: '#94a3b8',
          dark: '#1e293b',
          light: '#e2e8f0'
        }
      };
      tracks.push(track);
      console.log(`  ⚠️  Added track with basic info\n`);
    }
  }

  // Write to JSON file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ tracks }, null, 2));

  console.log(`✅ Generated tracks.json with ${tracks.length} track(s)`);
  console.log(`📁 Saved to: ${OUTPUT_FILE}`);
  console.log(`🎨 Extracted album art saved to: ${IMG_DIR}\n`);
  console.log(`🎉 Ready to play! Run 'npm run dev' to start the player.\n`);
}

generatePalettes().catch(console.error);
