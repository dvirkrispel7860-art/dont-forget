/*
 * The route search, moved off the phone.
 *
 * WHY THIS EXISTS
 *
 * The app's data source (open-bus Stride, the Ministry of Transport GTFS feed)
 * has no journey planner. A search with a change has to be assembled from
 * stop_times by hand, and measuring that on the phone gave:
 *
 *   the stop index          ~4 MB
 *   one change              ~10 MB   (and the bulk queries truncate at 5,000 rows)
 *   two changes             ~25-35 MB
 *   a row of stop_times     937 bytes
 *
 * Fourteen megabytes for one "how do I get there" is not something to do to
 * somebody's mobile data. So the same search runs here instead, on a connection
 * where megabytes are free, and the phone receives a few kilobytes of journeys.
 *
 * WHAT IT IS NOT
 *
 * Not an API key holder — there is no key. Stride needs none, which is why this
 * proxy exists purely for bandwidth and not for secrets. Nothing is stored and
 * nothing is logged: a request carries two coordinates and a time, and none of
 * it outlives the response.
 *
 * HOW THE SEARCH WORKS
 *
 * Direct journeys are a single lookup per candidate stop. Journeys with one
 * change use a bidirectional search, which is what keeps the request count
 * constant rather than exploding:
 *
 *   forward   rides leaving the origin      -> every stop those rides reach
 *   backward  rides arriving at the target  -> every stop those rides came from
 *   change    the intersection, where the timing actually works
 *
 * DEPLOY
 *
 *   Cloudflare Workers :  npx wrangler deploy server/routes-proxy.js
 *   Deno Deploy        :  deploy this file as-is
 *   Node 18+           :  see the adapter note at the bottom
 *
 * Then set EXPO_PUBLIC_TRANSIT_ROUTES_ENDPOINT in the app to the deployed URL.
 * Until that is set the app never calls this and keeps doing its own on-device
 * direct-only search.
 */

const STRIDE = 'https://open-bus-stride-api.hasadna.org.il';

/* ---------------------------------------------------------------- tunables --- */

/** Stops around the user worth trying to board at. */
const ORIGIN_CANDIDATES = 5;
/** Stops around the destination worth aiming at. */
const DESTINATION_CANDIDATES = 3;
/** How far back from the target arrival to look for departures, in hours. */
const SEARCH_WINDOW_HOURS = 2;
/** Walking pace used for every walk. Same modest figure the app uses. */
const WALK_METRES_PER_MINUTE = 80;
/** Slack a change needs on top of the walk between the two stops. */
const MIN_CHANGE_BUFFER_MINUTES = 3;
/** A change is only offered between stops this close together. */
const MAX_CHANGE_WALK_METRES = 400;
/** The API refuses larger pages, and truncates silently at this size. */
const PAGE = 5000;
/** How many journeys to hand back. The app ranks and shows three. */
const MAX_JOURNEYS = 8;
/** Stop rows exist per schedule date; ingestion lags, so walk back if needed. */
const MAX_DATE_LOOKBACK_DAYS = 4;

/* ------------------------------------------------------------------ helpers --- */

function isoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Straight-line metres. The same maths the app uses, so numbers agree. */
function distanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const walkMinutes = (metres) => Math.max(1, Math.round(metres / WALK_METRES_PER_MINUTE));

async function api(path, params) {
  const url = new URL(STRIDE + path);
  for (const [key, value] of Object.entries({ get_count: 'false', ...params })) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    // The status only — a failing upstream can echo anything back.
    throw new Error(`stride ${path} responded ${response.status}`);
  }
  return response.json();
}

/**
 * Pages through a query the 5,000-row limit would otherwise truncate in silence.
 * Truncation is the difference between "no route" and "we did not look properly".
 */
async function apiAll(path, params, maxPages = 4) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await api(path, { ...params, limit: PAGE, offset: page * PAGE });
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/* --------------------------------------------------------------- stop index --- */

/*
 * The day's stop list, ~30k rows and about 4 MB. Held in module scope so the
 * isolate reuses it across requests — this is the single biggest reason the
 * search belongs on a server rather than in the app.
 */
let stopIndex = null;

