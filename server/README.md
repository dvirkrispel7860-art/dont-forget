# server/ — the route search

One file: [`routes-proxy.js`](routes-proxy.js). It runs the public-transport route
search that the app cannot afford to run on a phone.

## Why it exists

The data source (open-bus Stride, the Ministry of Transport GTFS feed) has no
journey planner, so a route with a change has to be assembled from `stop_times`
by hand. Measured against the live API:

| | on the phone |
|---|---|
| the day's stop index | ~4 MB |
| one change | ~10 MB, and the bulk queries truncate at 5,000 rows |
| two changes | ~25–35 MB |
| one row of `stop_times` | 937 bytes |

Fourteen megabytes for one "how do I get there" is not something to do to
somebody's mobile data. The same search here returns **about 9 KB**.

Measured end to end, Tel Aviv, an 08:00–10:00 window: 8 journeys — one direct and
seven with a change — in **8,660 bytes**. Cold start 7.5 s (it builds the stop
index), warm 5.7 s.

## What it is not

**Not a key holder.** Stride needs no API key, which is why this exists purely
for bandwidth. There is no credential in this file and none is needed.

Nothing is stored and nothing is logged. A request carries two coordinates and a
time; none of it outlives the response.

## Deploy

```bash
# Cloudflare Workers — free tier is enough
npx wrangler deploy server/routes-proxy.js
```

Deno Deploy takes the file as-is. For Node 18+ there is an adapter snippet at the
bottom of the file.

Then point the app at it:

```
EXPO_PUBLIC_TRANSIT_ROUTES_ENDPOINT=https://your-worker.workers.dev
```

That variable is a **URL, not a secret** — which is why it can be public. Until it
is set the app never calls this and keeps doing its own on-device, direct-only
search. Nothing breaks by not deploying it.

## The contract

```
POST /
{
  "from":        { "lat": 32.0714, "lon": 34.7789 },
  "to":          { "lat": 32.0733, "lon": 34.7648 },   // or { "stopCode": 12974 }
  "departAfter": "2026-08-20T08:00:00Z",               // optional, defaults to now
  "arriveBy":    "2026-08-20T10:00:00Z",               // optional
  "maxTransfers": 1                                    // 0 or 1
}
```

```
200
{
  "journeys": [
    {
      "legs": [
        { "id", "lineNumber", "agency", "headsign", "lineRef", "operatorRef",
          "departure", "arrival",
          "from": { "code", "name", "city", "lat", "lon" },
          "to":   { "code", "name", "city", "lat", "lon" } }
      ],
      "originMetres": 93,          // walk from the user to the first stop
      "destinationMetres": 0,      // walk from the last stop to the destination
      "changeWalkMetres": 0        // only on a journey with a change
    }
  ],
  "scheduleDate": "2026-08-20",
  "transfersSearched": 1,
  "source": "stride-gtfs-il"
}
```

Journeys come back roughly ordered and **unscored**. Ranking belongs to the app
(`src/transit/routePlanner.ts`) so that a one-leg journey found on the device and
a two-leg journey found here are compared by the same function.

## How the search works

Direct journeys are one lookup per candidate stop. Journeys with a change use a
bidirectional search, which keeps the request count constant instead of exploding:

```
forward    rides leaving the origin       →  every stop those rides reach
backward   rides arriving at the target   →  every stop those rides came from
change     the intersection, where the timing actually works
```

A change is only offered when it can physically be made: off the first bus, walk
to the second stop, and still be there before it leaves — with a 3-minute buffer
on top of the walk, and never across more than 400 m.

## Limits, honestly

- **Two changes are not implemented.** The second level alone measured 10,370 rows
  (~9.3 MB server-side), and the journeys it would add are rarely the ones anyone
  wants. `maxTransfers` accepts 0 or 1.
- **Coverage is patchy.** `stop_times` ingestion lags for some stops, so a real
  pair of stops can legitimately return zero journeys. That is reported as zero,
  never filled in with a guess.
- **No predicted times.** The feed publishes vehicle positions, not ETAs — there
  is no `predicted`/`expected`/`delay` field anywhere in its schema. Every time
  here is the timetable's, and the app labels it as such.
