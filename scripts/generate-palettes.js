const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { slugify } = require('./lib/slug');

const MUSIC_DIR   = path.join(__dirname, '../src/music');
const OUTPUT_FILE = path.join(__dirname, '../src/data/tracks.json');
const COVER_DIR   = path.join(__dirname, '../public/img/covers');
// Hand-supplied artwork, checked before the file's own embedded picture.
const DROP_IN_DIR = path.join(__dirname, '../src/covers');

// Cover output sizes. The big one backs the album-art panel and the blurred
// body wash; the small one is the vinyl centre label, which renders at ~90px
// and shouldn't pay to decode a 2048px source.
const COVER_SIZE = 720;
const LABEL_SIZE = 240;

// Used when a file carries no embedded art. The player treats a null image
// as "fall back to a placeholder", so these colours only apply if the
// placeholder set is empty too.
const DEFAULT_COLORS = {
  primary: '#6366f1',
  secondary: '#4f46e5',
  accent: '#a78bfa',
  muted: '#94a3b8',
  dark: '#1e293b',
  light: '#e2e8f0',
};

// Look for hand-supplied art matching a track's slug. Extension-agnostic so
// you can drop a jpg, png or webp without renaming anything.
function findDropInCover(slug) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const candidate = path.join(DROP_IN_DIR, `${slug}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Mix-version keywords, mirroring MIX_KEYWORDS in
// src/scripts/utils/format-track-name.js. That module is browser ESM and this
// script is CommonJS, so the list is restated rather than imported — keep the
// two in step.
const MIX_KEYWORDS = /(mix|remix|edit|version|dub|extended|original|club|radio|instrumental|acapella|bootleg|rework|reconstruction|refix|recut|rebuild|vip|flip|treatment|mashup|live|session|rerub)/i;

// Split a trailing "(... Mix)" off an ID3 title.
//
// Drive tracks already arrive as { title, version } via formatTrackName, and
// the UI gives the mix its own colour in the track list and its own line under
// the title. Local tracks came straight from ID3 with the mix baked into the
// title, so they missed that treatment and truncated badly in the list.
function splitVersion(title) {
  const match = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { title, version: null };

  const [, base, inner] = match;
  if (!base || !MIX_KEYWORDS.test(inner)) return { title, version: null };

  return { title: base.trim(), version: inner.trim() };
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

// Palette straight off the artwork. Keys match the CSS custom properties the
// player sets in updateTheme(), so the whole UI recolours per track.
async function extractPalette(buffer) {
  try {
    const { Vibrant } = require('node-vibrant/node');
    const palette = await Vibrant.from(buffer).getPalette();
    return {
      primary:   palette.Vibrant?.hex      || DEFAULT_COLORS.primary,
      secondary: palette.DarkVibrant?.hex  || DEFAULT_COLORS.secondary,
      accent:    palette.LightVibrant?.hex || DEFAULT_COLORS.accent,
      muted:     palette.Muted?.hex        || DEFAULT_COLORS.muted,
      dark:      palette.DarkMuted?.hex    || DEFAULT_COLORS.dark,
      light:     palette.LightMuted?.hex   || DEFAULT_COLORS.light,
    };
  } catch (e) {
    console.error(`  ⚠️  Palette extraction failed: ${e.message}`);
    return { ...DEFAULT_COLORS };
  }
}

// Write the two cover derivatives. WebP because these are photographic
// 2048px PNGs — the source art runs 6-8MB each and has no business shipping
// raw (an earlier commit deleted them from the repo for exactly that reason).
async function writeCovers(buffer, slug) {
  const coverName = `${slug}.webp`;
  const labelName = `${slug}-label.webp`;

  await sharp(buffer)
    .resize(COVER_SIZE, COVER_SIZE, { fit: 'cover' })
    .webp({ quality: 82 })
    .toFile(path.join(COVER_DIR, coverName));

  await sharp(buffer)
    .resize(LABEL_SIZE, LABEL_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(path.join(COVER_DIR, labelName));

  const bytes = fs.statSync(path.join(COVER_DIR, coverName)).size;
  return { cover: `img/covers/${coverName}`, label: `img/covers/${labelName}`, bytes };
}

async function generateTracks() {
  console.log('🎵 Generating tracks + covers from music metadata...\n');

  const { parseFile } = await import('music-metadata');

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.mkdirSync(COVER_DIR, { recursive: true });

  if (!fs.existsSync(MUSIC_DIR)) {
    console.log('❌ No music directory found at src/music/');
    console.log('💡 Create src/music/ and add MP3 files, then run this script again!');
    return;
  }

  const musicFiles = fs.readdirSync(MUSIC_DIR)
    .filter((file) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(file))
    .sort();

  if (musicFiles.length === 0) {
    console.log('❌ No music files found in src/music/');
    console.log('💡 Add MP3 files to src/music/ and run this script again!');
    return;
  }

  console.log(`Found ${musicFiles.length} music file(s)\n`);

  const tracks = [];
  let withArt = 0;
  let artBytes = 0;

  for (let i = 0; i < musicFiles.length; i++) {
    const filename  = musicFiles[i];
    const musicPath = path.join(MUSIC_DIR, filename);
    const slug      = slugify(filename);

    console.log(`Processing: ${filename}`);

    const track = {
      id: i + 1,
      title: path.parse(filename).name.replace(/[-_]/g, ' '),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: '0:00',
      version: null,
      image: null,
      label: null,
      audio: `music/${slugify(filename)}.opus`,
      colors: { ...DEFAULT_COLORS },
    };

    try {
      const { common, format } = await parseFile(musicPath);

      const split    = splitVersion(common.title || track.title);
      track.title    = split.title;
      track.version  = split.version;
      track.artist   = common.artist || common.artists?.join(', ') || track.artist;
      track.album    = common.album || track.album;
      track.duration = formatDuration(format.duration);

      // Artwork comes from one of two places, drop-in first:
      //
      //   1. src/covers/<slug>.(jpg|jpeg|png|webp) — hand-supplied art. Lets
      //      you cover a track whose MP3 carries none (or override one whose
      //      embedded art you don't like) without re-tagging the file.
      //   2. The MP3's own embedded picture, handed back as a buffer by
      //      music-metadata — no separate ffmpeg pass needed.
      //
      // Anything with neither falls back to a neon placeholder at runtime.
      const dropIn = findDropInCover(slug);
      const picture = common.picture?.[0];
      const source = dropIn
        ? { buffer: fs.readFileSync(dropIn), origin: `drop-in ${path.basename(dropIn)}` }
        : picture?.data?.length
          ? { buffer: Buffer.from(picture.data), origin: 'embedded' }
          : null;

      if (source) {
        const buffer = source.buffer;
        const { cover, label, bytes } = await writeCovers(buffer, slug);
        track.image  = cover;
        track.label  = label;
        track.colors = await extractPalette(buffer);
        withArt++;
        artBytes += bytes;
        console.log(`  ✓ ${track.title}${track.version ? ` [${track.version}]` : ''} — ${track.artist} (${track.duration})`);
        console.log(`  🎨 ${source.origin} — ${(bytes / 1024).toFixed(0)}KB / palette ${track.colors.primary} / ${track.colors.accent}`);
      } else {
        console.log(`  ✓ ${track.title}${track.version ? ` [${track.version}]` : ''} — ${track.artist} (${track.duration})`);
        console.log(`  ○ No art — falls back to a placeholder. Drop one at src/covers/${slug}.jpg to fix.`);
      }
    } catch (error) {
      console.error(`  ❌ Error processing ${filename}: ${error.message}`);
      console.log('  ⚠️  Added track with basic info');
    }

    tracks.push(track);
    console.log('');
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ tracks }, null, 2));

  console.log('═══════════════════════════════════════');
  console.log(`✅ tracks.json — ${tracks.length} track(s), ${withArt} with embedded art`);
  if (withArt) console.log(`🖼️  Covers written to public/img/covers/ (${(artBytes / 1024).toFixed(0)}KB total)`);
  console.log(`📁 ${OUTPUT_FILE}\n`);
}

generateTracks().catch((error) => {
  console.error('Error generating tracks:', error);
  process.exit(1);
});
