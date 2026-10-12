import { expect, test, type Page } from '@playwright/test';
import demo from '../src/engine/cards/demo-card.json' with { type: 'json' };

// The real card lives only on the server; here a renamed demo card stands in for it.
const UNLOCKED = { ...demo, id: 'unlocked-test', title: 'Unlocked test card', source: { ...demo.source, kind: 'user-supplied' } };

async function mockServer(page: Page) {
  await page.route('**/api/unlock-card', async (route) => {
    const { passcode } = route.request().postDataJSON() as { passcode: string };
    if (passcode === '1234') await route.fulfill({ json: UNLOCKED });
    else await route.fulfill({ status: 401, json: { error: 'That passcode isn’t right.' } });
  });
}

test('passcode in the card drawer unlocks the card', async ({ page }) => {
  await mockServer(page);
  await page.goto('/');
  await page.getByTestId('home-unlock').click();
  await page.getByTestId('unlock-passcode').fill('0000');
  await page.getByTestId('unlock-submit').click();
  await expect(page.getByText('That passcode isn’t right.')).toBeVisible();
  await page.getByTestId('unlock-passcode').fill('1234');
  await page.getByTestId('unlock-submit').click();
  await expect(page.getByText('Loaded "Unlocked test card"')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Using your imported card: Unlocked test card')).toBeVisible();
});

test('an #unlock= link loads the card and clears the passcode from the address bar', async ({ page }) => {
  await mockServer(page);
  await page.goto('/#unlock=1234');
  await expect(page.getByTestId('unlock-notice')).toContainText('Card unlocked: Unlocked test card');
  await expect(page.getByText('Using your imported card: Unlocked test card')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});
