import { createClient } from '@supabase/supabase-js'

// Cliente com service role — só para rotinas de sistema (cron, jobs em
// background) que não têm sessão de usuário logado. A chave dá acesso total
// ao banco, ignorando RLS — nunca importar isto em código que roda no browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
