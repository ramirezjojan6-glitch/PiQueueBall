"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const bg = "#2A9B5B";
const textColor = "#FFFFFF";

const svgMarkup = (size, text = "PQB.") => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="${bg}"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${Math.round(size * 0.34)}"
        font-weight="700"
        letter-spacing="-2"
        fill="${textColor}">${text}</text>
</svg>
`.trim();

async function writePng(filePath, size, text = "PQB.") {
  const svg = svgMarkup(size, text);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(filePath, png);
}

(async () => {
  await writePng(path.join(projectRoot, "assets", "logo.png"), 1024);

  const iconDirs = [
    ["android/app/src/main/res/mipmap-mdpi", 48],
    ["android/app/src/main/res/mipmap-hdpi", 72],
    ["android/app/src/main/res/mipmap-xhdpi", 96],
    ["android/app/src/main/res/mipmap-xxhdpi", 144],
    ["android/app/src/main/res/mipmap-xxxhdpi", 192]
  ];

  for (const [dir, size] of iconDirs) {
    const fullDir = path.join(projectRoot, dir);
    await writePng(path.join(fullDir, "ic_launcher.png"), size);
    await writePng(path.join(fullDir, "ic_launcher_round.png"), size);
    await writePng(path.join(fullDir, "ic_launcher_foreground.png"), size);
  }

  fs.writeFileSync(
    path.join(projectRoot, "android/app/src/main/res/values/ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`
  );

  console.log("Custom PQB logo assets updated.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
