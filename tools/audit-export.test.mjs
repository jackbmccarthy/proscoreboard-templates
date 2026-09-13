import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditExport } from './audit-export.mjs';

test('export audit reports hidden files, secrets, absolute paths and symlinks without modifying or exposing values', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'template-audit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sources'));
  await mkdir(path.join(root, 'reviews'));
  await writeFile(path.join(root, 'sources/.DS_Store'), 'preserved');
  await writeFile(path.join(root, '.env'), 'must remain unread and unprinted');
  const token = ['ghp_', 'x'.repeat(35)].join('');
  const privatePath = ['', 'Users', 'fixture-person', 'private'].join('/');
  await writeFile(path.join(root, 'sources/example.txt'), `${token}\n${privatePath}`);
  await writeFile(path.join(root, 'reviews/test.json'), '{}');
  await symlink(path.join(root, 'sources/example.txt'), path.join(root, 'sources/link.txt'));
  const report = await auditExport(root);
  for (const category of ['excluded-os-metadata', 'excluded-hidden-file', 'github-token', 'local-absolute-path', 'symlink']) assert.ok(report.findings.some((finding) => finding.category === category), category);
  assert.ok(!report.findings.some((finding) => finding.file === 'reviews'));
  assert.equal(await readFile(path.join(root, 'sources/.DS_Store'), 'utf8'), 'preserved');
  assert.equal(await readFile(path.join(root, '.env'), 'utf8'), 'must remain unread and unprinted');
  assert.ok(!JSON.stringify(report).includes(token));
  assert.ok(!JSON.stringify(report).includes(privatePath));
});
