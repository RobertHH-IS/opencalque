# OpenCalque Codex MCP

This package exposes the OpenCalque headless core as a local stdio MCP server.
It is intentionally workspace-scoped and does not call an external model.

The server keeps the `.opencalque` document as the source of truth and writes a
sidecar `<document>.codex.json` containing source context, calibration metadata,
revision history, snapshots and coordinate-level diffs.

Run the source directly so the MCP stdout stream contains JSON-RPC messages
only:

```sh
OPENCALQUE_WORKSPACE=/path/to/workspace \
  node_modules/.bin/tsx packages/mcp/src/server.ts
```

Tools include opening a document, describing semantic nodes and coordinates,
applying validated operation batches, validating, rendering SVG/PNG previews,
rendering source overlays, exporting DXF, reading the source image, inspecting
history/diffs and undoing the last batch.
