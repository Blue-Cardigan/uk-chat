# Data Protection Impact Assessment (DPIA) - ChatGB

Last updated: 2026-03-30
Status: Draft - requires legal review and sign-off

## Scope

- LLM-assisted chat with persisted conversation history
- Uploaded document excerpts used for inference context
- Council mode deliberation workflows
- Public share links for user-selected conversations
- Planned synthetic profile/personalisation feature

## Risks identified

1. Over-collection of personal data in free-form prompts and attachments.
2. Third-party processing without clear user awareness.
3. Potential accidental disclosure through shared conversation links.
4. Insufficient user controls for deletion/export if not implemented.
5. Elevated risk if special category demographic data is collected.

## Mitigations

- Privacy notice and first-use disclosure in-product.
- Explicit consent flow for optional personalisation/synthetic profiles.
- Share revocation and optional expiry.
- Full account deletion and full data export endpoints.
- RLS enforcement and admin audit logs.
- Sensitive token encryption at rest.
- Retention job for aged content.

## Residual risk

Medium (pending legal review, DPA completion, and operational process rollout).

## Actions before production

- [ ] Legal sign-off on lawful basis register and privacy policy
- [ ] DPIA sign-off by responsible owner
- [ ] DPA completion with all processors
- [ ] Breach response runbook approved
