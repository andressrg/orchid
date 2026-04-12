import { test, expect } from '@playwright/test';

test.describe('Session viewing', () => {
  const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-session-${testId}@example.com`;
  const password = 'testpassword123';
  const sessionId = `e2e-session-${testId}`;

  test('can view a session after creating one', async ({ page }) => {
    // Sign up
    await page.goto('/signup');
    await page.getByLabel('Name').fill('E2E Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/t\/[\w-]+\/dashboard/, { timeout: 15000 });

    // Extract team slug from URL
    const url = page.url();
    const teamSlug = url.match(/\/t\/([\w-]+)\//)?.[1];
    expect(teamSlug).toBeTruthy();

    // Create a session via the API (browser has auth cookies)
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: 'Add a health check endpoint' }, timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'I\'ll add a GET /health endpoint that returns { status: "ok" }.' }, timestamp: '2026-01-01T00:01:00Z' }),
    ].join('\n');

    const createRes = await page.evaluate(
      async ({ transcript: t, sid }) => {
        const res = await fetch(`/api/sessions/${sid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            user_name: 'e2e-tester',
            user_email: 'e2e@test.com',
            working_dir: '/tmp/test',
            git_remotes: [],
            branch: 'main',
            tool: 'claude-code',
            transcript: t,
            status: 'done',
          }),
        });
        return { status: res.status, id: (await res.json()).id };
      },
      { transcript, sid: sessionId },
    );
    expect(createRes.status).toBe(200);

    // Navigate to the session detail page
    await page.goto(`/t/${teamSlug}/sessions/${sessionId}`);

    // Verify the session page renders with conversation data
    await expect(page.getByText('Add a health check endpoint')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/health endpoint/)).toBeVisible();

    // Verify tab bar is present
    await expect(page.getByRole('button', { name: 'Conversation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Commits' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible();

    // Verify metadata is shown
    await expect(page.getByText('e2e-tester')).toBeVisible();
  });
});
