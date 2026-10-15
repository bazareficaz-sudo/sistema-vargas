import { zapiContatoMetadata, type ZAPIConfig } from '@/lib/zapi'
import { nomeDoMetadata, numeroOculto } from './contatos'

// Nome do WhatsApp para contato que chegou sem ele (carga do histórico, que
// não guardava nome, ou mensagem sem `senderName`). Só leitura na Z-API.

type Admin = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

export function configZapi(cfg: { instance_id?: string | null; token?: string | null; client_token?: string | null; url_base?: string | null } | null): ZAPIConfig | null {
  return cfg?.instance_id && cfg?.token
    ? { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base }
    : null
}

/** Um contato: grava o nome se a Z-API souber e o contato ainda estiver sem. */
export async function preencherNomeDoContato(admin: Admin, config: ZAPIConfig, contatoId: string, telefone: string): Promise<'preenchido' | 'sem_nome' | 'erro'> {
  if (numeroOculto(telefone)) return 'sem_nome'
  const r = await zapiContatoMetadata(config, telefone)
  if (!r.ok) return 'erro'
  const nome = nomeDoMetadata(r.dados)
  // Sem nome no WhatsApp: grava vazio ('') para não consultar de novo. A
  // próxima mensagem com nome do remetente ainda preenche (função do banco).
  const { error } = await admin.from('whatsapp_contatos')
    .update({ nome_whatsapp: nome ?? '', updated_at: new Date().toISOString() })
    .eq('id', contatoId).is('nome_whatsapp', null)
  if (error) return 'erro'
  return nome ? 'preenchido' : 'sem_nome'
}

/**
 * Lote dos contatos sem nome (os mais recentes primeiro). Para no primeiro
 * erro seguido de outro: instância fora do ar não precisa de 40 tentativas.
 */
export async function preencherNomes(admin: Admin, empresaId: string, config: ZAPIConfig, limite = 40) {
  const { data, error } = await admin.from('whatsapp_contatos')
    .select('id, telefone')
    .eq('empresa_id', empresaId).is('nome_whatsapp', null).not('chave', 'like', 'x%')
    .order('ultima_em', { ascending: false }).limit(limite)
  if (error) return { consultados: 0, preenchidos: 0, semNome: 0, erros: 1, restantes: null as number | null }
  let preenchidos = 0, semNome = 0, erros = 0, seguidos = 0, consultados = 0
  for (const c of (data ?? []) as { id: string; telefone: string }[]) {
    if (consultados) await pausa(300)
    consultados++
    const r = await preencherNomeDoContato(admin, config, c.id, c.telefone)
    if (r === 'preenchido') { preenchidos++; seguidos = 0 }
    else if (r === 'sem_nome') { semNome++; seguidos = 0 }
    else { erros++; if (++seguidos >= 2) break }
  }
  const { count } = await admin.from('whatsapp_contatos').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).is('nome_whatsapp', null).not('chave', 'like', 'x%')
  return { consultados, preenchidos, semNome, erros, restantes: count ?? null }
}
