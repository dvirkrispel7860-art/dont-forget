/*
 * Tests for the AI provider layer — the real compiled modules from src/ai,
 * not a reimplementation.
 *
 * The remote provider reads its endpoint at module load, so several tests set the
 * environment and reload the module to exercise configured / unconfigured /
 * failing states.
 */
const path = require('path');

const DIR = __dirname;
const FILES = [
  'ai/index.js',
  'ai/localProvider.js',
  'ai/remoteProvider.js',
  'ai/requestContext.js',
  'ai/itemsFromText.js',
  'ai/types.js',
  'aiAnalysis.js',
];

/** Loads src/ai fresh, with the given endpoint configuration. */
function load({ endpoint } = {}) {
  if (endpoint) process.env.EXPO_PUBLIC_AI_ENDPOINT = endpoint;
  else delete process.env.EXPO_PUBLIC_AI_ENDPOINT;
  for (const f of FILES) delete require.cache[require.resolve(path.join(DIR, f))];
  return require(path.join(DIR, 'ai/index.js'));
}

const NOW = new Date('2026-08-20T09:00:00').getTime();

const destination = (id, name, icon, items = [], extra = {}) => ({
  id,
  name,
  icon,
  favorite: false,
  items: items.map((n, i) => ({ id: `${id}-${i}`, name: n, checked: false, active: true })),
  createdAt: 1,
  ...extra,
});

const trip = (destinationId, name, icon, items) => ({
  id: `t-${Math.abs(hash(destinationId + items.join()))}`,
  destinationId,
  destinationName: name,
  icon,
  at: NOW - 86400000,
  items: items.map((n) => ({ itemId: n, name: n, taken: true, skipped: false })),
});
function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}
const names = (items) => items.map((i) => i.name);

