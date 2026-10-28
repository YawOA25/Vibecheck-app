/**
 * Makes the app icon and splash PNGs from the master art (VC-71, Q4).
 *
 * What it does: reads assets/brand/mark.svg (the gold "vibe gauge" mark),
 * makes the five variants the Q4 spec asks for, draws each one at exactly
 * 1024 x 1024 and saves it in assets/images/:
 *
 *   icon.png                     dark background, mark 1.2x bigger. Saved
 *                                WITHOUT a transparency channel, because the
 *                                App Store rejects icons that have one.
 *   android-icon-foreground.png  transparent, mark at 1x (fits Android's
 *                                central 626 px safe circle).
 *   android-icon-background.png  solid #0A0A0C, no transparency.
 *   android-icon-monochrome.png  transparent, no grey track, the gold parts
 *                                in white (Android 13 tints it to match the
 *                                phone's theme).
 *   splash-icon.png              same as the foreground.
 *
 * Why a script: the PNGs must always match the SVG. If the mark ever
 * changes, edit mark.svg and run this again instead of redrawing five files.
 *
 * What it needs: the SVG drawing library @resvg/resvg-js. On purpose it is
 * NOT in package.json (the spec says no new packages): it's only needed on
 * the rare day the art changes. Install it somewhere outside the app and
 * point NODE_PATH at it, for example (Bash):
 *
 *   npm i --prefix "$TEMP/resvg" @resvg/resvg-js@2.6.2
 *   NODE_PATH="$TEMP/resvg/node_modules" node scripts/export-brand-pngs.js
 *
 * Inputs: none on the command line. Output: the five PNG files, and one
 * line per file on screen. Exits with an error if resvg isn't found or the
 * SVG has changed shape so a variant can't be made.
 *
 * The new icons only show in a new development or EAS build (Expo Go shows
 * its own icon).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** The app folder (this file lives in apps/vibecheck/scripts/). */
const APP_DIR = path.join(__dirname, '..');
const MASTER = path.join(APP_DIR, 'assets', 'brand', 'mark.svg');
const OUT_DIR = path.join(APP_DIR, 'assets', 'images');
/** Every file is a 1024 px square (spec section 4). */
const SIZE = 1024;

/**
 * Loads the SVG drawing library, or stops with instructions.
 *
 * @returns resvg's `Resvg` class.
 */
function loadResvg() {
  try {
    return require('@resvg/resvg-js').Resvg;
  } catch {
    console.error(
      '@resvg/resvg-js not found. Install it outside the app and set NODE_PATH\n' +
        '(see the comment at the top of scripts/export-brand-pngs.js).',
    );
    process.exit(1);
  }
}

/**
 * Replaces one exact piece of the SVG text, and fails loudly if it isn't
 * there (so a changed master can't silently produce the wrong art).
 *
 * @param svg - the SVG text.
 * @param pattern - a regular expression that must match once.
 * @param replacement - what to put in its place.
 * @returns the changed SVG text.
 */
function replaceOnce(svg, pattern, replacement) {
  const matches = svg.match(new RegExp(pattern.source, 'g')) ?? [];
  if (matches.length !== 1) {
    throw new Error(`mark.svg changed: expected one match for ${pattern}, found ${matches.length}`);
  }
  return svg.replace(pattern, replacement);
}

/** The background rectangle line (deleted for the transparent files). */
const BG_RECT = /<rect width="1024" height="1024" fill="#0A0A0C"\/>/;
/** The mark's size, written as "scale(1)" in the master. */
const MARK_SCALE = /scale\(1\)/;
/** The grey track path (dropped from the monochrome icon). */
const TRACK = /<path [^>]*stroke="#2B2B31"\/>/;

/**
 * Builds each variant's SVG text from the master, as the spec's table says.
 *
 * @param master - the text of mark.svg.
 * @returns a map from PNG file name to { svg, opaque }. `opaque` files are
 *   saved without a transparency channel.
 */
function variants(master) {
  const transparent = replaceOnce(master, BG_RECT, '');
  const mono = replaceOnce(transparent, TRACK, '').replace(/#D6B97B/g, '#FFFFFF');
  // Just the dark square: the master with the whole mark group removed.
  const background = replaceOnce(master, /<g id="mark"[\s\S]*<\/g>/, '');
  return {
    'icon.png': { svg: replaceOnce(master, MARK_SCALE, 'scale(1.2)'), opaque: true },
    'android-icon-foreground.png': { svg: transparent, opaque: false },
    'android-icon-background.png': { svg: background, opaque: true },
    'android-icon-monochrome.png': { svg: mono, opaque: false },
    'splash-icon.png': { svg: transparent, opaque: false },
  };
}

/**
 * Wraps data in one PNG "chunk": length, 4-letter type, data, checksum.
 *
 * @param type - e.g. 'IHDR'.
 * @param data - the chunk's bytes.
 * @returns the chunk's bytes.
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Saves raw pixels as a PNG with only red, green and blue (no transparency
 * channel), which the App Store needs for the icon. Written by hand with
 * Node's own zlib, so no image package is needed.
 *
 * @param rgba - width x height x 4 bytes (red, green, blue, alpha). Every
 *   pixel must be fully opaque; the alpha byte is dropped.
 * @param width - pixels across.
 * @param height - pixels down.
 * @returns the PNG file's bytes.
 */
function encodeOpaquePng(rgba, width, height) {
  // Each row starts with a "filter" byte (0 = none), then 3 bytes per pixel.
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    rows[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      if (rgba[from + 3] !== 255) {
        throw new Error(`pixel ${x},${y} is see-through; an opaque file must not be`);
      }
      const to = rowStart + 1 + x * 3;
      rows[to] = rgba[from];
      rows[to + 1] = rgba[from + 1];
      rows[to + 2] = rgba[from + 2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per colour value
  header[9] = 2; // colour type 2 = RGB, no alpha
  header[10] = 0; // compression: deflate (the only option)
  header[11] = 0; // filter method 0
  header[12] = 0; // not interlaced
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // the PNG signature
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draws every variant and saves it.
 *
 * @returns nothing; writes the files and prints one line each.
 */
function main() {
  const Resvg = loadResvg();
  const master = fs.readFileSync(MASTER, 'utf8');
  for (const [file, { svg, opaque }] of Object.entries(variants(master))) {
    // Draw at exactly 1024 px wide (the SVG is square, so 1024 tall too).
    const image = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render();
    if (image.width !== SIZE || image.height !== SIZE) {
      throw new Error(`${file} came out ${image.width} x ${image.height}, not ${SIZE}`);
    }
    // Opaque files are re-saved without alpha; the others keep resvg's PNG.
    const png = opaque ? encodeOpaquePng(image.pixels, SIZE, SIZE) : image.asPng();
    fs.writeFileSync(path.join(OUT_DIR, file), png);
    console.log(`${file}: ${SIZE} x ${SIZE}, ${opaque ? 'opaque (RGB)' : 'transparent (RGBA)'}`);
  }
}

main();
