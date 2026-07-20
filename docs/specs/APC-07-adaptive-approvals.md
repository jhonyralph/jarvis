# APC-07 - Adaptive Approval Queue

## Problem
`decideAdaptiveRun` can return `ask`, but the Hub did not yet expose a concrete approval queue for autonomous/background actions. Scheduled routines therefore had no useful middle ground between silently running or being blocked.

## Scope
- Add a normalized adaptive approval request contract in core.
- Gate scheduled routines through adaptive background policy.
- Let manual routine runs bypass the background gate because they are explicit user actions.
- Broadcast pending approvals to the web app and allow owner approval/rejection.

## Out of Scope
- Approval persistence across Hub restart.
- Approval flow for delegated managed execution budgets.
- Fine-grained diff approvals for repo writes.

## Acceptance
- A scheduled routine with `background` disallowed is blocked and not run.
- A scheduled routine with policy decision `ask` creates one pending approval instead of repeatedly notifying.
- Approving the pending item runs the routine once with the approval gate bypassed.
- Rejection clears the pending item.
