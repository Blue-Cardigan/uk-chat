# Remote Hetzner `xtk-mcp` Setup (Cursor + Claude)

## Required values

Replace `<YOUR_TOKEN>` with your actual token value

## Cursor

Use either project-level `.cursor/mcp.json` or global `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "xtk-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.explorethekingdom.co.uk/sse"],
      "env": {
        "MCP_TOKEN": "<YOUR_TOKEN>"
      }
    }
  }
}
```

## Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "xtk-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.explorethekingdom.co.uk/sse"],
      "env": {
        "MCP_TOKEN": "<YOUR_TOKEN>"
      }
    }
  }
}
```

## Verify

1. Save the config.
2. Restart Cursor/Claude Desktop.
3. Check MCP tools list for `xtk-mcp` connected.

