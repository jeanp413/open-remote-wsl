# Security Fix Plan — open-remote-wsl

## Overview

Nine security findings (F-01 through F-09) were identified in a review of the
`open-remote-wsl` VS Code extension.  All nine must be fixed before the
extension can be considered safe for use with untrusted workspaces or
user-controlled settings.

The fixes fall into four categories:

| Category | Findings |
|---|---|
| New helper module | (prerequisite for F-01, F-02, F-08, F-09) |
| Bash script hardening | F-01, F-02, F-05, F-06, F-07, F-09 |
| Authority / distro-name parsing | F-03, F-08 |
| Terminal command injection | F-04 |

---

## Implementation Order (dependency graph)

```
Step 0  src/common/shellEscape.ts  ← NEW FILE (prerequisite)
          |
          ├─► Step 1  F-08  wslManager.ts       (validateDistroName)
          ├─► Step 7  F-01  serverSetup.ts       (shellEscapeSingleQuote + validateHttpsUrl)
          ├─► Step 7  F-02  serverSetup.ts       (validateExtensionId + validateEnvVarName)
          └─► Step 8  F-05  serverSetup.ts       (validateHttpsUrl)

Step 2  F-03  authResolver.ts      (independent)
Step 3  F-04  commands.ts + wslManager.ts (independent)
Step 4  F-06  serverSetup.ts       (independent)
Step 5  F-07  serverSetup.ts       (independent)
Step 6  F-09  serverConfig.ts      (independent; logically before Step 7)
```

Steps 2–6 are independent of each other and of Step 0 except as noted.
Steps 7 and 8 both require Step 0 to exist first.

---

## Sub-Task 0 — New file: `src/common/shellEscape.ts`

**Intent:** Provide a single, auditable place for all shell-safety helpers so
that every call site imports from one module and no ad-hoc escaping exists.

**Status:** [x] complete

### Functions to export

#### `shellEscapeSingleQuote(value: string): string`

- **Contract:** Given an arbitrary string, return a bash single-quote–safe
  literal that, when surrounded by `'...'` in a bash script, evaluates to
  exactly `value`.
- **Algorithm:** Replace every `'` in `value` with `'\''`; wrap the result
  in `'` and `'`.
  ```
  input : hello 'world'
  output: 'hello '\''world'\'''
  ```
- **Why single-quote:** Single-quote context in bash is 100% literal — no
  variable expansion, no command substitution, no backslash processing.
  It is the only bash quoting form that requires no character-by-character
  analysis of the payload.

#### `validateHttpsUrl(value: string, fieldName: string): void`

- **Contract:** Throws a `ServerInstallError` (imported from `serverSetup.ts`)
  if `value` does not start with `https://`.  The check is intentionally
  simple — it gates the most common downgrade (plain HTTP) and completely
  rejects non-URL payloads.
- **Parameters:** `fieldName` is used only in the error message for diagnostics.

#### `validateExtensionId(id: string): void`

- **Contract:** Throws `ServerInstallError` if `id` does not match
  `^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$` (VS Code
  marketplace extension ID format, optionally followed by `-prerelease`).
  More precisely, the allowlist regex is:
  ```
  /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*(-prerelease)?$/
  ```

#### `validateEnvVarName(name: string): void`

- **Contract:** Throws `ServerInstallError` if `name` does not match
  `^[A-Za-z_][A-Za-z0-9_]*$` (POSIX env var name).

#### `validateDistroName(name: string): void`

- **Contract:** Throws `Error` if `name` does not match `^[\w.-]+$`
  (alphanumeric, underscore, dot, hyphen — the set WSL itself allows).
  Used in `wslManager.ts` before any distro name is stored or used.

#### `validateSimpleIdentifier(value: string, fieldName: string): void`

- **Contract:** Throws `ServerInstallError` if `value` does not match
  `^[A-Za-z0-9_-]+$`.  Used for `serverApplicationName` and
  `serverDataFolderName` (F-09).

#### `validateCommitHash(value: string): void`

- **Contract:** Throws `ServerInstallError` if `value` does not match
  `^[0-9a-f]{40}$` (full SHA-1 hex).  Used to validate `commit` from
  `product.json` (F-09).

#### `validateQuality(value: string): void`

- **Contract:** Throws `ServerInstallError` if `value` is not one of
  `stable`, `insider`, `exploration`.  Used to validate `quality` from
  `product.json` (F-09).

