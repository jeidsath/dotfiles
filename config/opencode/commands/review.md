---
description: Independent GLM 5.2 review of current changes
agent: 10-glm-5p2-plan
subagent: true
---

Review the current working-tree changes independently.

Start with:
!`git diff --stat`
!`git diff`

Look specifically for:
- correctness bugs
- regressions
- missed edge cases
- concurrency or error-handling problems
- security issues
- unnecessary complexity
- tests that should exist but do not

Do not edit anything. Report concrete findings in severity order. If there are no substantive problems, say so.
