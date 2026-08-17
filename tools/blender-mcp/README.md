# Blender MCP Architecture & Maintenance Guide

## 1. Overview & Architecture

Blender MCP operates via a two-tier bridge architecture:

```
+---------------------------+        Stdio (JSON-RPC)       +------------------------------------+
|  AI Agent / Antigravity   | <===========================> |    blender-mcp-server.cjs          |
|  (Gemini / Claude / Cursor)|                               |    (Node.js MCP Server Proxy)      |
+---------------------------+                               +------------------------------------+
                                                                              ||
                                                                              || TCP Socket (Port 9876)
                                                                              \/
                                                            +------------------------------------+
                                                            |       Blender 5.x Instance         |
                                                            |  - bl_ext.user_default.mcp (Addon) |
                                                            |  - or blender_server_addon.py      |
                                                            +------------------------------------+
```

---

## 2. Source Code & File Locations

### A. Client Proxy (MCP Server)
- **Source Code**: [`playable-shared-kit/tools/blender-mcp/blender-mcp-server.cjs`](file:///d:/_Projects/CC3/@puzzle/SmashFest-CocosPlayable/playable-shared-kit/tools/blender-mcp/blender-mcp-server.cjs)
- **Configuration**: [`C:\Users\admin\.gemini\config\mcp_config.json`](file:///C:/Users/admin/.gemini/config/mcp_config.json)
- **MCP Schemas**: `C:\Users\admin\.gemini\antigravity\mcp\blender-mcp\`

### B. Blender Server (Add-on)
1. **Official Blender Lab Extension** (Installed in Blender 5.1/5.2):
   - **Disk Path**: `C:\Users\admin\AppData\Roaming\Blender Foundation\Blender\5.1\extensions\user_default\mcp\`
   - **Official Git Repo**: [projects.blender.org/lab/blender_mcp](https://projects.blender.org/lab/blender_mcp)
   - **Official Documentation**: [blender.org/lab/mcp-server](https://www.blender.org/lab/mcp-server/)
   - **Current Version**: `v1.0.0` (Latest release from Blender Lab)
2. **Framework Standalone Fallback**:
   - **File**: [`playable-shared-kit/tools/blender-mcp/blender_server_addon.py`](file:///d:/_Projects/CC3/@puzzle/SmashFest-CocosPlayable/playable-shared-kit/tools/blender-mcp/blender_server_addon.py)

---

## 3. How to Update to the Latest Version

### Updating the Official Blender Extension:
1. Open Blender 5.x.
2. Go to **Edit → Preferences → Get Extensions**.
3. Search for **MCP** or install the latest `.zip` package from:
   `https://projects.blender.org/lab/blender_mcp/releases`
4. Enable the add-on and ensure the server is started on `127.0.0.1:9876`.

### Updating the Node.js MCP Proxy:
If new tools or parameters are added:
1. Update [`blender-mcp-server.cjs`](file:///d:/_Projects/CC3/@puzzle/SmashFest-CocosPlayable/playable-shared-kit/tools/blender-mcp/blender-mcp-server.cjs) with new tool definitions in `TOOLS` array.
2. Update schema JSONs in `C:\Users\admin\.gemini\antigravity\mcp\blender-mcp\`.

---

## 4. Verification & Health Check

Run the following inside Blender or via the MCP tool:
- `blender_ping`: Verifies TCP connectivity to Blender backend.
- `blender_get_scene_info`: Retrieves active objects, polygon counts, and materials.
- `blender_execute_script`: Executes arbitrary Python code via `bpy`.
