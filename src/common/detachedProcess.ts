import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Run a long-lived process without tying its lifetime or stdio to this host. */
export async function runDetachedUntilOutput(command: string, args: string[], marker: string) {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-remote-wsl-'));
    const stdoutPath = path.join(outputDir, 'stdout');
    const stderrPath = path.join(outputDir, 'stderr');
    let stdoutFd: number | undefined;
    let stderrFd: number | undefined;

    // Windows may keep these files open until the detached launcher exits.
    // Retry cleanup on exit if deleting them while it is running fails.
    const cleanup = async () => {
        try {
            await Promise.all([stdoutPath, stderrPath].map(file => fs.promises.unlink(file).catch(error => {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            })));
            await fs.promises.rmdir(outputDir);
        } catch {
            // Best effort: cleanup must not interrupt a running server.
        }
    };

    try {
        stdoutFd = fs.openSync(stdoutPath, 'wx', 0o600);
        stderrFd = fs.openSync(stderrPath, 'wx', 0o600);
        // Detach the Node/Electron helper, NOT wsl.exe. A detached WSL launcher
        // can allocate a visible console even with windowsHide. The helper keeps
        // WSL alive and launches it with CREATE_NO_WINDOW instead.
        const helperScript = `
            const child = require('child_process').spawn(
                ${JSON.stringify(command)}, ${JSON.stringify(args)}, {
                    windowsHide: true,
                    windowsVerbatimArguments: true,
                    stdio: ['ignore', 1, 2]
                }
            );
            child.once('error', error => {
                process.stderr.write(error.stack + '\\n');
                process.exitCode = 1;
            });
            child.once('exit', code => { process.exitCode = code === null ? 1 : code; });
        `;
        const child = cp.spawn(process.execPath, ['-e', helperScript], {
            detached: true,
            windowsHide: true,
            // The editor executable is Electron; this runs it as a Node helper,
            // not as another editor window. Normal Windows argument quoting is
            // required here; only the helper's WSL command uses verbatim args.
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            // Pipes still couple a detached child to the extension host.
            stdio: ['ignore', stdoutFd, stderrFd],
        });
        let exitCode: number | undefined;
        let spawnError: Error | undefined;
        child.once('error', error => { spawnError = error; });
        child.once('exit', code => { exitCode = code ?? 1; });
        child.unref();

        fs.closeSync(stdoutFd);
        stdoutFd = undefined;
        fs.closeSync(stderrFd);
        stderrFd = undefined;

        try {
            while (true) {
                if (spawnError) {
                    throw spawnError;
                }
                const completedExitCode = exitCode;
                // Read accumulated output so a marker split across writes is detected too.
                const [stdout, stderr] = await Promise.all([
                    fs.promises.readFile(stdoutPath, 'utf8'),
                    fs.promises.readFile(stderrPath, 'utf8'),
                ]);
                if (stdout.includes(marker) || completedExitCode !== undefined) {
                    return { stdout, stderr, exitCode: completedExitCode ?? 0 };
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } finally {
            if (exitCode === undefined && !spawnError) {
                child.once('exit', () => { void cleanup(); });
            }
        }
    } finally {
        if (stdoutFd !== undefined) {
            fs.closeSync(stdoutFd);
        }
        if (stderrFd !== undefined) {
            fs.closeSync(stderrFd);
        }
        await cleanup();
    }
}
