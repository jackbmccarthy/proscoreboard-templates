import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROOT } from './build-catalog.mjs';

const rootFiles = new Set(['package.json', 'README.md', 'AGENTS.md', '.gitignore', 'catalog.json']);
const directories = new Set(['templates', 'tools', 'contract', 'studio', 'reviews', 'published', '.github']);
const textExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.yml', '.yaml', '.csv', '.svg']);
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['credential-assignment', /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[=:]\s*["'][A-Za-z0-9_+\/-]{24,}["']/i],
  ['local-absolute-path', /(?:\/Users\/[^\s"'<>/]+\/|\/home\/[^\s"'<>/]+\/|\/private\/(?:tmp|var)\/|[A-Z]:\\Users\\)/],
];

/** Reports filenames and categories only, never suspected secret values. Does not modify assets. */
export async function auditExport(root = DEFAULT_ROOT) {
  const findings = [];
  const files = [];
  let totalBytes = 0;
  const report = (file, category, severity = 'warning', extra = {}) => findings.push({ file, category, severity, ...extra });
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && entry.name === '.git') continue;
      if (entry.isSymbolicLink()) { report(file, 'symlink', 'error'); continue; }
      if (entry.name === '.DS_Store' || entry.name.startsWith('._')) { report(file, 'excluded-os-metadata', 'info'); continue; }
      if (file === 'templates/references' || file === 'sources' || /\.(?:zip|tar|gz|7z)$/i.test(entry.name)) report(file, 'excluded-original-assets', 'error');
      if (entry.name.startsWith('.') && file !== '.gitignore' && file !== '.github') {
        report(file, 'excluded-hidden-file', 'error');
        continue;
      }
      if (!relative && !(entry.isDirectory() ? directories.has(entry.name) : rootFiles.has(entry.name))) report(file, 'outside-export-allowlist', 'error');
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) { report(file, 'non-regular-file', 'error'); continue; }
      const size = (await lstat(path.join(root, file))).size;
      totalBytes += size;
      files.push(file);
      if (size > 10_000_000) report(file, 'large-asset', size > 50_000_000 ? 'error' : 'warning', { bytes: size });
      if (/\.(?:pem|key|p12|pfx|sqlite3?|db)$/i.test(entry.name)) report(file, 'private-material-extension', 'error');
      if (path.extname(entry.name) === '.zip') report(file, 'archive-needs-human-inventory', 'warning');
      if (size > 8_000_000 || !textExtensions.has(path.extname(entry.name))) continue;
      const text = await readFile(path.join(root, file), 'utf8');
      for (const [category, pattern] of patterns) {
        const match = pattern.exec(text);
        if (match) report(file, category, 'error', { line: text.slice(0, match.index).split('\n').length });
      }
    }
  }
  await walk();
  return { files: files.length, totalBytes, findings: findings.sort((a, b) => a.file.localeCompare(b.file)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((value) => value !== '--check')) throw new Error('Usage: node tools/audit-export.mjs [--check]');
  const report = await auditExport();
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--check') && report.findings.some((finding) => finding.severity === 'error')) process.exitCode = 1;
}
