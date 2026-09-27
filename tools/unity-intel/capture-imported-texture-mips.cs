using UnityEngine;using UnityEditor;using Newtonsoft.Json;using System.Collections.Generic;using System.Linq;
public class Script {static string Hash(string p){using(var sha=System.Security.Cryptography.SHA256.Create())return System.BitConverter.ToString(sha.ComputeHash(System.IO.File.ReadAllBytes(p))).Replace("-","").ToLowerInvariant();}
public static string Main(){
 if(!Application.dataPath.Replace('\\','/').Equals("UNITY_ASSETS_PATH"))throw new System.Exception("Owned reference only");
 var output="OUTPUT_FILE";var requestId="REQUEST_ID";
 if(System.IO.File.Exists(output)&&Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(output))["requestId"]?.ToString()==requestId)return "Existing atomic capture for this request";
 if(QualitySettings.activeColorSpace!=ColorSpace.Linear)throw new System.Exception("Linear reference required");
 var shader=AssetDatabase.LoadAssetAtPath<Shader>("SHADER_ASSET_PATH");if(!shader||!shader.isSupported)throw new System.Exception("Native mip shader not ready");
 var material=new Material(shader);var textures=new List<object>();var previous=RenderTexture.active;var previousWrite=GL.sRGBWrite;
 try{foreach(var sourcePath in Newtonsoft.Json.JsonConvert.DeserializeObject<string[]>(System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String("ASSET_PATHS_BASE64")))){
 var path=sourcePath;var sourceHash=Hash(path);var importerHash=Hash(path+".meta");var t=AssetDatabase.LoadAssetAtPath<Texture2D>(path);if(!t||!UnityEngine.Experimental.Rendering.GraphicsFormatUtility.IsSRGBFormat(t.graphicsFormat))throw new System.Exception("Native sRGB Texture2D required "+path);if(!SystemInfo.SupportsTextureFormat(t.format))throw new System.Exception("Native GPU sampling unsupported for "+t.format+"; validated decoder or matching reference device required");var mips=new List<object>();
 for(int mip=0;mip<t.mipmapCount;mip++){int w=Mathf.Max(1,t.width>>mip),h=Mathf.Max(1,t.height>>mip);var rt=new RenderTexture(w,h,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB);rt.Create();var image=new Texture2D(w,h,TextureFormat.RGBA32,false,false);try{
 material.SetFloat("_Mip",mip);GL.sRGBWrite=true;Graphics.Blit(t,rt,material);RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,w,h),0,0,false);image.Apply(false,false);mips.Add(new{width=w,height=h,rgba=System.Convert.ToBase64String(image.GetRawTextureData<byte>().ToArray())});
 }finally{Object.DestroyImmediate(image);Object.DestroyImmediate(rt);}}
 if(sourceHash!=Hash(path)||importerHash!=Hash(path+".meta"))throw new System.Exception("Source changed during capture");
 textures.Add(new{schemaVersion=1,path,sourceTextureSha256=sourceHash,sourceImporterSha256=importerHash,guid=AssetDatabase.AssetPathToGUID(path),unityVersion=Application.unityVersion,format=t.graphicsFormat.ToString(),textureFormat=t.format.ToString(),activeBuildTarget=EditorUserBuildSettings.activeBuildTarget.ToString(),graphicsDevice=SystemInfo.graphicsDeviceType.ToString(),sampler=new{filterMode=t.filterMode.ToString(),wrapU=t.wrapModeU.ToString(),wrapV=t.wrapModeV.ToString(),wrapW=t.wrapModeW.ToString(),anisoLevel=t.anisoLevel,mipMapBias=t.mipMapBias},srgb=true,mips});
 }}finally{RenderTexture.active=previous;GL.sRGBWrite=previousWrite;Object.DestroyImmediate(material);}
 System.IO.File.WriteAllText(output+".tmp",JsonConvert.SerializeObject(new{schemaVersion=1,requestId,textures}));if(System.IO.File.Exists(output))System.IO.File.Replace(output+".tmp",output,null);else System.IO.File.Move(output+".tmp",output);return "Captured "+textures.Count+" imported texture mip chains";
}}
