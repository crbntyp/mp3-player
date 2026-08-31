import '../styles/banner.scss';
import { AudioVisualizer } from './visualizer.js';

/*
 * Banner rig. Dev-only — see src/banner.html.
 *
 * The one rule this file follows: it does not draw a player. It fetches
 * index.html, lifts the real .player-container out of it and clones that per
 * track, so the banner is a photograph of the component rather than a
 * reproduction of it. The same goes for the wordmark and the Records button,
 * which are lifted once and placed under the row.
 */

// Real covers first — a sleeve is a fallback, and a banner should lead with
// the art that actually came off the record. The first id also sets the
// page's palette and backdrop, so it wants to be the strongest cover.
const DEFAULT_ORDER = [4, 1, 5, 6, 2];

// Each card gets its own playhead, so five transports don't read as one
// screenshot repeated five times.
const PLAYHEADS = [0.34, 0.62, 0.17, 0.78, 0.45];

const PAUSE_ICON = 'M6 4h4v16H6V4zm8 0h4v16h-4V4z';

const stage = document.getElementById('stage');
const inner = document.getElementById('inner');
const row = document.getElementById('row');
const footer = document.getElementById('footer');
const guides = document.getElementById('guides');
const readout = document.getElementById('readout');

const opts = {
  frame: '2.96',
  count: 5,
  gap: 170,
  record: 200,
  spin: 'still',
  viz: 'off',
  fill: 'bleed',
  footer: 'stack',
  guides: 'guides',
};

let tracks = [];
let sleeves = [];
let template = null;      // the app's .player-container, unpopulated
let footerParts = null;   // { credit, records } lifted from the same page
let sleeveOffset = 0;
let order = DEFAULT_ORDER.slice();
let visualizers = [];

// ── Data ────────────────────────────────────────────────────────────────

async function load() {
  const [appHtml, trackData, sleeveData] = await Promise.all([
    fetch('index.html').then((r) => r.text()),
    fetch('data/tracks.json').then((r) => r.json()),
    fetch('data/placeholders.json').then((r) => r.json()),
  ]);

  const doc = new DOMParser().parseFromString(appHtml, 'text/html');
  template = doc.querySelector('.player-container');

  // The wordmark and the Records button live inside .player-container in the
  // app, which is right there and wrong here: one row wants one of each. They
  // come out of the template before it is ever cloned.
  footerParts = {
    credit: template.querySelector('.credit'),
    records: template.querySelector('.records-launch'),
  };
  footerParts.credit.remove();
  footerParts.records.remove();

  tracks = trackData.tracks;
  sleeves = sleeveData.images;
}

// A track with no embedded artwork gets a sleeve, exactly as the player does.
// Which sleeve is deterministic here rather than random, so the same frame
// can be shot twice.
function artFor(track, slot) {
  if (track.image) {
    return { cover: track.image, label: track.label || track.image, colors: track.colors };
  }
  const sleeve = sleeves[(slot * 7 + sleeveOffset) % sleeves.length];
  return { cover: sleeve.url, label: sleeve.thumb, colors: sleeve.colors };
}

function seconds(duration) {
  const [m, s] = String(duration || '0:00').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}

