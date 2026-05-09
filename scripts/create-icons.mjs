import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');

const svgBuffer = readFileSync(resolve(publicDir, 'favicon.svg'));

async function makeIcon(size, outputFile) {
  const iconSize = Math.round(size * 0.8);
  const padding = Math.floor((size - iconSize) / 2);

  const icon = await sharp(svgBuffer)
    .resize(iconSize, iconSize)
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 13, g: 13, b: 13, alpha: 1 } },
  })
    .composite([{ input: icon, top: padding, left: padding }])
    .png()
    .toFile(resolve(publicDir, outputFile));

  console.log(`Created ${outputFile} (${size}x${size}, icon ${iconSize}x${iconSize})`);
}

await makeIcon(180, 'apple-touch-icon.png');
await makeIcon(192, 'icon-192.png');
await makeIcon(512, 'icon-512.png');
console.log('Icons generated successfully.');
