using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using UnityEngine;

// Regenerates fixtures/wind-zone-native.json through the shared Unity-MCP:
//   npm run unity:script -- --project <Unity> --script <this file>   (writes OUTPUT_FILE)
// Read-only: every object is HideAndDontSave and destroyed; WindZones already in the open scenes are
// deactivated for the capture and restored afterwards (they would add their force to every case).
// Particles are emitted at rest (no gravity, no emission, no shape) into a system with External Forces
// enabled, next to one WindZone, and stepped with ParticleSystem.Simulate; the velocity after each step
// gives the acceleration. Cases cover spherical falloff and radius, sign of windMain, the module
// multiplier, turbulence, pulse magnitude/frequency (edit-mode wind time is frozen, so `windTime`
// records the clocks that may drive it), directional zones, zone scale and Local simulation space
// with a translated, rotated and scaled emitter.
public class Script {
  static string F(float v) { return v.ToString("R", CultureInfo.InvariantCulture); }
  static string V(Vector3 v) { return "[" + F(v.x) + "," + F(v.y) + "," + F(v.z) + "]"; }

  class Zone { public WindZoneMode mode = WindZoneMode.Spherical; public float radius = 4, main = -1, turbulence, pulseMagnitude, pulseFrequency; public Vector3 euler; public float scale = 1; }
  class Emitter { public bool local; public Vector3 position, euler; public float scale = 1; public float multiplier = 1; }

  static string Run(string name, Zone z, Emitter e, Vector3[] starts, int steps = 3, float dt = 1f / 60) {
    var zoneGo = new GameObject("wind-zone") { hideFlags = HideFlags.HideAndDontSave };
    var go = new GameObject("wind-particles") { hideFlags = HideFlags.HideAndDontSave };
    try {
      zoneGo.transform.eulerAngles = z.euler; zoneGo.transform.localScale = Vector3.one * z.scale;
      var zone = zoneGo.AddComponent<WindZone>();
      zone.mode = z.mode; zone.radius = z.radius; zone.windMain = z.main; zone.windTurbulence = z.turbulence;
      zone.windPulseMagnitude = z.pulseMagnitude; zone.windPulseFrequency = z.pulseFrequency;
      go.transform.position = e.position; go.transform.eulerAngles = e.euler; go.transform.localScale = Vector3.one * e.scale;
      var system = go.AddComponent<ParticleSystem>();
      system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = system.main; main.playOnAwake = false; main.loop = false; main.duration = 100;
      main.startSpeed = 0; main.startLifetime = 100; main.gravityModifier = 0; main.maxParticles = 16;
      main.simulationSpace = e.local ? ParticleSystemSimulationSpace.Local : ParticleSystemSimulationSpace.World;
      main.scalingMode = ParticleSystemScalingMode.Hierarchy;
      var emission = system.emission; emission.enabled = false;
      var shape = system.shape; shape.enabled = false;
      var forces = system.externalForces; forces.enabled = true; forces.multiplier = e.multiplier;
      system.Simulate(0, false, true, true);
      foreach (var p in starts) system.Emit(new ParticleSystem.EmitParams { position = p, velocity = Vector3.zero, startLifetime = 100, startSize = 1 }, 1);
      var buffer = new ParticleSystem.Particle[16];
      var sb = new StringBuilder();
      sb.Append("{\"case\":\"").Append(name).Append("\",\"dt\":").Append(F(dt))
        .Append(",\"zone\":{\"mode\":").Append((int)z.mode).Append(",\"radius\":").Append(F(z.radius)).Append(",\"windMain\":").Append(F(z.main))
        .Append(",\"turbulence\":").Append(F(z.turbulence)).Append(",\"pulseMagnitude\":").Append(F(z.pulseMagnitude))
        .Append(",\"pulseFrequency\":").Append(F(z.pulseFrequency)).Append(",\"euler\":").Append(V(z.euler)).Append(",\"scale\":").Append(F(z.scale)).Append("}")
        .Append(",\"emitter\":{\"local\":").Append(e.local ? "true" : "false").Append(",\"position\":").Append(V(e.position))
        .Append(",\"euler\":").Append(V(e.euler)).Append(",\"scale\":").Append(F(e.scale)).Append(",\"multiplier\":").Append(F(e.multiplier)).Append("}")
        .Append(",\"steps\":[");
      for (int s = 0; s <= steps; s++) {
        if (s > 0) system.Simulate(dt, false, false, false);
        int n = system.GetParticles(buffer);
        if (s > 0) sb.Append(",");
        sb.Append("[");
        for (int i = 0; i < n; i++) sb.Append(i > 0 ? "," : "").Append("{\"position\":").Append(V(buffer[i].position)).Append(",\"velocity\":").Append(V(buffer[i].velocity)).Append("}");
        sb.Append("]");
      }
      return sb.Append("]}").ToString();
    } finally {
      Object.DestroyImmediate(go);
      Object.DestroyImmediate(zoneGo);
    }
  }