function clock(total) {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Cards ───────────────────────────────────────────────────────────────

function buildCard(track, slot) {
  const card = template.cloneNode(true);
  const art = artFor(track, slot);

  const el = {
    record: card.querySelector('#rotate-record'),
    labelArt: card.querySelector('#record-label-art'),
    labelTitle: card.querySelector('#record-label-title-path'),
    labelArtist: card.querySelector('#record-label-artist-path'),
    cover: card.querySelector('#album-art'),
    title: card.querySelector('#track-title'),
    artist: card.querySelector('#track-artist'),
    canvas: card.querySelector('#visualizer-canvas'),
    playIcon: card.querySelector('#play-btn path'),
    current: card.querySelector('#current-time'),
    bar: card.querySelector('#progress-bar'),
    duration: card.querySelector('#duration'),
    volume: card.querySelector('#volume-slider'),
  };

  // Palette per card. The app writes these to :root because it only ever
  // shows one track; scoped to the card instead, every sleeve keeps its own
  // colours — the record label, the progress fill and the visualiser all
  // read them from here.
  Object.entries(art.colors).forEach(([key, value]) => {
    card.style.setProperty(`--color-${key}`, value);
  });

  el.record.classList.remove('hidden');
  el.record.classList.add('visible', 'playing');

  el.cover.src = art.cover;
  el.labelArt.src = art.label;
  el.labelTitle.textContent = track.title;
  el.labelArtist.textContent = track.artist;

  el.title.replaceChildren(document.createTextNode(track.title));
  if (track.version) {
    el.title.appendChild(document.createElement('br'));
    const version = document.createElement('span');
    version.className = 'track-version';
    version.textContent = `(${track.version})`;
    el.title.appendChild(version);
  }
  el.artist.textContent = track.artist;

  // Mid-track and playing: a transport frozen at 0:00 with a play triangle
  // reads as a screenshot of something that never started.
  const total = seconds(track.duration);
  const at = PLAYHEADS[slot % PLAYHEADS.length];
  el.playIcon.setAttribute('d', PAUSE_ICON);
  el.bar.style.width = `${at * 100}%`;
  el.current.textContent = clock(total * at);
  el.duration.textContent = track.duration || clock(total);
  el.volume.value = '0.8';

  card.classList.add('banner-card');
  uniquifyIds(card, slot);
  return { card, canvas: el.canvas, colors: art.colors };
}

// Five clones of markup written for one instance means five of every id.
// Anything an internal reference points at (the two curved baselines the
// record label's textPaths ride on) is renamed per card; everything else
// loses its id, since nothing outside the app's own script looks it up.
function uniquifyIds(card, slot) {
  card.querySelectorAll('[id]').forEach((node) => {
    const id = node.id;
    const refs = card.querySelectorAll(`[href="#${id}"]`);
    if (!refs.length) {
      node.removeAttribute('id');
      return;
    }
    const next = `${id}-${slot}`;
    node.id = next;
    refs.forEach((ref) => ref.setAttribute('href', `#${next}`));
  });
}

// The visualiser reads its canvas by id, one per document. Rather than fork
// it, each canvas borrows that id for the length of one constructor call.
function attachVisualizer(canvas, colors, seed) {
  canvas.id = 'visualizer-canvas';
  const viz = new AudioVisualizer();
  canvas.removeAttribute('id');

  viz.updateColors(colors);
  viz.dataArray = new Uint8Array(256);
  viz.analyser = fakeAnalyser(seed);
  viz.show();
  return viz;
}

// Frequency data that looks like music: loud at the bottom, falling away up
// the spectrum, moving. Seeded per card so no two waveforms match.
function fakeAnalyser(seed) {
  let t = seed * 13;
  return {
    getByteFrequencyData(arr) {
      t += 0.045;
      for (let i = 0; i < arr.length; i += 1) {
        const rolloff = Math.exp(-i / (arr.length * 0.32));
        const move = Math.sin(i * 0.29 + t * 1.6 + seed) * 0.55
                   + Math.sin(i * 0.061 - t * 0.9 + seed * 2) * 0.45;
        arr[i] = Math.max(0, Math.min(255, Math.round(rolloff * (155 + move * 95))));
      }
    },
  };
}

function render() {
  visualizers.forEach((viz) => viz.dispose());
  visualizers = [];
  row.replaceChildren();

  const chosen = order
    .map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean)
    .slice(0, opts.count);

  const built = chosen.map((track, slot) => buildCard(track, slot));
  built.forEach(({ card }) => row.appendChild(card));

  if (opts.viz === 'on') {
    built.forEach(({ canvas, colors }, slot) => {
      visualizers.push(attachVisualizer(canvas, colors, slot + 1));
    });
  } else {
    built.forEach(({ canvas }) => { canvas.hidden = true; });
  }

  footer.replaceChildren(
    footerParts.credit.cloneNode(true),
    footerParts.records.cloneNode(true),
  );
  placeFooter();

  // The first track owns the frame: its palette paints the wash and its cover
  // is the blurred field behind everything. The other four keep their own
  // colours locally, which is the whole reason the palette is scoped to the
  // card rather than to the root.
  const lead = built[0];
  if (lead) {
    Object.entries(lead.colors).forEach(([key, value]) => {
      stage.style.setProperty(`--color-${key}`, value);
    });
    stage.style.setProperty('--backdrop-image', `url("${lead.card.querySelector('.album-art').src}")`);
  }

  applyGeometry();
  layout();
}

// ── Geometry ────────────────────────────────────────────────────────────

// Under the row, or pinned to the frame's bottom corners. The difference is
// whether the wordmark and the Records button are part of the composition or
// furniture around it, which is a parenting question, not a styling one.
function placeFooter() {
  const corners = opts.footer === 'corners';
  stage.classList.toggle('footer-corners', corners);
  (corners ? stage : inner).appendChild(footer);
}

function applyGeometry() {
  row.style.setProperty('--banner-gap', `${opts.gap}px`);
  row.style.setProperty('--record-visible-left', `${opts.record}px`);
  // The record is 400px wide inside a 465px card, so anything past 65px of
  // slide hangs off the right-hand end of the row.
  row.style.setProperty('--banner-overhang', `${Math.max(0, opts.record + 400 - 465)}px`);
  stage.classList.toggle('is-still', opts.spin === 'still');
}

