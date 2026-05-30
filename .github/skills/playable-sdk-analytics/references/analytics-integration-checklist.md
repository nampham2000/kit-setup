# Analytics Integration Checklist

## Shared Kit Sources

- Template config: [TrackingConfig.json](../../../../resources/TrackingConfig.json)
- Tracking service: [GameTrackingService.ts](../../../../packages/playable-sdk/analytics/GameTrackingService.ts)
- Package entrypoint: [index.ts](../../../../packages/playable-sdk/index.ts)

## Consumer Project Setup

1. Copy the shared template to `assets/resources/TrackingConfig.json` in the consumer project.
2. Keep the JSON shape intact so `resources.load("TrackingConfig", JsonAsset, ...)` can resolve and merge it.
3. Import `GameTrackingService` from `playable-sdk` where possible.

## Required Tracking Hooks

- Startup:
  - Call `GameTrackingService.init()` once when the playable becomes active.
  - Do not manually emit `playableLoaded`; `init()` already does that.
- Engagement:
  - Let `GameTrackingService` manage `sessionStart`, `sessionStay`, `targetDurationReached`, and `sessionEnd`.
  - Override the session boundary only when the playable flow clearly needs a custom start or stop moment.
- Interactions:
  - Call `GameTrackingService.logInteraction()` only on meaningful progression actions.
  - Avoid noisy taps that do not represent real progress.
- CTA:
  - Call `GameTrackingService.logDownloadClick()` on the actual install or download CTA.
- End State:
  - Call `GameTrackingService.logGameWin()` or `GameTrackingService.logGameLose()` when the playable reaches a terminal result.

## Config Values The User Must Confirm

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
- any custom `events.*` values that must match an external dashboard or naming scheme

## Delivery Checklist

- Mention which file received the tracking hooks.
- Mention which file now contains `TrackingConfig.json`.
- Mention any unclear gameplay hook that still needs user confirmation.
- Keep the final response explicit about manual config that the user must still fill in.