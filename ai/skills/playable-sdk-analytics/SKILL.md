---
name: playable-sdk-analytics
description: "Use when implementing, auditing, or fixing playable-sdk analytics or tracking in a playable project. Covers TrackingConfig.json, assets/resources copy, GameTrackingService wiring, engagement timers, interaction events, CTA clicks, game end events, and project-specific tracking configuration."
argument-hint: "Target playable project or analytics task"
---

# Playable SDK Analytics Integration Skill

Use this skill when a playable project needs to adopt or update the shared analytics flow from `playable-sdk`.

## 1. Non-Negotiables
- Reuse `playable-sdk` exports instead of copying tracking code into the game project.
- Ensure the consumer project contains `assets/resources/TrackingConfig.json` with the same shape as `resources/TrackingConfig.json` in `playable-shared-kit`.
- Inspect the actual playable flow before adding hooks; do not guess where interactions, CTA clicks, or win/lose states happen.
- Do not double-log events that `GameTrackingService` already emits automatically during `init`, session start, or session stop.

---

## 2. Standard Workflow
1. Verify the project imports `GameTrackingService` from the concrete module `playable-sdk/analytics/GameTrackingService`; Component barrels must remain Component-free in Cocos Creator 3.8.x.
2. Copy or update `assets/resources/TrackingConfig.json` from `playable-shared-kit/resources/TrackingConfig.json`.
3. Wire the tracking calls in gameplay:
   - `GameTrackingService.init()` once at startup.
   - `GameTrackingService.logInteraction()` on meaningful player progression.
   - `GameTrackingService.logDownloadClick()` on real CTA click.
   - `GameTrackingService.logGameWin()` or `GameTrackingService.logGameLose()` on terminal game outcomes.
