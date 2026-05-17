const fs = require('fs');
const path = require('path');

// Wipes generated output but leaves committed static files intact.
//
// public/img/assets/ stays — those are tracked UI icons (fav, record, app
// icons). Everything else under public/ matches a gitignore rule and is
// safe to nuke.
const ROOT = path.join(__dirname, '..');

function rmIfExists(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  fs.rmSync(abs, { recursive: true, force: true });
  console.log(`  ✓ removed ${rel}`);
}

function wipeContents(dir, keep = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs)) {
    if (keep.includes(entry)) continue;
    const target = path.join(abs, entry);
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`  ✓ removed ${dir}/${entry}`);
  }
}

console.log('🧹 Cleaning generated output...\n');
rmIfExists('dist');
rmIfExists('public/music');
rmIfExists('public/data');
wipeContents('public/img', ['assets']);
console.log('\n✅ Clean complete.\n');
