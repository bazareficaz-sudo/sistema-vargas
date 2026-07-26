// Publica ou atualiza um post do blog direto no banco, usando a service role key.
// Uso: node scripts/publicar-post.mjs caminho/para/post.json
//
// O JSON deve ter: titulo, slug, resumo, conteudo, categoria, publicado, destaque, autor
// (categoria: novidade | atualizacao | manutencao | dica)
// publicado_em é opcional (ISO 8601) — se omitido, usa o momento da publicação.
//
// Faz upsert por slug: se o slug já existir, atualiza o post existente.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Carrega .env.local sem depender do pacote dotenv (não é dependência do projeto)
function loadEnvLocal() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const text = readFileSync(envPath, 'utf-8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env.local')
  process.exit(1)
}

const jsonPath = process.argv[2]
if (!jsonPath) {
  console.error('Uso: node scripts/publicar-post.mjs caminho/para/post.json')
  process.exit(1)
}

const post = JSON.parse(readFileSync(jsonPath, 'utf-8'))

if (!post.titulo || !post.slug) {
  console.error('O JSON precisa ter pelo menos "titulo" e "slug"')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const payload = {
  titulo: post.titulo,
  slug: post.slug,
  resumo: post.resumo ?? '',
  conteudo: post.conteudo ?? '',
  capa_url: post.capa_url ?? null,
  categoria: post.categoria ?? 'novidade',
  publicado: post.publicado ?? true,
  destaque: post.destaque ?? false,
  autor: post.autor ?? 'Equipe Vargas',
  updated_at: new Date().toISOString(),
  ...(post.publicado !== false ? { publicado_em: post.publicado_em ?? new Date().toISOString() } : {}),
}

const { data, error } = await supabase
  .from('blog_posts')
  .upsert(payload, { onConflict: 'slug' })
  .select('id, slug, publicado')
  .single()

if (error) {
  console.error('Erro ao publicar post:', error.message)
  process.exit(1)
}

console.log(`✔ Post "${data.slug}" salvo (id: ${data.id}, publicado: ${data.publicado})`)
