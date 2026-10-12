import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
  test(`home fits ${viewport.width}x${viewport.height} without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /ready to strike/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
    const targets = page.locator('.bottom-nav button');
    await expect(targets).toHaveCount(5);
    const heights = await targets.evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  });
}

test('main navigation works from the keyboard without hover', async ({ page }) => {
  await page.goto('/');
  const settings = page.getByRole('button', { name: 'Settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Sound Lab' })).toBeVisible();
});

test('a mapped supplied Ogg effect is served and the browser advertises Vorbis support', async ({ page }) => {
  await page.goto('/');
  const asset = await page.request.get('/audio/click_001.ogg');
  expect(asset.ok()).toBeTruthy();
  const oggType = await page.evaluate(() => document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"'));
  expect(oggType).not.toBe('');
});

test('the production PWA exposes its install manifest and both required raster icons', async ({ page }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifestResponse = await page.request.get(manifestHref!);
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'SayStrike — English Speaking Arcade', display: 'standalone' });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});

test('the production PWA opens a client route while offline after its shell is installed', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable.');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: /ready to strike/i })).toBeVisible();
  await context.setOffline(true);
  await page.goto('/progress');
  await expect(page.getByRole('heading', { name: /progress review/i })).toBeVisible();
  await expect(page.getByText(/server is offline/i)).toBeVisible();
});
