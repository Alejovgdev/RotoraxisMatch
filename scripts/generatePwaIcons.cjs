// Uses Expo's existing image tooling. No AI, new artwork or native asset edits.
// Run from any directory: node scripts/generatePwaIcons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { generateImageAsync } = require('@expo/image-utils');

const projectRoot = path.resolve(__dirname, '..');
const brandRoot = path.join(projectRoot, 'assets', 'images', 'brand');
const outputRoot = path.join(projectRoot, 'public', 'icons');

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const icons = [
    ['icon-192.png', 'icon.png', 192],
    ['icon-512.png', 'icon.png', 512],
    ['icon-maskable-512.png', 'adaptive-icon.png', 512],
    ['apple-touch-icon.png', 'icon.png', 180],
  ];

  for (const [name, source, size] of icons) {
    // The adaptive foreground already fits inside the maskable safe circle.
    // Preserve its full canvas and flatten it onto the original navy background.
    const { source: png } = await generateImageAsync(
      { projectRoot },
      {
        src: path.join(brandRoot, source),
        name,
        width: size,
        height: size,
        resizeMode: 'contain',
        backgroundColor: '#03295B',
        removeTransparency: true,
      },
    );
    fs.writeFileSync(path.join(outputRoot, name), png);
    console.log(`${name}: ${size}x${size} from ${source}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
