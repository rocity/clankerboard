# Self-hosting

Notes for operators running Agent Kanban behind their own infrastructure. The app is one container plus Postgres (`docker-compose.yml` lists every setting).

## Reverse proxies and the live stream

Open boards update through a long-lived Server-Sent Events response at `GET /api/stream`. A proxy that buffers responses holds those events back, so boards stop updating until the buffer fills or the connection closes.

- **Turn off response buffering for `/api/stream`.** The app sends `X-Accel-Buffering: no` on that route, which nginx honours on its own. Other proxies need buffering turned off for the route in their own config.
- **Allow idle reads of at least 30 seconds.** The stream sends a keepalive comment every 20 seconds. A proxy read timeout shorter than that drops idle streams, and browsers reconnect every few seconds.
- **Don't cache or compress the route.** The app sends `Cache-Control: no-cache`. Compression can buffer too.

For nginx, in the `server` block in front of the app:

```nginx
location /api/stream {
    proxy_pass http://agentkanban:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

### Reconnects and `STREAM_BACKLOG_LIMIT`

A browser that loses the stream reconnects with the id of the last event it saw, and the app replays the Activity it missed. `STREAM_BACKLOG_LIMIT` (default 500) caps that replay: a client that missed more gets a single `resync` event and reloads its data instead. Raise it if long disconnects are common and reloads are slow; `0` makes every reconnect with a gap resync.

The live stream runs in the app process. With more than one replica, a change made on one replica reaches only the streams open on that replica, so run a single replica for now.

## Upgrading to the Agent Kanban names

This release renames every identifier from the old codename to `agentkanban` ([ADR 0009](adr/0009-product-is-agent-kanban-everywhere.md) lists the old names). There is no compatibility path, so an existing deployment takes these steps once.

1. **Update the database credentials.** The Compose project, database name, user, and password are now all `agentkanban`. The new project name also means a new data volume, so the upgraded deployment starts empty unless you move the data. Dump it from the running deployment, then restore it into the new one before the app starts:

   ```sh
   # In the old checkout, with the old deployment running
   docker compose exec -T db pg_dump --no-owner --no-privileges -U <old user> <old database> > backup.sql
   docker compose down
   # In the new checkout
   docker compose up -d --wait db
   docker compose exec -T db psql -U agentkanban -d agentkanban < backup.sql
   docker compose up -d
   ```

   The old volume is left in place. Remove it once the new deployment checks out. If `DATABASE_URL` points at your own Postgres, the database needs no change.
2. **Re-register the MCP server.** Every User with an Agent removes the old server from Claude Code (`claude mcp list` shows it, `claude mcp remove <name>` removes it) and runs the setup command from the Agents page again. It registers the server as `agentkanban`.
3. **Rename the environment variable.** Committed `.mcp.json` files and shell setups use `AGENTKANBAN_API_KEY`. Replace the server entry with the `.mcp.json` snippet from the Agents page and export the key under the new name.

Each browser's saved theme and last Company reset once. Nothing needs doing for that.
