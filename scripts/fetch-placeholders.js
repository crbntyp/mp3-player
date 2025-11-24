const fs = require('fs');
const https = require('https');
const { Vibrant } = require('node-vibrant/node');
const path = require('path');

const PEXELS_API_KEY = 'vTST9e7OjHJBkzipEIm5gFCofIiNeQ5XfRlPU8zk4yN7xLt5qRMv25Zu';
const SEARCH_QUERIES = ['surreal', 'awkward', 'odd', 'weird', 'unreal', 'neon', 'techno'];
const TARGET_COUNT = 50;

console.log('🎨 Fetching surreal/weird/neon/techno images from Pexels...\n');

let allPlaceholders = [];
let currentQueryIndex = 0;

function fetchImages(query, page = 1) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.pexels.com',
            path: `/v1/search?query=${encodeURIComponent(query)}&per_page=80&page=${page}&orientation=square`,
            headers: {
                'Authorization': PEXELS_API_KEY
            }
        };

        https.get(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response.photos || []);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 200) {
                const writeStream = fs.createWriteStream(filepath);
                res.pipe(writeStream);
                writeStream.on('finish', () => {
                    writeStream.close();
                    resolve();
                });
                writeStream.on('error', reject);
            } else {
                reject(new Error(`Failed to download: ${res.statusCode}`));
            }
        }).on('error', reject);
    });
}

async function extractColorPalette(imagePath) {
    try {
        const palette = await Vibrant.from(imagePath).getPalette();
        return {
            primary: palette.Vibrant?.hex || '#6366f1',
            secondary: palette.DarkVibrant?.hex || '#4f46e5',
            accent: palette.LightVibrant?.hex || '#a78bfa',
            muted: palette.Muted?.hex || '#94a3b8',
            dark: palette.DarkMuted?.hex || '#1e293b',
            light: palette.LightMuted?.hex || '#e2e8f0'
        };
    } catch (error) {
        console.error('  ⚠️  Palette extraction failed:', error.message);
        return {
            primary: '#6366f1',
            secondary: '#4f46e5',
            accent: '#a78bfa',
            muted: '#94a3b8',
            dark: '#1e293b',
            light: '#e2e8f0'
        };
    }
}

async function fetchAllImages() {
    for (const query of SEARCH_QUERIES) {
        if (allPlaceholders.length >= TARGET_COUNT) break;

        console.log(`Searching: "${query}"...`);

        // Fetch multiple pages if needed
        let page = 1;
        while (allPlaceholders.length < TARGET_COUNT) {
            const photos = await fetchImages(query, page);

            if (!photos || photos.length === 0) break;

            for (const photo of photos) {
                if (allPlaceholders.length >= TARGET_COUNT) break;

                // Skip duplicates
                if (allPlaceholders.some(p => p.id === photo.id)) continue;

                // Download image temporarily to extract color palette
                const tempPath = path.join(__dirname, `temp_${photo.id}.jpg`);
                try {
                    await downloadImage(photo.src.large, tempPath);
                    const colors = await extractColorPalette(tempPath);

                    allPlaceholders.push({
                        id: photo.id,
                        url: photo.src.large,
                        photographer: photo.photographer,
                        photographer_url: photo.photographer_url,
                        colors: colors
                    });

                    // Clean up temporary file
                    fs.unlinkSync(tempPath);
                } catch (error) {
                    console.error(`  ⚠️  Error processing photo ${photo.id}:`, error.message);
                }
            }

            console.log(`  Page ${page}: Found ${photos.length} images (${allPlaceholders.length}/${TARGET_COUNT} collected)`);
            page++;
        }
    }

    // Save to JSON file
    const outputPath = './src/data/placeholders.json';
    fs.writeFileSync(outputPath, JSON.stringify({ images: allPlaceholders }, null, 2));

    console.log(`\n✅ Fetched ${allPlaceholders.length} images with color palettes`);
    console.log(`📁 Saved to: ${outputPath}\n`);

    allPlaceholders.forEach((img, i) => {
        console.log(`  ${i + 1}. Photo by ${img.photographer} - Primary: ${img.colors.primary}`);
    });
}

fetchAllImages().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
