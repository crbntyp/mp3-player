const fs    = require('fs');
const https = require('https');
const path  = require('path');
const sharp = require('sharp');
const { Vibrant } = require('node-vibrant/node');

const PEXELS_API_KEY = 'vTST9e7OjHJBkzipEIm5gFCofIiNeQ5XfRlPU8zk4yN7xLt5qRMv25Zu';

// Spiral-staircase / dark-architecture-from-above aesthetic. Moody,
// high-contrast, near-monochrome shots of spiral staircases looking up
// or down. The 21-photo pinned set is hand-curated from the Pexels
// search the user shared, plus supplemental API results — every entry
// verified avg_color luminance < 0.05.
const SEARCH_QUERIES = [
    'spiral staircase',
    'spiral staircase from above',
    'spiral staircase from below',
    'spiral staircase monochrome',
];
const PINNED_PHOTO_IDS = [
    // From the user's exact Pexels search.
    13259293, 11710172, 7630930, 11101129, 13582399,
    7140997, 16955371, 11984251, 5068758, 16355722,
    5587174, 4977562, 5596458, 2630772,
    // Additional dark spiral staircases from API search.
    19466345, 6333850, 19466344, 29330242, 31557560,
    6357147, 20180314,
];

const TARGET_COUNT  = 25;          // pinned set already exceeds this
const IMAGE_SIZE    = 1024;
const PER_QUERY_MAX = 4;
// Strict darkness gate for any fallback queries — pins bypass this.
const MAX_AVG_LUMINANCE = 0.05;

// Must mention an actual staircase — "spiral" alone leaks galaxies,
// candle arrangements, and abstract spiral art.
const ALT_REQUIRED = ['staircase', 'stairway', 'stairs'];
const ALT_FORBIDDEN = [
    'woman', 'man', 'person', 'people', 'girl', 'boy', 'child',
    'face', 'portrait', 'couple', 'smiling',
];

function altPasses(alt) {
    if (!alt || typeof alt !== 'string') return false;
    const lower = alt.toLowerCase();
    if (ALT_FORBIDDEN.some((tok) => lower.includes(tok))) return false;
    if (!ALT_REQUIRED.some((tok) => lower.includes(tok))) return false;
    return true;
}

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

// Sharp pipeline: subtle darken + slight desaturate to push the staircase
// shots toward a unified moody monochrome look. The source images are
// already near-B&W; this just enforces consistency across the set.
async function processImage(srcPath, destPath) {
    await sharp(srcPath)
        .modulate({ brightness: 0.85, saturation: 0.85 })
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

        // Pull two pages so the strict alt filter has more candidates.
        const [p1, p2] = await Promise.all([fetchImages(query, 1), fetchImages(query, 2)]);
        const photos = [...(p1 || []), ...(p2 || [])];
        if (photos.length === 0) continue;

        let acceptedForQuery = 0;
        for (const photo of photos) {
            if (collected.length >= TARGET_COUNT) break;
            if (acceptedForQuery >= PER_QUERY_MAX) break;
            if (collected.some((p) => p.id === photo.id)) continue;

            // Pre-filter on the API-provided avg_color so we don't burn
            // bandwidth on photos with bright backgrounds.
            if (relativeLuminance(photo.avg_color) > MAX_AVG_LUMINANCE) continue;
            // Alt-text gate — abstract subjects only, no scenes or people.
            if (!altPasses(photo.alt)) continue;

            const tempPath = path.join(__dirname, `temp_${photo.id}.jpg`);
            const finalPath = path.join(OUT_DIR, `${photo.id}.jpg`);
            const imageUrl = `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=${IMAGE_SIZE}&h=${IMAGE_SIZE}&fit=crop`;

            try {
                await downloadImage(imageUrl, tempPath);
                await processImage(tempPath, finalPath);
                const colors = await extractColorPalette(finalPath);

                collected.push({
                    id: photo.id,
                    url: `img/placeholders/${photo.id}.jpg`,
                    photographer: photo.photographer,
                    photographer_url: photo.photographer_url,
                    query,
                    colors,
                });
                acceptedForQuery++;
                console.log(`  ✓ kept #${photo.id} (avg ${photo.avg_color}, primary ${colors.primary})`);

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
