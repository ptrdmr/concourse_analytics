import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dest = join(root, '.netlify', 'blobs', 'deploy');
const tipsDir = join(root, 'public', 'data', 'tips');

await mkdir(join(dest, 'tips'), { recursive: true });

const names = await readdir(tipsDir);
let count = 0;
for (const name of names) {
  if (!name.endsWith('.json') || name.startsWith('$')) continue;
  await cp(join(tipsDir, name), join(dest, 'tips', name));
  count += 1;
}

await cp(join(root, 'public', 'data', 'gratuity.json'), join(dest, 'gratuity.json'));
await cp(join(root, 'public', 'data', 'service_charges.json'), join(dest, 'service_charges.json'));

console.log(`Staged ${count} tip months and the POS records for this deploy.`);
