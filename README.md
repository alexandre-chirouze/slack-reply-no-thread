# Slack Reply No Thread

Add a **❝ Reply** button to Slack in **Google Chrome** or Slack Desktop on macOS. Clicking it adds a discreet
**↗** link to the original message beneath your answer, allowing Slack to show
its native message preview with the author, avatar, and message content.

In the main conversation, replies stay in that conversation rather than opening
a thread. In an already open thread pane, the button uses that thread's composer.
Type your answer above the link and send it with Slack's usual Send button.
The button never sends a message automatically.

Existing draft text, formatting, mentions, and attachments remain in place.
The cursor returns to the end of your answer; **⌘Z** removes the inserted link
in one step (**Ctrl+Z** on Windows/Linux). Links retain the original message's thread context. Search results
are excluded, and a message must have a native timestamp permalink.

## Discord-style reply context

Message previews in conversations and open threads become a single reply-context
line above the replying author's name, with a curved connector, small avatar,
author, and an excerpt truncated with an ellipsis. The source conversation and
time are available in the hover tooltip. Click the line (or focus it and press
Enter/Space) to show Slack's original card below the answer; click again to hide
it. Native links and controls remain available in the expanded card. File and
website previews are not compacted, and unsupported message layouts are left alone.

The redundant **↗** is hidden locally when it matches the displayed preview;
it stays in the sent message. This only changes the display on computers running
this plugin. It does not edit messages or change what other recipients see.
Stopping the desktop plugin restores the native cards and links. In Chrome,
disable or remove the extension and reload Slack tabs to restore them. Slack's existing
**Show more** control may still be needed for content Slack itself truncates.

## Installation agents: ask where the user uses Slack

Before installing, ask the user:

> Do you want the reply button in the Slack desktop app, in Slack in Google
> Chrome, or both?

Wait for their choice before running installation commands. If the user has
already explicitly chosen a target in the conversation, use that choice without
asking again. Do not infer the target from the operating system or installed apps.

