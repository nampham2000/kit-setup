// Controlled Unity experiment for Velocity over Lifetime orbital + offset + radial + speed modifier (knight Tornado
// settings): a copy of ParticleSystem_Tornado at the origin emits one particle at EMIT (world) and is stepped with
// Simulate(1/60); prints the particle position every 6 steps for the variants A (source), B (speedModifier 1),
// C (speedModifier 1, offset 0), D (source, emitter moving +X at 5 u/s during the run), E (source speed, offset 0).
// DC_SUBST: EMIT=<x,y,z>
using UnityEngine; using System.Text; using System.Globalization;
public class Script { public static string Main() {
  var IC = CultureInfo.InvariantCulture;
  ParticleSystem src = null;
  foreach (var ps in Object.FindObjectsByType<ParticleSystem>(FindObjectsInactive.Include, FindObjectsSortMode.None))
    if (ps.name == "ParticleSystem_Tornado" && ps.transform.parent && ps.transform.parent.parent && ps.transform.parent.parent.name.Contains("Special")) { src = ps; break; }
  if (!src) return "tornado not found";
  var e = "@EMIT@".Split(','); var emit = new Vector3(float.Parse(e[0], IC), float.Parse(e[1], IC), float.Parse(e[2], IC));
  var sb = new StringBuilder();
  foreach (var variant in new[] { "A", "B", "C", "D", "E" }) {
    var go = Object.Instantiate(src.gameObject); go.SetActive(true); go.transform.SetParent(null); go.transform.position = Vector3.zero; go.transform.rotation = Quaternion.identity; go.transform.localScale = Vector3.one;
    foreach (var c in go.GetComponentsInChildren<ParticleSystem>()) if (c.gameObject != go) Object.DestroyImmediate(c.gameObject);
    var ps = go.GetComponent<ParticleSystem>();
    ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
    var main = ps.main; main.playOnAwake = false; main.loop = false; main.duration = 5; main.startLifetime = 2;
    var em = ps.emission; em.rateOverTimeMultiplier = 0; em.rateOverDistanceMultiplier = 0;
    var vol = ps.velocityOverLifetime;
    if (variant == "B" || variant == "C") vol.speedModifierMultiplier = 1;
    if (variant == "C" || variant == "E") { vol.orbitalOffsetXMultiplier = 0; vol.orbitalOffsetYMultiplier = 0; vol.orbitalOffsetZMultiplier = 0; }
    ps.Simulate(0, false, true, false);
    var p = new ParticleSystem.EmitParams { position = emit, velocity = Vector3.zero, startLifetime = 2, startSize = 1, applyShapeToPosition = false };
    ps.Emit(p, 1);
    var buf = new ParticleSystem.Particle[4];
    sb.Append(variant).Append(" sm=").Append(vol.speedModifierMultiplier.ToString(IC)).Append(':');
    for (int step = 1; step <= 60; step++) {
      if (variant == "D") go.transform.position = new Vector3(5f * step / 60f, 0, 0);
      ps.Simulate(1f / 60, false, false, false);
      if (step % 6 == 0) { int n = ps.GetParticles(buf); if (n > 0) { var q = buf[0].position; sb.Append(" [").Append(q.x.ToString("0.###", IC)).Append(',').Append(q.y.ToString("0.###", IC)).Append(',').Append(q.z.ToString("0.###", IC)).Append(']'); } else sb.Append(" -"); }
    }
    sb.Append('\n');
    Object.DestroyImmediate(go);
  }
  var v = src.velocityOverLifetime;
  sb.Append("src space=" + src.main.simulationSpace + " volSpace=" + v.space + " orb=" + v.orbitalXMultiplier + "," + v.orbitalYMultiplier + "," + v.orbitalZMultiplier + " off=" + v.orbitalOffsetXMultiplier + "," + v.orbitalOffsetYMultiplier + "," + v.orbitalOffsetZMultiplier + " radial=" + v.radialMultiplier + " sm=" + v.speedModifierMultiplier);
  return sb.ToString();
} }
