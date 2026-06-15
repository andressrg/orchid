import { describe, it, expect } from 'vitest';
import { buildShareUrls, buildShareText } from '@/app/components/share-profile';

// P7-5: the share intent URLs for the public efficiency profile. These are the
// pure builders behind the X / LinkedIn / Copy-link buttons. We assert the
// correct base URL per platform and that the text + profile URL are properly
// encodeURIComponent-encoded — query-special characters round-trip with no
// double-encoding and no injection. (The React render is verified visually on
// the preview; vitest runs in node env, so we test the pure helpers only.)

const PROFILE_URL = 'https://orchidkeep.com/u/julian-mazo';
// A URL with query params + a space to exercise encoding (?, &, space).
const TRICKY_URL = 'https://orchidkeep.com/u/ada?ref=tw&from=share me';

describe('buildShareText', () => {
  it('wraps the page headline into the postable brag', () => {
    expect(buildShareText('3.4 PRs / million tokens')).toBe(
      'I ship 3.4 PRs / million tokens on Orchid 🌸',
    );
  });

  it('works for every headlineMode-derived headline', () => {
    expect(buildShareText('12 PRs merged')).toBe('I ship 12 PRs merged on Orchid 🌸');
    expect(buildShareText('1.2M tokens')).toBe('I ship 1.2M tokens on Orchid 🌸');
  });
});

describe('buildShareUrls — X / Twitter', () => {
  it('targets the tweet intent with encoded text + url', () => {
    const text = buildShareText('3.4 PRs / million tokens');
    const url = buildShareUrls({ platform: 'x', profileUrl: PROFILE_URL, text });

    expect(url.startsWith('https://twitter.com/intent/tweet?')).toBe(true);
    expect(url).toContain(`text=${encodeURIComponent(text)}`);
    expect(url).toContain(`url=${encodeURIComponent(PROFILE_URL)}`);
    // The "/" and spaces in the text must be percent-encoded, not raw.
    expect(url).toContain('%20');
    expect(url).toContain('%2F');
  });

  it('encodes query-special characters in the profile url exactly once', () => {
    const text = buildShareText('1 PR merged');
    const url = buildShareUrls({ platform: 'x', profileUrl: TRICKY_URL, text });
    const encoded = encodeURIComponent(TRICKY_URL);

    // Single, correct encoding — recover the original by decoding the url param.
    expect(url).toContain(`url=${encoded}`);
    expect(url).not.toContain('url=https://orchidkeep.com/u/ada?ref=tw'); // not raw
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('url')).toBe(TRICKY_URL); // round-trips, no double-encode
    expect(params.get('text')).toBe(text);
  });
});

describe('buildShareUrls — LinkedIn', () => {
  it('targets share-offsite with only the encoded url', () => {
    const url = buildShareUrls({
      platform: 'linkedin',
      profileUrl: PROFILE_URL,
      text: buildShareText('12 PRs merged'),
    });

    expect(url.startsWith('https://www.linkedin.com/sharing/share-offsite/?')).toBe(true);
    expect(url).toContain(`url=${encodeURIComponent(PROFILE_URL)}`);
    // LinkedIn share-offsite carries no text param.
    expect(url).not.toContain('text=');
  });

  it('encodes query-special characters in the profile url, round-tripping cleanly', () => {
    const url = buildShareUrls({
      platform: 'linkedin',
      profileUrl: TRICKY_URL,
      text: buildShareText('done'),
    });
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('url')).toBe(TRICKY_URL);
  });
});
