// Dump Unity's generated ShaderGraph code (the text Unity compiles) for the shared kit's ShaderGraph -> Cocos
// effect generator (tools/shader-compiler/shadergraph-codegen.cjs). Read-only.
// Run: npm run unity:script -- --project <UnityProjectRoot> --script playable-shared-kit/tools/unity-intel/dump-shadergraph-code.cs
//        --set OUTPUT_DIR=<absolute dir> --set SEARCH_FOLDERS=Assets/Game;Assets/Shaders
// SEARCH_FOLDERS is ';'-separated (empty = all of Assets). Needs com.ccplayable.unity-intelligence >= this kit.
using System;
using System.Linq;
public class Script
{
    public static string Main()
    {
        var type = AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetType("CcPlayable.UnityIntelligence.Capture.ShaderGraphCodeDump"))
            .FirstOrDefault(t => t != null);
        if (type == null)
            throw new Exception("CcPlayable.UnityIntelligence.Capture.ShaderGraphCodeDump missing: run unity:intel:setup to refresh the kit Unity package");
        var folders = "SEARCH_FOLDERS".Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
        if (folders.Length == 1 && folders[0] == "SEARCH" + "_FOLDERS") folders = new string[0];
        return (string)type.GetMethod("Dump").Invoke(null, new object[] { "OUTPUT_DIR", folders });
    }
}
