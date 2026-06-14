import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { Resend } from 'resend';
import { db } from './db';
import * as schema from './schema';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
  },
  // Account linking lets a logged-in email/password user merge their GitHub
  // login into the SAME Orchid user (no duplicate account).
  //
  // - `trustedProviders: ['github']` — GitHub may auto-link on a logged-OUT
  //   sign-in even when the existing Orchid account's email is unverified,
  //   provided the GitHub primary (verified) email matches. Better Auth's
  //   callback gate is `trustedProviders.includes(provider) || emailVerified`.
  // - `allowDifferentEmails: true` — the logged-IN `linkSocial` flow can merge a
  //   GitHub whose email differs from the Orchid email. Without it, linking is
  //   refused with `LINKING_DIFFERENT_EMAILS_NOT_ALLOWED` / `email_doesn't_match`.
  //
  // Security tradeoff: `allowDifferentEmails` is normally an account-takeover
  // risk, but here linking is gated behind completing the GitHub OAuth
  // round-trip — the user proves they control the GitHub account before it is
  // attached, and the link request is bound to their active server session
  // (Better Auth signs `userId` + `email` into the OAuth state). It only ever
  // attaches GitHub to the *already-authenticated* user; it never logs anyone in.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['github'],
      allowDifferentEmails: true,
    },
  },
  // "Continue with GitHub". Better Auth stores the GitHub access token in the
  // `account` table (providerId 'github', accessToken) and links it to the
  // `user`. We request `repo` so private merged PRs also count in the public
  // efficiency profile's real PR total; `read:user` + `user:email` are added
  // by the provider's default scope. The user's GitHub login + numeric id are
  // mapped onto the `user` row (see `user.additionalFields`) so the handle is
  // queryable and `/u/<github-login>` resolves.
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      scope: ['repo'],
      mapProfileToUser: (profile: { login: string; id: string | number }) => ({
        githubLogin: profile.login,
        githubId: String(profile.id),
      }),
    },
  },
  // Persist the GitHub login + id onto the `user` row. `input: false` keeps
  // them server-controlled (only the OAuth profile mapping can set them, never
  // a client sign-up payload); columns already exist in `auth-schema.ts`.
  user: {
    additionalFields: {
      githubLogin: { type: 'string', required: false, input: false },
      githubId: { type: 'string', required: false, input: false },
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
      async sendInvitationEmail(data) {
        const inviteUrl = `${baseURL}/invite/${data.id}`;

        if (resend) {
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'Orchid <noreply@orchidkeep.com>',
            to: data.email,
            subject: `Join ${data.organization.name} on Orchid`,
            html: `
              <p>${data.inviter.user.name} invited you to join <strong>${data.organization.name}</strong> on Orchid.</p>
              <p><a href="${inviteUrl}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:white;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
              <p style="color:#888;font-size:12px;">Or copy this link: ${inviteUrl}</p>
            `,
          });
        } else {
          console.log(`[orchid] Invitation email (no RESEND_API_KEY): ${inviteUrl}`);
        }
      },
    }),
  ],
});
