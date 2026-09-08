import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'
import { validarFalta, validarAtualizacaoFalta } from '@/lib/pdv/payloadFalta'

// PRIMEIRA OPERAÇÃO DE NEGÓCIO ATRÁS DA IDENTIDADE DO TERMINAL.
//
// `faltas` é o registro de "cliente pediu, não tinha". Sem efeito financeiro,
// sem estoque, fora do caminho da venda — auditado no código, não presumido:
// `registrarFalta` não é chamada de lugar nenhum dentro de `registrarVenda`.
//
// ── POR QUE ELA, E O QUE ISTO CONSERTA ───────────────────────────────────
//
// O caminho legado tem dois defeitos reais, e os dois somem aqui:
//
//   DUPLICAÇÃO. `api.registrarFalta` gera um `uuidv4()` NOVO a cada envio.
//   Servidor grava, resposta se perde, `remote_id` não é salvo, o guard
//   `!falta.remote_id` não protege — e o retry insere uma segunda linha.
//
//   PERDA. Depois de 5 tentativas, `sync.js` marca o item como processado
//   "para não travar a fila". O registro desaparece sem ninguém saber.
//
// A chave aqui é o `id` LOCAL da falta, que o PDV já gera em
// `db.faltas.registrar()` e grava no SQLite ANTES de qualquer envio. Ele
// sobrevive a queda, timeout, fechamento, reinício e replay — porque nasce em
// disco, não em memória. É a mesma chave na primeira tentativa e na décima.
//
// ── O QUE ESTA FASE NÃO FAZ ──────────────────────────────────────────────
//
// Não redesenha o módulo. Campos, defaults e o significado de "falta" e
// "encomenda" são os de hoje. Muda o transporte e a autorização, nada mais.

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  return operacaoProtegida(req, {
    operacao: 'faltas.registrar',
    // A flag consultada é a desta operação. Ligar `faltas` no Caixa não liga
    // mais nada — nem hoje, nem quando existirem outras rotas.
    flagDaOperacao: 'faltas',
    corpo,
    executar: async (ctx) => {
      const v = validarFalta(corpo)
      if (!v.ok) throw new Error(v.erro)

      // O id da linha remota É a chave de idempotência, que é o id local da
      // falta. Assim o retry não pode criar outra linha nem por acidente: a
      // chave primária o impede, além da trava em `pdv_operacoes`.
      const id = String(corpo?.idempotency_key ?? '')

      const sb = createAdminClient()
      const { error } = await sb.from('faltas').insert({
        id,
        empresa_id: ctx.empresa_id,        // ← do token, nunca do corpo
        produto_id: v.falta.produto_id,
        produto_nome: v.falta.produto_nome,
        produto_sku: v.falta.produto_sku,
        cliente_nome: v.falta.cliente_nome,
        cliente_telefone: v.falta.cliente_telefone,
        quantidade_solicitada: v.falta.quantidade_solicitada,
        observacao: v.falta.observacao,
        status: v.falta.status,
        origem: v.falta.origem,
        usuario_nome: v.falta.usuario_nome,
        tipo: v.falta.tipo,
        prazo_desejado: v.falta.prazo_desejado,
        preco_negociado: v.falta.preco_negociado,
        // Passa a ser o UUID do terminal. O `terminal_id` legado do corpo é
        // ignorado para qualquer efeito — inclusive este.
        terminal_id: ctx.terminal_id,
      })

      // 23505 = a linha já existe, de uma tentativa anterior cuja resposta se
      // perdeu. É sucesso, não erro: o efeito pedido já está no banco, e é
      // exatamente um.
      if (error && error.code !== '23505') throw new Error(error.message)

      return { falta_id: id, ja_existia: error?.code === '23505' }
    },
  })
}

/** Atualização — hoje a fila só sincroniza `status`, mas a rota aceita o par documentado. */
export async function PATCH(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  return operacaoProtegida(req, {
    operacao: 'faltas.atualizar',
    flagDaOperacao: 'faltas',
    corpo,
    executar: async (ctx) => {
      const faltaId = String(corpo?.falta_id ?? '')
      if (!faltaId) throw new Error('falta_id é obrigatório.')

      const v = validarAtualizacaoFalta(corpo)
      if (!('dados' in v)) throw new Error(v.ok ? 'Nada para atualizar.' : v.erro)

      const sb = createAdminClient()
      // O `.eq('empresa_id')` não é redundante com a autenticação: ele impede
      // que um terminal legítimo altere uma falta de outra empresa passando um
      // id que não é dele. Autenticar diz quem é; isto diz onde pode mexer.
      const { data, error } = await sb.from('faltas')
        .update(v.dados)
        .eq('id', faltaId)
        .eq('empresa_id', ctx.empresa_id)
        .select('id').maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new Error('Falta não encontrada nesta empresa.')

      return { falta_id: faltaId }
    },
  })
}
