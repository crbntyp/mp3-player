const fs = require('fs');
const path = require('path');

// Copy committed source assets into the Vite public/ tree so they end up
// served at /plyr/<path> without going through the JS import graph (which
// would hash filenames and break references in tracks.json + service worker).
//
// Sources → destinations under ../public/:
//   src/img/assets/   → public/img/assets/   (UI icons, fav, record etc.)
//   src/data/         → public/data/         (tracks.json, placeholders.json)
//   src/fonts/        → public/fonts/        (Britanica family + Muli later)
//   node_modules/line-awesome/dist/line-awesome/fonts/ → public/fonts/
const ROOT = path.join(__dirname, '..');

// Line Awesome fonts are now resolved through the Vite import graph (see
// the @import in styles/main.scss), so they come along bundled — no need
// to copy them. Britanica is imported the same way through main.scss, so
// these fonts files only need to land in public/ for direct <link> use
// (none right now) or future migration.
const copies = [
  { from: 'src/data', to: 'public/data' },
];

function copyRecursive(srcAbs, destAbs) {
  if (!fs.existsSync(srcAbs)) return 0;
  const stat = fs.statSync(srcAbs);
  if (stat.isDirectory()) {
    fs.mkdirSync(destAbs, { recursive: true });
    let count = 0;
    for (const entry of fs.readdirSync(srcAbs)) {
      count += copyRecursive(path.join(srcAbs, entry), path.join(destAbs, entry));
    }
    return count;
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  return 1;
}

console.log('📋 Copying static assets to public/...\n');

let totalFiles = 0;
for (const { from, to } of copies) {
  const srcAbs = path.join(ROOT, from);
  const destAbs = path.join(ROOT, to);
  if (!fs.existsSync(srcAbs)) {
    console.log(`  ⏭  Skipped (missing): ${from}`);
    continue;
  }
  const count = copyRecursive(srcAbs, destAbs);
  totalFiles += count;
  console.log(`  ✓ ${from} → ${to} (${count} file${count === 1 ? '' : 's'})`);
}

console.log(`\n✅ Copied ${totalFiles} file(s) into public/\n`);
