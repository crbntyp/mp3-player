const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Turn the generated sleeve masters into the shipped fallback set.
//
// A track with no embedded art and no drop-in cover wears one of these. The
// set used to be Pexels stairwell photography run through a desaturate to
// force a "unified moody monochrome" look — unrelated stock images pretending
// to be album art, and grey ones at that. These are purpose-made sleeves in
// the same register as the real covers, so a fallback reads as a record.
//
// Masters live in _sleeves/ (gitignored — they're large and regenerating them
// costs money). What ships is the tracked JPEG set written here.
//
//   node scripts/generate-sleeves.mjs   # create the masters (Kie, costs money)
//   node scripts/build-sleeves.js       # process them into the shipped set

const SRC_DIR   = path.join(__dirname, '../_sleeves');
const OUT_DIR   = path.join(__dirname, '../public/img/placeholders');
const DATA_FILE = path.join(__dirname, '../src/data/placeholders.json');

const SIZE = 1024;

async function extractPalette(buffer) {
  try {
    const { Vibrant } = require('node-vibrant/node');
    const palette = await Vibrant.from(buffer).getPalette();
    return {
      primary:   palette.Vibrant?.hex      || '#6366f1',
      secondary: palette.DarkVibrant?.hex  || '#4f46e5',
      accent:    palette.LightVibrant?.hex || '#a78bfa',
      muted:     palette.Muted?.hex        || '#94a3b8',
      dark:      palette.DarkMuted?.hex    || '#1e293b',
      light:     palette.LightMuted?.hex   || '#e2e8f0',
    };
  } catch (e) {
    console.error(`  ⚠️  Palette extraction failed: ${e.message}`);
    return {
      primary: '#6366f1', secondary: '#4f46e5', accent: '#a78bfa',
      muted: '#94a3b8', dark: '#1e293b', light: '#e2e8f0',
    };
  }
}

async function build() {
  console.log('🎨 Building fallback sleeve set...\n');

  if (!fs.existsSync(SRC_DIR)) {
    console.log('❌ No _sleeves/ directory. Run: node scripts/generate-sleeves.mjs');
    process.exit(1);
  }

  const masters = fs.readdirSync(SRC_DIR)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();

  if (masters.length === 0) {
    console.log('❌ No sleeve masters found in _sleeves/');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Clear the old set so removed or renamed sleeves don't linger and get
  // served alongside the current ones.
  for (const stale of fs.readdirSync(OUT_DIR)) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(stale)) fs.unlinkSync(path.join(OUT_DIR, stale));
  }

  const images = [];
  let totalBytes = 0;

  for (const file of masters) {
    const name = path.parse(file).name;
    const outName = `${name}.jpg`;
    const outPath = path.join(OUT_DIR, outName);

    // No modulate() here on purpose — the previous pipeline darkened and
    // desaturated every image, which is exactly what made the set look dead.
    const buffer = await sharp(path.join(SRC_DIR, file))
      .resize(SIZE, SIZE, { fit: 'cover' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    fs.writeFileSync(outPath, buffer);
    totalBytes += buffer.length;

    const colors = await extractPalette(buffer);
    images.push({ id: name, url: `img/placeholders/${outName}`, colors });

    console.log(`  ✓ ${outName}  ${(buffer.length / 1024).toFixed(0)}KB  ${colors.primary} / ${colors.accent}`);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify({ images }, null, 2));

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ ${images.length} sleeve(s), ${(totalBytes / 1024 / 1024).toFixed(2)}MB total`);
  console.log(`📁 ${OUT_DIR}`);
  console.log(`📄 ${DATA_FILE}\n`);
}

build().catch((error) => {
  console.error('Error building sleeves:', error);
  process.exit(1);
});
