import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Spec 17.5: drill-path bundle under 150KB gzipped. The drill loads only the entry chunk,
// index-*.js. The dashboard chunk and the analysis worker load later, off the drill path.
const BUDGET_BYTES = 150 * 1024;
const dir = 'dist/assets';

const all = readdirSync(dir).filter((f) => f.endsWith('.js'));
const files = all.filter((f) => f.startsWith('index-'));
if (files.length === 0) {
  console.error(`No JS found in ${dir}. Run vite build first.`);
  process.exit(1);
}

for (const file of all.filter((f) => !files.includes(f))) {
  console.log(`${file}  ${(gzipSync(readFileSync(join(dir, file))).length / 1024).toFixed(1)} KB gzip, not on the drill path`);
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
