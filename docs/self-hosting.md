# Self-hosting

Notes for operators running Clankerboard behind their own infrastructure. The app is one container plus Postgres (`docker-compose.yml` lists every setting).

## Reverse proxies and the live stream

Open boards update through a long-lived Server-Sent Events response at `GET /api/stream`. A proxy that buffers responses holds those events back, so boards stop updating until the buffer fills or the connection closes.

- **Turn off response buffering for `/api/stream`.** The app sends `X-Accel-Buffering: no` on that route, which nginx honours on its own. Other proxies need buffering turned off for the route in their own config.
- **Allow idle reads of at least 30 seconds.** The stream sends a keepalive comment every 20 seconds. A proxy read timeout shorter than that drops idle streams, and browsers reconnect every few seconds.
- **Don't cache or compress the route.** The app sends `Cache-Control: no-cache`. Compression can buffer too.

For nginx, in the `server` block in front of the app:

```nginx
location /api/stream {
    proxy_pass http://clankerboard:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

### Reconnects and `STREAM_BACKLOG_LIMIT`

A browser that loses the stream reconnects with the id of the last event it saw, and the app replays the Activity it missed. `STREAM_BACKLOG_LIMIT` (default 500) caps that replay: a client that missed more gets a single `resync` event and reloads its data instead. Raise it if long disconnects are common and reloads are slow; `0` makes every reconnect with a gap resync.

The live stream runs in the app process. With more than one replica, a change made on one replica reaches only the streams open on that replica, so run a single replica for now.
