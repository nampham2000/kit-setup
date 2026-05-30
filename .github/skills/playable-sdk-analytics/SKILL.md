---
name: playable-sdk-analytics
description: "Use when implementing, auditing, or fixing playable-sdk analytics or tracking in a playable project. Covers TrackingConfig.json, assets/resources copy, GameTrackingService wiring, engagement timers, interaction events, CTA clicks, game end events, and project-specific tracking configuration."
argument-hint: "Target playable project or analytics task"
---

# Playable SDK Analytics

Use this skill when a playable project needs to adopt or update the shared analytics flow from `playable-sdk`.

## When To Use

- The user asks to add analytics or tracking.
- The user mentions `TrackingConfig.json`, `GameTrackingService`, GameAnalytics, engagement, or interactions.
- The user wants to standardize CTA click, session, or game end events across playable projects.

## Procedure

1. Inspect the consumer project's real gameplay flow before changing anything.
2. Verify the project can import `GameTrackingService` from `playable-sdk`.
3. Ensure the consumer project has `assets/resources/TrackingConfig.json`, using the shared template from this repo as the source.
4. Add tracking hooks only where they match the actual flow:
   - startup: `GameTrackingService.init()`
   - meaningful player progression: `GameTrackingService.logInteraction()`
   - CTA click: `GameTrackingService.logDownloadClick()`
   - game end: `GameTrackingService.logGameWin()` or `GameTrackingService.logGameLose()`
5. Keep the implementation aligned with `GameTrackingService` built-ins:
   - `init()` already emits `playableLoaded` and starts the session.
   - `logInteraction()` increments the step counter and can emit `targetClicksReached`.
   - `logDownloadClick()` emits `playableClicked`, stops the session, and flushes events.
   - `logGameWin()` and `logGameLose()` emit `gameEnd`, stop the session, and flush events.
6. Before finishing, tell the user which config values still need project-specific data or gameplay confirmation.

## Required User Notification

Always call out the fields or hooks that still need review:

- `project_id`
- `brief_id`
- `android_bundle_id`
- `ios_bundle_id`
- `gameAnalytics.gameKey`
- `gameAnalytics.gameSecret`
- `gameAnalytics.build`
- `engagement.target_duration`
- `engagement.heartbeat_interval`
- `interactions.target_clicks`
- any `events.*` names that need to match a project-specific naming convention
- the exact gameplay methods chosen for interaction, CTA, and win/lose events

## References

- [Integration checklist](./references/analytics-integration-checklist.md)