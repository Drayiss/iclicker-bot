# iClicker Bot

A local Windows application and Edge extension for your experimental fake class. The app checks one selected tab every three seconds, alerts Discord when a class is detected, joins using an unambiguous visible Join control, sends each new question to a fresh solver, and submits only after rechecking the question and controls.

Version 1.3 also follows your requested **alert + random answer** policy when a single-choice question cannot be solved. This is enabled in saved settings and can be disabled in the control panel. Random choices are explicitly labeled and never represented as solved answers.

## Run on your PC

1. For the recommended releases, run **Install-App-Runtimes.cmd** once. It downloads official, SHA-256-verified Python and Node archives into this project and installs the pinned stable Codex CLI. An existing Python 3.11+ is needed to bootstrap setup. Then double-click **Start-iClicker-Bot.cmd** and keep the console open. The app has no third-party Python packages.
2. The control panel opens at **http://127.0.0.1:8765**.
3. Choose a solver in Settings:
   - **Codex CLI**: the runtime installer installs the pinned CLI locally. Run `.\node_modules\.bin\codex.cmd login` from this project and keep `codex` as the executable. Existing standard global npm installations are also supported. Node.js is only required for the CLI and JavaScript tests.
   - **OpenAI API**: select API mode and enter an API key, or set `OPENAI_API_KEY` before launching. API usage uses your API account.
4. Settings automatically fills the Discord webhook field (masked) from this project's `.local/config.json` when the panel opens, and keeps it filled after saving. For a new copy on another machine, paste your webhook into Settings and click **Save settings** once. Use **Send test alert** to verify Discord and PC alerts.
5. In Edge, open **edge://extensions**, enable **Developer mode**, select **Load unpacked**, and choose this project's **extension** folder.
6. Open the extension popup. Paste the pairing code from the control panel, select the existing iClicker tab, and choose **Connect this tab**. Edge's debugging banner must stay attached.
7. Open the class's live lobby or live question page in that tab, then choose **Start monitoring** in the control panel. A completed poll-history page remains idle; it does not expose the next class's live controls.

Python alternative: `python app.py`. Use `python app.py --no-open` to leave the browser closed.

To check your Codex login, run this from the project folder:

```powershell
.\node_modules\.bin\codex.cmd login status
```

A logged-in status using ChatGPT means the app can reuse your saved login. If you are not logged in, run `.\node_modules\.bin\codex.cmd login`. This checks authentication, not model availability or the live iClicker workflow.

## Runtime versions and setup checks

`runtime-lock.json` records the official releases checked on November 12, 2026:

| Component | Recommended version | Release channel |
| --- | --- | --- |
| Node.js | 26.13.1 | Latest LTS |
| Python | 3.15.2 | Latest stable; Python has no separate LTS label |
| Codex CLI | 0.167.2 | Latest stable; no LTS channel |
| Microsoft Edge | 157.0.4341.42 | Stable; update through `edge://settings/help` |

The CMD launchers use project-local runtimes when installed, without changing system-wide Python, Node or PowerShell execution policy. If the recommended Python is unavailable, the app can still run with compatible Python 3.11+ and prints an update recommendation. `.nvmrc`, `.python-version` and `package.json` agree with the runtime lock. The npm version comes from the pinned Node distribution.

Run **Check-App-Setup.cmd**, or `python tools/launch.py --check`, to see installed versus recommended versions. Run **Install-App-Runtimes.cmd** to install/repair the pinned versions; it needs access to `python.org`, `nodejs.org` and `registry.npmjs.org`. For API-only setup, `python tools/install_runtimes.py --skip-codex` omits the CLI installation. Saved credentials are never printed. The runtime installer does not update Edge or change browser permissions.

Use the setup checker for current installed versions; the table above records the release pins at the stated check date. `npm install` creates its dependency lockfile when registry access is available.

## Solver behavior

Monitoring continues after every submission: the app waits for the next question, solves/submits it, and repeats. A failed question or a random fallback does not stop later questions. It keeps watching until you pause/disconnect it or close the app.

The preferred model is `gpt-6.1-sol`. If the account reports that it is unavailable, the app tries the configurable fallback list automatically, in order. Login, quota and network failures produce an alert rather than cycling through models. Model availability must be established by your authenticated account; it was not assumed from the chat's available model names.

