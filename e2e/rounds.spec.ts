import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** Rank three options at the current level by clicking the first three available pickers. */
async function rankThree(page: Page) {
  const slots = page.getByTestId('ranking-slots');
  await expect(page.getByTestId('submit-ranking')).toBeVisible();
  const level = await page.getByTestId('stage-title').locator('..').innerText();
  // Clear any retained picks first.
  const filled = await slots.locator('[data-testid^="slot-"]').count();
  if (filled === 3) {
    await page.getByTestId('submit-ranking').click();
    return;
  }
  if (await page.getByTestId('category-picker').isVisible().catch(() => false)) {
    const buttons = page.locator('[data-testid^="pick-category-"]:not([disabled])');
    while ((await slots.locator('[data-testid^="slot-"]').count()) < 3) await buttons.first().click();
  } else if (await page.getByTestId('line-picker').isVisible().catch(() => false)) {
    const buttons = page.locator('[data-testid^="pick-line-"]:not([disabled])');
    while ((await slots.locator('[data-testid^="slot-"]').count()) < 3) await buttons.first().click();
  } else {
    // Exact-hand builder: open a line, add the configured variant, try next configurations.
    const lines = page.locator('[data-testid^="open-line-"]');
    let i = 0;
    while ((await slots.locator('[data-testid^="slot-"]').count()) < 3) {
      await lines.nth(i++).click();
      await page.getByTestId('add-variant').click();
      await page.getByText(/← All/).click();
    }
  }
  void level;
  await page.getByTestId('submit-ranking').click();
}

async function passThree(page: Page) {
  const tiles = page.getByTestId('rack').locator('button:not([data-kind="J"])');
  for (let i = 0; i < 3; i++) await tiles.nth(i).click();
  await page.getByTestId('pass-button').click();
}

async function expectReview(page: Page) {
  await expect(page.getByTestId('ranking-review')).toBeVisible();
  await expect(page.getByTestId('decision-credit')).toBeVisible();
  await expect(page.getByTestId('feedback-headline')).toBeVisible();
}

test('full Beginner round: both Charlestons, blind pass and courtesy pass', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('mode-beginner').click();
  await page.getByTestId('length-full').click();
  await page.getByTestId('start-round').click();
  await expect(page.getByTestId('stage-title')).toHaveText('Opening rack');
  await expect(page.getByTestId('rack').locator('[data-kind]')).toHaveCount(13);

  // First Charleston: R, A, L (with a blind pass of 1 on the first left).
  for (let p = 0; p < 3; p++) {
    await rankThree(page);
    await expectReview(page);
    if (p === 2) {
      await page.getByTestId('blind-1').click();
      const tiles = page.getByTestId('rack').locator('button:not([data-kind="J"])');
      await tiles.nth(0).click();
      await tiles.nth(1).click();
      await page.getByTestId('pass-button').click();
    } else {
      await passThree(page);
    }
    // After every exchange the player must re-rank before anything else.
    await expect(page.getByTestId('submit-ranking')).toBeVisible();
    await expect(page.getByTestId('last-pass')).toBeVisible();
    await expect(page.getByTestId('rack').locator('[data-kind]')).toHaveCount(13);
  }
  await rankThree(page);
  await expectReview(page);
  await expect(page.getByTestId('change-chart')).toBeVisible();
  await shot(page, 'beginner-review');

  // Vote to continue; opponents may stop the second Charleston.
  await page.getByTestId('vote-continue').click();
  for (let p = 0; p < 3; p++) {
    if (!(await page.getByTestId('pass-button').isVisible().catch(() => false))) break;
    await passThree(page);
    await rankThree(page);
    await expectReview(page);
  }
  // Courtesy pass (if offered).
  if (await page.getByTestId('courtesy-3').isVisible().catch(() => false)) {
    await page.getByTestId('courtesy-3').click();
    if (await page.getByTestId('courtesy-pass').isVisible().catch(() => false)) {
      const want = await page.getByTestId('courtesy-pass').locator('..').innerText();
      const n = Number(/(\d)\/(\d)/.exec(want)?.[2] ?? 0);
      const tiles = page.getByTestId('rack').locator('button:not([data-kind="J"])');
      for (let i = 0; i < n; i++) await tiles.nth(i).click();
      await page.getByTestId('courtesy-pass').click();
      await rankThree(page);
    }
  }
  await page.getByTestId('see-report').click();
  await expect(page.getByTestId('report')).toBeVisible();
  await expect(page.getByTestId('lessons')).toBeVisible();
  const score = (await page.getByTestId('score-total').textContent()) ?? '';
  expect(Number(score)).toBeGreaterThanOrEqual(0);
  expect(Number(score)).toBeLessThanOrEqual(100);
  await shot(page, 'beginner-report');
  // Instant restart.
  await page.getByTestId('play-again').click();
  await expect(page.getByTestId('stage-title')).toHaveText('Opening rack');
  expect(errors).toEqual([]);
});

test('full Hybrid round: categories → lines → exact hands, then report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('mode-hybrid').click();
  await page.getByTestId('length-first').click();
  await page.getByTestId('start-round').click();
  await shot(page, 'hybrid-0-rank');

  // Decision 0 and 1: categories.
  await expect(page.getByTestId('category-picker')).toBeVisible();
  await rankThree(page);
  await expectReview(page);
  await shot(page, 'hybrid-0-review');
  await passThree(page);
  await expect(page.getByTestId('category-picker')).toBeVisible();
  // Previous category picks are retained and can be resubmitted or changed.
  await expect(page.getByTestId('slot-0')).toBeVisible();
  await rankThree(page);
  await passThree(page);

  // Decision 2: card lines, with a milestone.
  await expect(page.getByTestId('milestone')).toBeVisible();
  await expect(page.getByTestId('line-picker')).toBeVisible();
  await shot(page, 'hybrid-2-lines');
  await rankThree(page);
  await expectReview(page);
  await passThree(page);

  // Decision 3: exact hands.
  await expect(page.getByTestId('variant-picker')).toBeVisible();
  await page.locator('[data-testid^="open-line-"]').first().click();
  await shot(page, 'hybrid-3-builder');
  await page.getByText(/← All/).click();
  await rankThree(page);
  await expectReview(page);
  await page.getByTestId('toggle-all-candidates').click();
  await shot(page, 'hybrid-3-review');

  await page.getByTestId('see-report').click();
  await expect(page.getByTestId('report')).toBeVisible();
  await page.getByTestId('replay-next').click();
  await shot(page, 'hybrid-report');
  expect(errors).toEqual([]);
});

test('opening-rack sprint gives instant grading and a next rack', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('drill-opening').click();
  for (let r = 0; r < 3; r++) {
    await rankThree(page);
    await expectReview(page);
    await page.getByTestId('next-rack').click();
    await expect(page.getByTestId('stage-title')).toHaveText('Opening rack');
  }
});

test('card reference shows source, hands and variations', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('header-card').click();
  await expect(page.getByTestId('card-source')).toContainText('Fictional demo card');
  await page.getByTestId('ref-line-RN-1').click();
  await expect(page.getByText('start 1 · Bam', { exact: true })).toBeVisible();
  await shot(page, 'card-reference');
});
