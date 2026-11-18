import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';

const data = join(process.cwd(), 'out', 'data');
const targets = [
  join(data, 'tips'),
  join(data, 'punches.json'),
  join(data, 'gratuity.json'),
  join(data, 'service_charges.json'),
];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}

const left = [];
for (const target of targets) {
  try {
    await access(target);
    left.push(target);
  } catch {
    // Removed, which is what we want.
  }
}

if (left.length) {
  console.error(`Private tip data is still in the published site: ${left.join(', ')}`);
  process.exit(1);
}

console.log('Removed private tip data from the published site.');
