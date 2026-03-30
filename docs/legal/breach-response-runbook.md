# ChatGB Data Breach Response Runbook

Last updated: 2026-03-30

## 1. Triage

Within 1 hour of incident detection:

- Confirm scope (systems, datasets, users impacted).
- Contain active exposure (disable access path, rotate secrets/tokens, revoke public links if relevant).
- Preserve evidence (logs, snapshots, timeline).

## 2. Internal escalation

- Notify engineering owner and privacy lead immediately.
- Start an incident timeline document with UTC timestamps.

## 3. Regulatory and user notification

- Assess whether the incident is a personal data breach under UK GDPR.
- If reportable, notify ICO within 72 hours of awareness.
- If high risk to individuals, notify affected users without undue delay.

## 4. Post-incident actions

- Root-cause analysis.
- Remediation plan with owners and deadlines.
- Update DPIA/risk register if threat model changed.
- Verify recurrence controls are deployed.
