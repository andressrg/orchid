import { test, expect } from '@playwright/test';

test.describe('Settings page', () => {
  const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-settings-${testId}@example.com`;
  const password = 'testpassword123';

  test('team settings loads members after signup', async ({ page }) => {
    // Sign up (setActive is called during signup)
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Settings Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/t\/[\w-]+\/dashboard/, { timeout: 15000 });

    // Navigate to settings
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/team/, { timeout: 5000 });

    // Verify team data loaded (not stuck on "Loading...")
    const main = page.getByRole('main');
    await expect(main.getByText('Settings Tester', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(main.getByText(email)).toBeVisible();
    await expect(main.getByText('owner')).toBeVisible();

    // Verify invite form is present
    await expect(main.getByPlaceholder('colleague@example.com')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Invite' })).toBeVisible();
  });

  test('team settings loads after re-login (no signup setActive)', async ({ page }) => {
    // First sign up to create the account
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Settings Tester 2');
    await page.getByLabel('Email').fill(`e2e-settings2-${testId}@example.com`);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/t\/[\w-]+\/dashboard/, { timeout: 15000 });

    // Extract team slug
    const teamSlug = page.url().match(/\/t\/([\w-]+)\//)?.[1];
    expect(teamSlug).toBeTruthy();

    // Clear cookies to simulate a fresh session (no active org set)
    await page.context().clearCookies();

    // Log back in
    await page.goto('/login');
    await page.getByLabel('Email').fill(`e2e-settings2-${testId}@example.com`);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/t\/[\w-]+\/dashboard/, { timeout: 15000 });

    // Go directly to settings — this is where the bug was
    await page.goto(`/t/${teamSlug}/settings/team`);

    // Verify it loads and doesn't stay stuck on "Loading..."
    const main = page.getByRole('main');
    await expect(main.getByText('Settings Tester 2', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(main.getByText('owner')).toBeVisible();
  });
});