### Imports / dependencies

`shellEscape.ts` must import `ServerInstallError` from `'../serverSetup'`.
Because `serverSetup.ts` also imports `shellEscape.ts` that creates a
**circular import**.  To break the cycle, extract `ServerInstallError` and
`ServerInstallOptions` into a new file `src/common/serverInstallTypes.ts`,
then both `serverSetup.ts` and `shellEscape.ts` import from there.

Alternatively (simpler): make the validator functions throw plain `Error`
and let the callers wrap if needed — but this loses the specific error type.

**Recommended:** use plain `Error` with a descriptive message. `serverSetup.ts`
already catches everything and re-wraps as `ServerInstallError` at the
`installCodeServer` boundary.  `shellEscape.ts` should therefore throw plain
`Error`; no circular import arises.

**Expected outcome when complete:**
- `src/common/shellEscape.ts` exists and compiles with `tsc --noEmit`.
- All exported functions are independently unit-testable.

---

## Sub-Task 1 — F-08: Distro name regex and re-validation (`src/wsl/wslManager.ts`)

**File:** `src/wsl/wslManager.ts`
**Lines affected:** 32, 62, and the two push-to-array calls inside
`listDistros` (line 37) and `listOnlineDistros` (line 67).

**Status:** [x] complete

### Changes

1. **Line 1 (imports):** Add:
   ```ts
   import { validateDistroName } from '../common/shellEscape';
   ```

2. **Line 32 — `listDistros` regex:**
   Change `[\w\.-]+` to `[\w.-]+` (move hyphen to the end of the character
   class — it is currently between `\.` and `]`, which is unambiguous but
   fragile; placing it last is the universally accepted convention).
   The pattern itself stays otherwise unchanged.

3. **Line 37–42 — `listDistros` push block:**
   Before `distros.push({...})`, add:
   ```ts
   try { validateDistroName(matches.groups.name); } catch { continue; }
   ```
   (silently skip invalid names rather than throwing, consistent with the
   existing "if it doesn't match the regex, we ignore it" pattern.)

4. **Line 62 — `listOnlineDistros` regex:**
   Same fix: change `[\w\.-]+` to `[\w.-]+`.

5. **Line 67–70 — `listOnlineDistros` push block:**
   Same guard:
   ```ts
   try { validateDistroName(matches.groups.name); } catch { continue; }
   ```

**Why this closes F-08:** Distro names that contain characters outside the
allowlist (e.g. `+`, `;`, `$`) are rejected at the point of parsing, so they
can never reach `authResolver.ts`, `serverSetup.ts`, or `commands.ts`.

**Expected outcome:** `listDistros()` and `listOnlineDistros()` never return a
distro name that could break authority parsing or inject into bash.

---

## Sub-Task 2 — F-03: Authority parsing (`src/authResolver.ts`)

**File:** `src/authResolver.ts`
**Line affected:** 43

**Status:** [x] complete

### Current code (line 43)
```ts
const [type, distroName] = authority.split('+');
```

### Change

Replace line 43 with:
```ts
const plusIdx = authority.indexOf('+');
const type    = plusIdx >= 0 ? authority.substring(0, plusIdx) : authority;
const distroName = plusIdx >= 0 ? authority.substring(plusIdx + 1) : '';
```

**Why this closes F-03:** `String.prototype.split('+')` with no limit
produces an array of arbitrary length; destructuring takes only the first two
elements, silently discarding everything after the second `+`.  Using
`indexOf` + `substring` recovers the full remainder of the string as the
distro name regardless of how many `+` characters it contains.

**Note:** With Sub-Task 1 in place, distro names containing `+` will already
be filtered by `validateDistroName` in `wslManager.ts` before they can be
stored and used to form an authority string.  This fix is nonetheless required
as defence-in-depth: the authority string comes from VS Code's remote
authority mechanism and could theoretically be constructed by other means.

**Expected outcome:** `distroName` always equals everything after the first
`+` in the authority string.

---

## Sub-Task 3 — F-04: Terminal command injection (`src/commands.ts`, `src/wsl/wslManager.ts`, `src/wsl/wslTerminal.ts`)

**Status:** [x] complete

### Part A — Add `installDistro` to `WSLManager` (`src/wsl/wslManager.ts`)

Insert a new public method after `deleteDistro` (after line 95):

