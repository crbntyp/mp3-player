const fs    = require('fs');
const https = require('https');
const path  = require('path');
const sharp = require('sharp');
const { Vibrant } = require('node-vibrant/node');

const PEXELS_API_KEY = 'vTST9e7OjHJBkzipEIm5gFCofIiNeQ5XfRlPU8zk4yN7xLt5qRMv25Zu';

// Dark music-gear aesthetic — moody studio shots of mixers, synths,
// DJ booths with neon accent lighting. Reference:
// https://www.pexels.com/photo/lights-on-music-mixer-17225445/
const SEARCH_QUERIES = [
    'music mixer',
    'audio mixer',
    'dj booth',
    'mixing console',
    'synthesizer dark',
];
const PINNED_PHOTO_IDS = [17225445]; // always include the user's reference.

const TARGET_COUNT  = 10;
const IMAGE_SIZE    = 1024;
const PER_QUERY_MAX = 3;   // round-robin so each subject is represented
const MAX_LUMINANCE = 0.55; // allow neon-accented dark scenes through

const OUT_DIR  = path.join(__dirname, '..', 'public', 'img', 'placeholders');
const OUT_JSON = path.join(__dirname, '..', 'src', 'data', 'placeholders.json');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('🖤 Fetching dark / B&W placeholder images from Pexels...\n');

function relativeLuminance(hex) {
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 0xff) / 255;
    const g = ((n >> 8)  & 0xff) / 255;
    const b = (n         & 0xff) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function fetchImages(query, page = 1) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.pexels.com',
            path: `/v1/search?query=${encodeURIComponent(query)}&per_page=80&page=${page}&orientation=square`,
            headers: { Authorization: PEXELS_API_KEY },
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response.photos || []);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
            const ws = fs.createWriteStream(filepath);
            res.pipe(ws);
            ws.on('finish', () => { ws.close(); resolve(); });
            ws.on('error', reject);
        }).on('error', reject);
    });
}

async function extractColorPalette(imagePath) {
    try {
        const palette = await Vibrant.from(imagePath).getPalette();
        return {
            primary:   palette.Vibrant?.hex      || '#6366f1',
            secondary: palette.DarkVibrant?.hex  || '#4f46e5',
            accent:    palette.LightVibrant?.hex || '#a78bfa',
            muted:     palette.Muted?.hex        || '#94a3b8',
            dark:      palette.DarkMuted?.hex    || '#1e293b',
            light:     palette.LightMuted?.hex   || '#e2e8f0',
        };
    } catch (e) {
        console.error('  ⚠️  Palette extraction failed:', e.message);
        return {
            primary: '#6366f1', secondary: '#4f46e5', accent: '#a78bfa',
            muted: '#94a3b8', dark: '#1e293b', light: '#e2e8f0',
        };
    }
}

// Sharp pipeline: keep colour but pull the midtones down so the neon
// accents on dark gear pop. No greyscale — the reference image is
// chromatic.
async function processImage(srcPath, destPath) {
    await sharp(srcPath)
        .modulate({ brightness: 0.9, saturation: 1.1 })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(destPath);
}

function fetchPhotoById(id) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.pexels.com',
            path: `/v1/photos/${id}`,
            headers: { Authorization: PEXELS_API_KEY },
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function tryAccept(photo, query, collected) {
    if (collected.some((p) => p.id === photo.id)) return false;
    const tempPath  = path.join(__dirname, `temp_${photo.id}.jpg`);
    const finalPath = path.join(OUT_DIR, `${photo.id}.jpg`);
    const imageUrl  = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=${IMAGE_SIZE}&h=${IMAGE_SIZE}&fit=crop`;
    try {
        await downloadImage(imageUrl, tempPath);
        await processImage(tempPath, finalPath);
        const colors = await extractColorPalette(finalPath);
        fs.unlinkSync(tempPath);
        collected.push({
            id: photo.id,
            url: `img/placeholders/${photo.id}.jpg`,
            photographer: photo.photographer,
            photographer_url: photo.photographer_url,
            query,
            colors,
        });
        console.log(`  ✓ kept #${photo.id} (${colors.primary})`);
        return true;
    } catch (error) {
        console.error(`  ⚠️  Error processing #${photo.id}:`, error.message);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return false;
    }
}

async function collect() {
    const collected = [];

    // Pinned references first.
    for (const pinId of PINNED_PHOTO_IDS) {
        try {
            const photo = await fetchPhotoById(pinId);
            if (photo && photo.id) await tryAccept(photo, 'pinned', collected);
        } catch (e) {
            console.error(`  ⚠️  Failed to fetch pinned #${pinId}:`, e.message);
        }
    }

    for (const query of SEARCH_QUERIES) {
        if (collected.length >= TARGET_COUNT) break;
        console.log(`Searching: "${query}"...`);

        const photos = await fetchImages(query, 1);
        if (!photos || photos.length === 0) continue;

        let acceptedForQuery = 0;
        for (const photo of photos) {
            if (collected.length >= TARGET_COUNT) break;
            if (acceptedForQuery >= PER_QUERY_MAX) break;
            if (collected.some((p) => p.id === photo.id)) continue;

            const tempPath = path.join(__dirname, `temp_${photo.id}.jpg`);
            const finalPath = path.join(OUT_DIR, `${photo.id}.jpg`);
            const imageUrl = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=${IMAGE_SIZE}&h=${IMAGE_SIZE}&fit=crop`;

            try {
                await downloadImage(imageUrl, tempPath);
                await processImage(tempPath, finalPath);
                const colors = await extractColorPalette(finalPath);

                if (relativeLuminance(colors.primary) > MAX_LUMINANCE) {
                    fs.unlinkSync(tempPath);
                    fs.unlinkSync(finalPath);
                    continue;
                }

                collected.push({
                    id: photo.id,
                    url: `img/placeholders/${photo.id}.jpg`,
                    photographer: photo.photographer,
                    photographer_url: photo.photographer_url,
                    query,
                    colors,
                });
                acceptedForQuery++;
                console.log(`  ✓ kept #${photo.id} (${colors.primary})`);

                fs.unlinkSync(tempPath);
            } catch (error) {
                console.error(`  ⚠️  Error processing photo ${photo.id}:`, error.message);
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }
        }
    }

    fs.writeFileSync(OUT_JSON, JSON.stringify({ images: collected }, null, 2));
    console.log(`\n✅ Collected ${collected.length} B&W placeholders`);
    console.log(`📁 Manifest: ${OUT_JSON}`);
    console.log(`📁 Images:   ${OUT_DIR}\n`);
}

collect().catch((e) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
});
