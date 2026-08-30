import { db } from './db'
import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'
import { brl } from './precos'
import { PAGAMENTO_LABEL } from './pedido'
import type { Loja } from './tipos'

// Aviso de pedido novo, por WhatsApp.
//
// Reaproveita `enviarWhatsappAutomacao`, que as automações já usam: ele
// resolve `whatsapp_config`, respeita `opt_out_whatsapp`, registra em
// `whatsapp_mensagens` e chama a Z-API. Um segundo caminho de envio seria um
// segundo lugar para esquecer o opt-out — e o opt-out é obrigação legal, não
// preferência de produto.
//
// ── A regra que governa este arquivo ──────────────────────────
//
// FALHAR AQUI NÃO PODE DERRUBAR O PEDIDO. O pedido já existe, o estoque já
// está reservado e o cliente já viu a confirmação. Se a Z-API estiver fora do
// ar, a loja perde o aviso — e vê o pedido na tela de Pedidos, que continua
// sendo a fonte da verdade. Deixar a exceção subir transformaria uma
// indisponibilidade da Z-API em venda perdida.
//
// Por isso tudo aqui devolve, nunca estoura, e o erro vai para o log com o
// número do pedido, que é o que permite achar depois.

/** Só dígitos, com 55 na frente — o formato que a Z-API espera. */
function paraZap(telefone: string | null | undefined): string | null {
  const n = (telefone ?? '').replace(/\D/g, '')
  if (n.length < 10) return null
  return n.startsWith('55') ? n : `55${n}`
}

type ItemAviso = { nome: string; quantidade: number; subtotal: number }

/** A linha crua de `marketplace_pedidos`, antes de virar a mensagem. */
type LinhaAviso = {
  numero_pedido: string
  cliente_nome: string | null
  valor_total: number | string | null
  status_externo: string | null
  observacoes: string | null
  entrega_logradouro: string | null
  entrega_numero: string | null
  entrega_bairro: string | null
  entrega_cidade: string | null
  entrega_estado: string | null
  dados_brutos: Record<string, unknown> | null
  marketplace_pedido_itens: {
    nome_produto: string | null
    quantidade: number | string | null
    subtotal: number | string | null
  }[] | null
}

type Pedido = {
  numero: string
  clienteNome: string
  clienteTelefone: string | null
  clienteId: string | null
  total: number
  modo: 'entrega' | 'retirada'
  pagamento: string
  endereco: string | null
  observacao: string | null
  itens: ItemAviso[]
}

/** Lista de itens, com teto — 40 itens no WhatsApp viram uma parede de texto. */
function linhasItens(itens: ItemAviso[]): string {
  const LIMITE = 15
  const linhas = itens.slice(0, LIMITE).map(i => `• ${i.quantidade}x ${i.nome} — ${brl(i.subtotal)}`)
  if (itens.length > LIMITE) linhas.push(`• ...e mais ${itens.length - LIMITE} item(ns)`)
  return linhas.join('\n')
}

/** O que a LOJA recebe. Tudo que ela precisa para atender sem abrir o sistema. */
export function mensagemParaLoja(p: Pedido): string {
  const partes = [
    `*Pedido novo na loja — ${p.numero}*`,
    '',
    `*Cliente:* ${p.clienteNome}`,
  ]
  if (p.clienteTelefone) partes.push(`*WhatsApp:* ${p.clienteTelefone}`)
  partes.push('', linhasItens(p.itens), '', `*Total: ${brl(p.total)}*`)
  partes.push(
    p.modo === 'retirada'
      ? '*Retirada na loja*'
      : `*Entrega:* ${p.endereco ?? 'endereço no sistema'}`)
  // "a combinar" escrito aqui também: quem lê o aviso precisa saber que não
  // entrou dinheiro nenhum, senão separa o pedido achando que está pago.
  partes.push(`*Pagamento:* ${PAGAMENTO_LABEL[p.pagamento] ?? p.pagamento} (a combinar — nada foi cobrado)`)
  if (p.observacao) partes.push('', `*Observação:* ${p.observacao}`)
  return partes.join('\n')
}

