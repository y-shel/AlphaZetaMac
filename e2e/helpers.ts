import type { Page } from '@playwright/test';

/** Answers a problem as the page shows it, for example "46 – 12". */
export function solve(text: string): number {
  const m = /^(\d+) ([+–×÷]) (\d+)$/.exec(text.trim());
  if (m === null) throw new Error(`cannot read the problem "${text}"`);
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case '+':
      return a + b;
    case '–':
      return a - b;
    case '×':
      return a * b;
    default:
      return a / b;
  }
}

/** Every record in one IndexedDB store of the app's database. */
export function readStore(page: Page, store: string): Promise<unknown[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('alphazetamac');
        open.onerror = () => reject(open.error ?? new Error('open failed'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onerror = () => reject(request.error ?? new Error('read failed'));
          request.onsuccess = () => {
            resolve(request.result as unknown[]);
            db.close();
          };
        };
      }),
    store,
  );
}

export async function startRound(page: Page, durationS: number): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Duration').selectOption(String(durationS));
  await page.getByRole('button', { name: 'Start' }).click();
}
