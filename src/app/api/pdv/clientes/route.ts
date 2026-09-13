import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'
import { validarCliente, validarAtualizacaoCliente } from '@/lib/pdv/payloadCliente'
import {
  escolherCliente, seguirMesclado, camposParaCompletar, type ClienteComparavel,
} from '@/lib/pdv/resolverCliente'

// A TABELA COM CPF SAI DE BAIXO DA CHAVE ANÔNIMA.
//
// ── O QUE FOI MEDIDO ─────────────────────────────────────────────────────
//
// Auditoria de 13/09/2026: com a chave `anon`, sem login nenhum, dá para ler
// 28.676 produtos (com `preco_custo`), 3.104 vendas e 103 clientes — estes
// últimos com `cpf_cnpj`. Dessas três tabelas, `clientes` é a única que dá
// para fechar por inteiro agora: `produtos` e `vendas` dependem do
// `registrarVenda`, que é a 0.6D e está pausada.
//
// Volume do que passa por aqui: 47 cadastros novos e 71 edições em 30 dias.
// Não é caminho quente; é caminho sensível.
//
// ── OS PONTOS QUE ESTA ROTA SUBSTITUI ────────────────────────────────────
//
//   _acharClienteRemoto      2 SELECTs, um deles baixando até 5.000 linhas
//   _seguirMesclado          1 SELECT por salto
//   registrarCliente         UPDATE + SELECT + INSERT
//   atualizarClienteEndereco UPDATE
//   sincronizarClientes      SELECT * paginado          → GET aqui
//   sincronizarClientesMesclados SELECT                 → GET em ./mesclados
//
// `atualizarCliente(remoteId, dados)` — um `.update(dados)` com o objeto
// inteiro do cliente — não ganhou rota: ele não tem chamador nenhum no PDV.
// Está sendo removido de lá, que é o que se faz com código morto que aceita
// escrita arbitrária numa tabela de dado pessoal.
//
// ── A DECISÃO QUE MUDA DE LADO ───────────────────────────────────────────
//
// "Este cliente já existe?" era respondida no terminal, baixando a lista da
// empresa inteira para comparar em JavaScript local. Agora é respondida aqui,
// ao lado do banco. A REGRA é a mesma, literalmente — mora em
// `resolverCliente.ts`, pura e testada, justamente porque divergir dela não
// dá erro visível: dá cadastro duplicado, como nos dois surtos de 07/08 (8
// cópias) e 24/08 (33 cópias).

/** Só o que a decisão precisa. Nada de `select('*')` numa tabela com CPF. */
const CAMPOS_DECISAO = 'id, nome, telefone, cpf_cnpj, mesclado_em'

/**
 * O que o PDV consome de fato — exatamente o que `mapCliente` lê no sync.js.
 *
 * NÃO ESTÁ AQUI: `endereco`. O `mapCliente` faz `c.logradouro || c.endereco`,
 * um fallback da época do Base44; o PDV nunca escreve essa coluna e o ERP web
 * nunca a lê. Se ela existir e ainda guardar o endereço de linhas antigas que
 * nunca passaram pela tela de entrega, essas linhas deixariam de receber
 * endereço no snapshot — hoje elas recebem, porque o legado usa `select('*')`.
 *
 * Não dá para decidir isso lendo código: depende do conteúdo da coluna. É item
 * de portão, com uma consulta só, ANTES de ligar a flag em qualquer terminal.
 * Se houver dado, acrescentar `endereco` aqui é uma linha.
 */
const CAMPOS_SNAPSHOT = [
  'id', 'nome', 'cpf_cnpj', 'telefone', 'whatsapp', 'email',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro',
  'cidade', 'estado', 'referencia', 'obs_entrega',
  'limite_credito', 'saldo_credito', 'saldo_devedor',
  'status_credito', 'permite_carteira', 'updated_at',
].join(', ')

const PAGINA = 500

type Sb = ReturnType<typeof createAdminClient>

/**
 * Do cadastro achado até o sobrevivente da unificação.
 *
 * A caminhada em si é a função pura `seguirMesclado`. Aqui só se HIDRATA o
 * mapa que ela consome: a lista da empresa cobre o caso normal, e os saltos
 * que saem dela (unificação entre empresas) são buscados um a um — que é o
 * que o PDV fazia para todos os saltos.
 *
 * O teto e a proteção contra ciclo estão na função pura, e valem para os dois
 * caminhos.
 */
async function hidratarCadeia(
  sb: Sb, inicio: ClienteComparavel, porId: Map<string, ClienteComparavel>,
): Promise<ClienteComparavel> {
  let atual = inicio
  for (let i = 0; i < 10; i++) {
    const alvo = atual.mesclado_em
    if (!alvo || porId.has(alvo)) break
    const { data } = await sb.from('clientes').select(CAMPOS_DECISAO).eq('id', alvo).maybeSingle()
    if (!data) break
    porId.set(data.id, data as ClienteComparavel)
    atual = data as ClienteComparavel
  }
  return seguirMesclado(inicio, porId)
}

