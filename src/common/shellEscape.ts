/**
 * Shell-safety helpers used when generating bash scripts sent to WSL.
 *
 * All validator functions throw a plain Error with a descriptive message.
 * Callers (serverSetup.ts, serverConfig.ts, wslManager.ts) catch or propagate
 * these as appropriate.
 */

/**
 * Wraps `value` in bash single-quotes so that it evaluates to exactly `value`
 * regardless of its content.
 *
 * Single-quote context in bash is unconditional: no variable expansion, no
 * command substitution, no backslash processing.  The only character that
 * requires special treatment is a literal single-quote, which must be handled
 * by closing the quote, emitting `\'`, and reopening.
 *
 * Examples:
 *   shellEscapeSingleQuote('hello')         → "'hello'"
 *   shellEscapeSingleQuote("it's a test")   → "'it'\\''s a test'"
 *   shellEscapeSingleQuote('$(id)')         → "'$(id)'"
 */
export function shellEscapeSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Throws if `value` does not begin with `https://`.
 * Used to prevent plain-HTTP downgrade attacks on the server download URL.
 */
export function validateHttpsUrl(value: string, fieldName: string): void {
    if (!value.startsWith('https://')) {
        throw new Error(
            `Security: "${fieldName}" must start with https:// (got: ${JSON.stringify(value)})`
        );
    }
}

/**
 * Throws if `id` is not a valid VS Code marketplace extension ID.
 *
 * Allowed format: `publisher.extension` or `publisher.extension-prerelease`
 * where each segment is alphanumeric plus underscores and hyphens.
 */
export function validateExtensionId(id: string): void {
    const EXT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*(-prerelease)?$/;
    if (!EXT_ID_RE.test(id)) {
        throw new Error(
            `Security: extension ID contains disallowed characters: ${JSON.stringify(id)}`
        );
    }
}

/**
 * Throws if `name` is not a valid POSIX environment variable name.
 *
 * Allowed: `^[A-Za-z_][A-Za-z0-9_]*$`
 */
export function validateEnvVarName(name: string): void {
    const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (!ENV_VAR_RE.test(name)) {
        throw new Error(
            `Security: env var name contains disallowed characters: ${JSON.stringify(name)}`
        );
    }
}

/**
 * Throws if `name` is not a valid WSL distro name.
 *
 * Allowed: word characters (alphanumeric + underscore), dots, and hyphens.
 * This matches the set WSL itself permits and places the hyphen last in the
 * character class to avoid any regex ambiguity.
 */
export function validateDistroName(name: string): void {
    const DISTRO_NAME_RE = /^[\w.-]+$/;
    if (!DISTRO_NAME_RE.test(name)) {
        throw new Error(
            `Security: distro name contains disallowed characters: ${JSON.stringify(name)}`
        );
    }
}

/**
 * Throws if `value` contains anything other than alphanumerics, underscores,
 * or hyphens.  Used for `serverApplicationName` and `serverDataFolderName`
 * from product.json.
 */
export function validateSimpleIdentifier(value: string, fieldName: string): void {
    const SIMPLE_ID_RE = /^[A-Za-z0-9_.~-]+$/;
    if (!SIMPLE_ID_RE.test(value)) {
        throw new Error(
            `Security: "${fieldName}" contains disallowed characters: ${JSON.stringify(value)}`
        );
    }
}

/**
 * Throws if `value` is not a 40-character lowercase hex string (git SHA-1).
 * Used to validate `commit` from product.json.
 */
export function validateCommitHash(value: string): void {
    const COMMIT_RE = /^[0-9a-f]{40}$/;
    if (!COMMIT_RE.test(value)) {
        throw new Error(
            `Security: commit hash is not a valid 40-char hex SHA: ${JSON.stringify(value)}`
        );
    }
}

/**
 * Throws if `value` is not one of the known VS Code quality strings.
 * Used to validate `quality` from product.json.
 */
export function validateQuality(value: string): void {
    const ALLOWED: ReadonlySet<string> = new Set(['stable', 'insider', 'exploration']);
    if (!ALLOWED.has(value)) {
        throw new Error(
            `Security: quality must be one of stable|insider|exploration (got: ${JSON.stringify(value)})`
        );
    }
}