async function latestScheduleDate() {
  const today = new Date();
  for (let back = 0; back <= MAX_DATE_LOOKBACK_DAYS; back += 1) {
    const probe = new Date(today);
    probe.setUTCDate(today.getUTCDate() - back);
    const date = isoDate(probe);
    const rows = await api('/gtfs_stops/list', { limit: 1, date_from: date, date_to: date });
    if (rows.length > 0) return date;
  }
  throw new Error('no schedule data available');
}

async function loadStops() {
  const date = await latestScheduleDate();
  if (stopIndex && stopIndex.date === date) return stopIndex;

  const stops = [];
  const seen = new Set();
  for (let offset = 0; offset < 60000; offset += PAGE) {
    const rows = await api('/gtfs_stops/list', {
      limit: PAGE,
      offset,
      date_from: date,
      date_to: date,
    });
    for (const row of rows) {
      if (typeof row.lat !== 'number' || typeof row.lon !== 'number') continue;
      if (seen.has(row.code)) continue;
      seen.add(row.code);
      stops.push({
        id: row.id,
        code: row.code,
        name: row.name ?? `תחנה ${row.code}`,
        city: row.city ?? '',
        lat: row.lat,
        lon: row.lon,
      });
    }
    if (rows.length < PAGE) break;
  }

  stopIndex = { date, stops };
  return stopIndex;
}

