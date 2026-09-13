import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_ROOT } from './build-catalog.mjs';

async function check(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) count += await check(file);
    else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${path.relative(DEFAULT_ROOT, file)}`);
      count++;
    }
  }
  return count;
}

let count = 0;
for (const directory of ['tools', 'contract', 'studio', 'social']) count += await check(path.join(DEFAULT_ROOT, directory));
console.log(`Syntax checked ${count} JavaScript files; no transpiler or external linter required.`);
