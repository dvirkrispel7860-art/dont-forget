import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  clearAllData,
  loadActiveExits,
  loadDestinations,
  loadSettings,
  loadTrips,
  saveActiveExits,
  saveDestinations,
  saveSettings,
  saveTrips,
} from './storage';
import { normalizeItemName } from './suggestions';
import {
  ActiveExits,
  defaultSettings,
  Destination,
  Item,
  Settings,
  SkipMap,
  Trip,
} from './types';

let seq = 0;
function newId(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

type State = { destinations: Destination[]; hydrated: boolean };

/** The editable fields of a destination — its items are managed separately. */
export type DestinationPatch = Partial<
  Pick<
    Destination,
    'name' | 'icon' | 'address' | 'favorite' | 'reminder' | 'travelMode' | 'transit'
  >
>;

type Action =
  | { type: 'hydrate'; destinations: Destination[] }
  | { type: 'addDestination'; destination: Destination }
  | { type: 'updateDestination'; id: string; patch: DestinationPatch }
  | { type: 'deleteDestination'; id: string }
  | { type: 'addItem'; destinationId: string; item: Item }
  | {
      type: 'addSuggestedItems';
      destinationId: string;
      entries: { name: string; newId: string }[];
    }
  | { type: 'toggleItem'; destinationId: string; itemId: string }
  | { type: 'removeItem'; destinationId: string; itemId: string }
  | { type: 'resetChecks'; destinationId: string };

function mapDestination(
  state: State,
  id: string,
  fn: (d: Destination) => Destination,
): State {
  return {
    ...state,
    destinations: state.destinations.map((d) => (d.id === id ? fn(d) : d)),
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return { destinations: action.destinations, hydrated: true };

    case 'addDestination':
      return { ...state, destinations: [...state.destinations, action.destination] };

    case 'updateDestination':
      return mapDestination(state, action.id, (d) => ({ ...d, ...action.patch }));

    case 'deleteDestination':
      return {
        ...state,
        destinations: state.destinations.filter((d) => d.id !== action.id),
      };

    case 'addItem':
      return mapDestination(state, action.destinationId, (d) => ({
        ...d,
        items: [...d.items, action.item],
      }));

    /**
     * Accepting suggestions must never produce two rows with the same name. If a
     * matching row already exists it is reactivated (this is the common case —
     * the item is suggested precisely because the user removed it); only a name
     * with no row at all gets appended.
     */
    case 'addSuggestedItems':
      return mapDestination(state, action.destinationId, (d) => {
        const items = [...d.items];

        for (const entry of action.entries) {
          const key = normalizeItemName(entry.name);
          if (!key) continue;

          const index = items.findIndex((i) => normalizeItemName(i.name) === key);
          if (index >= 0) {
            if (!items[index].active) {
              items[index] = { ...items[index], active: true, checked: false };
            }
            continue;
          }

          items.push({ id: entry.newId, name: entry.name, checked: false, active: true });
        }

        return { ...d, items };
      });

    case 'toggleItem':
      return mapDestination(state, action.destinationId, (d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === action.itemId ? { ...i, checked: !i.checked } : i,
        ),
      }));

    // "הסר מהיעד" / delete in the editor: keep the row, just deactivate it.
    case 'removeItem':
      return mapDestination(state, action.destinationId, (d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === action.itemId ? { ...i, active: false, checked: false } : i,
        ),
      }));

    case 'resetChecks':
      return mapDestination(state, action.destinationId, (d) => ({
        ...d,
        items: d.items.map((i) => (i.checked ? { ...i, checked: false } : i)),
      }));

    default:
      return state;
  }
}