function sizeStage() {
  const clean = document.body.classList.contains('is-clean');
  const availableW = window.innerWidth - 40;
  const availableH = window.innerHeight - (clean ? 40 : 96);

  let w;
  let h;
  if (opts.frame === 'fit') {
    w = availableW;
    h = availableH;
  } else {
    const ratio = parseFloat(opts.frame);
    w = Math.min(availableW, availableH * ratio);
    h = w / ratio;
  }
  stage.style.width = `${Math.round(w)}px`;
  stage.style.height = `${Math.round(h)}px`;
  stage.style.setProperty('--banner-pad', `${Math.round(Math.min(w, h) * 0.055)}px`);
}

function layout() {
  sizeStage();

  // offsetWidth is the untransformed layout box, so the row can be measured
  // at the player's real size and only then fitted to the frame.
  const naturalW = inner.offsetWidth;
  const naturalH = inner.offsetHeight;
  if (!naturalW || !naturalH) return;

  // Fit against the sleeves, not against the row's box. The box carries a
  // reserve of empty space at each end for the records to slide into, so
  // fitting to it would spend the frame's width on padding and leave the
  // covers looking smaller than the number suggests.
  const room = opts.fill === 'bleed' ? 1.16 : 0.94;
  const scale = Math.min(
    (stage.clientWidth * room) / sleeveSpan(),
    (stage.clientHeight * 0.9) / naturalH,
  );
  inner.style.setProperty('--banner-scale', scale.toFixed(4));

  drawGuides();
  updateReadout(scale);
}

// The first cover's left edge to the last cover's right edge, at the row's
// natural size — measured rather than derived, so it stays honest whatever
// the spacing and card count are. Rects come back already transformed, so
// the scale in force has to be divided back out.
function sleeveSpan() {
  const arts = row.querySelectorAll('.album-art-container');
  if (!arts.length) return inner.offsetWidth;
  const applied = parseFloat(getComputedStyle(inner).getPropertyValue('--banner-scale')) || 1;
  const first = arts[0].getBoundingClientRect();
  const last = arts[arts.length - 1].getBoundingClientRect();
  return (last.right - first.left) / applied;
}

// What each consumer of this image keeps. object-fit: cover, so the crop is
// the largest box of that ratio that fits inside the frame, centred.
function cropBox(ratio) {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  return ratio > w / h
    ? { w, h: w / ratio }
    : { w: h * ratio, h };
}

function drawGuides() {
  guides.replaceChildren();
  if (opts.guides === 'none') return;

  const add = (ratio, kind, label, scrim) => {
    const box = cropBox(ratio);
    const node = document.createElement('div');
    node.className = `banner-guide banner-guide--${kind}`;
    node.style.width = `${Math.round(box.w)}px`;
    node.style.height = `${Math.round(box.h)}px`;
    if (scrim) {
      const ink = document.createElement('div');
      ink.className = 'banner-scrim';
      node.appendChild(ink);
    }
    const tag = document.createElement('span');
    tag.className = 'banner-guide__label';
    tag.textContent = label;
    node.appendChild(tag);
    guides.appendChild(node);
  };

  if (opts.guides === 'hero') {
    add(2.96, 'hero', 'project page hero — with the page’s own ink over it', true);
    return;
  }
  add(2.96, 'hero', 'project page hero (≈2.96:1, varies with window)');
  add(1.2785, 'card', 'work-grid card (808:632)');
}

function updateReadout(scale) {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  readout.innerHTML = `frame <b>${w}×${h}</b> css · ×${dpr} dpr → `
    + `<b>${Math.round(w * dpr)}×${Math.round(h * dpr)}</b> px · `
    + `row at ${Math.round(scale * 100)}% · press <b>h</b> for a clean frame`;
}

// ── Controls ────────────────────────────────────────────────────────────

function bind() {
  const on = (id, key, cast = String) => {
    const field = document.getElementById(id);
    field.value = String(opts[key]);
    field.addEventListener('change', () => {
      opts[key] = cast(field.value);
      if (key === 'count' || key === 'viz') render();
      else { placeFooter(); applyGeometry(); layout(); }
    });
  };

  on('c-frame', 'frame');
  on('c-count', 'count', Number);
  on('c-gap', 'gap', Number);
  on('c-record', 'record', Number);
  on('c-spin', 'spin');
  on('c-viz', 'viz');
  on('c-fill', 'fill');
  on('c-footer', 'footer');
  on('c-guides', 'guides');

  document.getElementById('c-reroll').addEventListener('click', () => {
    sleeveOffset += 1;
    render();
  });

  document.getElementById('c-shuffle').addEventListener('click', () => {
    order = order.slice(1).concat(order[0]);
    render();
  });

  // Chrome and guides off in one key, so the frame can be photographed
  // without anything the rig added to it in shot.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'h' || event.key === 'H') {
      document.body.classList.toggle('is-clean');
      layout();
    }
  });

  window.addEventListener('resize', () => layout());
}

load().then(() => {
  render();
  bind();
  // The covers decide the row's height once they have loaded, so the fit is
  // taken again after the last one arrives rather than guessed before.
  window.addEventListener('load', () => layout());
  document.fonts?.ready.then(() => layout());
});