// ── CADASTRO ─────────────────────────────────────────────────────────────
//
// A chave de idempotência é o `id` LOCAL do cliente, que `db.clientes.criar()`
// gera e grava no SQLite ANTES de qualquer envio — sobrevive a queda, timeout,
// fechamento, reinício e replay, porque nasce em disco e não em memória.
//
// Diferente de `faltas`, a chave NÃO vira o id da linha remota. Não pode: o
// resultado normal deste cadastro é reaproveitar um cliente que já existe, e
// forçar o id local nele seria criar a segunda linha que esta rota existe para
// impedir. A chave vive só em `pdv_operacoes`; o id remoto vem na resposta, e
// o replay devolve o MESMO id remoto da primeira vez.
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  return operacaoProtegida(req, {
    operacao: 'clientes.registrar',
    flagDaOperacao: 'clientes',
    corpo,
    executar: async (ctx) => {
      const v = validarCliente(corpo)
      if (!v.ok) throw new Error(v.erro)

      const sb = createAdminClient()

      // A lista da empresa, uma vez, para as duas perguntas: quem é este
      // cliente, e quem sobreviveu às unificações. O PDV fazia uma consulta
      // para a primeira e mais uma por salto na segunda.
      //
      // SEM filtro de `ativo`: um cadastro inativado ou já mesclado continua
      // sendo a mesma pessoa, e ignorá-lo é abrir a cópia.
      const { data: candidatos, error: erroLista } = await sb.from('clientes')
        .select(CAMPOS_DECISAO).eq('empresa_id', ctx.empresa_id).limit(5000)
      if (erroLista) throw new Error(erroLista.message)

      const lista = (candidatos ?? []) as ClienteComparavel[]
      const porId = new Map(lista.map((c) => [c.id as string, c]))

      const achado = escolherCliente(v.cliente, lista)

      if (achado) {
        const sobrevivente = await hidratarCadeia(sb, achado, porId)
        const alvo = String(sobrevivente.id)

        // Completa o que falta, nunca sobrescreve. Um lado vazio faz o par
        // voltar a parecer gente diferente na rodada seguinte.
        const completar = camposParaCompletar(sobrevivente, v.cliente)
        if (Object.keys(completar).length) {
          await sb.from('clientes').update(completar)
            .eq('id', alvo).eq('empresa_id', ctx.empresa_id)
        }

        return {
          cliente_id: alvo,
          ja_existia: true,
          mesclado: alvo !== String(achado.id),
          completado: Object.keys(completar),
        }
      }

      const { data, error } = await sb.from('clientes').insert({
        empresa_id: ctx.empresa_id,        // ← do token, nunca do corpo
        nome: v.cliente.nome,
        cpf_cnpj: v.cliente.cpf_cnpj,
        telefone: v.cliente.telefone,
        email: v.cliente.email,
        limite_credito: v.cliente.limite_credito,
        saldo_credito: v.cliente.saldo_credito,
        ativo: true,
      }).select('id').single()

      if (error) throw new Error(error.message)

      return { cliente_id: data.id, ja_existia: false, mesclado: false, completado: [] }
    },
  })
}

// ── EDIÇÃO ───────────────────────────────────────────────────────────────
//
// Contato e endereço de entrega, a lista fechada de `payloadCliente`. O que
// chega aqui é a mesma coisa que a fila manda hoje em `update_endereco`.
export async function PATCH(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  return operacaoProtegida(req, {
    operacao: 'clientes.atualizar',
    flagDaOperacao: 'clientes',
    corpo,
    executar: async (ctx) => {
      const clienteId = String(corpo?.cliente_id ?? '')
      if (!clienteId) throw new Error('cliente_id é obrigatório.')

      const v = validarAtualizacaoCliente(corpo)
      if (!v.ok) throw new Error(v.erro)

      const sb = createAdminClient()
      // O `.eq('empresa_id')` não é redundante com a autenticação: ele impede
      // que um terminal legítimo altere o cliente de outra empresa passando um
      // id que não é dele. Autenticar diz quem é; isto diz onde pode mexer.
      const { data, error } = await sb.from('clientes')
        .update(v.dados)
        .eq('id', clienteId)
        .eq('empresa_id', ctx.empresa_id)
        .select('id').maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new Error('Cliente não encontrado nesta empresa.')

      return { cliente_id: clienteId, campos: Object.keys(v.dados) }
    },
  })
}

// ── SNAPSHOT ─────────────────────────────────────────────────────────────
//
// O que o terminal baixa para ter os clientes offline. Mesma paginação e
// mesmo recorte incremental do legado (`updated_at >= ultimaSync`), e a mesma
// ordenação estável por (nome, id) — sem ela, paginar sobre uma tabela que
// recebe cadastro no meio pula linhas.
//
// `select('*')` virou lista explícita: é exatamente o que `mapCliente` lê no
// `sync.js`. O que o PDV não usa não sai do servidor.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde')
  const pagina = Math.max(0, Number(url.searchParams.get('pagina') ?? 0) || 0)

  return leituraProtegida(req, {
    flagDaOperacao: 'clientes',
    ler: async (ctx) => {
      const sb = createAdminClient()
      let q = sb.from('clientes').select(CAMPOS_SNAPSHOT)
        .eq('empresa_id', ctx.empresa_id)
        .eq('ativo', true)
        .order('nome').order('id')
        .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
      if (desde) q = q.gte('updated_at', desde)

      const { data, error } = await q
      if (error) throw new Error(error.message)

      const clientes = data ?? []
      return {
        clientes,
        pagina,
        // O PDV para quando a página vem incompleta — a mesma condição do
        // laço legado, dita pelo servidor para não ficar duplicada nos dois.
        tem_mais: clientes.length === PAGINA,
      }
    },
  })
}
