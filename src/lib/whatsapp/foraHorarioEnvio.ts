import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'
import { numeroOculto } from './contatos'
import { hojeNaLoja } from './conversas'
import { descreverHorario, horarioValido, lojaAberta, mensagemForaHorario } from './foraHorario'

// Envio da resposta fora do horário (só servidor; regras em foraHorario.ts).

type Admin = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Chamado pelo webhook (depois do 200) para cada mensagem recebida de um contato. */
export async function responderForaDoHorario(admin: Admin, empresaId: string, c: {
  contatoId: string; telefone: string; clienteId: string | null; clienteNome: string | null; nome: string | null
}, agora: Date = new Date()): Promise<'enviado' | 'aberta' | 'desligado' | 'ja_respondido' | 'atendendo' | 'pulado' | 'erro'> {
  if (numeroOculto(c.telefone)) return 'pulado'
  // Colunas novas: sem a migração, o select falha e nada acontece.
  const { data: cfg, error } = await admin.from('whatsapp_config')
    .select('ativo, fora_horario_ativo, fora_horario_mensagem, horario_semana').eq('empresa_id', empresaId).maybeSingle()
  if (error || !cfg?.ativo || !cfg.fora_horario_ativo) return 'desligado'
  const semana = horarioValido(cfg.horario_semana)
  if (!semana) return 'desligado'
  if (lojaAberta(semana, agora)) return 'aberta'

  const { data: contato } = await admin.from('whatsapp_contatos').select('ultima_saida_em, fora_horario_dia, status').eq('id', c.contatoId).maybeSingle()
  if (!contato || contato.status === 'ignorado') return 'pulado'
  if (contato.ultima_saida_em && agora.getTime() - new Date(contato.ultima_saida_em).getTime() < 30 * 60_000) return 'atendendo'

  // Marca o dia antes de enviar: só uma mensagem ganha.
  const hoje = hojeNaLoja(agora)
  const { data: marcado } = await admin.from('whatsapp_contatos').update({ fora_horario_dia: hoje })
    .eq('id', c.contatoId).or(`fora_horario_dia.is.null,fora_horario_dia.neq.${hoje}`).select('id')
  if (!marcado?.length) return 'ja_respondido'

  const { data: empresa } = await admin.from('empresas').select('nome, nome_fantasia').eq('id', empresaId).maybeSingle()
  const texto = mensagemForaHorario(cfg.fora_horario_mensagem, {
    nome: c.clienteNome || c.nome, loja: empresa?.nome_fantasia || empresa?.nome || '', horario: descreverHorario(semana),
  })
  const r = await enviarWhatsappAutomacao(admin, empresaId, c.telefone, texto, {
    tipo: 'fora_horario', cliente_id: c.clienteId, cliente_nome: c.clienteNome,
  })
  // Resultado desconhecido não é reenviado; erro fica registrado na mensagem.
  return r.ok ? 'enviado' : 'erro'
}
