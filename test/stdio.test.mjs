import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const dist = new URL('../dist/', import.meta.url);

test('package contains the built stdio binary', async () => {
  await access(new URL('cli.js', dist));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['orin-mcp'], './dist/cli.js');
  assert.equal(pkg.files.includes('dist'), true);
});

test('diagnostic logging never writes to stdout', async () => {
  const script = `import { log } from ${JSON.stringify(new URL('logging.js', dist).href)}; log('info','stdio-safe',{});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.match(stderr, /stdio-safe/);
});
