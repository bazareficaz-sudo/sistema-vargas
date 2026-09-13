// O QUE UM PDV PODE DIZER SOBRE UM CLIENTE — e nada além disso.
//
// O caminho legado tem `atualizarCliente(remoteId, dados)` e
// `atualizarClienteEndereco(remoteId, dados)`; o primeiro repassa o objeto
// INTEIRO para um `.update(dados)`. Com a chave `anon`, isso é o binário
// distribuído escolhendo o que gravar na tabela que guarda CPF — inclusive
// `limite_credito`, `saldo_devedor`, `mesclado_em` e `empresa_id`.
//
// (O `atualizarCliente` genérico não tem nenhum chamador no PDV. Está sendo
// removido junto com esta migração, em vez de ganhar uma rota.)
//
// Aqui as listas são fechadas e separadas por operação: o que se pode dizer
// ao CRIAR não é o que se pode dizer ao EDITAR. Campo fora da lista é
// ignorado, não é erro — um PDV mais novo mandando campo que este servidor
// ainda não conhece deve funcionar, não quebrar.
//
// ESTA FASE NÃO REDESENHA O CADASTRO. Campos e defaults são os de hoje; muda
// o transporte, a autorização e onde a decisão de "é a mesma pessoa" roda.

export type ClienteEntrada = {
  nome: string
  cpf_cnpj: string | null
  telefone: string | null
  email: string | null
  limite_credito: number
  saldo_credito: number
}

/** Texto aparado, limitado, ou nulo. Vazio vira nulo — não string vazia. */
function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function numero(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function validarCliente(
  corpo: Record<string, unknown>,
): { ok: true; cliente: ClienteEntrada } | { ok: false; erro: string } {
  const nome = texto(corpo?.nome, 200)
  if (!nome) return { ok: false, erro: 'nome é obrigatório.' }

  return {
    ok: true,
    cliente: {
      nome,
      // Gravado COMO VEIO, igual ao legado — inclusive com máscara. Não é
      // descuido: normalizar aqui mudaria o que está na coluna hoje, e isso
      // é assunto do ERP, não de uma troca de transporte.
      //
      // A busca não depende disso. A varredura por nome compara os dois lados
      // com `soDigitos`, então "123.456.789-00" e "12345678900" se reconhecem
      // mesmo que a consulta direta por igualdade não os encontre.
      cpf_cnpj: texto(corpo?.cpf_cnpj, 20),
      telefone: texto(corpo?.telefone, 30),
      email: texto(corpo?.email, 200),
      // Passam porque o INSERT legado os mandava, e esta fase troca o
      // transporte sem mudar o que é gravado. Num cadastro de balcão eles
      // chegam 0; diferente de 0 só acontece quando a linha local veio de uma
      // descida do próprio ERP.
      //
      // REGISTRADO, NÃO RESOLVIDO: quem concede limite de crédito é o ERP, e
      // a rota não tem como distinguir "0 de cliente novo" de "0 porque o
      // terminal está com cache velho". Tratar isso é decisão de produto, não
      // de migração — fica fora desta fase de propósito. Na EDIÇÃO eles já
      // não existem: a lista de campos editáveis abaixo não os inclui.
      limite_credito: numero(corpo?.limite_credito),
      saldo_credito: numero(corpo?.saldo_credito),
    },
  }
}

// ── EDIÇÃO ───────────────────────────────────────────────────────────────
//
// Exatamente os campos que `ipcMain.handle('clientes:atualizarEndereco')` e a
// fila (`update_endereco`) mandam hoje, e nenhum a mais. Contato e entrega.
//
// `nome` e `cpf_cnpj` NÃO entram: mudar o nome de um cliente pelo PDV mudaria
// a chave que `mesmoCliente` usa para reconhecê-lo, e o cadastro seguinte
// nasceria como pessoa diferente. Corrigir nome é operação do ERP.
const CAMPOS_EDITAVEIS = [
  'telefone', 'whatsapp', 'cep', 'logradouro', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'referencia', 'obs_entrega',
] as const

export function validarAtualizacaoCliente(
  corpo: Record<string, unknown>,
): { ok: true; dados: Record<string, string> } | { ok: false; erro: string } {
  const dados: Record<string, string> = {}
  for (const campo of CAMPOS_EDITAVEIS) {
    // `if (dados[c])` — a mesma condição do legado: campo ausente ou vazio
    // não é enviado. Apagar endereço pelo PDV nunca foi possível, e passar a
    // ser agora seria mudança de comportamento escondida numa migração.
    const v = texto(corpo?.[campo], 200)
    if (v) dados[campo] = v
  }
  if (!Object.keys(dados).length) return { ok: false, erro: 'Nada para atualizar.' }
  return { ok: true, dados }
}
