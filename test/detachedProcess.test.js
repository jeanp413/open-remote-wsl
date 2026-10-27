const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const ts = require('typescript');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-remote-wsl-test-'));
const helperPath = path.join(directory, 'detachedProcess.js');
fs.writeFileSync(helperPath, ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/common/detachedProcess.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText);
const { runDetachedUntilOutput } = require(helperPath);
after(() => fs.rmSync(directory, { recursive: true, force: true }));

function fixture(name, source) {
    const file = path.join(directory, name + '.js');
    fs.writeFileSync(file, source);
    // The launcher deliberately uses Windows verbatim arguments, like WSLManager.
    return process.platform === 'win32' ? `"${file}"` : file;
}

test('reads a completion marker split across writes', async () => {
    const script = fixture('split', `
        process.stderr.write('diagnostic');
        process.stdout.write('result\\nscript: ');
        setTimeout(() => process.stdout.write('end\\n'), 150);
    `);
    const result = await runDetachedUntilOutput(process.execPath, [script], 'script: end');
    assert.equal(result.stdout, 'result\nscript: end\n');
    assert.equal(result.stderr, 'diagnostic');
    assert.equal(result.exitCode, 0);
});

test('returns output and exit status when the command fails before completion', async () => {
    const script = fixture('failure', `
        process.stdout.write('partial result');
        process.stderr.write('failed to start');
        process.exitCode = 7;
    `);
    const result = await runDetachedUntilOutput(process.execPath, [script], 'script: end');
    assert.deepEqual(result, { stdout: 'partial result', stderr: 'failed to start', exitCode: 7 });
});

test('reports command spawn errors from the helper', async () => {
    const result = await runDetachedUntilOutput(
        path.join(directory, 'missing-executable'), [], 'script: end'
    );
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOENT/);
});

test('the launcher survives its parent exiting without holding the parent open', async () => {
    const sentinel = path.join(directory, 'survived');
    const childScript = fixture('survivor', `
        process.stdout.write('script: end\\n');
        setTimeout(() => {
            require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'alive');
        }, 2000);
    `);
    const parentScript = fixture('parent', `
        require(${JSON.stringify(helperPath)}).runDetachedUntilOutput(
            process.execPath, [${JSON.stringify(childScript)}], 'script: end'
        ).then(result => process.stdout.write(JSON.stringify(result)));
    `);
    // spawnSync does its own quoting, unlike the helper under test.
    const parent = cp.spawnSync(process.execPath, [parentScript.replace(/^"|"$/g, '')], {
        encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(parent.error);
    assert.equal(parent.status, 0, parent.stderr);
    assert.equal(JSON.parse(parent.stdout).exitCode, 0);
    assert.equal(fs.existsSync(sentinel), false, 'parent must exit before its child finishes');
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(sentinel) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'alive');
});
