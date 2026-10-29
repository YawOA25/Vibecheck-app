/**
 * Checks that every area in the admin form's list has a map centre (VC-79).
 *
 * Why: the map draws each event as a circle around its area's centre, which
 * lives in the database (seeded by migration 20261029110000_map_points.sql).
 * If someone adds an area to src/data/dmv-areas.ts but not to the seed, its
 * events would silently drop off the map. This test reads the migration's
 * SQL text and fails if any listed label is missing, or if any circle is
 * under the 600 m privacy floor.
 *
 * It's a .js file because it reads a file with Node's `fs` (the app's
 * TypeScript setup has no Node types).
 */
const fs = require('node:fs');
const path = require('node:path');

const { DMV_AREAS } = require('../src/data/dmv-areas');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261029110000_map_points.sql'),
  'utf8',
);

/**
 * Pulls the seeded rows out of the migration text.
 *
 * @returns a list of { label, lat, lng, radius } from lines like
 *   "('Shaw, DC', 38.9123, -77.0219, 600),". SQL's doubled quote ('') is
 *   turned back into one apostrophe.
 */
function seededRows() {
  const rows = [];
  const pattern = /\('((?:[^']|'')+)',\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(\d+)\)/g;
  for (const m of sql.matchAll(pattern)) {
    rows.push({
      label: m[1].replace(/''/g, "'"),
      lat: Number(m[2]),
      lng: Number(m[3]),
      radius: Number(m[4]),
    });
  }
  return rows;
}

describe('area_centroids seed', () => {
  const rows = seededRows();
  const labels = new Set(rows.map((r) => r.label));

  it('has a centre for every area in the app list', () => {
    const missing = DMV_AREAS.map((a) => a.label).filter((label) => !labels.has(label));
    expect(missing).toEqual([]);
  });

  it('has nothing the app list lacks, and no duplicates', () => {
    const listed = new Set(DMV_AREAS.map((a) => a.label));
    expect(rows.filter((r) => !listed.has(r.label))).toEqual([]);
    expect(rows).toHaveLength(labels.size);
  });

  it('keeps every circle at 600 m or more, inside the DMV-to-Richmond box', () => {
    for (const r of rows) {
      expect(r.radius).toBeGreaterThanOrEqual(600);
      expect(r.lat).toBeGreaterThan(37);
      expect(r.lat).toBeLessThan(39.8);
      expect(r.lng).toBeGreaterThan(-78);
      expect(r.lng).toBeLessThan(-76.4);
    }
  });
});