```ts
async installDistro(distroName: string): Promise<void> {
    const resp = this._runWSLCommand(['--install', '-d', distroName], 'utf16le');
    const { exitCode } = await resp.exitPromise;
    const { stdout, stderr } = resp;
    if (exitCode) {
        this.logger.trace(`Command wsl installDistro exited with code ${exitCode}`, stdout + '\n\n' + stderr);
        throw new Error(`Failed to install WSL distro "${distroName}": exit code ${exitCode}`);
    }
}
```

**Why `cp.spawn` (via `_runWSLCommand`) is safe:** Arguments passed to
`cp.spawn` are transmitted directly to the OS `CreateProcess` API on Windows;
no shell interprets them.  There is no injection surface regardless of what
`distroName` contains.

### Part B — Replace terminal call (`src/commands.ts`)

1. **Line 4:** Remove the import of `wslTerminal`:
   ```ts
   // DELETE:
   import wslTerminal from './wsl/wslTerminal';
   ```

2. **Lines 52–62 — `promptInstallNewWSLDistro`:**
   - Change the function signature to accept `wslManager: WSLManager`
     (it already does from line 52).
   - Replace line 61:
     ```ts
     // DELETE:
     wslTerminal.runCommand(`wsl.exe --install -d ${distroName}`);
     // ADD:
     await wslManager.installDistro(distroName);
     ```

### Part C — Delete `src/wsl/wslTerminal.ts`

After Part B, `wslTerminal.ts` has no remaining importers.  The file should
be deleted.  Verify with `grep -r wslTerminal src/` before deleting.

**Why this closes F-04:** The distro name is never interpolated into a shell
string.  It is passed directly as a `cp.spawn` argument.

**Expected outcome:** Installing a new distro works via `cp.spawn`; the
`wslTerminal.ts` file no longer exists; `tsc --noEmit` reports no errors.

---

## Sub-Task 4 — F-06: Sentinel strength and value parser (`src/serverSetup.ts`)

**File:** `src/serverSetup.ts`
**Lines affected:** 40, 125–126

**Status:** [x] complete

### Change 1 — Sentinel length (line 40)

Current:
```ts
const scriptId = crypto.randomBytes(12).toString('hex');  // 24 hex chars
```
Change to:
```ts
const scriptId = crypto.randomBytes(32).toString('hex');  // 64 hex chars
```

**Why:** 96-bit entropy (24 hex chars) is plausible to collide with substrings
in a sufficiently noisy login banner.  256-bit (64 hex chars) reduces the
probability to negligible and is harder to accidentally embed in output.

### Change 2 — Key/value split (lines 125–126)

Current:
```ts
const [key, value] = line.split('==');
resultMap[key] = value;
```

Replace with:
```ts
const eqIdx = line.indexOf('==');
if (eqIdx < 0) { continue; }
const key   = line.substring(0, eqIdx);
const value = line.substring(eqIdx + 2, line.lastIndexOf('=='));
resultMap[key] = value;
```

**Why:** `split('==')` with no limit tokenises on every occurrence of `==`.
The destructuring `[key, value]` therefore silently drops any `==` within the
value.  Using `indexOf` for the first delimiter and `lastIndexOf` for the
trailing `==` terminator correctly recovers a value that itself contains `==`.

Also add a guard: skip the line if `key` is empty (avoids writing an
`undefined` key from blank lines).

**Expected outcome:** Values containing `==` (e.g. base-64 strings) are
parsed correctly; the sentinel cannot be spoofed by a 24-char random prefix in
a banner.

---

## Sub-Task 5 — F-07: Atomic token file creation (`src/serverSetup.ts`)

**File:** `src/serverSetup.ts`
**Lines affected:** 286–287 (inside the bash heredoc in `generateBashInstallScript`)

**Status:** [x] complete

### Current bash (lines 286–287 of the TypeScript template literal)
```bash
touch $SERVER_TOKENFILE
chmod 600 $SERVER_TOKENFILE
```

### Change

Replace both lines with the single atomic equivalent:
```bash
install -m 600 /dev/null "$SERVER_TOKENFILE"
```

**Why `install` is atomic:** The `install` utility creates the file with the
specified mode in a single `open(O_CREAT|O_WRONLY, 0600)` call.  There is no
window during which the file exists with world-readable permissions.
`install` is part of GNU coreutils and is present in every mainstream Linux
distribution (including WSL distros).

**Note:** The variable reference also gains double-quotes (`"$SERVER_TOKENFILE"`)
for robustness against spaces in the path, consistent with shell best practice.

