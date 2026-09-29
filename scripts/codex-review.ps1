$ErrorActionPreference = "Stop"

$prompt = @"
You are the independent Codex code reviewer for the Blockora project.

Read:
- CLAUDE.md
- docs/ROADMAP.md
- docs/PROGRESS.md
- current git diff
- relevant source files
- relevant tests

Review only. Do not modify source code.

Check:
- correctness
- regression risk
- architecture
- performance
- memory/resource lifecycle
- tests
- TypeScript correctness
- CLAUDE.md compliance

Return:
PASS
PASS_WITH_NOTES
or
FAIL

Write the complete result to:
docs/CODEX_REVIEW.md

Use the review format defined in CLAUDE.md.

Only FAIL for concrete CRITICAL or IMPORTANT issues.
Do not request speculative refactors or future-phase features.
"@

codex exec $prompt