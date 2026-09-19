# Audio owner examples

For a Unity effect that invokes `PlayOneShot` every three seconds, preserve that
schedule separately from the voice lifetime. A four-second clip overlaps its next
invocation: configure at least two concurrent voices instead of making it loop.
Store every handle under the effect owner; destroying the owner stops its voices.

For a collision prefab with random volume chosen in `Start`, sample once when
that pooled instance is activated. Pass the value to `playSound(id, gain)` and
retain it for that activation. Do not mutate shared intent volume: that would
change concurrent collisions. On pool return, stop only this instance's handles.

For source attenuation, keep the source distance/curve in config and update the
handle's playback gain. This preserves managed mute and fade behavior. It does
not supply spatial panning, spread or Doppler; require separate evidence for those.

For repeatable browser QA, preload before input, arm a playback probe, and click
the real control twice. Check two requested/started events, the first handle no
longer active after replacement, the second advancing, and nonzero audio signal.
