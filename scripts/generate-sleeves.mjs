// One-off generator for the fallback sleeve set.
//
// Tracks with no embedded art and no drop-in cover fall back to a placeholder.
// That set used to be Pexels stairwell photography, desaturated to grey by
// fetch-placeholders.js — unrelated stock images pretending to be album art.
// These are purpose-made sleeves instead: same cosmic/atmospheric register as
// the real covers, so a fallback looks like a record rather than a photo.
//
// Model: gpt-image-2-text-to-image on Kie. Note it must go through the CLI's
// `raw` command — `image` requires a vendor/model id and this one has no
// vendor prefix. Kie has no Midjourney endpoint despite the CLI's `mj` command.
//
//   node scripts/generate-sleeves.mjs [startIndex]

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const run = promisify(execFile);
const KIE = '/Users/carbontype/Documents/Engineering/crbntyp/_tools/kie/kie.mjs';
const OUT = path.join(import.meta.dirname, '../_sleeves');

const STYLE = 'cinematic matte painting, richly atmospheric, deep shadow, '
  + 'volumetric light, subtle film grain, album cover art for a late 1990s '
  + 'progressive trance 12 inch vinyl single. No text, no lettering, no words, '
  + 'no logos, no watermark.';

const SCENES = [
  'a vast aurora burning green and violet over a frozen lake, a hairline crack of light across the ice',
  'a monolithic black slab standing in thick fog, lit from within by a seam of amber light',
  'a distant city skyline under an enormous magenta nebula, rain-slick streets reflecting the sky',
  'an empty desert road running straight into a wall of electric blue light storm',
  'a cathedral of ice with turquoise light pouring through its arches, a single figure dwarfed at the base',
  'an enormous wave frozen mid-break at night, lit from beneath by cyan bioluminescence',
  'a derelict radio telescope dish under a sky of streaking violet starlight',
  'a lone figure on a cliff edge facing a colossal orange harvest moon through haze',
  'endless mirrored salt flats at dusk reflecting a sky of teal and rose cloud',
  'a tunnel of concrete arches receding into a glowing pink vanishing point',
  'storm clouds lit from inside by silent lightning above a black glass sea',
  'a forest of bare trees under an emerald green sky, mist pooling at the roots',
  'a solitary lighthouse beam cutting through violet fog over jagged rocks',
  'the curve of a planet horizon seen from orbit, thin atmosphere glowing turquoise against deep space',
];

fs.mkdirSync(OUT, { recursive: true });

const start = Number(process.argv[2] || 0);

for (let i = start; i < SCENES.length; i++) {
  const n = String(i + 2).padStart(2, '0'); // 01 is the approved example
  const out = path.join(OUT, `sleeve-${n}.png`);

  if (fs.existsSync(out)) { console.log(`= sleeve-${n} exists, skipping`); continue; }

  const input = JSON.stringify({
    prompt: `${SCENES[i]}, ${STYLE}`,
    aspect_ratio: '1:1',
    resolution: '1K',
  });

  console.log(`→ sleeve-${n}: ${SCENES[i].slice(0, 60)}…`);
  try {
    const { stdout } = await run('node',
      [KIE, 'raw', '--model', 'gpt-image-2-text-to-image', '--input', input, '--out', out],
      { maxBuffer: 1024 * 1024 * 32 });
    console.log(stdout.trim().split('\n').pop());
  } catch (err) {
    console.error(`✗ sleeve-${n} failed: ${String(err.stderr || err).slice(0, 200)}`);
  }
}

console.log('\nDone. Files in _sleeves/');
