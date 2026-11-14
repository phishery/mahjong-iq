import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function fastSettings(page: Page) {
  await page.addInitScript(() => {
    const key = 'mahjong-iq:settings:v1';
    const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...cur, animations: 'off', simulation: false }));
  });
}

/** Rank the first three categories offered (Beginner mode). */
async function rankCategories(page: Page) {
  const slots = page.getByTestId('ranking-slots');
  if ((await slots.locator('[data-testid^="slot-"]').count()) < 3) {
    const buttons = page.locator('[data-testid^="pick-category-"]:not([disabled])');
    while ((await slots.locator('[data-testid^="slot-"]').count()) < 3) await buttons.first().click();
  }
  await page.getByTestId('submit-ranking').click();
}

async function passThree(page: Page) {
  const tiles = page.getByTestId('rack').locator('button:not([data-kind="J"])');
  for (let i = 0; i < 3; i++) await tiles.nth(i).click();
  await page.getByTestId('pass-button').click();
}

/** Make one legal move at the table if one is offered. Returns false when the hand is over. */
async function tableMove(page: Page): Promise<boolean> {
  if (await page.getByTestId('table-result').isVisible().catch(() => false)) return false;
  for (const id of ['table-mahjong', 'table-call-mahjong', 'table-call-pass']) {
    const b = page.getByTestId(id);
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      return true;
    }
  }
  const discard = page.getByTestId('table-discard');
  if (await discard.isVisible().catch(() => false)) {
    await page.getByTestId('rack').locator('button').last().click();
    if (await discard.isEnabled()) await discard.click();
    return true;
  }
  await page.waitForTimeout(100);
  return true;
}

test('a finished Quick round can be played out against three computer players', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fastSettings(page);
  await page.goto('/');
  await page.getByTestId('mode-beginner').click();
  await page.getByTestId('length-first').click();
  await page.getByTestId('start-round').click();
  for (let i = 0; i < 3; i++) {
    await rankCategories(page);
    await passThree(page);
  }
  await rankCategories(page);
  await expect(page.getByTestId('play-hand')).toBeVisible();
  await page.getByTestId('play-hand').click();
  await expect(page.getByTestId('table')).toBeVisible();
  await expect(page.getByTestId('seat-left')).toBeVisible();
  await shot(page, 'solo-start');

  let sawHint = false;
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && (await tableMove(page))) {
    if (!sawHint && (await page.getByTestId('table-hint').isVisible().catch(() => false))) {
      await page.getByTestId('table-hint').click();
      await expect(page.getByTestId('table-discard')).toBeEnabled();
      sawHint = true;
      await shot(page, 'solo-turn');
    }
  }
  await expect(page.getByTestId('table-result')).toBeVisible();
  await shot(page, 'solo-result');
  expect(sawHint).toBe(true);
  expect(errors).toEqual([]);
});

test('two people play the Charleston at the same online table', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  for (const p of [host, guest]) await fastSettings(p);

  await host.goto('/');
  await host.getByTestId('home-play-online').click();
  await host.getByTestId('online-name').fill('Host');
  await host.getByTestId('online-create').click();
  await expect(host.getByTestId('lobby')).toBeVisible();
  const code = (await host.getByTestId('room-code').innerText()).trim();
  await shot(host, 'online-lobby');

  // The guest arrives through the invite link.
  await guest.goto(`/#room=${code}`);
  await guest.getByTestId('online-name').fill('Guest');
  await expect(guest.getByTestId('online-code')).toHaveValue(code);
  await guest.getByTestId('online-join').click();
  await expect(guest.getByTestId('lobby')).toBeVisible();
  await expect(host.getByTestId('lobby-seat-1')).toContainText('Guest');

  await host.getByTestId('online-start').click();
  for (const p of [host, guest]) await expect(p.getByTestId('table')).toBeVisible();
  await expect(host.getByTestId('table-pass')).toBeVisible();

  const handOf = async (p: Page) => (await p.getByTestId('rack').locator('[data-kind]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).join(' ');
  for (const p of [host, guest]) {
    const tiles = p.getByTestId('rack').locator('button:not([data-kind="J"])');
    for (let i = 0; i < 3; i++) await tiles.nth(i).click();
    await p.getByTestId('table-pass').click();
  }
  // Both see the next pass (First Across) once the bots have passed too.
  for (const p of [host, guest]) await expect(p.getByTestId('table-pass')).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText(/First Across/).first()).toBeVisible();
  expect(await handOf(host)).not.toEqual('');
  await shot(guest, 'online-charleston');
});
