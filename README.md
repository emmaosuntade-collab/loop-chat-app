# Loop setup

Loop uses Supabase for accounts, friend invitations, and real-time chat. The Supabase Free plan includes database and Realtime quotas for a small app. Accounts use email/password; phone numbers identify invitees, so this setup does not send paid SMS verification codes.

## Connect a free Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run `supabase/schema.sql`.
3. In Project Settings, copy the Project URL and the publishable/anon key into `supabase-config.js` as `url` and `publicKey`.
4. In Authentication settings, allow email/password sign-up. For live invite links, add the deployed site URL to the allowed redirect URLs.
5. Deploy this folder to a static HTTPS host. A `file://` link or `localhost` address cannot be opened by a friend on another device.

Only use the public publishable/anon key in `supabase-config.js`. Never put a service-role key in browser code.

The free Supabase project can pause after a week of inactivity. Phone-number matching is not phone verification; enabling SMS OTP would require an SMS provider and may cost extra.