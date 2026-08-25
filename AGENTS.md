# Agent Tooling Guardrails

These rules are mandatory for ChatGPT/agent work in this repository.

## GitHub operations

- Use the GitHub connector tools for all repository reads and writes: branch inspection, file fetch/update/create/delete, commits, pull requests, workflow runs, jobs, logs, artifacts, and merges.
- **Direct implementation from ChatGPT is supported and expected:** use GitHub connector writes plus GitHub Actions to edit code, checkpoint work, open PRs, run CI/headless Blender/WebGL validation, inspect artifacts, iterate, and merge. Do not tell the user this repository cannot be implemented from chat without first attempting this established workflow.
- For tasks that require executable validation or rendering, prefer the repository's existing GitHub Actions workflows instead of stopping at a code-only proposal.
- Do **not** use `container`, shell `git`, `gh`, `curl`, Python networking, or raw HTTP as a fallback for GitHub operations.
- If a GitHub tool is not currently loaded, call `api_tool.list_resources` for the GitHub connector and load the exact function needed, then continue with the GitHub connector.
- If a GitHub connector call fails, diagnose/retry with the connector. Do not switch to shell GitHub access.

## Safe write protocol

Before any repository write:

1. Confirm the target repository and working branch.
2. Fetch the current file from that branch and use its current blob SHA for updates.
3. Write only to the intended working branch; never fall back to the default branch implicitly when branch-specific work is in progress.
4. Record the commit SHA returned by the write.
5. Verify the branch/PR head after meaningful checkpoints.

A change is not considered committed unless a GitHub connector write returns a commit SHA.

## CI and visual validation

- For Blender/SERA work, use the existing GitHub Actions headless Blender + WebGL audit pipeline.
- A visual change is not considered validated until the workflow completes successfully and the actual artifact PNGs have been downloaded and inspected.
- Never use generated/mock images as evidence of the game or Blender result.
- Do not claim a workflow, artifact, render, or screenshot exists unless the relevant GitHub connector result confirms it.

## Tool routing

- GitHub repo work -> GitHub connector.
- Local artifact/file inspection after download -> `container` / image inspection tools.
- User-visible file generation -> artifact-specific tools only when actually requested.
- Do not use `python_user_visible` merely for progress/status messages.

## Failure handling

If tool routing becomes unclear:

1. Stop before making a write.
2. Re-discover the correct GitHub connector function with `api_tool.list_resources`.
3. Resume only through the GitHub connector.
4. Report a failure accurately; never present an uncommitted or unvalidated change as completed.