/** O que o CLIENTE recebe. Confirma e diz o que vem a seguir. */
export function mensagemParaCliente(p: Pedido, nomeLoja: string): string {
  const primeiro = p.clienteNome.split(' ')[0] || ''
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}! Recebemos seu pedido *${p.numero}* na ${nomeLoja}.`,
    '',
    linhasItens(p.itens),
    '',
    `*Total: ${brl(p.total)}*`,
    '',
    p.modo === 'retirada'
      ? 'Vamos confirmar a separação e combinar o horário de retirada por aqui.'
      : 'Vamos confirmar a separação e combinar o valor e o prazo da entrega por aqui.',
    'O pagamento é feito na ' + (p.modo === 'retirada' ? 'retirada' : 'entrega') + '.',
  ].join('\n')
}

/**
 * Monta e envia os avisos do pedido.
 *
 * Lê o pedido do banco em vez de receber os dados da tela: é o que garante
 * que o aviso diz o preço que foi REGISTRADO, e não o que estava na tela do
 * cliente. Se os dois divergirem, a divergência é o defeito — e o aviso não
 * pode ajudar a escondê-la.
 */
export async function notificarPedido(loja: Loja, numero: string): Promise<void> {
  try {
    if (!loja.notificarLoja && !loja.notificarCliente) return

    const sb = db()
    const { data } = await sb
      .from('marketplace_pedidos')
      .select('numero_pedido, cliente_nome, valor_total, status_externo, observacoes, entrega_logradouro, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado, dados_brutos, marketplace_pedido_itens(nome_produto, quantidade, subtotal)')
      .eq('canal_id', loja.canalId)
      .eq('numero_pedido', numero)
      .maybeSingle()

    if (!data) return
    const d = data as LinhaAviso
    const bruto = d.dados_brutos ?? {}

    const p: Pedido = {
      numero: String(d.numero_pedido),
      clienteNome: String(d.cliente_nome ?? ''),
      clienteTelefone: (bruto.telefone as string) ?? null,
      clienteId: (bruto.cliente_id as string) ?? null,
      total: Number(d.valor_total ?? 0),
      modo: d.status_externo === 'retirada' ? 'retirada' : 'entrega',
      pagamento: String(bruto.pagamento_forma ?? 'pix'),
      endereco: [
        [d.entrega_logradouro, d.entrega_numero].filter(Boolean).join(', '),
        d.entrega_bairro,
        [d.entrega_cidade, d.entrega_estado].filter(Boolean).join('/'),
      ].filter(Boolean).join(' — ') || null,
      observacao: d.observacoes ?? null,
      itens: (d.marketplace_pedido_itens ?? []).map(i => ({
        nome: String(i.nome_produto ?? ''),
        quantidade: Number(i.quantidade ?? 0),
        subtotal: Number(i.subtotal ?? 0),
      })),
    }

    // ── Aviso da loja ──────────────────────────────────────
    if (loja.notificarLoja) {
      const destino = paraZap(loja.notificarNumero ?? loja.whatsapp)
      if (destino) {
        // Sem `cliente_id`: o destino é a própria loja, e passar o cliente
        // faria o opt-out DELE calar um aviso INTERNO.
        const r = await enviarWhatsappAutomacao(sb, loja.empresaId, destino, mensagemParaLoja(p), {
          tipo: 'loja_pedido_novo',
          referencia_tipo: 'loja_pedido',
          referencia_id: p.numero,
        })
        if (!r.ok) console.error('[loja] aviso da loja não saiu', { numero: p.numero, erro: r.erro })
      }
    }

    // ── Confirmação para o cliente ─────────────────────────
    if (loja.notificarCliente) {
      const destino = paraZap(p.clienteTelefone)
      if (destino) {
        // Aqui o `cliente_id` VAI: é mensagem para terceiro, e o opt-out dele
        // tem de valer.
        const r = await enviarWhatsappAutomacao(sb, loja.empresaId, destino,
          mensagemParaCliente(p, loja.nome), {
            tipo: 'loja_pedido_confirmacao',
            cliente_id: p.clienteId,
            cliente_nome: p.clienteNome,
            referencia_tipo: 'loja_pedido',
            referencia_id: p.numero,
          })
        if (!r.ok) console.error('[loja] confirmação ao cliente não saiu', { numero: p.numero, erro: r.erro })
      }
    }
  } catch (e) {
    // Ver o cabeçalho: o pedido já existe. Um aviso que não saiu é um
    // incômodo; uma exceção aqui seria uma venda perdida.
    console.error('[loja] notificação falhou', { numero, erro: e instanceof Error ? e.message : e })
  }
}