  public static string Main() {
    var others = Object.FindObjectsByType<WindZone>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Where(z => z.gameObject.activeInHierarchy).ToList();
    foreach (var z in others) z.gameObject.SetActive(false);
    var cases = new List<string>();
    var ring = new[] { new Vector3(1, 0, 0), new Vector3(2, 0, 0), new Vector3(3, 0, 0), new Vector3(0, 2, 0), new Vector3(0, 0, 1.5f), new Vector3(1, 1, 1), new Vector3(5, 0, 0) };
    var local = new[] { new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0.5f, 0.5f, 0) };
    try {
      cases.Add(Run("spherical", new Zone(), new Emitter(), ring));
      cases.Add(Run("spherical-multiplier-10", new Zone(), new Emitter { multiplier = 10 }, ring));
      cases.Add(Run("spherical-outward", new Zone { main = 2 }, new Emitter(), ring));
      cases.Add(Run("spherical-radius-8", new Zone { radius = 8 }, new Emitter(), ring));
      cases.Add(Run("spherical-turbulence", new Zone { turbulence = 1 }, new Emitter(), ring));
      cases.Add(Run("spherical-pulse-0.01", new Zone { pulseMagnitude = 0.5f, pulseFrequency = 0.01f }, new Emitter(), ring));
      cases.Add(Run("spherical-pulse-0.25", new Zone { pulseMagnitude = 0.5f, pulseFrequency = 0.25f }, new Emitter(), ring));
      cases.Add(Run("spherical-pulse-1", new Zone { pulseMagnitude = 0.5f, pulseFrequency = 1 }, new Emitter(), ring));
      cases.Add(Run("spherical-zone-scale-2", new Zone(), new Emitter(), new[] { new Vector3(1, 0, 0), new Vector3(3, 0, 0), new Vector3(5, 0, 0), new Vector3(7, 0, 0) }));
      cases[cases.Count - 1] = Run("spherical-zone-scale-2", new Zone { scale = 2 }, new Emitter(), new[] { new Vector3(1, 0, 0), new Vector3(3, 0, 0), new Vector3(5, 0, 0), new Vector3(7, 0, 0) });
      cases.Add(Run("directional-yaw-90", new Zone { mode = WindZoneMode.Directional, main = 1, euler = new Vector3(0, 90, 0) }, new Emitter(), ring));
      cases.Add(Run("directional-pitch-30", new Zone { mode = WindZoneMode.Directional, main = 2, euler = new Vector3(30, 0, 0) }, new Emitter { multiplier = 0.5f }, ring));
      cases.Add(Run("local-translated", new Zone { radius = 6 }, new Emitter { local = true, position = new Vector3(1, 0, 0) }, local));
      cases.Add(Run("local-translated-rotated-scaled", new Zone { radius = 6 }, new Emitter { local = true, position = new Vector3(1, 0, 0), euler = new Vector3(0, 90, 0), scale = 2 }, local));
      cases.Add(Run("local-directional", new Zone { mode = WindZoneMode.Directional, main = 1, radius = 6 }, new Emitter { local = true, position = new Vector3(1, 0, 0), euler = new Vector3(0, 90, 0), scale = 2 }, new[] { new Vector3(1, 0, 0) }));
    } finally {
      foreach (var z in others) z.gameObject.SetActive(true);
    }
    var clocks = "{\"time\":" + F(Time.time) + ",\"realtimeSinceStartup\":" + F(Time.realtimeSinceStartup) +
      ",\"editorTimeSinceStartup\":" + ((float)UnityEditor.EditorApplication.timeSinceStartup).ToString("R", CultureInfo.InvariantCulture) + "}";
    System.IO.File.WriteAllText("OUTPUT_FILE", "{\"unity\":\"" + Application.unityVersion + "\",\"windTime\":" + clocks + ",\"cases\":[" + string.Join(",", cases) + "]}");
    return "done: " + cases.Count + " cases -> OUTPUT_FILE";
  }
}
