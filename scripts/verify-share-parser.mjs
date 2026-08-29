// Check that share.php agrees with the client about what a filename means.
//
// share.php has to resolve a shared link on its own — a crawler never runs
// the app — so it carries a PHP port of utils/format-track-name.js and
// utils/track-key.js. Two implementations of the same non-trivial parsing,
// and a disagreement doesn't throw: the share card just shows a different
// title, or worse, different artwork from the record the link opens.
//
// So compare them over every real Drive filename, not a fixture. Needs
// Docker (there's no PHP on the host) and network for the listings.
//
//   node scripts/verify-share-parser.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import eras from '../src/data/eras.json' with { type: 'json' };

const run = promisify(execFile);
const ROOT = path.join(import.meta.dirname, '..');
const BASE = process.env.PLYR_BASE || 'https://crbntyp.com/plyr';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plyr-verify-'));

// The util modules are ESM but package.json has no "type": "module", so
// Node reads a bare .js as CommonJS and the named imports fail. Vite doesn't
// care; this script does. Copy them out under .mjs so we're still importing
// the real source rather than a transcription of it.
const UTILS = path.join(ROOT, 'src/scripts/utils');
for (const f of ['format-track-name', 'track-key']) {
    fs.copyFileSync(path.join(UTILS, `${f}.js`), path.join(tmp, `${f}.mjs`));
}
const { formatTrackName } = await import(path.join(tmp, 'format-track-name.mjs'));
const { hashString, trackKey } = await import(path.join(tmp, 'track-key.mjs'));

const names = [];
for (const era of eras.eras) {
    const res = await fetch(`${BASE}/proxy.php?action=list&folder=${era.id}`);
    const json = await res.json();
    for (const f of json.files || []) names.push(f.name);
}
if (names.length === 0) {
    console.error('No filenames fetched — nothing to compare.');
    process.exit(1);
}
fs.writeFileSync(path.join(tmp, 'names.json'), JSON.stringify(names));

// PHP side: pull the parser out of share.php without running its request
// handling, so we're testing the shipped code rather than a copy of it.
fs.writeFileSync(path.join(tmp, 'gen.php'), `<?php
$src = file_get_contents('/app/share.php');
$src = substr($src, 0, strpos($src, '// --- resolve ---'));
eval(preg_replace('/^<\\\\?php/', '', $src, 1));
$out = [];
foreach (json_decode(file_get_contents('/verify/names.json'), true) as $n) {
    $p = formatTrackName($n);
    $out[] = ['artist'=>$p['artist'],'title'=>$p['title'],'version'=>$p['version'],'hash'=>fnv1a($n)];
}
file_put_contents('/verify/php.json', json_encode($out));
`);

await run('docker', ['run', '--rm',
    '-v', `${path.join(ROOT, 'public')}:/app`,
    '-v', `${tmp}:/verify`,
    'php:8.3-cli', 'php', '/verify/gen.php']);

const php = JSON.parse(fs.readFileSync(path.join(tmp, 'php.json'), 'utf8'));

let bad = 0;
names.forEach((name, i) => {
    const a = formatTrackName(name);
    const b = php[i];
    const diffs = [];
    if (a.artist !== b.artist) diffs.push(`artist: js="${a.artist}" php="${b.artist}"`);
    if (a.title !== b.title) diffs.push(`title: js="${a.title}" php="${b.title}"`);
    if ((a.version || null) !== (b.version || null)) diffs.push(`version: js="${a.version}" php="${b.version}"`);
    const h = hashString(trackKey({ fileName: name }));
    if (h !== b.hash) diffs.push(`sleeve hash: js=${h} php=${b.hash}`);
    if (diffs.length) { bad++; console.error(`✗ ${name}\n    ${diffs.join('\n    ')}`); }
});

fs.rmSync(tmp, { recursive: true, force: true });

if (bad) {
    console.error(`\n❌ ${bad} of ${names.length} filenames disagree.`);
    process.exit(1);
}
console.log(`✅ share.php agrees with the client on all ${names.length} filenames.`);
