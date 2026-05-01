import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/t/any-team/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows login page with form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByText(/sign up/i)).toBeVisible();
  });

  test('shows signup page with form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('shows error for invalid login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nonexistent@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('p.text-red-400, p.text-sm.text-red-400')).toBeVisible({
      timeout: 5000,
    });
  });

  test('full signup and login flow', async ({ page }) => {
    const email = `test-${Date.now()}@example.com`;
    const password = 'testpassword123';

    // Sign up
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Should redirect to team dashboard (URL includes /t/<slug>/dashboard)
    await expect(page).toHaveURL(/\/t\/[\w-]+\/dashboard/, { timeout: 10000 });

    // Should redirect to team dashboard (URL includes /t/<slug>/dashboard)
    // The client-side router.push navigates here after signup + team creation
    await expect(page).toHaveURL(/\/t\/[\w-]+\/dashboard/, { timeout: 15000 });
  });
});
