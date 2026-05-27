# Edge caching for `/api/eo` (global efficiency)

The origin already shares work across nearby users via the per-cell in-memory cache, and
coarse `/api/eo` responses now send CDN-friendly headers:

```
Cache-Control: public, max-age=120, s-maxage=300, stale-while-revalidate=600
```

`s-maxage=300` tells a shared cache (Cloudflare) to serve the response for 5 minutes and
`stale-while-revalidate` to refresh in the background, so a user anywhere in the world
gets an instant cached answer and the origin (Cloud Run) only recomputes on a true miss,
cutting global latency and origin wake-ups while preserving scale-to-zero. Precise
("sharpen") requests send `no-store` and are never cached.

## The one manual step (Cloudflare; Claude cannot configure this)

By default Cloudflare does not cache `GET` JSON responses even with `s-maxage`. Add a
**Cache Rule** in the Cloudflare dashboard (Rules -> Cache Rules) for the zone `dmj.one`:

- **When incoming requests match:** `Hostname equals localpulse.dmj.one` AND
  `URI Path equals /api/eo`
- **Then:** Cache eligibility = **Eligible for cache**; Edge TTL = **Use cache-control
  header if present** (or 300s); Browser TTL = Respect origin.
- **Cache key:** include the query string. For the coarse (no-lat/lng) path that relies on
  the Cloudflare IP-geolocation headers, add the headers `cf-ipcountry` (and optionally a
  coarsened `cf-iplatitude`/`cf-iplongitude`) to the **custom cache key** so users in the
  same area share a cached entry without leaking one user's precise location to another.

Leave `/api/eo/certificate`, `/api/eo/verify`, `/api/eo/world`, and `/api/eo/route`
uncached (they are `no-store` / per-request).

This is the only piece that must be done in the Cloudflare dashboard; everything else
(headers, per-cell origin cache) is already in the code.