- **Slack desktop app:** follow [Slack Desktop requirements](#slack-desktop-requirements-macos)
  and [Instructions for desktop installation agents](#instructions-for-desktop-installation-agents).
  The desktop launcher supports macOS only.
- **Slack in a browser:** follow [Install in Google Chrome](#install-in-google-chrome).
  Browser support currently means Google Chrome. Do not run the desktop launcher
  installation commands for a browser-only setup.
- **Both:** complete and verify each setup separately, one at a time.

For Chrome, confirm the extension is loaded and enabled, reload Slack tabs, and
check that **❝ Reply** appears when hovering over a message in a conversation
with a visible composer. Do not send a test message or overwrite the user's draft.
If loading the extension requires a manual user step, explain that step and report
the setup as pending until verified.

## Install in Google Chrome

The Chrome extension works independently of the macOS desktop launcher. Use a
current desktop Google Chrome on macOS, Windows, or Linux (the extension requires
Chrome 120+). Node.js and Slack Desktop are not needed to use the extension.

1. Clone this repository or download and extract its source ZIP. Keep the folder
   somewhere permanent; Chrome loads the extension from that location.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder containing
   `manifest.json` (not the `src` folder).
4. Open Slack in Chrome, or reload any existing Slack tabs. Open a conversation
   and hover over a message to see **❝ Reply**.

Click **❝ Reply**, type your answer above **↗**, and send with Slack's normal Send
button. Open threads use their own composer. The extension activates automatically
on Slack HTTPS subdomains, including `app.slack.com` and workspace subdomains.
It only runs in the top-level page and requires no API token, background server,
debugging port, or npm install command.

To update, update the files in the same folder, click the extension's **Reload**
button in `chrome://extensions`, then reload Slack tabs. To stop or uninstall,
disable or remove **Slack Reply No Thread** there, then reload all open Slack tabs.
Already injected page code stays active until those tabs reload or close.

If the button is missing, check that the extension is enabled and allowed to run
on the Slack site, reload the tab, and open a conversation with a visible composer.
Managed browsers may restrict unpacked extensions. This is a local unpacked
extension, not a Chrome Web Store listing.

The manifest loads the shared script in Chrome's
[`MAIN` execution world](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#run_time_and_execution_environment)
so it can access Slack's existing Quill editor. There are no extension API
permissions, remote scripts, or telemetry. Its site access is limited to Slack
HTTPS subdomains; Chrome displays the corresponding site-access notice.

## Slack Desktop requirements (macOS)

- **macOS** with Slack Desktop installed at `/Applications/Slack.app`.
- **Node.js 22 or newer**, with `node` and `npm` available in the terminal.
- **Git** and access to this repository to clone it.
- A local desktop session belonging to the user who runs Slack.

The desktop launcher supports macOS only. For Slack in Chrome, including on
Windows and Linux, use the extension instructions above.
There are no npm dependencies, build steps, Slack API tokens, bots, or workspace
apps to install. No administrator privileges are needed.

## Install Slack Desktop integration locally

Run these commands on the user's Mac, as that user, from a directory where you
want to keep the checkout. If a command fails, resolve the error before continuing.

```sh
git clone git@github.com:alexandre-chirouze/slack-reply-no-thread.git
cd slack-reply-no-thread

export UV_THREADPOOL_SIZE=1
export OMP_NUM_THREADS=1

node --version
npm --version
test -d /Applications/Slack.app

npm run install
open "$HOME/Applications/Slack Quote Reply.app"
```

If GitHub SSH authentication is unavailable, use this clone command instead,
then follow the remaining steps above:

```sh
git clone https://github.com/alexandre-chirouze/slack-reply-no-thread.git
```

**Use `npm run install`, not `npm install`.** There are no packages to download;
the `install` script creates a local macOS launcher. A plain `npm install` also
runs this lifecycle script and is unnecessary.

Open a Slack conversation and hover over a message. **❝ Reply** should appear in
the message action toolbar. Click it, type an answer above **↗**, and send when
ready. New replies use the compact link; previously sent messages are not edited.
Slack controls whether and how the [message-link preview](https://slack.com/help/articles/203274767-Forward-messages-in-Slack)
appears, including access permissions and preview preferences.

Launch **Slack Quote Reply** from `~/Applications` whenever starting Slack. You
can drag it to the Dock. It opens the real Slack application. If Slack is already
running normally, it gracefully restarts Slack to enable injection. Save active
work before launching; it never force-quits Slack. No login item is installed.

## Instructions for desktop installation agents

Follow the [installation target choice](#installation-agents-ask-where-the-user-uses-slack)
above first. These steps apply only when the user chooses the Slack desktop app.

1. Check the requirements on the actual user's Mac. Run `uname -s`,
   `command -v node`, `node --version`, `command -v npm`, and
   `test -d /Applications/Slack.app`. If a prerequisite is missing, explain which
   one is needed; do not report the installation as complete.
2. Work as the desktop user, without `sudo`. Resolve paths from that user's
   `$HOME`; do not copy another computer's installed launcher or runtime files.
   The installer records the current Node executable's absolute path.
3. Clone the repository, or use the existing checkout. For an existing active
   installation, follow the update procedure below before installing again.
4. Run the installation commands above sequentially with worker limits of one.
   Opening the launcher can restart Slack. Let the user handle Slack sign-in or
   any native confirmation dialogs themselves.
5. Verify with `npm run status`. Allow a few seconds for startup and open a Slack
   workspace; a ready session should report `Running` and at least one connected
   Slack page. Confirm the hover button appears in a conversation.
6. For an automated editor check, use `npm run test:slack` as described below.
   Do not send a test message or overwrite the user's draft to verify installation.
7. Tell the user the installed app path, how to launch it next time, and how to
   stop or uninstall it. Do not claim a sent preview was verified unless it was.

The installation is per macOS user. Run it separately for each user who wants it.
Keep Node installed at the recorded path. If Node is moved, removed, or replaced
by a version-manager change, reinstall using a working Node executable.

## Update an existing desktop installation

From the checkout, run these commands sequentially. Stop if any command fails.
The stop/start steps can restart Slack.

```sh
export UV_THREADPOOL_SIZE=1
export OMP_NUM_THREADS=1
npm run stop
git pull --ff-only
npm run install
open "$HOME/Applications/Slack Quote Reply.app"
```

The installer refuses to replace an active installation. Editing or pulling the
checkout alone does not update the installed copy. Reinstall and relaunch after
changes. Preserve local work if `git pull --ff-only` reports a conflict.

## Desktop status, stop, and uninstall

From the checkout:

```sh
npm run status
npm run stop
npm run uninstall
```

These are separate management commands; run the one you need. `stop` removes the
injection and restarts Slack normally to close its debugging port. `uninstall`
also removes this project's launcher and support directory. Slack's own files,
code signature, and user data are not modified by the installer or uninstaller.

If the checkout is no longer available, the installed copy can manage itself:

```sh
node "$HOME/Library/Application Support/Slack Quote Reply/src/launcher.mjs" status
node "$HOME/Library/Application Support/Slack Quote Reply/src/launcher.mjs" stop
node "$HOME/Library/Application Support/Slack Quote Reply/src/launcher.mjs" uninstall
```

Again, choose the command for the action you want. The installed runner also
accepts `start` if you want to launch it from a terminal.

## Desktop installed files

| Location | Purpose |
| --- | --- |
| `~/Applications/Slack Quote Reply.app` | User-owned launcher; opens the real Slack app |
| `~/Library/Application Support/Slack Quote Reply/src/` | Installed JavaScript files |
| `~/Library/Application Support/Slack Quote Reply/launcher.log` | Startup and launcher diagnostics |
| `~/Library/Application Support/Slack Quote Reply/state.json` | Runtime process IDs, local port, and connection status |
| `~/Library/Application Support/Slack Quote Reply/watcher.lock` | Prevents duplicate injectors |

State and lock files are managed by the launcher. Do not copy them between
machines or manually remove them while the injector is running.

## Desktop troubleshooting

| Symptom | What to do |
| --- | --- |
| `node` or `npm` is unavailable | Install Node.js 22+ using the user's preferred method, then open a terminal where both commands work. |
| Slack is installed somewhere else | This version requires `/Applications/Slack.app`; use that location before installing. |
| `Run stop before updating an active installation` | Run `npm run stop`, then install and launch again. |
| Launcher does not start | Read `launcher.log`. If the recorded Node path no longer exists, reinstall with the current Node executable. |
| Status shows zero connected pages | Open Slack, sign in locally if needed, open a workspace, and check again after a few seconds. |
| Reply button is missing | Hover a message with a timestamp permalink in a main conversation or open thread, with its composer visible. Search results are unsupported. Reopen the launcher after Slack updates. |
| Slack did not quit | Resolve Slack's local confirmation dialog and retry. The launcher does not force-quit it. |
| Link appears but no preview card | Slack controls previews and access. The link still opens the original message for users with access. |

Slack updates can change editor internals or selectors and break compatibility.
The injector avoids falling back to an unrelated composer when it cannot resolve
the correct one. Logs do not intentionally contain message text or credentials.

## How the desktop launcher works and local access

The launcher starts Slack with Chromium remote debugging bound to `127.0.0.1`
on an available port. It verifies the listening process and Slack user agent,
then injects local JavaScript into Slack HTTPS pages. A single background Node
process checks pages every two seconds, handles workspace changes and reloads,
and exits when Slack quits.

A mutation observer adds the button to Slack's hover toolbar. It uses the selected
message's native timestamp permalink and the existing Quill editor to append a
link with a compact label. It never calls Slack's messaging API or sends messages.

**While enabled, the local debugging endpoint allows other processes on the Mac
to inspect or control Slack.** Loopback binding prevents remote network access
but does not authenticate local programs. Use `stop` to close it. This is an
unofficial modification and may be affected by workplace device policies.

## Development and verification

Run one task at a time, with one worker. No build or dependency installation is
required.

```sh
export UV_THREADPOOL_SIZE=1
export OMP_NUM_THREADS=1
npm test
```

The unit tests validate eligible Slack page targets and reject remote debugger
connections. The test runner uses `--test-concurrency=1`.

To verify the actual unpacked Chrome extension with local fixtures, run separately:

```sh
UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 npm run test:chrome
```

This check uses a recent Chrome with the DevTools `Extensions.loadUnpacked`
command, a disposable headless profile, and one renderer. It checks automatic
injection, access to a page-owned editor double, main/thread click routing,
compact previews, reloads, URL exclusions, and uninstall followed by reload.
All test page requests are intercepted and fulfilled locally; it never signs in
to Slack or sends messages. Set `CHROME_PATH` when Chrome is not at the default
macOS location. The editor double verifies integration and routing, not Slack's
actual Quill implementation; the live checks below cover that separately.

With Slack Quote Reply running and a visible conversation open:

```sh
npm run test:slack
```

With an open thread side pane as well:

```sh
npm run test:slack -- --thread
```

Run the live checks separately. They hover a message and use an offscreen instance
of Slack's own editor to verify the compact link, preserved URL and thread context,
answer placement, formatted drafts, undo, and unchanged live draft content. The
thread check also verifies separate composer routing. They inject the checkout's
script into the page, so use a matching installed version to avoid the installed
watcher restoring a different version during the check. No messages are sent;
these checks do not verify the final sent preview card.

Compatibility observed during development: Slack **4.52.171** on macOS
(Electron **44.4.5**). Chrome extension fixture checks pass in Chrome
**156.0.8078.74** on macOS. A signed-in Slack web session and Windows/Linux
have not been verified. Slack DOM/editor changes may require selector updates.

| File | Responsibility |
| --- | --- |
| `manifest.json` | Chrome extension; loads the shared script on Slack pages |
| `src/launcher.mjs` | Install, launch, watch, stop, and uninstall |
| `src/cdp.mjs` | Local debugger connection and Slack page filtering |
| `src/quote-reply.js` | Hover button, permalink selection, and composer insertion |
| `scripts/verify-slack.mjs` | Live checks without sending messages |
| `scripts/verify-chrome.mjs` | Isolated unpacked-extension checks with local fixtures |
| `scripts/probe.mjs` | Developer helper for evaluating a supplied script against a local Slack debugger; set `SLACK_QUOTE_PORT` explicitly |
| `test/` | Unit tests and live editor/routing checks |

Use Conventional Commits for commits and PR titles, for example
`fix: preserve thread context in reply links`. Use purpose-based branch names
such as `feat/compact-replies` or `fix/composer-routing`.

### Review the compact design without installing

With Google Chrome installed at its standard macOS location, run:

```sh
UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 npm run preview:compact
```

This opens a separate headless Chrome process with a disposable profile, renders
an illustrative Slack-style fixture with the actual plugin code, checks expansion,
keyboard access, edits, narrow layouts, and cleanup, and writes `collapsed.png`
and `expanded.png` to the ignored `preview-output/` directory. It does not connect
to Slack or modify the installation. Set `CHROME_PATH` to use another Chrome
executable; pass an output directory after `--` to save the screenshots elsewhere.
These are isolated design previews, not screenshots of the user's live Slack.
