import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDeployStore } from '@netlify/blobs';

// Netlify does not upload a staged .netlify/blobs folder for this site, so the
// files are written to the deploy store directly. The store only exists inside a
// Netlify build; a local `npm run build` has nowhere to put them.
if (process.env.NETLIFY !== 'true') {
  console.log('Not a Netlify build - tip files were not published to deploy storage.');
  process.exit(0);
}

const root = process.cwd();
const tipsDir = join(root, 'public', 'data', 'tips');

const files = [];
for (const name of await readdir(tipsDir)) {
  if (!name.endsWith('.json') || name.startsWith('$')) continue;
  files.push({ key: `tips/${name}`, path: join(tipsDir, name) });
}
const months = files.length;
files.push({ key: 'gratuity.json', path: join(root, 'public', 'data', 'gratuity.json') });
files.push({ key: 'service_charges.json', path: join(root, 'public', 'data', 'service_charges.json') });

const store = getDeployStore();
for (const file of files) {
  await store.set(file.key, await readFile(file.path, 'utf8'));
}

// The tip page reads with strong consistency, so check the same way: a deploy
// that cannot read its own tip files should fail here, not on the GM's screen.
const probe = files[0];
const back = await store.get(probe.key, { type: 'text', consistency: 'strong' });
if (back == null) {
  console.error(`Wrote ${files.length} files to deploy storage but could not read ${probe.key} back.`);
  process.exit(1);
}

console.log(`Published ${months} tip months and the POS records to deploy storage.`);
