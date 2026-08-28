# Drop-in cover art

Art placed here wins over whatever is embedded in the MP3.

Name the file after the track's **slug** — the audio filename lowercased with
every run of non-alphanumeric characters collapsed to a single `-`:

| Source MP3 | Slug | Drop-in file |
|---|---|---|
| `Green Velvet - Flash (DJ Elite That Fuct Camera Mix).mp3` | `green-velvet-flash-dj-elite-that-fuct-camera-mix` | `green-velvet-flash-dj-elite-that-fuct-camera-mix.jpg` |

`.jpg`, `.jpeg`, `.png` and `.webp` all work. Square art is expected — anything
else is centre-cropped.

Run `npm run generate-palettes` (or any `npm run build`) afterwards. The image
is resized to a 720px cover plus a 240px vinyl-label version, and the track's
whole colour palette is re-derived from it.

Tracks currently falling back to a placeholder for want of art:

- `freefall-skydive-i-feel-wonderful`
- `green-velvet-flash-dj-elite-that-fuct-camera-mix`
- `taiko-silence-club-mix-nme`

Source files in here are inputs, not build output — commit them.