Every question gets a separate solver invocation. Codex mode uses a new ephemeral `codex exec` process with a read-only sandbox, structured JSON output, the full visible question and options, and a PNG capture including relevant figures. API mode makes an independent Responses request with no previous response or conversation, image input, structured output and `store: false`.

With random fallback enabled, the default solver budget is **12 seconds across all model attempts**, shortened when a clearly identified visible countdown requires it. You can adjust this to 3–43 seconds. The bridge checks for completed solver work separately so a ready answer does not have to wait for the next three-second page check. Timed-out CLI processes and their owned child processes are terminated.

The ChatGPT-internal `spawn_agent(..., fork_turns="none")` tool is not callable by an application on your PC. Independent solver sessions provide the fresh-context behavior without inheriting this conversation. The solver is instructed to use only the supplied question data and no browser, shell, network or other tools.

## Missing text and page changes

- The app never reconstructs absent question text. Missing/unidentified/clipped text, unreadable context, capture failures and solver failures trigger **Activity chat**, PC and Discord alerts. If random fallback is enabled and the live single-choice controls are clear, it selects one of those visible options at random, submits it and verifies the receipt. This may be wrong. You can change the answer manually while the poll remains open; the bot does not automatically overwrite a correction to that same question.
- Closed polls, multiple-answer/text questions, inaccessible controls, invalid/ambiguous selectors and multiple competing question frames remain alert-only. There is no random submission when the app cannot unambiguously identify a visible live single-choice control. A loading question image receives a brief grace period, unless a visible deadline is imminent.
- Default page recognition is deliberately conservative. It supports question-text containers, radio/checkbox options, answer buttons labeled A-E, and text/numeric inputs. Version 1.1 adds the `#btnJoin` and `.polling-page-wrapper` selectors found in public iClicker extensions, joined-state wording, and native single-choice click-to-submit behavior. These published patterns are not a substitute for checking the current live page. If the active page differs, pause and set exact CSS selectors under **Page selectors & timing**.
- On a recognized native polling page with a visible **Multiple Choice** question type and unique A-E buttons, clicking the chosen letter is submission. The app does not require or search for a separate Submit button in that mode. Multiple-answer and text/numeric questions still require a clear explicit submission control. An ambiguous explicit Submit never falls back to implicit submission.
- Questions delivered as a single fully loaded question image are sent to the vision-capable solver in the screenshot, even when their wording has no DOM text. Hidden-image placeholders do not go to the solver; absent/illegible content uses the configured random-or-alert policy. Merely recognizing an image does not establish that its question is answerable.
- Selectors must identify a single visible question, Join, Submit, or text input; the options selector may identify multiple options. Stale zero-match selectors may recover through unique known or semantic matches, with recovered fields shown in diagnostics. Invalid syntax or multiple matches block submission. Nested known text containers are resolved conservatively; accessible labels and test attributes provide alternatives to CSS classes.
- Visible, accessible same-origin iframes are probed. Actions are bound to the captured document/frame and checked again before clicking. Hidden/cross-origin inaccessible frames and ambiguous competing question frames are not acted on. Content split across unrelated frames, target questions and unrecognized submission interfaces still require an adapter update.
- Submit may initially be disabled until an answer is selected. The extension checks that the final answer is selected and the Submit button is enabled before clicking it.
- The extension checks the question again immediately before entering/submitting. A question change discards the old answer.
- A successful click alone is not reported as successful submission. The same question must show explicit submitted/recorded/**Answer Received** text, or your configured acknowledgment selector. Unclear acknowledgment alerts you and stops automatic retries.
- The app persists dispatched/submitted fingerprints within a durable class session, so identical questions in a later class can be handled again after a detected class end/idle transition. The extension also maintains a bounded persistent command ledger and pending acknowledgments. A restart or lost acknowledgment does not repeat submission. **Inspect current question again** clears a blocked solver attempt only; it cannot retry an uncertain or completed submission.
- Activity chat is the local application's event feed. A standalone app cannot post messages back into this ChatGPT conversation.

## Alerts and operation

Keep the PC awake, Edge open, the class tab accessible, the debugger banner attached and the app running. Active debugging keeps the extension service worker awake for its three-second timer. A 30-second recovery alarm restores the worker after startup; the app alerts after about 20 seconds without extension contact. PC/browser sleep can delay checks; the app cannot promise monitoring while the PC is asleep.

A DOM `MutationObserver` and hash/history navigation events also trigger inspections when meaningful page state changes. They supplement the three-second timer and ignore unchanged semantic states such as countdown ticks. The control panel's **Detected** line shows Join visibility, question source, option count and submission mode without requiring you to control the instructor's class.

Additional independent wake-up signals include tab-navigation events, relevant iClicker network-response metadata and structured WebSocket activity events. Network hints only trigger inspection or an unreadable-poll alert; they never authorize a click or supply missing question text. Raw network frames, headers, credentials and response bodies are not stored or forwarded. If network observation is unavailable, DOM/timer polling continues and retries that detector later. The actual internal event schema remains unverified against this account's live class.

On a missing tab, automatic recovery requires exactly one matching saved URL containing a course/activity identity. Generic `#/polling` URLs and multiple matches require manual reconnection, preventing an automatic switch into a different class. An attachment owned by this extension can be recovered after a worker restart. Edge's explicit stop-debugging action still disarms it.

The extension's **Show last detection check** button displays the latest capture time, matched state, recovered selectors, frame information and detector health. It reads cached diagnostics and does not click or submit anything.

After updating to extension version 1.3, pause, click **Reload** for this extension on `edge://extensions`, reload the class page, then reconnect the tab and resume monitoring. Reloading the page removes the previous adapter's listeners. See [DETECTION_NOTES.md](DETECTION_NOTES.md) for the public research behind these changes and its limitations. The minimum Chromium API version is 120, which supports the half-minute recovery alarm; use current stable Edge for actual operation.

Class-start, access, login and browser failures go to Discord. Failure/help messages also produce a PC message and an Activity chat event. Unchanged idle states are quiet. Discord delivery retries transient network/rate-limit failures and reports failures locally. If the local app itself is closed or crashes, the extension can show a PC connection alert but cannot send Discord through the stopped app. Start the app again to restore notifications.

Use **Pause** to stop new solver/submission work. Disconnecting in the extension releases debugger access. Clicking Edge's Cancel/stop-debugging control disarms the extension and requires explicit reconnection. An action already received by Edge may finish while a pause request is arriving.

## Private data

The server binds only to `127.0.0.1:8765`; API access needs a random pairing token and rejects unexpected Host headers. Other extensions cannot discover that token by reading the panel HTML through CORS. Webhook and API credentials live in `.local/config.json`, never in the extension. Keep this directory private. Regular state responses do not return saved credential values. A separate authenticated endpoint lets only the local panel load the saved Discord webhook into its masked Settings field; cross-origin and extension reads are rejected, and the API key is never returned. Question fingerprints persist in `.local/history.json` and class-session identity in `.local/session.json`; screenshots are held in memory, with temporary PNG files only while a CLI solver runs. The extension stores its own pairing/selection settings, recent diagnostic summary, action IDs/fingerprints and pending receipts locally. Codex/API requests necessarily share question text and screenshots with the selected model provider. Notifications send concise status/random-choice messages to the configured Discord webhook, with mentions disabled.

## Practice and tests

Use **Open practice class** in the control panel and pair its tab. The disposable fake class tests class joining, choice/text questions, a geometry figure, missing text and class end. It uses the configured solver and Discord webhook, so normal model usage and alerts apply.

Run:

```powershell
python -m unittest discover -s tests -v
node --test tests/*.test.cjs
```

The Python suite covers monitor transitions, repeated classes, quiet polling, full context forwarding, stale answers, pause handling, model fallback, deduplicated alerts, uncertain submissions, persistence, runtime pin consistency/installation checks and HTTP auth/CORS/secret redaction. HTTP handlers are exercised with in-memory sockets because the build environment restricts outgoing loopback connections. JavaScript tests cover extraction/submission, the background worker's network/disconnect/recovery behavior, and dashboard settings handling. Real Edge extension installation, live selectors, authenticated solver access and Discord delivery require the final PC setup above and are not claimed as validated by these unit tests.

## Reference documentation

- [Official Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/create)
- [Chromium debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Extension service-worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Official Node 26.13.1 LTS release and checksums](https://nodejs.org/en/blog/release/v26.13.1)
- [Official Python 3.15.2 release and checksums](https://www.python.org/downloads/release/python-3152/)
- [Official Codex CLI releases](https://github.com/openai/codex/releases)
- [Microsoft Edge stable release notes](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel)
