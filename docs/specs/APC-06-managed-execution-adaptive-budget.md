# APC-06 - Adaptive Budget for Delegated Execution

## Problem
Delegated executions accepted an explicit managed-execution policy, but did not apply the adaptive control-plane budget resolved for the current project/subscope. A power user could configure a project budget and still launch a delegated plan that only honored the caller-provided policy.

## Scope
- Merge the resolved adaptive budget into managed execution policy before local or remote delegation.
- Keep the strictest limit when both caller and adaptive policy provide a budget.
- Map adaptive `unknownEstimate: "ask"` to managed `reject` because managed runners do not have an approval round-trip for budget prompts yet.

## Out of Scope
- Interactive approval UI for delegated execution budget prompts.
- Runner protocol changes.
- Cost/token estimation improvements.

## Acceptance
- Delegated execution receives an effective managed policy constrained by adaptive project/subscope budget.
- Caller-provided `maxConcurrency`, `maxDepth`, `maxTasks`, and `deadlineAt` remain intact unless bounded by existing execution config.
- Tests prove the stricter budget wins and unknown adaptive estimates do not silently allow execution.
