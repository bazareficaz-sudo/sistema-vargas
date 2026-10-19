import { chaveTelefone, semMarca } from './contatos'
import { guardarMidia } from './midias'

// Mensagem que a loja mandou PELO CELULAR (a Z-API só avisa se "notificar as
// enviadas por mim" estiver ligado na instância). Entra no histórico da
// conversa para ela ficar completa. Nunca duplica o que o próprio sistema
// enviou: a Z-API também avisa essas, com o mesmo messageId.

type Admin = { from: (t: string) => any; storage: { from: (b: string) => any }; rpc: (fn: string, args: Record<string, unknown>) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function registrarEnviadaPeloCelular(admin: Admin, empresaId: string, dados: { telefone: string; texto: string; messageId: string | null; midiaUrl?: string | null; respostaA?: string | null; lid?: string | null }) {
  // Só conversa com contato (cliente procurou a loja): resposta para o dono,
  // fornecedor ou grupo não entra.
  const chave = chaveTelefone(dados.telefone) ?? `x${dados.telefone.replace(/\D/g, '')}`
  let { data: contato } = await admin.from('whatsapp_contatos').select('id').eq('empresa_id', empresaId).eq('chave', chave).maybeSingle()
  // Mandada para o código oculto de quem já tem contato pelo número: é esse.
  // (18/10/2026: as respostas pelo celular para a Fatima Brandao caíam numa
  // segunda conversa, "7674…@lid".)
  if (!contato && dados.lid) {
    ({ data: contato } = await admin.from('whatsapp_contatos').select('id').eq('empresa_id', empresaId).eq('lid', dados.lid).maybeSingle())
  }
  if (!contato) return
  // Número e código na mesma mensagem: liga os dois.
  if (dados.lid && chaveTelefone(dados.telefone)) await admin.rpc('whatsapp_ligar_lid', { p_contato: contato.id, p_lid: dados.lid })

  // O envio pelo sistema grava o messageId logo depois da resposta da Z-API;
  // o aviso pode chegar antes. Espera um pouco e confere.
  await pausa(5000)
  if (dados.messageId) {
    const { data: ja } = await admin.from('whatsapp_mensagens').select('id').eq('empresa_id', empresaId).eq('zapi_message_id', dados.messageId).limit(1)
    if (ja?.length) return
  }
  // Foto enviada pelo sistema volta como "[foto] legenda"; o sistema gravou
  // só a legenda. Confere as duas formas.
  const recente = new Date(Date.now() - 3 * 60_000).toISOString()
  const textos = [...new Set([dados.texto, semMarca(dados.texto)].filter(Boolean))]
  const { data: igual } = await admin.from('whatsapp_mensagens').select('id')
    .eq('empresa_id', empresaId).eq('contato_id', contato.id).neq('tipo', 'recebida').in('conteudo', textos).gte('created_at', recente).limit(1)
  if (igual?.length) return

  const agora = new Date().toISOString()
  const { data: nova } = await admin.from('whatsapp_mensagens').insert({
    empresa_id: empresaId, contato_id: contato.id, telefone: dados.telefone, tipo: 'enviada_celular',
    conteudo: dados.texto, conteudo_pdf_url: dados.midiaUrl ?? null,
    status: 'enviado', zapi_message_id: dados.messageId, enviado_em: agora, operador_nome: 'Celular',
    ...(dados.respostaA ? { resposta_a: dados.respostaA } : {}),
  }).select('id').single()
  if (nova?.id && dados.midiaUrl) await guardarMidia(admin, { empresaId, contatoId: contato.id, mensagemId: nova.id, url: dados.midiaUrl })
}
