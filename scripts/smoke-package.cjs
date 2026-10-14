const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-package-'));
const env = {...process.env};
delete env.CODEX_HOME;
delete env.CLAUDE_CONFIG_DIR;
function run(args) {
  const result = spawnSync(process.execPath, args, {encoding:'utf8', env, timeout:60000});
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}
try {
  const packed = JSON.parse(run([process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', root]));
  const tar = path.join(root, packed[0].filename);
  assert.ok(!packed[0].files.some(f => /\.py$|node_modules|stdout\.txt/.test(f.path)));
  run([process.env.npm_execpath, 'exec', '--yes', '--package', tar, '--', 'claude-codex-discussion', 'install', '--home', root]);
  for (const assistant of ['.codex', '.claude']) {
    const cli = path.join(root, assistant, 'skills', 'claude-codex-discussion', 'dist', 'cli.cjs');
    assert.equal(run([cli, '--version']).trim(), '2.0.0');
  }
  console.log('Packed npm install and both standalone runtimes verified');
} finally { fs.rmSync(root, {recursive:true, force:true}); }
