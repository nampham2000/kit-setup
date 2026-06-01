# VS Code MCP Autostart

This local VS Code helper starts the three MCP entries configured in `.vscode/mcp.json` whenever the `cocos_game` folder is opened:

- `blender-mcp`
- `gimp-mcp`
- `cocos-mcp`

`blender-mcp` and `gimp-mcp` start after workspace activation. `cocos-mcp` starts after `localhost:3000` is available, because that endpoint is served by the Cocos Creator extension.

After activation, the helper keeps watching `localhost:3000`. If Cocos Creator is restarted and the MCP endpoint disappears then comes back, the helper starts the workspace `cocos-mcp` server again.

Install or refresh the helper by running:

```bat
0_setup-all.bat
```

The first start of a workspace MCP configuration can still show VS Code's trust confirmation. Approve the three workspace servers once; subsequent workspace openings are started by the installed helper.

Implementation note: VS Code's official `chat.mcp.autostart` setting restarts servers whose configuration is new or outdated. This helper also handles already-known servers that otherwise stay in the `Stopped` state after reopening the workspace.