**Expected outcome:** The token file is never world-readable, even
momentarily.

---

## Sub-Task 6 — F-09: product.json field validation (`src/serverConfig.ts`)

**File:** `src/serverConfig.ts`
**Line affected:** `getVSCodeServerConfig()` return statement (lines 28–36)

**Status:** [x] complete

### Change

After building the return object, add validation calls before returning.
Import the validators from `shellEscape.ts`:

```ts
import { validateSimpleIdentifier, validateCommitHash, validateQuality } from './common/shellEscape';
```

Inside `getVSCodeServerConfig()`, before `return { ... }`:

```ts
validateCommitHash(productJson.commit);
validateQuality(productJson.quality);
validateSimpleIdentifier(productJson.serverApplicationName, 'serverApplicationName');
validateSimpleIdentifier(productJson.serverDataFolderName,  'serverDataFolderName');
```

These throw `Error` (plain, not `ServerInstallError`) which propagates up
through `installCodeServer` and is caught by the resolver as a
`TemporarilyNotAvailable` error with a message the user can see.

**Why this closes F-09:** A tampered `product.json` with shell metacharacters
in `serverApplicationName` or `serverDataFolderName` will cause the extension
to throw a clear error rather than silently generating a malicious bash script.

**Expected outcome:** Connecting to WSL with a standard VS Code / VSCodium
`product.json` works normally; a file with injected chars in those fields
causes a visible error before any bash is generated.

---

## Sub-Task 7 — F-01 + F-02: Bash script hardening (`src/serverSetup.ts`)

**File:** `src/serverSetup.ts`
**Lines affected:** 133, 144, 174, 227, 333 (all inside `generateBashInstallScript`)

**Status:** [x] complete

### Imports to add (top of file)

```ts
import { shellEscapeSingleQuote, validateHttpsUrl, validateExtensionId, validateEnvVarName } from './common/shellEscape';
```

### Change A — Validate and escape `serverDownloadUrlTemplate` (F-01, line 227)

**Before (line 227):**
```ts
SERVER_DOWNLOAD_URL="$(echo "${serverDownloadUrlTemplate.replace(/\$\{/g, '\\${')}" | sed ...)"
```

**After:**
1. At the top of `generateBashInstallScript`, before the template literal,
   add:
   ```ts
   validateHttpsUrl(serverDownloadUrlTemplate, 'serverDownloadUrlTemplate');
   const safeUrlTemplate = shellEscapeSingleQuote(serverDownloadUrlTemplate);
   ```
2. Replace the interpolation on line 227 with:
   ```ts
   SERVER_DOWNLOAD_URL="$(echo ${safeUrlTemplate} | sed "s/\\\${quality}/$DISTRO_QUALITY/g" | sed "s/\\\${version}/$DISTRO_VERSION/g" | sed "s/\\\${commit}/$DISTRO_COMMIT/g" | sed "s/\\\${os}/$SERVER_OS/g" | sed "s/\\\${arch}/$SERVER_ARCH/g" | sed "s/\\\${release}/$DISTRO_VSCODIUM_RELEASE/g")"
   ```
   Note: `safeUrlTemplate` is already single-quoted, so the outer `"..."` for
   the `echo` argument becomes unnecessary — the whole right-hand side of the
   assignment can use `$()` with the single-quoted literal directly, eliminating
   the double-quote injection surface entirely.

**Why this closes F-01:** Single-quote quoting in bash is unconditional — no
character inside `'...'` has special meaning.  The only content that can break
out is a literal `'`, which `shellEscapeSingleQuote` handles by closing the
quote, inserting `\'`, and reopening.

### Change B — Validate and escape `extensionIds` (F-02, line 133)

**Before (line 133):**
```ts
const extensions = extensionIds.map(id => '--install-extension ' + id).join(' ');
```

**After:**
```ts
for (const id of extensionIds) { validateExtensionId(id); }
const extensions = extensionIds.map(id => `--install-extension ${shellEscapeSingleQuote(id)}`).join(' ');
```

The `extensions` string is embedded in the bash as:
```bash
SERVER_INITIAL_EXTENSIONS="${extensions}"
```
With single-quote–escaped IDs, there is no injection surface.

### Change C — Validate and escape `envVariables` (F-02, lines 174, 333)

**Before (lines 174 and 333):**
```ts
${envVariables.map(envVar => `echo "${envVar}==$${envVar}=="`).join('\n')}
```