function nearestStops(stops, lat, lon, limit) {
  return stops
    .map((stop) => ({ ...stop, metres: Math.round(distanceMetres(lat, lon, stop.lat, stop.lon)) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ the legs --- */

/** One boarding, as the app expects it — the same fields its provider produces. */
function toLeg(board, alight, boardStop, alightStop) {
  return {
    id: `${board.gtfs_ride_id}:${board.stop_sequence}`,
    lineNumber: board.gtfs_route__route_short_name ?? '—',
    agency: board.gtfs_route__agency_name ?? '',
    headsign: board.gtfs_route__route_long_name ?? '',
    lineRef: board.gtfs_route__line_ref ?? undefined,
    operatorRef: board.gtfs_route__operator_ref ?? undefined,
    departure: board.departure_time || board.arrival_time,
    arrival: alight.arrival_time,
    from: {
      code: boardStop.code,
      name: boardStop.name,
      city: boardStop.city,
      lat: boardStop.lat,
      lon: boardStop.lon,
    },
    to: {
      code: alightStop.code,
      name: alightStop.name,
      city: alightStop.city,
      lat: alightStop.lat,
      lon: alightStop.lon,
    },
  };
}

/* ------------------------------------------------------------------ searching --- */

async function search({ from, to, arriveBy, departAfter, maxTransfers }) {
  const { stops } = await loadStops();
  const byId = new Map(stops.map((stop) => [stop.id, stop]));

  const origins = nearestStops(stops, from.lat, from.lon, ORIGIN_CANDIDATES);
  const targets =
    to.stopCode != null
      ? stops.filter((stop) => stop.code === to.stopCode).map((stop) => ({ ...stop, metres: 0 }))
      : nearestStops(stops, to.lat, to.lon, DESTINATION_CANDIDATES);

  if (origins.length === 0 || targets.length === 0) return { journeys: [] };

  const target = arriveBy ? new Date(arriveBy) : new Date(Date.now() + 60 * 60_000);
  const windowStart = new Date(Math.max(departAfter.getTime(), target.getTime() - SEARCH_WINDOW_HOURS * 3600_000));
  const windowEnd = target;
  if (windowEnd <= windowStart) return { journeys: [] };

  /* ---- rides leaving the origin candidates, and rides reaching the targets */
  const [originRows, targetRows] = await Promise.all([
    api('/gtfs_ride_stops/list', {
      limit: 500,
      gtfs_stop_ids: origins.map((s) => s.id).join(','),
      arrival_time_from: windowStart.toISOString(),
      arrival_time_to: windowEnd.toISOString(),
    }),
    api('/gtfs_ride_stops/list', {
      limit: 500,
      gtfs_stop_ids: targets.map((s) => s.id).join(','),
      arrival_time_from: windowStart.toISOString(),
      arrival_time_to: new Date(windowEnd.getTime() + 60 * 60_000).toISOString(),
    }),
  ]);

  // Only rides we can actually still catch.
  const boardings = originRows.filter(
    (row) => new Date(row.departure_time || row.arrival_time) >= departAfter,
  );
  if (boardings.length === 0 || targetRows.length === 0) return { journeys: [] };

  const boardingByRide = new Map();
  for (const row of boardings) {
    const existing = boardingByRide.get(row.gtfs_ride_id);
    if (!existing || row.stop_sequence < existing.stop_sequence) {
      boardingByRide.set(row.gtfs_ride_id, row);
    }
  }
  const arrivalByRide = new Map();
  for (const row of targetRows) {
    const existing = arrivalByRide.get(row.gtfs_ride_id);
    if (!existing || row.arrival_time < existing.arrival_time) {
      arrivalByRide.set(row.gtfs_ride_id, row);
    }
  }

  const journeys = [];

  /* ---- direct: a ride that leaves the origin and reaches a target itself */
  for (const [rideId, board] of boardingByRide) {
    const alight = arrivalByRide.get(rideId);
    if (!alight) continue;
    if (alight.stop_sequence <= board.stop_sequence) continue;
    const boardStop = byId.get(board.gtfs_stop_id);
    const alightStop = byId.get(alight.gtfs_stop_id);
    if (!boardStop || !alightStop) continue;

    const originMetres = origins.find((s) => s.id === boardStop.id)?.metres ?? null;
    const destinationMetres = targets.find((s) => s.id === alightStop.id)?.metres ?? null;
    journeys.push({
      legs: [toLeg(board, alight, boardStop, alightStop)],
      originMetres,
      destinationMetres,
    });
  }

  if (maxTransfers < 1) {
    return { journeys: trim(journeys), scheduleDate: stopIndex.date, transfersSearched: 0 };
  }

  /* ---- one change: the bidirectional intersection */
  const spanEnd = new Date(windowEnd.getTime() + 180 * 60_000);
  const [forwardRows, backwardRows] = await Promise.all([
    apiAll('/gtfs_ride_stops/list', {
      gtfs_ride_ids: [...boardingByRide.keys()].join(','),
      arrival_time_from: windowStart.toISOString(),
      arrival_time_to: spanEnd.toISOString(),
    }),
    apiAll('/gtfs_ride_stops/list', {
      gtfs_ride_ids: [...arrivalByRide.keys()].join(','),
      arrival_time_from: new Date(windowStart.getTime() - 180 * 60_000).toISOString(),
      arrival_time_to: spanEnd.toISOString(),
    }),
  ]);

  /** stop -> the earliest we could be standing there, and how */
  const reachable = new Map();
  for (const row of forwardRows) {
    const board = boardingByRide.get(row.gtfs_ride_id);
    if (!board || row.stop_sequence <= board.stop_sequence) continue;
    const at = new Date(row.arrival_time).getTime();
    const best = reachable.get(row.gtfs_stop_id);
    if (!best || at < best.at) reachable.set(row.gtfs_stop_id, { at, row, board });
  }

  /** stop -> rides leaving it that end up at a target */
  const feeders = new Map();
  for (const row of backwardRows) {
    const alight = arrivalByRide.get(row.gtfs_ride_id);
    if (!alight || row.stop_sequence >= alight.stop_sequence) continue;
    const list = feeders.get(row.gtfs_stop_id) || [];
    list.push({ leaves: new Date(row.departure_time || row.arrival_time).getTime(), row, alight });
    feeders.set(row.gtfs_stop_id, list);
  }

  for (const [stopId, arrive] of reachable) {
    // Getting off where we could have stayed on is not a change.
    if (arrivalByRide.has(arrive.row.gtfs_ride_id) && targets.some((t) => t.id === stopId)) continue;

    const firstAlightStop = byId.get(stopId);
    const boardStop = byId.get(arrive.board.gtfs_stop_id);
    if (!firstAlightStop || !boardStop) continue;

    for (const option of feeders.get(stopId) ?? []) {
      const secondBoardStop = byId.get(option.row.gtfs_stop_id);
      const finalStop = byId.get(option.alight.gtfs_stop_id);
      if (!secondBoardStop || !finalStop) continue;

      /*
       * A change between two different stops means walking. Beyond a few hundred
       * metres that is not a change any more, and the timing has to allow for it
       * — a connection nobody can catch is worse than no suggestion.
       */
      const changeMetres = Math.round(
        distanceMetres(firstAlightStop.lat, firstAlightStop.lon, secondBoardStop.lat, secondBoardStop.lon),
      );
      if (changeMetres > MAX_CHANGE_WALK_METRES) continue;
      const changeWalk = changeMetres <= 30 ? 0 : walkMinutes(changeMetres);
      const readyAt = arrive.at + (changeWalk + MIN_CHANGE_BUFFER_MINUTES) * 60_000;
      if (option.leaves < readyAt) continue;

      const originMetres = origins.find((s) => s.id === boardStop.id)?.metres ?? null;
      const destinationMetres = targets.find((s) => s.id === finalStop.id)?.metres ?? null;

      journeys.push({
        legs: [
          toLeg(arrive.board, arrive.row, boardStop, firstAlightStop),
          toLeg(option.row, option.alight, secondBoardStop, finalStop),
        ],
        originMetres,
        destinationMetres,
        changeWalkMetres: changeMetres,
      });
    }
  }

  return { journeys: trim(journeys), scheduleDate: stopIndex.date, transfersSearched: 1 };
}

/**
 * Keeps the few worth sending. A rough ordering only — the app scores properly,
 * so this just has to avoid throwing away the good ones.
 */
function trim(journeys) {
  const scored = journeys.map((journey) => {
    const first = journey.legs[0];
    const last = journey.legs[journey.legs.length - 1];
    const arrival = new Date(last.arrival).getTime() + (journey.destinationMetres != null ? walkMinutes(journey.destinationMetres) * 60_000 : 0);
    return { journey, arrival, transfers: journey.legs.length - 1 };
  });
  scored.sort((a, b) => a.arrival - b.arrival || a.transfers - b.transfers);

  const seen = new Set();
  const out = [];
  for (const entry of scored) {
    const shape = `${entry.journey.legs[0].from.code}|${entry.journey.legs.map((l) => l.lineNumber).join('>')}`;
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push(entry.journey);
    if (out.length >= MAX_JOURNEYS) break;
  }
  return out;
}

/* ------------------------------------------------------------------ the http --- */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

function coords(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ error: 'POST a journey request' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }

    const from = coords(body.from);
    if (!from) return json({ error: 'from must be { lat, lon }' }, 400);

    const to =
      Number.isInteger(body.to?.stopCode) ? { stopCode: body.to.stopCode } : coords(body.to);
    if (!to) return json({ error: 'to must be { lat, lon } or { stopCode }' }, 400);

    const departAfter = body.departAfter ? new Date(body.departAfter) : new Date();
    if (Number.isNaN(departAfter.getTime())) return json({ error: 'departAfter is not a time' }, 400);
    const arriveBy = body.arriveBy ? new Date(body.arriveBy) : null;
    if (arriveBy && Number.isNaN(arriveBy.getTime())) return json({ error: 'arriveBy is not a time' }, 400);

    const maxTransfers = body.maxTransfers === 0 ? 0 : 1;

    try {
      const result = await search({
        from,
        to,
        arriveBy: arriveBy ? arriveBy.toISOString() : null,
        departAfter,
        maxTransfers,
      });
      return json({ ...result, source: 'stride-gtfs-il' });
    } catch (error) {
      // The message only, never the upstream body.
      return json({ error: error instanceof Error ? error.message : 'search failed' }, 502);
    }
  },
};

/*
 * Running on Node 18+ instead of an edge runtime:
 *
 *   import handler from './routes-proxy.js';
 *   import { createServer } from 'node:http';
 *   createServer(async (req, res) => {
 *     const chunks = []; for await (const c of req) chunks.push(c);
 *     const request = new Request('http://localhost' + req.url, {
 *       method: req.method,
 *       headers: req.headers,
 *       body: chunks.length ? Buffer.concat(chunks) : undefined,
 *     });
 *     const response = await handler.fetch(request);
 *     res.writeHead(response.status, Object.fromEntries(response.headers));
 *     res.end(Buffer.from(await response.arrayBuffer()));
 *   }).listen(8787);
 */
