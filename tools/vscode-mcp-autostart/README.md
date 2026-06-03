# VS Code MCP Autostart

This local VS Code helper starts workspace MCP entries configured in `.vscode/mcp.json` whenever a workspace with that file is opened.

- All configured non-Cocos servers start right after workspace activation.
- `cocos-mcp` still waits for `localhost:3000`, because that endpoint is served by the Cocos Creator extension.

This means a workspace can add extra local tools such as `workMemory` in `.vscode/mcp.json` and the helper will start them without hardcoding new server ids in the extension.

After activation, the helper keeps watching `localhost:3000`. If Cocos Creator is restarted and the MCP endpoint disappears then comes back, the helper starts the workspace `cocos-mcp` server again.

Install or refresh the helper by running:

```bat
0_setup-all.bat
```

The first start of a workspace MCP configuration can still show VS Code's trust confirmation. Approve the workspace servers once; subsequent workspace openings are started by the installed helper.

Implementation note: VS Code's official `chat.mcp.autostart` setting restarts servers whose configuration is new or outdated. This helper also handles already-known servers that otherwise stay in the `Stopped` state after reopening the workspace.
