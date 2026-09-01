import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export type ProvedorComSegredo = 'anthropic' | 'openai'

function chaveMestra() {
  const origem = process.env.IA_CREDENTIALS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!origem) throw new Error('chave_mestra_ia_ausente')
  return createHash('sha256').update(origem).digest()
}

export function cifrarSegredo(valor: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', chaveMestra(), iv)
  const conteudo = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), conteudo.toString('base64url')].join('.')
}

export function decifrarSegredo(valor: string) {
  const [versao, iv, tag, conteudo] = valor.split('.')
  if (versao !== 'v1' || !iv || !tag || !conteudo) throw new Error('segredo_ia_invalido')
  const decipher = createDecipheriv('aes-256-gcm', chaveMestra(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(conteudo, 'base64url')), decipher.final()]).toString('utf8')
}

export async function obterSegredoProvedor(provedor: ProvedorComSegredo) {
  const variavel = provedor === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  if (variavel) return variavel
  const { data, error } = await createAdminClient().from('ia_provedor_segredos')
    .select('segredo_cifrado').eq('provedor', provedor).maybeSingle()
  if (error || !data?.segredo_cifrado) return null
  try { return decifrarSegredo(data.segredo_cifrado) } catch { return null }
}

