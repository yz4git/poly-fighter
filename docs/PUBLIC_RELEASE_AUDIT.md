# Public Release Audit

Audit date: 2026-08-24

This document records the repository checks performed before changing `yz4git/poly-fighter` from private to public visibility.

## Release decision

**PUBLIC VISIBILITY: APPROVED AFTER MERGING PR #17.**

The audit found no committed API key, password, private key, npm authentication token, or environment credential in the reviewed default-branch content. `.env*` and `*.pem` are ignored. `.openai/hosting.json` contains a Sites project identifier, not an authentication credential.

The repository is intentionally **public source, not automatically open source**. See the root `LICENSE` notice.

## Asset provenance

- `public/reference/female-turnaround.jpeg` is original AI-assisted project reference artwork created for POLY FIGHTER. Its provenance is documented in `public/reference/README.md`.
- The current Blender SERA pipeline uses the Quaternius Universal Base Characters Kit as a source body/rig.
- The Quaternius source used by CI is CC0 1.0 Universal and is pinned to upstream mirror commit `57c0855a6622d4654fe32e9208efb820051164e3`.
- Third-party details are recorded in `THIRD_PARTY_NOTICES.md`.

## GitHub Actions hardening

- Pull-request validation is explicitly `contents: read`.
- The SERA WebGL visual audit performs build/test/capture work with `contents: read`.
- Runtime publishing is isolated into a second job with `contents: write` and only runs when the PR head repository is the same repository as the base repository. Fork PRs cannot enter the write job.
- The SERA Hero Asset AI Pipeline PR is explicitly `contents: read`.
- `sera-v10-reconstruct.yml` retains `contents: write` because it only runs on `workflow_dispatch` or pushes to a named repository branch; it does not run on untrusted pull-request code.

## Pull-request cleanup

- PR #1 `Implement V7 Golden Master closed-loop reconstruction`: **closed as superseded**. Its branch was 276 commits behind main with two unique historical commits. Later V8/V9/V10/V11/Blender work replaced this path.
- PR #9 `Finish SERA V10.2 partitioned articulation`: **closed as superseded**. Its branch was 189 commits behind main with three unique historical commits. V10.3/V10.4/V11/Blender work replaced this path.
- PR #16 `Add SERA Hero Asset AI Pipeline`: **active**. Its workflow permissions were hardened to `contents: read` before public release.
- PR #17 `Prepare repository for public visibility`: **active public-release gate**.

## Branch classification

The following historical branches were confirmed to have **zero commits ahead of main**, so they expose no branch-only source beyond content already present in main/history:

- `chatgpt/blender-sera-prototype`
- `chatgpt/sera-skinning-30`
- `chatgpt/sera-v10-4-reference-match`
- `chatgpt/sera-v11-v91-character-v10-rig`
- `chatgpt/sera-v11-winding-fix`
- `chatgpt/visual-v8-single-mesh`
- `chatgpt/visual-v9-1-screen-match`
- `chatgpt/visual-v9-authored-stance`
- `chatgpt/visual-v10-1-skinning`
- `chatgpt/visual-v10-3-articulation`
- `chatgpt/visual-v10-offline-reconstruction`

Two obsolete branches retain unique historical commits but their PRs are closed and their differences were reviewed:

- `agent/golden-master-v7` — closed PR #1; historical reconstruction/reference diagnostics.
- `chatgpt/visual-v10-2-polish` — closed PR #9; obsolete articulation experiment and temporary README.

Active branches:

- `main`
- `chatgpt/sera-hero-ai-pipeline` — PR #16
- `chatgpt/public-release-prep` — PR #17

`chatgpt/public-release-prep-2` and `chatgpt/public-release-prep-license` are empty temporary refs created from the same main commit during preparation and contain no unique commits or files. They are safe to expose, though they may be deleted later purely to reduce branch-list clutter.

## Remaining operational note

Changing GitHub visibility itself is an account/repository setting and should only be done after PR #17 is merged. The release audit does not change the visibility setting by itself.
