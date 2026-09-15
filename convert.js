const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');

loadImage('icon.svg').then(img => {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 256, 256);
  fs.writeFileSync('icon.png', canvas.toBuffer());
  console.log('Done');
}).catch(e => {
  console.error(e);
  process.exit(1);
});
