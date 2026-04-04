import { describe, it, expect } from 'vitest';
import app from '@/app/lib/api-app';

describe('GET /api/health', () => {
  it('returns ok when database is connected', async () => {
    const res = await app.request('/api/health');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
  });
});
