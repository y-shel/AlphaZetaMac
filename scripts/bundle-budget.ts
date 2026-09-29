import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Spec 17.5: drill-path bundle under 150KB gzipped. In Plan 1 every chunk is drill path.
// Plan 3 narrows this to the drill chunk once the dashboard is split out.
const BUDGET_BYTES = 150 * 1024;
const dir = 'dist/assets';

const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error(`No JS found in ${dir}. Run vite build first.`);
  process.exit(1);
}

let total = 0;
for (const file of files) {
  const size = gzipSync(readFileSync(join(dir, file))).length;
  total += size;
  console.log(`${file}  ${(size / 1024).toFixed(1)} KB gzip`);
}
console.log(`total ${(total / 1024).toFixed(1)} KB gzip, budget ${BUDGET_BYTES / 1024} KB`);
if (total > BUDGET_BYTES) {
  console.error('Over the drill bundle budget.');
  process.exit(1);
}
