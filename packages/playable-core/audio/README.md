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

The backend plays Web Audio clips through nodes on the context the Cocos web
player already uses (decoded buffer of the loaded clip: BufferSource -> Gain ->
StereoPanner -> destination); other clips use a Cocos AudioSource. It does not
create a second context or play silent sounds to unlock autoplay (unlockFromGesture
resumes the shared context from the gesture).

`playSound(id, gain, rate, pan)`: `rate` is the playback rate (Unity pitch;
AudioRandomContainer cents -> 2^(cents / 1200)), `pan` the stereo pan in [-1, 1]
(Unity 3D panning of the source relative to the listener; update moving sources
with `audio.setPlaybackPan(handle, pan)`). Distance rolloff stays a caller gain
computed from the source AudioSource min/max distance and rolloff mode.
`audio.supportsRatePan` is true once a voice rendered rate/pan through Web Audio;
on other backends they are ignored and must be reported as a gap. Mixer routing,
spread and Unity virtual-voice ranking are not implemented.

Commit `tools/audio-port-map.json` with source path/hash/callback, runtime consumer,
regression, and preserved/adapted policy disposition. Include two owner lifecycle
rounds, overlap, mute/resume and exact callback counts in acceptance.
