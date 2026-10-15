import { chaveTelefone } from './contatos'

// Mensagem que a loja mandou PELO CELULAR (a Z-API só avisa se "notificar as
// enviadas por mim" estiver ligado na instância). Entra no histórico da
// conversa para ela ficar completa. Nunca duplica o que o próprio sistema
// enviou: a Z-API também avisa essas, com o mesmo messageId.

type Admin = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function registrarEnviadaPeloCelular(admin: Admin, empresaId: string, dados: { telefone: string; texto: string; messageId: string | null }) {
  // Só conversa com contato (cliente procurou a loja): resposta para o dono,
  // fornecedor ou grupo não entra.
  const chave = chaveTelefone(dados.telefone) ?? `x${dados.telefone.replace(/\D/g, '')}`
  const { data: contato } = await admin.from('whatsapp_contatos').select('id').eq('empresa_id', empresaId).eq('chave', chave).maybeSingle()
  if (!contato) return

  // O envio pelo sistema grava o messageId logo depois da resposta da Z-API;
  // o aviso pode chegar antes. Espera um pouco e confere.
  await pausa(5000)
  if (dados.messageId) {
    const { data: ja } = await admin.from('whatsapp_mensagens').select('id').eq('empresa_id', empresaId).eq('zapi_message_id', dados.messageId).limit(1)
    if (ja?.length) return
  }
  const recente = new Date(Date.now() - 3 * 60_000).toISOString()
  const { data: igual } = await admin.from('whatsapp_mensagens').select('id')
    .eq('empresa_id', empresaId).eq('contato_id', contato.id).neq('tipo', 'recebida').eq('conteudo', dados.texto).gte('created_at', recente).limit(1)
  if (igual?.length) return

  const agora = new Date().toISOString()
  await admin.from('whatsapp_mensagens').insert({
    empresa_id: empresaId, contato_id: contato.id, telefone: dados.telefone, tipo: 'enviada_celular',
    conteudo: dados.texto, status: 'enviado', zapi_message_id: dados.messageId, enviado_em: agora, operador_nome: 'Celular',
  })
}
