import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..');
const releaseDir = resolve(root, 'release');
const installerName = `iFicam-Setup-${pkg.version}.exe`;
const installerPath = resolve(releaseDir, installerName);
const latestPath = resolve(releaseDir, 'latest.yml');

const data = await readFile(installerPath);
const info = await stat(installerPath);
const sha512 = createHash('sha512').update(data).digest('base64');
const releaseDate = new Date().toISOString();

const latest = [
  `version: ${pkg.version}`,
  'files:',
  `  - url: ${installerName}`,
  `    sha512: ${sha512}`,
  `    size: ${info.size}`,
  `path: ${installerName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n');

await writeFile(latestPath, latest, 'utf8');
console.log(`Prepared release metadata for ${installerName}`);
