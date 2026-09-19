# Managed gameplay audio

Configure intents in `audio.system.sounds` and the bounded `maxSfxVoices` budget.
Each intent specifies its resource path, volume, loop, cooldown, concurrency,
priority (larger wins), and whether a higher-priority voice may replace it.
Derive these choices from the source callback and audio owner; defaults are not
evidence of Unity equivalence. Unity priority numbers use the opposite ordering.

Await `PlayableAudioController.ready` before enabling input. Call `unlockAudio`
from the actual gesture, including DOM controls outside the Cocos canvas. Call
`SoundManager.playSound(id, gain)` for gameplay feedback. The optional gain is a
per-playback multiplier, independent of policy/master volume, mute, and fades.
Use `audio.setPlaybackGain(handle, gain)` to update it without affecting other
voices. Keep exact owner handles and stop them when the source owner stops.

Positive handles mean the backend was requested to start. They do not establish
audibility: validate engine playback time, running audio context, and nonzero
signal using a real gesture. Counters distinguish requested, played, rejected,
stolen and completed voices. Gameplay callbacks must still complete if playback
is rejected. Late completion and stale handles cannot release a reused voice.

The backend uses Cocos AudioSource and its existing browser context. It does not
create a second context or play silent sounds to unlock autoplay. Pitch, spatial
panning/spread, mixer routing, and Unity virtual-voice ranking are not implemented
by this API. Report these gaps; a caller's attenuation gain alone is not 3D parity.

Commit `tools/audio-port-map.json` with source path/hash/callback, runtime consumer,
regression, and preserved/adapted policy disposition. Include two owner lifecycle
rounds, overlap, mute/resume and exact callback counts in acceptance.
