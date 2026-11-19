import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Compressed copies of the private tip JSON, bundled into the tip-data function
// only (netlify.toml included_files). Raw, the files are too large to bundle.
const root = process.cwd();
const data = join(root, 'public', 'data');
const dest = join(root, 'netlify', 'tip-data');

await rm(dest, { recursive: true, force: true });
await mkdir(join(dest, 'tips'), { recursive: true });

const files = [];
for (const name of await readdir(join(data, 'tips'))) {
  if (name.endsWith('.json')) files.push(join('tips', name));
}
const months = files.length;
files.push('gratuity.json', 'service_charges.json');

let raw = 0;
let packed = 0;
for (const rel of files) {
  const text = await readFile(join(data, rel));
  const gz = gzipSync(text, { level: 9 });
  await writeFile(join(dest, `${rel}.gz`), gz);
  raw += text.length;
  packed += gz.length;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`Packed ${months} tip months and the POS records for the tip-data function (${mb(raw)} MB -> ${mb(packed)} MB).`);
