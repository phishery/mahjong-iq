import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

async function passThree(page: Page) {
  const tiles = page.getByTestId('rack').locator('button:not([data-kind="J"])');
  for (let i = 0; i < 3; i++) await tiles.nth(i).click();
  await page.getByTestId('pass-button').click();
}

test('on wide screens the card docks under the rack, follows the picks and folds for the analysis', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('mode-hybrid').click();
  await page.getByTestId('length-first').click();
  await page.getByTestId('start-round').click();

  const dock = page.getByTestId('card-dock');
  await expect(dock).toBeVisible();
  await expect(page.getByTestId('card-dock-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(dock.getByTestId('card-filter-all')).toHaveAttribute('aria-pressed', 'true');

  // Picking a section jumps the card to it.
  await page.getByTestId('pick-category-like').click();
  await expect(dock.getByTestId('card-filter-like')).toHaveAttribute('aria-pressed', 'true');
  await expect(dock.locator('[data-testid^="ref-line-"]')).toHaveCount(3);
  await page.getByTestId('pick-category-run').click();
  await page.getByTestId('pick-category-quints').click();
  await shot(page, 'dock-rank');

  // After locking in, the card folds away and the analysis takes its place.
  await page.getByTestId('submit-ranking').click();
  await expect(page.getByTestId('feedback-headline')).toBeVisible();
  await expect(page.getByTestId('card-dock-toggle')).toHaveAttribute('aria-expanded', 'false');
  await shot(page, 'dock-review');
  await page.getByTestId('card-dock-toggle').click();
  await expect(dock.locator('[data-testid^="ref-line-"]').first()).toBeVisible();

  await passThree(page);
  await page.getByTestId('submit-ranking').click(); // keep the same categories
  await passThree(page);

  // Card-line round: the card opens on the sections just ranked, and follows the line picked.
  await expect(page.getByTestId('line-picker')).toBeVisible();
  await expect(dock.getByTestId('card-filter-mine')).toHaveAttribute('aria-pressed', 'true');
  const shown = await dock.locator('[data-testid^="ref-line-"]').count();
  expect(shown).toBe(3 + 6 + 3); // Like Numbers, Consecutive Runs and Quints lines on the demo card
  // The line picker opens on the #1 section from the last ranking.
  // A line from one of those sections is outlined in place; a section chip narrows the card.
  await page.getByTestId('pick-line-LK-2').click();
  await expect(dock.getByTestId('card-filter-mine')).toHaveAttribute('aria-pressed', 'true');
  await expect(dock.getByTestId('ref-line-LK-2').locator('..')).toHaveClass(/ring-2/);
  await page.getByTestId('line-picker').getByRole('button', { name: '369' }).click();
  await expect(dock.getByTestId('card-filter-369')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'dock-lines');
  expect(errors).toEqual([]);
});

test('phones keep the slide-out card drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('start-round').click();
  await expect(page.getByTestId('submit-ranking')).toBeVisible();
  await expect(page.getByTestId('card-dock')).toHaveCount(0);
  await page.getByTestId('open-card').click();
  await expect(page.getByRole('dialog', { name: 'Card reference' })).toBeVisible();
});
