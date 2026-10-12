import { enviarWhatsappAutomacao } from './whatsapp-send'
import type { ResultadoExecucao } from './tipos'
import { montarAvisoChegada, telefoneAvisavel } from '@/lib/faltas/avisoChegada'

// AVISO AO CLIENTE: A FALTA CHEGOU.
//
// A falta/encomenda com cliente vira 'recebido' sozinha quando o produto volta
// ao estoque (nota, ajuste, inventário, transferência — trigger
// faltas_baixa_por_entrada) ou quando alguém marca "Chegou". O banco anota
// `chegou_em`; esta regra, a cada passada do cron, manda o WhatsApp.
//
//   · uma mensagem por falta (aviso_whatsapp_em);
//   · até 3 tentativas se a Z-API falhar — depois disso fica para o vendedor,
//     com o erro visível na lista de faltas;
//   · só o que chegou DEPOIS de a regra ser criada: ligar a regra não manda
//     mensagem para encomenda antiga;
//   · sem telefone válido, não tenta — a falta continua em "Chegou" para o
//     balcão avisar.

/* eslint-disable @typescript-eslint/no-explicit-any */

const POR_RODADA = 20
const MAX_TENTATIVAS = 3

export async function executarAvisoFaltaChegou(sb: any, a: any): Promise<ResultadoExecucao> {
  const { data: faltas, error } = await sb.from('faltas')
    .select('id, produto_nome, cliente_nome, cliente_telefone, aviso_whatsapp_tentativas')
    .eq('empresa_id', a.empresa_id)
    .eq('status', 'recebido')
    .is('aviso_whatsapp_em', null)
    .not('chegou_em', 'is', null)
    .gte('chegou_em', a.created_at)
    .lt('aviso_whatsapp_tentativas', MAX_TENTATIVAS)
    .order('chegou_em')
    .limit(POR_RODADA)
  if (error) return { status: 'erro', erro: error.message }

  const pendentes = (faltas ?? []).filter((f: any) => telefoneAvisavel(f.cliente_telefone))
  if (pendentes.length === 0) return { status: 'sem_acao' }

  const { data: emp } = await sb.from('empresas').select('nome, nome_fantasia').eq('id', a.empresa_id).maybeSingle()
  const loja = emp?.nome_fantasia || emp?.nome || ''

  let enviados = 0
  let ultimoErro = ''
  for (const f of pendentes) {
    const mensagem = montarAvisoChegada(a.mensagem_modelo, { nome: f.cliente_nome, produto: f.produto_nome, loja })
    const r = await enviarWhatsappAutomacao(sb, a.empresa_id, telefoneAvisavel(f.cliente_telefone)!, mensagem, {
      tipo: a.tipo, cliente_nome: f.cliente_nome ?? null, referencia_tipo: 'falta', referencia_id: f.id,
    })
    if (r.ok) {
      enviados++
      await sb.from('faltas').update({ aviso_whatsapp_em: new Date().toISOString(), aviso_whatsapp_erro: null }).eq('id', f.id)
    } else {
      ultimoErro = r.erro ?? 'Falha no envio'
      await sb.from('faltas').update({
        aviso_whatsapp_tentativas: Number(f.aviso_whatsapp_tentativas ?? 0) + 1,
        aviso_whatsapp_erro: ultimoErro,
      }).eq('id', f.id)
    }
  }

  if (enviados > 0) return { status: 'ok' }
  return { status: 'erro', erro: ultimoErro }
}
