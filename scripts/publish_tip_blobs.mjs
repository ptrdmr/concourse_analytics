import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDeployStore } from '@netlify/blobs';

// The store only exists inside a Netlify build, so a local `npm run build` has
// nowhere to put the tip files.
if (process.env.NETLIFY !== 'true') {
  console.log('Not a Netlify build - tip files were not published to deploy storage.');
  process.exit(0);
}

// The nightly sales, labor, and reservation data ship in the same deploy. A tip
// upload failure must not block them, so it warns loudly and lets the build go on;
// the tip page then says it cannot load the month.
function skip(reason) {
  console.warn(`WARNING: tip files were NOT published, so the Gratuity page will have no data. ${reason}`);
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

try {
  const store = getDeployStore({ deployID: process.env.DEPLOY_ID });
  for (const file of files) {
    await store.set(file.key, await readFile(file.path, 'utf8'));
  }
  const probe = files[0];
  const back = await store.get(probe.key, { type: 'text', consistency: 'strong' });
  if (back == null) skip(`Wrote ${files.length} files but could not read ${probe.key} back.`);
} catch (err) {
  skip(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}

console.log(`Published ${months} tip months and the POS records to deploy storage.`);