async function main() {
  const AI = load();

  /* ============================================= 1 · an existing destination */
  {
    const destinations = [destination('d1', 'בית ספר אשקלון', '🏫', ['תיק'])];
    const r = await AI.analyze(
      AI.buildAIRequest('אני יוצא מחר לבית ספר', { destinations, now: NOW }),
    );
    check('1 · understood', r.understood, true);
    check('1b · intent', r.intent, 'prepare_departure');
    check('1c · matched the destination that exists', r.destination, {
      kind: 'existing',
      id: 'd1',
      name: 'בית ספר אשקלון',
      icon: '🏫',
    });
    check('1d · no proposal to create one', r.actions.some((a) => a.type === 'suggest_destination'), false);
    // "מחר" with no hour names a day but not a time, and the existing parser
    // refuses to invent one — so there is deliberately no timestamp here.
    check('1e · a bare "מחר" invents no hour', r.when, null);
    check('1f0 · and it is reported as unknown', r.unknown.includes('when'), true);
    check('1f · answered on the device', r.meta.provider, 'local-keywords');
    check('1g · and did not fall back, because nothing else was configured', r.meta.fellBack, false);
  }

  /* ================================================== 2 · a new destination */
  {
    const r = await AI.analyze(
      AI.buildAIRequest('אני הולך לחדר כושר', { destinations: [], now: NOW }),
    );
    check('2 · understood', r.understood, true);
    check('2b · proposes a new destination rather than inventing one', r.destination, {
      kind: 'new',
      name: 'חדר כושר',
      icon: '🏋️',
    });
    const action = r.actions.find((a) => a.type === 'suggest_destination');
    check('2c · as an action for the user to confirm', action?.destination.name, 'חדר כושר');
    check('2d · nothing was created — the result is a proposal only', typeof action, 'object');
  }

  /* ==================================================== 3 · several items */
  {
    const r = await AI.analyze(
      AI.buildAIRequest(
        'אני יוצא מחר לבית ספר ואסור לי לשכוח מחשבון, מחברת ובקבוק מים',
        { destinations: [destination('d1', 'בית ספר', '🏫')], now: NOW },
      ),
    );
    check('3 · the three named things, in order', names(r.newItems), ['מחשבון', 'מחברת', 'בקבוק מים']);
    check('3b · all sourced to the sentence', r.newItems.every((i) => i.source === 'text'), true);
    check('3c · and offered as an action', r.actions.some((a) => a.type === 'suggest_items'), true);
  }

  /* =========================================== 4 · destination *and* items */
  {
    const destinations = [destination('g', 'סבתא', '👵')];
    const r = await AI.analyze(
      AI.buildAIRequest('אני הולך לסבתא וצריך לקחת את התרופות והמטען', {
        destinations,
        now: NOW,
      }),
    );
    check('4 · destination found', r.destination?.kind, 'existing');
    check('4b · and it is the existing one', r.destination?.name, 'סבתא');
    check('4c · items read off the sentence', names(r.newItems), ['תרופות', 'מטען']);
    check('4d · explanation shows both', r.explanation.includes('סבתא') && r.explanation.includes('תרופות'), true);
  }

  /* ---- 4e · an item already on the list is not offered again */
  {
    const destinations = [destination('g', 'סבתא', '👵', ['תרופות'])];
    const r = await AI.analyze(
      AI.buildAIRequest('הולך לסבתא וצריך לקחת את התרופות והמטען', {
        destinations,
        focusedDestinationId: 'g',
        now: NOW,
      }),
    );
    check('4e · the one already on the list is separated out', names(r.existingItems), ['תרופות']);
    check('4f · only the genuinely new one is offered', names(r.newItems), ['מטען']);
  }

  /* ================================================= 5 · transport mode */
  {
    const destinations = [destination('d1', 'בית ספר', '🏫', [], { travelMode: 'car' })];
    const r = await AI.analyze(
      AI.buildAIRequest('אני נוסע לבית ספר באוטובוס', { destinations, now: NOW }),
    );
    check('5 · the mode the user named', r.transportMode, 'bus');
    const update = r.actions.find((a) => a.type === 'update_destination');
    check('5b · offered as a change to confirm, not applied', update?.changes, { travelMode: 'bus' });
    check('5c · for the right destination', update?.destinationId, 'd1');

    const silent = await AI.analyze(
      AI.buildAIRequest('אני נוסע לבית ספר', { destinations, now: NOW }),
    );
    check('5d · a sentence that names no mode gets none', silent.transportMode, null);
    check('5e · and says so', silent.unknown.includes('transportMode'), true);
    check('5f · no change is proposed', silent.actions.some((a) => a.type === 'update_destination'), false);
  }

  /* ========================================================== 6 · the date */
  {
    const destinations = [destination('d1', 'בית ספר', '🏫')];
    const r = await AI.analyze(
      AI.buildAIRequest('מחר בבוקר אני יוצא לבית ספר', { destinations, now: NOW }),
    );
    check('6 · a time was read', r.when !== null, true);
    check('6b · it is tomorrow', new Date(r.when.at).getDate(), new Date(NOW + 86400000).getDate());
    check('6c · with the reading shown to the user', typeof r.when.phrase, 'string');

    const none = await AI.analyze(AI.buildAIRequest('אני יוצא לבית ספר', { destinations, now: NOW }));
    check('6d · no time in the sentence → none invented', none.when, null);
    check('6e · and it is listed as unknown', none.unknown.includes('when'), true);
  }

  /* ======================================================= 7 · the history */
  {
    const destinations = [destination('d1', 'אימון', '⚽')];
    const trips = [
      trip('d1', 'אימון', '⚽', ['מגן שוקיים', 'בקבוק מים']),
      trip('d1', 'אימון', '⚽', ['מגן שוקיים', 'בקבוק מים']),
      trip('d1', 'אימון', '⚽', ['מגן שוקיים']),
    ];
    const r = await AI.analyze(
      AI.buildAIRequest('אני יוצא שוב לאימון', {
        destinations,
        trips,
        focusedDestinationId: 'd1',
        now: NOW,
      }),
    );
    const fromHistory = r.suggestedItems.filter((i) => i.source === 'history');
    check('7 · history produced suggestions', fromHistory.length > 0, true);
    check('7b · naming something actually recorded', fromHistory.some((i) => i.name === 'מגן שוקיים'), true);
    check('7c · with the real counts as the reason', /\d+ מתוך \d+|יציאה אחת מתוך/.test(fromHistory[0].reason), true);
    check('7d · nothing unsourced', r.suggestedItems.every((i) => ['history', 'weather', 'activity'].includes(i.source)), true);
  }

  /* ======================================================= 8 · the weather */
  {
    const destinations = [destination('d1', 'ים', '🏖️')];
    const weather = {
      reading: {
        at: NOW,
        temperature: 31,
        apparentTemperature: 34,
        code: 0,
        windSpeed: 10,
        precipitationProbability: 0,
      },
      locationLabel: 'תל אביב-יפו',
    };
    const r = await AI.analyze(
      AI.buildAIRequest('אני יוצא לים מחר', { destinations, weather, now: NOW }),
    );
    const fromWeather = r.suggestedItems.filter((i) => i.source === 'weather');
    check('8 · the forecast justified a suggestion', names(fromWeather), ['בקבוק מים']);
    check('8b · with the real number in the reason', fromWeather[0].reason.includes('34'), true);
    check('8c · and weather is not listed as unknown', r.unknown.includes('weather'), false);

    const rain = await AI.analyze(
      AI.buildAIRequest('אני יוצא לים מחר', {
        destinations,
        weather: { ...weather, reading: { ...weather.reading, temperature: 18, apparentTemperature: 18, precipitationProbability: 80 } },
        now: NOW,
      }),
    );
    check('8d · rain justifies an umbrella', names(rain.suggestedItems.filter((i) => i.source === 'weather')), ['מטרייה']);
    check('8e · quoting the chance the app was given', rain.suggestedItems[0].reason.includes('80%'), true);
  }

  /* =============================================== 9 · text nobody can read */
  {
    const r = await AI.analyze(
      AI.buildAIRequest('אסdkfj כלרלכ 123', { destinations: [], now: NOW }),
    );
    check('9 · not understood', r.understood, false);
    check('9b · intent unknown', r.intent, 'unknown');
    check('9c · nothing invented', [r.destination, r.transportMode, r.when], [null, null, null]);
    check('9d · no items', [r.newItems.length, r.suggestedItems.length], [0, 0]);
    check('9e · it asks instead of guessing', r.actions[0].type, 'ask_clarification');
    check('9f · with a question', typeof r.actions[0].question, 'string');
    check('9g · confidence zero', r.confidence, 0);
  }

  /* ================================================= 10 · low confidence */
  {
    // "מורה" alone is weight 1 — a hint, not a statement.
    const r = await AI.analyze(AI.buildAIRequest('מורה', { destinations: [], now: NOW }));
    check('10 · a weak signal is not treated as understood', r.understood, false);
    check('10b · below the threshold', r.confidence < AI.MIN_CONFIDENCE, true);
    check('10c · and it asks', r.actions[0].type, 'ask_clarification');

    // Two strong words are enough.
    const strong = await AI.analyze(
      AI.buildAIRequest('אני הולך לחדר כושר', { destinations: [], now: NOW }),
    );
    check('10d · a clear sentence clears the threshold', strong.confidence >= AI.MIN_CONFIDENCE, true);
    check('10e · confidence is normalised 0…1', strong.confidence <= 1, true);
  }

  /* ================================ 11 · remote not configured → local */
  {
    const Unconfigured = load();
    check('11 · the remote provider reports itself unconfigured', Unconfigured.isRemoteConfigured(), false);
    check('11b · so the active provider is the local one', Unconfigured.activeProvider().id, 'local-keywords');

    // Nothing may leave the device when nothing is configured.
    let calls = 0;
    const realFetch = global.fetch;
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({}) };
    };
    const r = await Unconfigured.analyze(
      Unconfigured.buildAIRequest('אני הולך לים', { destinations: [], now: NOW }),
    );
    global.fetch = realFetch;
    check('11c · the sentence was never sent anywhere', calls, 0);
    check('11d · and a real local answer came back', r.understood, true);
    check('11e · not marked as a fallback, because this is normal', r.meta.fellBack, false);
    check('11f · asking it directly throws rather than sending', await Unconfigured.remoteProvider
      .analyze(Unconfigured.buildAIRequest('x', { destinations: [], now: NOW }))
      .then(() => 'resolved')
      .catch((e) => e.name), 'AINotConfiguredError');
  }

  /* ==================================== 12 · remote fails → falls back */
  {
    const Configured = load({ endpoint: 'https://example.invalid/analyze' });
    check('12 · configured', Configured.isRemoteConfigured(), true);

    const realFetch = global.fetch;
    for (const [label, impl, reason] of [
      ['a 500', async () => ({ ok: false, status: 500 }), 'bad-response'],
      ['unusable JSON', async () => ({ ok: true, json: async () => ({ nonsense: true }) }), 'bad-response'],
      ['broken JSON', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }), 'failed'],
    ]) {
      global.fetch = impl;
      const r = await Configured.analyze(
        Configured.buildAIRequest('אני הולך לחדר כושר', { destinations: [], now: NOW }),
      );
      check(`12 · ${label} → local answer`, r.understood, true);
      check(`12b · ${label} → marked as a fallback`, r.meta.fellBack, true);
      check(`12c · ${label} → reason ${reason}`, r.meta.fallbackReason, reason);
      check(`12d · ${label} → the answer is the device's`, r.meta.provider, 'local-keywords');
    }
    global.fetch = realFetch;
  }

  /* ============================================== 13 · no internet at all */
  {
    const Configured = load({ endpoint: 'https://example.invalid/analyze' });
    const realFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('Network request failed');
    };
    const r = await Configured.analyze(
      Configured.buildAIRequest('אני יוצא לים מחר', { destinations: [], now: NOW }),
    );
    global.fetch = realFetch;
    check('13 · offline → a real answer, not an error', r.understood, true);
    check('13b · reason recorded as offline', r.meta.fallbackReason, 'offline');
    check('13c · and the user-facing explanation is normal', r.explanation.length > 0, true);

    // An abort is a timeout, not an error to show.
    global.fetch = async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const timedOut = await Configured.analyze(
      Configured.buildAIRequest('אני הולך לחדר כושר', { destinations: [], now: NOW }),
    );
    global.fetch = realFetch;
    check('13d · a timeout falls back too', timedOut.meta.fallbackReason, 'timeout');
  }

  /* ================================================= 14 · no destinations */
  {
    const r = await AI.analyze(
      AI.buildAIRequest('אני הולך לים וצריך לקחת מגבת', { destinations: [], now: NOW }),
    );
    check('14 · still works with an empty app', r.understood, true);
    check('14b · and proposes creating the destination', r.destination?.kind, 'new');
    check('14c · with the item the user named', names(r.newItems), ['מגבת']);
  }

  /* ==================================================== 15 · no history */
  {
    const destinations = [destination('d1', 'אימון', '⚽')];
    const r = await AI.analyze(
      AI.buildAIRequest('אני יוצא שוב לאימון', { destinations, trips: [], focusedDestinationId: 'd1', now: NOW }),
    );
    check('15 · no history → nothing from history', r.suggestedItems.filter((i) => i.source === 'history').length, 0);
    check('15b · and it is listed as unknown', r.unknown.includes('history'), true);
    check('15c · the answer still stands on the activity list', r.suggestedItems.length > 0, true);
    check('15d · all of it sourced to the activity', r.suggestedItems.every((i) => i.source === 'activity'), true);
  }

  /* ==================================================== 16 · no weather */
  {
    const destinations = [destination('d1', 'ים', '🏖️')];
    const r = await AI.analyze(AI.buildAIRequest('אני יוצא לים', { destinations, now: NOW }));
    check('16 · no forecast → nothing from weather', r.suggestedItems.filter((i) => i.source === 'weather').length, 0);
    check('16b · listed as unknown', r.unknown.includes('weather'), true);
    check('16c · and no forecast is stated', /°|גשם|סיכוי/.test(r.explanation), false);
  }

  /* ================================ extra · what the request does NOT carry */
  {
    const destinations = [
      destination('d1', 'עבודה', '💼', ['לפטופ'], {
        address: 'רוטשילד 22, תל אביב',
        coords: { latitude: 32.08, longitude: 34.78 },
        reminder: { enabled: true, time: '07:00', days: [0] },
      }),
    ];
    const request = AI.buildAIRequest('אני נוסע לעבודה', {
      destinations,
      trips: [trip('d1', 'עבודה', '💼', ['לפטופ'])],
      focusedDestinationId: 'd1',
      now: NOW,
    });
    const serialised = JSON.stringify(request);
    check('extra · no address in the request', serialised.includes('רוטשילד'), false);
    check('extra b · no coordinates', /latitude|longitude/.test(serialised), false);
    check('extra c · no reminder settings', serialised.includes('reminder'), false);
    check('extra d · destination names are there, because matching needs them', serialised.includes('עבודה'), true);

    const payload = JSON.stringify(AI.buildPayload(request));
    check('extra e · the outbound payload has no address either', payload.includes('רוטשילד'), false);
    check('extra f · and no coordinates', /latitude|longitude/.test(payload), false);
    check('extra g · nor an emoji-only weather field when there is no weather', payload.includes('weather'), false);
  }

  /* ================================ extra · the response is never trusted blindly */
  {
    const Configured = load({ endpoint: 'https://example.invalid/analyze' });
    const request = Configured.buildAIRequest('אני הולך לים', {
      destinations: [destination('real', 'ים', '🏖️')],
      now: NOW,
    });

    // A destination id the app never sent must be rejected.
    const fake = Configured.parseResponse(
      {
        understood: true,
        confidence: 0.9,
        destination: { kind: 'existing', id: 'does-not-exist', name: 'מקום מומצא', icon: '❓' },
        newItems: [{ name: 'מגבת' }],
        actions: [],
      },
      request,
    );
    check('trust · an unknown destination id is dropped', fake.destination, null);
    check('trust b · but a verifiable item survives', names(fake.newItems), ['מגבת']);

    const real = Configured.parseResponse(
      {
        understood: true,
        confidence: 0.9,
        destination: { kind: 'existing', id: 'real', name: 'שם אחר לגמרי', icon: '❓' },
        newItems: [],
        suggestedItems: [{ name: 'מגבת', source: 'activity' }],
        actions: [{ type: 'no_action' }],
      },
      request,
    );
    check('trust c · a known id is accepted', real.destination.id, 'real');
    check('trust d · with the app\'s own name, not the response\'s', real.destination.name, 'ים');

    // Claiming understanding with nothing in it is not an answer.
    const empty = Configured.parseResponse(
      { understood: true, confidence: 1, newItems: [], actions: [] },
      request,
    );
    check('trust e · an empty claim of understanding is refused', empty, null);

    // A bare timestamp with no explanation is not acted on.
    const bareTime = Configured.parseResponse(
      {
        understood: true,
        confidence: 0.9,
        destination: { kind: 'new', name: 'ים', icon: '🏖️' },
        when: { at: NOW + 3600000 },
        actions: [],
      },
      request,
    );
    check('trust f · a time with no phrase is discarded', bareTime.when, null);

    // An invented travel mode is discarded.
    const badMode = Configured.parseResponse(
      {
        understood: true,
        confidence: 0.9,
        destination: { kind: 'new', name: 'ים', icon: '🏖️' },
        transportMode: 'teleport',
        actions: [],
      },
      request,
    );
    check('trust g · an unknown travel mode is discarded', badMode.transportMode, null);
  }

  /* ==================================== extra · the item parser on its own */
  {
    const { itemsFromText } = AI;
    check('items · no cue → nothing', itemsFromText('אני הולך לים'), []);
    check('items b · a cue → the list', itemsFromText('צריך לקחת מגבת וקרם הגנה'), ['מגבת', 'קרם הגנה']);
    check('items c · commas and vav together', itemsFromText('אסור לי לשכוח מחשבון, מחברת ובקבוק מים'), ['מחשבון', 'מחברת', 'בקבוק מים']);
    check('items d · stops at a reason clause', itemsFromText('צריך לקחת מטרייה כי יורד גשם'), ['מטרייה']);
    check('items e · stops at a time word', itemsFromText('צריך לקחת תיק מחר בבוקר'), ['תיק']);
    check('items f · empty text', itemsFromText(''), []);
    check('items g · duplicates collapse', itemsFromText('לקחת מים, מים ומים'), ['מים']);
  }

  /* ==================================== extra · the legacy shape still works */
  {
    const r = await AI.analyze(
      AI.buildAIRequest('אני הולך לים וצריך לקחת מגבת', { destinations: [], now: NOW }),
    );
    const legacy = AI.toLegacyAnalysis(r);
    check('legacy · understood', legacy.understood, true);
    check('legacy b · has the fields the screens read', [
      typeof legacy.activity.label,
      typeof legacy.destination.kind,
      Array.isArray(legacy.suggestions),
      typeof legacy.confidence,
    ], ['string', 'string', true, 'number']);
    check('legacy c · the user\'s own item comes first', legacy.suggestions[0].name, 'מגבת');

    const notUnderstood = AI.toLegacyAnalysis(
      await AI.analyze(AI.buildAIRequest('זזזז', { destinations: [], now: NOW })),
    );
    check('legacy d · not understood narrows correctly', notUnderstood, { understood: false, text: 'זזזז' });
  }

  /* ==================================== extra · analyzeUserText goes through it */
  {
    let sent = 0;
    const Configured = load({ endpoint: 'https://example.invalid/analyze' });
    const realFetch = global.fetch;
    global.fetch = async () => {
      sent++;
      throw new TypeError('Network request failed');
    };
    const legacy = await Configured.analyzeUserText('אני הולך לחדר כושר', {
      destinations: [],
      now: NOW,
    });
    global.fetch = realFetch;
    check('seam · analyzeUserText tried the configured provider', sent, 1);
    check('seam b · and still returned a usable answer', legacy.understood, true);
    check('seam c · in the old shape', legacy.destination.name, 'חדר כושר');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
