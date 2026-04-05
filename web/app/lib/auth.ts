import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { Resend } from 'resend';
import { db } from './db';
import * as schema from './schema';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const baseURL = process.env.BETTER_AUTH_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

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
