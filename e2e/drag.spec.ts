import { expect, test, type Page } from '@playwright/test';

async function fastSettings(page: Page) {
  await page.addInitScript(() => {
    const key = 'mahjong-iq:settings:v1';
    const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...cur, animations: 'off', simulation: false }));
  });
}

const rackOrder = (page: Page) =>
  page.getByTestId('rack').locator('[data-tile-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tileId!));

const tileBox = async (page: Page, id: string) => (await page.locator(`[data-tile-id="${id}"]`).boundingBox())!;
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function mouseDrag(page: Page, fromId: string, toId: string) {
  const a = centre(await tileBox(page, fromId));
  const b = centre(await tileBox(page, toId));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 15 });
  await page.mouse.up();
}

async function touchDrag(page: Page, fromId: string, toId: string) {
  const a = centre(await tileBox(page, fromId));
  const b = centre(await tileBox(page, toId));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 15; i++) {
    const x = a.x + ((b.x - a.x) * i) / 15;
    const y = a.y + ((b.y - a.y) * i) / 15;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Start a Beginner Quick round and reach the first pass, where rack tiles are clickable buttons. */
async function reachFirstPass(page: Page) {
  await fastSettings(page);
  await page.goto('/');
  await page.getByTestId('mode-beginner').click();
  await page.getByTestId('length-first').click();
  await page.getByTestId('start-round').click();
  const slots = page.getByTestId('ranking-slots');
  const picks = page.locator('[data-testid^="pick-category-"]:not([disabled])');
  while ((await slots.locator('[data-testid^="slot-"]').count()) < 3) await picks.first().click();
  await page.getByTestId('submit-ranking').click();
  await expect(page.getByTestId('pass-button')).toBeVisible();
}

test('dragging rearranges the rack while tiles are clickable, and a tap still selects', async ({ page }) => {
  await reachFirstPass(page);
  const before = await rackOrder(page);
  await mouseDrag(page, before[0], before[before.length - 1]);
  const after = await rackOrder(page);
  expect(after[after.length - 1]).toBe(before[0]);
  expect([...after].sort()).toEqual([...before].sort());
  // The drag did not select the tile it ended on…
  await expect(page.locator(`[data-tile-id="${before[0]}"] button`)).toHaveAttribute('aria-pressed', 'false');
  // …and a plain tap still selects.
  const plain = after.find((id) => after.indexOf(id) === 2)!;
  await page.locator(`[data-tile-id="${plain}"] button`).click();
  await expect(page.locator(`[data-tile-id="${plain}"] button`)).toHaveAttribute('aria-pressed', 'true');
  // The order survives the next pass (new tiles are added at the end).
  await expect(page.getByTestId('sort-mode').getByText('Manual')).toBeVisible();
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('dragging with a finger rearranges the rack', async ({ page }) => {
    await reachFirstPass(page);
    const before = await rackOrder(page);
    await touchDrag(page, before[before.length - 1], before[0]);
    const after = await rackOrder(page);
    expect(after[0]).toBe(before[before.length - 1]);
  });
});

test('dragging works at the game table while bots keep playing', async ({ page }) => {
  await reachFirstPass(page);
  // Finish the round quickly: pass three times, ranking in between.
  for (let i = 0; i < 3; i++) {
    const tiles = page.getByTestId('rack').locator('button:not([data-kind="J"])');
    for (let k = 0; k < 3; k++) await tiles.nth(k).click();
    await page.getByTestId('pass-button').click();
    const slots = page.getByTestId('ranking-slots');
    if ((await slots.locator('[data-testid^="slot-"]').count()) < 3) {
      const picks = page.locator('[data-testid^="pick-category-"]:not([disabled])');
      while ((await slots.locator('[data-testid^="slot-"]').count()) < 3) await picks.first().click();
    }
    await page.getByTestId('submit-ranking').click();
  }
  await page.getByTestId('play-hand').click();
  await expect(page.getByTestId('table')).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await rackOrder(page);
    await mouseDrag(page, before[1], before[before.length - 2]);
    const after = await rackOrder(page);
    // Bots may draw/discard meanwhile, so compare only the tiles still in the rack.
    const kept = before.filter((id) => after.includes(id));
    expect(after.filter((id) => kept.includes(id)).indexOf(before[1])).toBeGreaterThan(kept.indexOf(before[1]));
  }
});
