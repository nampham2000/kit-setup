---
name: Setup Playable SDK Analytics
description: "Integrate playable-sdk analytics into a playable project: copy TrackingConfig.json to assets/resources, wire GameTrackingService, map engagement and interactions events, and report the project-specific config that still needs manual values."
argument-hint: "Target playable project or gameplay flow notes"
agent: "agent"
---
Integrate `playable-sdk` analytics into the current playable project.

Use these shared-kit references:

- [Analytics skill](../skills/playable-sdk-analytics/SKILL.md)
- [Tracking checklist](../skills/playable-sdk-analytics/references/analytics-integration-checklist.md)
- [TrackingConfig template](../../resources/TrackingConfig.json)
- [GameTrackingService](../../packages/playable-sdk/analytics/GameTrackingService.ts)

Required outcome:

1. Make the project load `TrackingConfig.json` from `assets/resources/TrackingConfig.json`.
2. Reuse `GameTrackingService` from `playable-sdk`.
3. Wire the game's startup, engagement, interaction, CTA, and win/lose hooks to the existing tracking service.
4. Keep the implementation aligned with the service's built-in engagement and interactions behavior.
5. End with a short list of fields or flow points that still need project-specific configuration or confirmation.