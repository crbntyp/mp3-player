const path = require('path');

// Shared filename slug. generate-palettes.js names covers with it and
// optimize-music.js names the transcoded audio with it, so tracks.json can
// reference both from one source filename. Keeping it here means the two
// scripts can't drift into disagreeing about what a track is called.
//
// Also gets spaces and parens out of the URLs — "Green Velvet - Flash (DJ
// Elite That Fuct Camera Mix).opus" needs escaping at every use site;
// "green-velvet-flash-dj-elite-that-fuct-camera-mix.opus" does not.
function slugify(name) {
  return path.parse(name).name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
