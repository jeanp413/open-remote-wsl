/**
 * Validator unit tests for src/common/shellEscape.ts
 *
 * These tests verify the shell-safety helpers introduced to fix
 * security findings F-01 through F-09.  They run against the compiled
 * output of shellEscape.ts and require no test framework.
 *
 * Usage:
 *   npx tsc --outDir out-test src/common/shellEscape.ts --module commonjs --target es2019 --noEmit false
 *   node test-validators.js
 *
 * Exit code 0 = all passed.  Exit code 1 = one or more failures.
 */

'use strict';

const {
    shellEscapeSingleQuote,
    validateHttpsUrl,
    validateExtensionId,
    validateEnvVarName,
    validateDistroName,
    validateSimpleIdentifier,
    validateCommitHash,
    validateQuality,
} = require('./out-test/shellEscape');

let passed = 0;
let failed = 0;

function expect_block(label, fn) {
    try {
        fn();
        console.log('FAIL (no throw):', label);
        failed++;
    } catch (e) {
        console.log('BLOCKED ✓', label, '--', e.message);
        passed++;
    }
}

function expect_pass(label, fn) {
    try {
        fn();
        console.log('PASS  ✓', label);
        passed++;
    } catch (e) {
        console.log('FAIL (threw):', label, '--', e.message);
        failed++;
    }
}

function expect_eq(label, actual, expected) {
    if (actual === expected) {
        console.log('PASS  ✓', label);
        passed++;
    } else {
        console.log('FAIL:', label);
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        failed++;
    }
}

// ---------------------------------------------------------------------------
console.log('\n--- shellEscapeSingleQuote ---');
expect_eq('plain string',       shellEscapeSingleQuote('hello'),          "'hello'");
expect_eq('embedded quote',     shellEscapeSingleQuote("hello 'world'"),  "'hello '\\''world'\\'''");
expect_eq('cmd substitution $', shellEscapeSingleQuote('$(id)'),          "'$(id)'");
expect_eq('cmd substitution `', shellEscapeSingleQuote('`id`'),           "'`id`'");
expect_eq('backslash',          shellEscapeSingleQuote('a\\b'),           "'a\\b'");

// ---------------------------------------------------------------------------
console.log('\n--- F-04 validateDistroName ---');
expect_block('semicolon',       () => validateDistroName('Ubuntu;evil'));
expect_block('dollar',          () => validateDistroName('Ubuntu$evil'));
expect_block('plus',            () => validateDistroName('Ubuntu+evil'));
expect_block('space',           () => validateDistroName('Ubuntu evil'));
expect_pass ('Ubuntu',          () => validateDistroName('Ubuntu'));
expect_pass ('AlmaLinux-8',     () => validateDistroName('AlmaLinux-8'));
expect_pass ('My.Distro_1',     () => validateDistroName('My.Distro_1'));

// ---------------------------------------------------------------------------
console.log('\n--- F-02 validateExtensionId ---');
expect_block('semicolon',       () => validateExtensionId('bad;id'));
expect_block('path traversal',  () => validateExtensionId('../evil'));
expect_block('no dot',          () => validateExtensionId('nodot'));
expect_block('space',           () => validateExtensionId('pub lisher.ext'));
expect_pass ('ms-python.python',            () => validateExtensionId('ms-python.python'));
expect_pass ('publisher.ext-prerelease',    () => validateExtensionId('publisher.ext-prerelease'));

// ---------------------------------------------------------------------------
console.log('\n--- F-02 validateEnvVarName ---');
expect_block('leading digit',   () => validateEnvVarName('1BAD'));
expect_block('semicolon',       () => validateEnvVarName('MY;VAR'));
expect_block('space',           () => validateEnvVarName('MY VAR'));
expect_block('hyphen',          () => validateEnvVarName('MY-VAR'));
expect_pass ('MY_VAR',          () => validateEnvVarName('MY_VAR'));
expect_pass ('_PRIVATE',        () => validateEnvVarName('_PRIVATE'));
expect_pass ('lowercase',       () => validateEnvVarName('myVar'));

// ---------------------------------------------------------------------------
console.log('\n--- F-01/F-05 validateHttpsUrl ---');
expect_block('http://',         () => validateHttpsUrl('http://evil.com', 'url'));
expect_block('ftp://',          () => validateHttpsUrl('ftp://evil.com', 'url'));
expect_block('javascript:',     () => validateHttpsUrl('javascript:alert(1)', 'url'));
expect_block('empty string',    () => validateHttpsUrl('', 'url'));
expect_pass ('https://ok.com',  () => validateHttpsUrl('https://ok.com', 'url'));
expect_pass ('https with path', () => validateHttpsUrl('https://example.com/path/to/file.tar.gz', 'url'));

// ---------------------------------------------------------------------------
console.log('\n--- F-09 validateCommitHash ---');
expect_block('too short',       () => validateCommitHash('abc123'));
expect_block('uppercase hex',   () => validateCommitHash('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'));
expect_block('41 chars',        () => validateCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2f'));
expect_pass ('valid sha1',      () => validateCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'));

// ---------------------------------------------------------------------------
console.log('\n--- F-09 validateQuality ---');
expect_block('unknown string',  () => validateQuality('evil'));
expect_block('uppercase STABLE',() => validateQuality('STABLE'));
expect_pass ('stable',          () => validateQuality('stable'));
expect_pass ('insider',         () => validateQuality('insider'));
expect_pass ('exploration',     () => validateQuality('exploration'));

// ---------------------------------------------------------------------------
console.log('\n--- F-09 validateSimpleIdentifier ---');
expect_block('semicolon',       () => validateSimpleIdentifier('evil;name', 'f'));
expect_block('cmd substitution',() => validateSimpleIdentifier('evil$(cmd)', 'f'));
expect_block('space',           () => validateSimpleIdentifier('spaces here', 'f'));
expect_pass ('code-server',     () => validateSimpleIdentifier('code-server', 'f'));
expect_pass ('.vscode-server',  () => validateSimpleIdentifier('.vscode-server', 'f'));
expect_pass ('.bobide-server',  () => validateSimpleIdentifier('.bobide-server', 'f'));

// ---------------------------------------------------------------------------
console.log('\n--- Summary ---');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
