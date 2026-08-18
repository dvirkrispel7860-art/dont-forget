/** Hebrew counts read badly with a bare number at 0 and 1, so spell those out. */

export function itemsCountLabel(count: number): string {
  if (count === 0) return 'עוד אין פריטים';
  if (count === 1) return 'פריט אחד';
  return `${count} פריטים`;
}

export function takenLabel(count: number): string {
  if (count === 0) return 'לא נלקחו פריטים';
  if (count === 1) return 'פריט אחד נלקח';
  return `${count} פריטים נלקחו`;
}

/** "17 באוגוסט" — the year is added only when it is not the current one. */
export function formatTripDate(at: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "07:42" */
export function formatTripClock(at: number): string {
  return new Date(at).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "17 באוגוסט · 07:42" */
export function formatTripDateTime(at: number): string {
  return `${formatTripDate(at)} · ${formatTripClock(at)}`;
}

/** "6/6 פריטים ✓" — the tick appears only when everything was taken. */
export function tripCountLabel(taken: number, total: number | null): string {
  if (total === null) return takenLabel(taken);
  const base = `${taken}/${total} פריטים`;
  return taken === total && total > 0 ? `${base} ✓` : base;
}