**After:**
```ts
${envVariables.map(envVar => {
    validateEnvVarName(envVar);
    return `echo "${envVar}==$${envVar}=="`;
}).join('\n')}
```

Because `validateEnvVarName` restricts `envVar` to `^[A-Za-z_][A-Za-z0-9_]*$`,
no shell metacharacters can be present, making the double-quoted `echo` safe.
(Using `$envVar` inside `"..."` is intentional — it expands the bash variable
whose name is the env var name, which is the desired behaviour.)

**Expected outcome:** Any extension ID or env var name containing metacharacters
causes `generateBashInstallScript` to throw before any bash is sent to WSL.
The URL template is embedded as a single-quoted literal, immune to injection.

---

## Sub-Task 8 — F-05: Download URL scheme validation (`src/serverSetup.ts`)

**File:** `src/serverSetup.ts`
**Lines affected:** 238–241 (wget/curl download calls), and the URL template
resolution at line 227.

**Status:** [x] complete

### Change

After `SERVER_DOWNLOAD_URL` is resolved in the bash script, add a bash-level
check before the download:

```bash
if [[ "$SERVER_DOWNLOAD_URL" != https://* ]]; then
    echo "Error: SERVER_DOWNLOAD_URL must use https://"
    print_install_results_and_exit 1
fi
```

Insert this block immediately before the `if [[ ! -z $(which wget) ]]` check
(currently line 238).

Additionally, `validateHttpsUrl` is already called on the TypeScript-side
URL template in Sub-Task 7 Change A, providing a second layer of defence.

**Note on SHA-256 integrity:** Comprehensive integrity verification would
require the download server to publish a checksum file (e.g.
`vscode-server.tar.gz.sha256`).  As of this writing, VSCodium releases do
publish SHA-256 checksums in their GitHub release assets.  A follow-up task
should:
- Download `<url>.sha256` alongside the tarball.
- Compare with `sha256sum -c` before extraction.
This is out of scope for the current fix but is noted here as a recommended
follow-on.

**Expected outcome:** If a URL template somehow resolves to a non-HTTPS URL
(e.g. through a misconfigured setting that bypassed TypeScript-level
validation), the bash script itself refuses to download.

---

## Validation Steps

### 1. TypeScript compile check — ✅ PASSED

```
npx tsc --noEmit
```

Zero errors, zero warnings.

### 2. Unit tests

No automated test suite exists in the repo.  Manual REPL verification of
`shellEscape.ts` helpers confirmed correct behaviour for all cases in the
original test matrix.

### 3. Manual WSL smoke test — ✅ PASSED

- Extension packaged as `open-remote-wsl-0.0.5.vsix` via `npx @vscode/vsce package --no-yarn`
- Installed into Bob (VS Code fork) via *Extensions: Install from VSIX…*
- Remote WSL window opened successfully targeting `SAFIR-AlmaLinux-8`
- Server installed, connection token received, file editing confirmed working

**Regression found and fixed during smoke test:**
`validateSimpleIdentifier` originally used `^[A-Za-z0-9_-]+$`, which rejected
`.bobide-server` (Bob's `serverDataFolderName`) due to the leading dot.
Regex widened to `^[A-Za-z0-9_.~-]+$` to allow dots and tildes, which are
safe in folder names and present in real-world VS Code fork `product.json` values.

### 4. Package as `.vsix`

```
# Install Node.js LTS from https://nodejs.org first, then:
npm install
npx vscode-dts dev
npx vscode-dts main
npx @vscode/vsce package --no-yarn
```

Note: the upstream repo uses `yarn` in its `postinstall` and `package` scripts.
These have been updated to use `npm` / `npx` so the project builds without yarn.

---

## Notes on `vsce` Packaging

- `package.json` scripts updated: `postinstall` now uses `npm run update-dts`
  (was `yarn update-dts`); `package` script now uses `npx @vscode/vsce package`
  (was `npx vsce package --yarn`).
- `security-fix-plan.md` added to `.vscodeignore` so it is excluded from the
  published `.vsix`.
- `src/common/shellEscape.ts` is a pure TypeScript module; it adds no new
  npm runtime dependencies.
- The deletion of `src/wsl/wslTerminal.ts` (Sub-Task 3C) removes a source
  file but does not break any `package.json` entry points or activation events,
  since `wslTerminal` was only ever an internal import.
