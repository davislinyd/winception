# WAIT-TO-FIX: OS Image Cache status text

## Context

Development workspace to fix:

`C:\Users\davis\Documents\Codex\osdcloud-project`

Deployment clone where this note is stored:

`C:\osdcloud-win11-deployment-lab`

Remote repository:

`origin-github` / `origin` -> `https://github.com/your-username/osdcloud-win11-deployment-lab.git`

Target branch:

`master`

## Current finding

The Web OS Image Cache download job currently shows `Downloading X / Y` for the whole acquisition job. The network source download can reach `4.9 GB / 4.9 GB`, but the job still has local work left: source size/hash validation, DISM source inspection, DISM WIM export, output validation/hash, catalog update, and final cache rename.

That makes the UI look stuck even when it is actually doing post-download local processing. If the Web console process stops, the frontend polling path can also leave the last stale `Downloading 4.9 GB / 4.9 GB` text on screen.

## Pre-fix git gate

Before modifying code in the development workspace:

1. Open `C:\Users\davis\Documents\Codex\osdcloud-project`.
2. Run `git status --short --branch`.
3. Run `git remote -v`.
4. Run `git pull --ff-only origin-github master` only if the working tree is clean.
5. Re-read `.ai/status.json` and compare it with live Git state.
6. If pull brings new code, re-read the relevant implementation and tests before editing.
7. If the working tree is dirty, stop and report the blocking files. Do not stash or overwrite unless explicitly instructed.

## Implementation plan

Add phase-aware progress metadata to the OS image acquisition job without changing the actual download/export/cache behavior.

Backend behavior:

- Keep existing `status`, `running`, `bytes`, `totalBytes`, `fileName`, `imageId`, `startedAt`, `finishedAt`, and `error` fields.
- Add non-breaking `phase` and `message` fields to `osDownloadStatus`.
- Emit progress phases from `tools/osdcloud-console/src/osImages.js`:
  - `downloading-source`
  - `download-complete`
  - `verifying-source`
  - `inspecting-source`
  - `exporting-wim`
  - `verifying-wim`
  - `caching`
- Preserve the last meaningful phase on failure.
- Set final success phase/message when the job reaches `downloaded` or `cache-hit`.

Frontend behavior:

- In `tools/osdcloud-console/web/app.js`, render OS download text from `phase` and `message` when present.
- During network download, show `Downloading source image X / Y`.
- After source bytes equal total but the job is still running, show `Download complete; preparing image...`.
- During DISM export, show `Exporting deployable WIM with DISM. This can take several minutes.`
- On success, show `Cached <fileName>.`
- On failure, show `Failed: <error>`.
- Track refresh failures. If the last known OS download state is still running and `/api/state` polling fails, show `Connection to Web console lost; status may be stale.`

Documentation:

- Update user-facing documentation only if an existing OS Image Cache section already describes the download flow. Keep the docs change minimal.

Status file:

- After code/docs/test changes in the development workspace, update `.ai/status.json` according to repo rules.
- Do not update `.ai/status.json` during a read-only check.

## Tests

Focused tests:

`node --test tools/osdcloud-console/test/osImages.test.js tools/osdcloud-console/test/serviceController.test.js tools/osdcloud-console/test/webUi.test.js`

Full verification:

`npm test`

Diff hygiene:

`git diff --check`

Expected test coverage:

- `osImages.test.js` verifies phase ordering through download, post-download validation, DISM export, and cache finalization.
- `serviceController.test.js` verifies background job state keeps `running: true` during intermediate phases and ends with a success or failure phase/message.
- `webUi.test.js` verifies phase-aware text and stale Web-console connection text exist in the frontend.

## Out of scope

- Do not change actual Microsoft download logic.
- Do not change DISM export behavior.
- Do not add resume, cancel, retry, or staging cleanup features.
- Do not edit `C:\OSDCloud` manually.
- Do not edit code directly in `C:\osdcloud-win11-deployment-lab`.
