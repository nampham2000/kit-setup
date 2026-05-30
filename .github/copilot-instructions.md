# Playable Shared Kit AI Rules

- When the user asks to set up or modify a `playable-sdk` capability, first look for a matching package-specific asset under `.github/skills`, `.github/prompts`, or `.github/agents`.
- For analytics or tracking requests, prefer the `playable-sdk-analytics` skill or the `playable-sdk-analytics` custom agent before inventing a new workflow.
- For analytics integration, reuse `playable-sdk` exports instead of duplicating local tracking logic.
- Ensure the consumer project has `assets/resources/TrackingConfig.json`, using `resources/TrackingConfig.json` in this repo as the source template.
- Wire only meaningful tracking hooks: startup/init, engagement/session timing, interaction progression, CTA click, and game end states.
- Always tell the user which fields still require project-specific values or flow confirmation so tracking can run with the correct project identifiers, analytics keys, and event mapping.