type Store = {
  destinations: Destination[];
  hydrated: boolean;
  getDestination: (id: string | undefined) => Destination | undefined;
  /** Returns the id of the freshly created destination. */
  createDestination: (name: string, icon: string, address: string) => string;
  updateDestination: (id: string, patch: DestinationPatch) => void;
  toggleFavorite: (id: string) => void;
  deleteDestination: (id: string) => void;
  addItem: (destinationId: string, name: string) => void;
  /** Accepts history-based suggestions; reactivates matching rows instead of duplicating. */
  addSuggestedItems: (destinationId: string, names: string[]) => void;
  toggleItem: (destinationId: string, itemId: string) => void;
  removeItem: (destinationId: string, itemId: string) => void;
  /*
   * Leaving is one flow with two phases:
   *   normal  --("🚀 אני יוצא" → startExit)-->  in-exit
   *   in-exit --("✅ סיימתי את היציאה" → completeExit)-->  normal
   * Exactly one of the two buttons is on screen at any time.
   */

  /** True while an exit is in progress for this destination. */
  isExiting: (destinationId: string) => boolean;
  /**
   * When the active exit started, or undefined when there is none. Persisted
   * with the exit itself, so "מצב יציאה" can show a real departure time even
   * after a refresh instead of inventing one.
   */
  exitStartedAt: (destinationId: string) => number | undefined;
  /** "🚀 אני יוצא": begins a fresh exit — clears any leftover ticks. */
  startExit: (destinationId: string) => void;
  /**
   * "✅ סיימתי את היציאה": writes the trip (destination, timestamp, every item
   * and whether it was taken) to history, clears the ticks, and ends the exit.
   */
  completeExit: (destinationId: string) => void;

  /** "רק הפעם" — session only, forgotten as soon as the trip ends. */
  skippedIds: (destinationId: string) => string[];
  skipOnce: (destinationId: string, itemId: string) => void;
  unskip: (destinationId: string, itemId: string) => void;

  /** Past exit checks, newest first. Written by finishTrip. */
  trips: Trip[];
  getTrip: (id: string | undefined) => Trip | undefined;

  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;

  /** Wipes destinations, history and settings. */
  clearEverything: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function DestinationsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { destinations: [], hydrated: false });
  const [skips, setSkips] = useState<SkipMap>({});
  const [trips, setTrips] = useState<Trip[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [activeExits, setActiveExits] = useState<ActiveExits>({});
  const firstPersist = useRef(true);
  const sideStoresLoaded = useRef(false);

  // Load once on startup.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      loadDestinations(),
      loadTrips(),
      loadSettings(),
      loadActiveExits(),
    ]).then(([destinations, loadedTrips, loadedSettings, loadedActiveExits]) => {
      if (!alive) return;
      setTrips(loadedTrips);
      setSettings(loadedSettings);
      setActiveExits(loadedActiveExits);
      sideStoresLoaded.current = true;
      dispatch({ type: 'hydrate', destinations });
    });
    return () => {
      alive = false;
    };
  }, []);

  // Persist on every change (skipping the initial hydrate).
  useEffect(() => {
    if (!state.hydrated) return;
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    void saveDestinations(state.destinations);
  }, [state.destinations, state.hydrated]);

  useEffect(() => {
    if (sideStoresLoaded.current) void saveTrips(trips);
  }, [trips]);

  useEffect(() => {
    if (sideStoresLoaded.current) void saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (sideStoresLoaded.current) void saveActiveExits(activeExits);
  }, [activeExits]);

  const getDestination = useCallback(
    (id: string | undefined) =>
      id ? state.destinations.find((d) => d.id === id) : undefined,
    [state.destinations],
  );

  const createDestination = useCallback((name: string, icon: string, address: string) => {
    const trimmedAddress = address.trim();
    const destination: Destination = {
      id: newId('dest'),
      name: name.trim(),
      icon,
      address: trimmedAddress.length > 0 ? trimmedAddress : undefined,
      items: [],
      createdAt: Date.now(),
    };
    dispatch({ type: 'addDestination', destination });
    return destination.id;
  }, []);

  const value = useMemo<Store>(
    () => ({
      destinations: state.destinations,
      hydrated: state.hydrated,
      getDestination,
      createDestination,
      updateDestination: (id, patch) => dispatch({ type: 'updateDestination', id, patch }),
      toggleFavorite: (id) => {
        const current = state.destinations.find((d) => d.id === id);
        dispatch({
          type: 'updateDestination',
          id,
          patch: { favorite: !(current?.favorite ?? false) },
        });
      },
      deleteDestination: (id) => {
        dispatch({ type: 'deleteDestination', id });
        setSkips((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setActiveExits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      },
      addItem: (destinationId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        dispatch({
          type: 'addItem',
          destinationId,
          item: { id: newId('item'), name: trimmed, checked: false, active: true },
        });
      },
      addSuggestedItems: (destinationId, names) => {
        const entries = names
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
          .map((name) => ({ name, newId: newId('item') }));
        if (entries.length === 0) return;
        dispatch({ type: 'addSuggestedItems', destinationId, entries });
      },
      toggleItem: (destinationId, itemId) =>
        dispatch({ type: 'toggleItem', destinationId, itemId }),
      removeItem: (destinationId, itemId) =>
        dispatch({ type: 'removeItem', destinationId, itemId }),
      isExiting: (destinationId) => activeExits[destinationId] != null,
      exitStartedAt: (destinationId) => activeExits[destinationId],

      startExit: (destinationId) => {
        // A new exit always starts clean, so nothing carries over from a
        // previous departure that was never completed.
        dispatch({ type: 'resetChecks', destinationId });
        setSkips((prev) => ({ ...prev, [destinationId]: [] }));
        setActiveExits((prev) => ({ ...prev, [destinationId]: Date.now() }));
      },

      completeExit: (destinationId) => {
        // Snapshot the list before the checks are cleared.
        const destination = state.destinations.find((d) => d.id === destinationId);
        if (destination) {
          const skipped = skips[destinationId] ?? [];
          const trip: Trip = {
            id: newId('trip'),
            destinationId,
            destinationName: destination.name,
            icon: destination.icon,
            address: destination.address,
            at: Date.now(),
            items: destination.items
              .filter((i) => i.active)
              .map((i) => ({
                itemId: i.id,
                name: i.name,
                taken: i.checked && !skipped.includes(i.id),
                skipped: skipped.includes(i.id),
              })),
          };
          setTrips((prev) => [trip, ...prev].slice(0, 200));
        }

        dispatch({ type: 'resetChecks', destinationId });
        setSkips((prev) => ({ ...prev, [destinationId]: [] }));
        // Back to the normal state: only "🚀 אני יוצא" shows again.
        setActiveExits((prev) => {
          const next = { ...prev };
          delete next[destinationId];
          return next;
        });
      },

      skippedIds: (destinationId) => skips[destinationId] ?? [],
      skipOnce: (destinationId, itemId) =>
        setSkips((prev) => {
          const current = prev[destinationId] ?? [];
          if (current.includes(itemId)) return prev;
          return { ...prev, [destinationId]: [...current, itemId] };
        }),
      unskip: (destinationId, itemId) =>
        setSkips((prev) => ({
          ...prev,
          [destinationId]: (prev[destinationId] ?? []).filter((id) => id !== itemId),
        })),

      trips,
      getTrip: (id) => (id ? trips.find((t) => t.id === id) : undefined),
      settings,
      updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
      clearEverything: () => {
        dispatch({ type: 'hydrate', destinations: [] });
        setTrips([]);
        setSettings(defaultSettings);
        setSkips({});
        setActiveExits({});
        void clearAllData();
      },
    }),
    [
      state.destinations,
      state.hydrated,
      skips,
      trips,
      settings,
      activeExits,
      getDestination,
      createDestination,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <DestinationsProvider>');
  return store;
}

/**
 * Home-screen order: favourites first, otherwise untouched.
 * Array.prototype.sort is stable, so destinations keep their existing relative
 * order inside each group.
 */
export function byFavoriteFirst(destinations: Destination[]): Destination[] {
  return [...destinations].sort(
    (a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false),
  );
}

/** Items that should show up in the exit check right now. */
export function activeItems(destination: Destination | undefined): Item[] {
  return destination ? destination.items.filter((i) => i.active) : [];
}
