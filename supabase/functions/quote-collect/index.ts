import { createCollector } from './handler.mjs';

const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
Deno.serve(createCollector({
  supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
  serviceRoleKey: secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  publishableKey: publishableKeys.default || Deno.env.get('SUPABASE_ANON_KEY') || '',
  allowedOrigin: 'https://felicialiu14.github.io'
}));
