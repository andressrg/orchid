/**
 * End-to-end smoke test for the Orchid CLI → API flow.
 *
 * Requires:
 *   ORCHID_API_URL — API base URL (e.g. http://localhost:3000/api)
 *   ORCHID_TOKEN   — Personal Access Token (orc_...)
 *
 * Run with: npm run test:e2e
 */

const API_URL = process.env.ORCHID_API_URL;
const TOKEN = process.env.ORCHID_TOKEN;

if (!API_URL || !TOKEN) {
  console.error('Error: ORCHID_API_URL and ORCHID_TOKEN must be set');
  process.exit(1);
}

const BASE = API_URL.replace(/\/$/, '');
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

const TEST_SESSION_ID = `e2e-test-${Date.now()}`;
const SEARCH_TERM = 'orchid_e2e_unique_marker';

const FAKE_TRANSCRIPT = [
  JSON.stringify({
    type: 'human',
    content: `Hello, this is an ${SEARCH_TERM} test message`,
  }),
  JSON.stringify({
    type: 'assistant',
    content: 'I received your test message.',
  }),
  JSON.stringify({
    type: 'human',
    content: 'Just verifying the E2E flow works.',
  }),
  JSON.stringify({ type: 'assistant', content: 'The flow is working!' }),
].join('\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

async function testPATAuth(): Promise<void> {
  console.log('\n=== PAT Authentication ===\n');

  // Health (no auth required)
  console.log('1. GET /health — no auth required');
  const healthRes = await fetch(`${BASE}/health`);
  assert(
    healthRes.status === 200,
    `Health returns 200 (got ${healthRes.status})`,
  );
  const health = (await healthRes.json()) as { status: string };
  assert(health.status === 'ok', 'Health status is ok');

  // Auth required
  console.log('\n2. GET /sessions — requires auth');
  const noAuthRes = await fetch(`${BASE}/sessions`);
  assert(
    noAuthRes.status === 401,
    `No auth returns 401 (got ${noAuthRes.status})`,
  );

  // Invalid token
  console.log('\n3. GET /sessions — invalid token');
  const badAuthRes = await fetch(`${BASE}/sessions`, {
    headers: { Authorization: 'Bearer orc_invalid' },
  });
  assert(
    badAuthRes.status === 401,
    `Invalid token returns 401 (got ${badAuthRes.status})`,
  );

  // Valid token - create session
  console.log('\n4. PUT /sessions/:id — create session');
  const putRes = await fetch(`${BASE}/sessions/${TEST_SESSION_ID}`, {
    method: 'PUT',
    headers: AUTH_HEADERS,
    body: JSON.stringify({
      user_name: 'e2e-tester',
      user_email: 'e2e@test.orchid',
      working_dir: '/tmp/orchid-e2e',
      git_remotes: ['https://github.com/test/orchid-e2e.git'],
      branch: 'main',
      tool: 'test',
      transcript: FAKE_TRANSCRIPT,
      status: 'done',
    }),
  });
  assert(putRes.status === 200, `PUT returns 200 (got ${putRes.status})`);
  const putBody = (await putRes.json()) as {
    id: string;
    message_count: number;
    user_id: string;
  };
  assert(putBody.id === TEST_SESSION_ID, 'Session ID matches');
  assert(
    putBody.message_count === 4,
    `Message count is 4 (got ${putBody.message_count})`,
  );
  assert(!!putBody.user_id, 'Session has user_id from PAT');

  // List sessions
  console.log('\n5. GET /sessions — verify session in list');
  const listRes = await fetch(`${BASE}/sessions`, { headers: AUTH_HEADERS });
  assert(listRes.status === 200, `List returns 200 (got ${listRes.status})`);
  const sessions = (await listRes.json()) as Array<{
    id: string;
    transcript?: string;
  }>;
  const found = sessions.find((s) => s.id === TEST_SESSION_ID);
  assert(!!found, 'Session appears in list');
  assert(!found?.transcript, 'List does not include transcript');

  // Get session
  console.log('\n6. GET /sessions/:id — retrieve full session');
  const getRes = await fetch(`${BASE}/sessions/${TEST_SESSION_ID}`, {
    headers: AUTH_HEADERS,
  });
  assert(getRes.status === 200, `Get returns 200 (got ${getRes.status})`);
  const session = (await getRes.json()) as {
    id: string;
    transcript: string;
    user_name: string;
    status: string;
  };
  assert(session.transcript === FAKE_TRANSCRIPT, 'Transcript matches');
  assert(session.user_name === 'e2e-tester', 'User name matches');

  // Search
  console.log('\n7. GET /sessions?q=<term> — search');
  const searchRes = await fetch(
    `${BASE}/sessions?q=${encodeURIComponent(SEARCH_TERM)}`,
    {
      headers: AUTH_HEADERS,
    },
  );
  assert(
    searchRes.status === 200,
    `Search returns 200 (got ${searchRes.status})`,
  );
  const searchResults = (await searchRes.json()) as Array<{ id: string }>;
  assert(
    !!searchResults.find((s) => s.id === TEST_SESSION_ID),
    'Search finds session',
  );

  // Stats
  console.log('\n8. GET /stats');
  const statsRes = await fetch(`${BASE}/stats`, { headers: AUTH_HEADERS });
  assert(statsRes.status === 200, `Stats returns 200 (got ${statsRes.status})`);

  // Token validation
  console.log('\n9. GET /tokens/validate');
  const validateRes = await fetch(`${BASE}/tokens/validate`, {
    headers: AUTH_HEADERS,
  });
  assert(
    validateRes.status === 200,
    `Validate returns 200 (got ${validateRes.status})`,
  );
  const validate = (await validateRes.json()) as {
    valid: boolean;
    userId: string;
  };
  assert(validate.valid === true, 'Token is valid');
  assert(!!validate.userId, 'Returns userId');

  // Delete session
  console.log('\n10. DELETE /sessions/:id — cleanup');
  const delRes = await fetch(`${BASE}/sessions/${TEST_SESSION_ID}`, {
    method: 'DELETE',
    headers: AUTH_HEADERS,
  });
  assert(delRes.status === 200, `Delete returns 200 (got ${delRes.status})`);

  // 404
  const verifyRes = await fetch(`${BASE}/sessions/${TEST_SESSION_ID}`, {
    headers: AUTH_HEADERS,
  });
  assert(verifyRes.status === 404, `Deleted session returns 404`);
}

async function testWebhook(): Promise<void> {
  console.log('\n=== Webhook ===\n');

  console.log('1. POST /webhook/github — skip non-PR');
  const skipRes = await fetch(`${BASE}/webhook/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push' },
    body: JSON.stringify({}),
  });
  assert(skipRes.status === 200, `Skip returns 200`);
  const skip = (await skipRes.json()) as { skipped: boolean };
  assert(skip.skipped === true, 'Skipped is true');
}

async function run(): Promise<void> {
  console.log(`\nOrchid CLI E2E Tests`);
  console.log(`Server: ${BASE}\n`);

  await testPATAuth();
  await testWebhook();

  console.log(`\n---\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('E2E test crashed:', err);
  process.exit(1);
});
