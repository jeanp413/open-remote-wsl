# Testing the WSL server lifecycle

Run `npm test` with Node.js 18 or newer to test detached process output,
startup failures, and survival after the launching process exits. These tests
run without WSL, but cannot validate Windows job or WSL interop behavior.

For an end-to-end check on Windows with WSL:

1. Build and install the extension, then close existing remote editor windows
   and stop any old editor server or systemd workaround for this distro. The
   first connection must start a new server using the updated launcher. Verify
   that opening the connection does not create a console or terminal window.
2. Connect two editor windows to the same distro. Record the server PID from
   `~/<server-data-folder>/.<commit>.pid` (for VSCodium, the folder is
   `.vscodium-server`).
3. Close the first window. Verify that the second stays connected and the
   server PID is unchanged. Edit a file and run a terminal command there.
4. Repeat with **Developer: Reload Window** in the first window, and by opening
   a different workspace. Verify the remaining window stays usable.
5. In a remote terminal, run `cmd.exe /c echo interop-ok` to check that Windows
   interop still works without a systemd service.
6. Close all remote windows and verify that the server eventually exits via its
   existing remote auto-shutdown behavior. The launcher must not keep the editor
   process alive.

This targets the known launcher-lifetime failure in upstream issue #2. Unrelated
network interruptions, server crashes, and WSL shutdowns can still disconnect a
session and need separate logs to diagnose.
