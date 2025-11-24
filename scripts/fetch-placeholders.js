const fs = require('fs');
const https = require('https');

const PEXELS_API_KEY = 'vTST9e7OjHJBkzipEIm5gFCofIiNeQ5XfRlPU8zk4yN7xLt5qRMv25Zu';
const SEARCH_QUERIES = ['cyberpunk', 'neon city', 'futuristic', 'synthwave', 'vaporwave'];
const TARGET_COUNT = 20;

console.log('🎨 Fetching cyberpunk placeholder images from Pexels...\n');

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

async function fetchAllImages() {
    for (const query of SEARCH_QUERIES) {
        if (allPlaceholders.length >= TARGET_COUNT) break;

        console.log(`Searching: "${query}"...`);
        const photos = await fetchImages(query);

        for (const photo of photos) {
            if (allPlaceholders.length >= TARGET_COUNT) break;

            // Skip duplicates
            if (allPlaceholders.some(p => p.id === photo.id)) continue;

            allPlaceholders.push({
                id: photo.id,
                url: photo.src.large,
                photographer: photo.photographer,
                photographer_url: photo.photographer_url
            });
        }

        console.log(`  Found ${photos.length} images (${allPlaceholders.length}/${TARGET_COUNT} collected)`);
    }

    // Save to JSON file
    const outputPath = './src/data/placeholders.json';
    fs.writeFileSync(outputPath, JSON.stringify({ images: allPlaceholders }, null, 2));

    console.log(`\n✅ Fetched ${allPlaceholders.length} images`);
    console.log(`📁 Saved to: ${outputPath}\n`);

    allPlaceholders.forEach((img, i) => {
        console.log(`  ${i + 1}. Photo by ${img.photographer}`);
    });
}

fetchAllImages().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
