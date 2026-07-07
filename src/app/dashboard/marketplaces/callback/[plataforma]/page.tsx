import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Esta página recebe o redirect do marketplace e repassa para a API route correspondente
export default async function CallbackPage({
  params, searchParams,
}: {
  params: Promise<{ plataforma: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const { plataforma } = await params
  const sp = await searchParams

  // Monta query string para repassar à API route
  const qs = new URLSearchParams(sp).toString()
  redirect(`/api/marketplace/${plataforma}/callback?${qs}`)
}
