import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'
import { buscarPadraoAnuncio, blocoPadraoAnuncio } from '@/lib/ia/padraoAnuncio'
import { buscarCandidatosCest, resolverCest, type CandidatoCest } from '@/lib/fiscal/cest'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Sugestão por IA pra completar campos vazios do cadastro de produto, com
// base só no nome e no EAN — nunca inventa categoria/marca nova (só aceita
// se bater com uma já cadastrada na empresa) e valida formato de NCM/CEST/
// medidas antes de devolver, pro mesmo padrão de "whitelist" já usado nas
// rotas de IA da Shopee (ia-sugerir-categoria/ia-gerar-conteudo).
function numOuNull(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) && n > min && n <= max ? Math.round(n * 1000) / 1000 : null
}

// A IA às vezes devolve NCM/CEST como número JSON em vez de string (apesar
// do prompt pedir string) — checar só `typeof === 'string'` descartava esses
// casos silenciosamente. Aceita number ou string e normaliza pra dígitos.
function digitsOuNull(v: unknown, tamanho: number): string | null {
  if (v == null) return null
  const digitos = String(v).replace(/\D/g, '')
  return digitos.length === tamanho ? digitos : null
}

// Percentual de imposto: aceita 0 (isento é resposta legítima, diferente de
// "não sei"), ao contrário de numOuNull, que exige > min.
function percentualOuNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10000) / 10000 : null
}

function origemOuNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isInteger(n) && n >= 0 && n <= 8 ? n : null
}

// Campos que dependem do REGIME da empresa, não do produto — são iguais pra
// todo item do catálogo, então derivar da configuração fiscal já cadastrada
// é mais confiável (e mais barato) do que perguntar pra IA item a item.
// CSOSN só existe no Simples; CST de ICMS só no regime normal — mandar o do
// regime errado a SEFAZ rejeita na hora (mesma regra de emitirParaVenda.ts).
function fiscalDoRegime(crt: string, regime: string | null, cfopPadrao: string | null) {
  const simples = crt === '1' || crt === '2'
  // Lucro Real apura PIS/COFINS pelo não-cumulativo (1,65 / 7,60); os demais
  // regimes normais (presumido, arbitrado) usam o cumulativo (0,65 / 3,00).
  const naoCumulativo = regime === 'lucro_real'
  return {
    cfop: cfopPadrao || '5102',
    csosn: simples ? '102' : null,
    icms_cst: simples ? null : '00',
    pis_cst: simples ? '49' : '01',
    cofins_cst: simples ? '49' : '01',
    // No Simples o PIS/COFINS está dentro do DAS — não há alíquota destacada
    // por item, então deixa vazio em vez de preencher um número que não existe.
    pis_percentual: simples ? null : (naoCumulativo ? 1.65 : 0.65),
    cofins_percentual: simples ? null : (naoCumulativo ? 7.6 : 3),
    simples,
  }
}

export async function POST(req: Request) {
  // O que o produto JÁ tem entra como contexto, não só o nome. Faz diferença
  // real no CEST: ele é derivado do NCM na tabela do Convênio ICMS 142/2018,
  // e os campos de ST já preenchidos (CFOP 5405, CSOSN 500, CST 60/70) são
  // evidência de que aquele item tem substituição tributária — muito mais
  // forte do que deduzir isso de um nome como "BUCHA TRIFIX 6".
  const { produtoNome, produtoEan, produtoNcm, produtoCfop, produtoCsosn, produtoIcmsCst } = await req.json()
  if (!produtoNome?.trim()) return NextResponse.json({ ok: false, erro: 'Nome do produto é obrigatório' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const padrao = await buscarPadraoAnuncio(sb, empresaId)

  const [{ data: categorias }, { data: marcas }, { data: configPropria }] = await Promise.all([
    sb.from('categorias').select('nome').eq('empresa_id', empresaId).eq('ativo', true),
    sb.from('marcas').select('nome').eq('empresa_id', empresaId).eq('ativo', true),
    sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaId).maybeSingle(),
  ])

  // Quem define os códigos fiscais é a empresa que EMITE a nota (pode ser
  // outra do grupo, via empresa_fiscal_id) — mesma resolução de
  // src/lib/fiscal/emitirParaVenda.ts, pra não sugerir o código de um regime
  // e a emissão sair com outro.
  const empresaFiscalId: string = configPropria?.empresa_fiscal_id || empresaId
  let configFiscal = configPropria
  if (empresaFiscalId !== empresaId) {
    const { data: outra } = await sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaFiscalId).maybeSingle()
    configFiscal = outra
  }
  const { data: empresaFiscal } = await sb.from('empresas')
    .select('uf, estado, regime_tributario').eq('id', empresaFiscalId).maybeSingle()

  const uf = empresaFiscal?.uf || empresaFiscal?.estado || null
  const regime = fiscalDoRegime(
    String(configFiscal?.crt ?? '1'),
    empresaFiscal?.regime_tributario ?? null,
    configFiscal?.cfop_venda_dentro ?? null,
  )

  // CEST sai da tabela oficial, não da memória do modelo. Com o NCM em mãos,
  // a consulta devolve os candidatos possíveis e o modelo no máximo escolhe
  // entre eles — nunca inventa um código. Medido no catálogo real: 82% dos
  // produtos ficam resolvidos aqui, sem a IA precisar opinar.
  const candidatosCest: CandidatoCest[] = await buscarCandidatosCest(sb, produtoNcm)
  const resolucao = resolverCest(candidatosCest)

  const instrucaoCest =
    resolucao.certeza === 'unico'
      ? `"${resolucao.cest}" (já resolvido pela tabela oficial — repita exatamente este valor)`
      : resolucao.certeza === 'nao_aplica'
        ? produtoNcm
          ? 'null (o NCM deste produto não consta na tabela de substituição tributária — CEST não se aplica; responda null)'
          : '"<sem NCM informado, não há como consultar a tabela — responda null>"'
        : `"<escolha UM destes códigos, o que melhor descreve o produto. Responda só os 7 dígitos, entre aspas:\n${
            resolucao.candidatos.map(c => `      ${c.cest} — ${c.descricao}`).join('\n')
          }>"`

  const prompt = `Você ajuda a completar o cadastro de produtos de uma loja brasileira (bazar/variedades) num sistema de PDV.

Com base SÓ no nome do produto e (se houver) no código de barras EAN/GTIN abaixo, sugira dados pra completar o cadastro.

Nome do produto: "${produtoNome}"
EAN/GTIN: ${produtoEan?.trim() || 'não informado'}

Já cadastrado neste produto (use como âncora — NÃO contradiga o que já está aqui):
- NCM: ${String(produtoNcm ?? '').trim() || 'não informado'}
- CFOP: ${String(produtoCfop ?? '').trim() || 'não informado'}
- CSOSN: ${String(produtoCsosn ?? '').trim() || 'não informado'}
- CST ICMS: ${String(produtoIcmsCst ?? '').trim() || 'não informado'}

Contexto fiscal da empresa que emite a nota (use só pra ajustar os campos fiscais abaixo):
- Estado (UF): ${uf ?? 'não informado'}
- Regime: ${regime.simples ? 'Simples Nacional' : 'Regime normal'}
- Operação: revenda no varejo (loja de bazar/variedades), venda dentro do próprio estado

Categorias já cadastradas nesta loja (escolha o nome exato de uma se fizer sentido; se nenhuma se encaixar, use null — NÃO invente uma categoria nova):
${(categorias ?? []).map(c => `- ${c.nome}`).join('\n') || '(nenhuma cadastrada ainda)'}

Marcas já cadastradas nesta loja (escolha o nome exato de uma se fizer sentido; se nenhuma se encaixar, use null — NÃO invente uma marca nova):
${(marcas ?? []).map(m => `- ${m.nome}`).join('\n') || '(nenhuma cadastrada ainda)'}

Responda SOMENTE com um JSON neste formato exato:
{
  "titulo_sugerido": "<versão melhorada do nome do produto acima — mesma identidade do produto, só mais completo e bem formatado: capitalização correta (não usar CAIXA ALTA nem tudo minúsculo), sem abreviação confusa, incluindo marca/modelo/medida/voltagem/quantidade quando isso já estiver implícito no nome mas puder ficar mais claro. NÃO invente característica que não esteja sugerida pelo nome original. Se o nome já estiver bom e completo, repita ele. Nunca null.>",
  "categoria": "<nome exato de uma categoria da lista acima, ou null>",
  "marca": "<nome exato de uma marca da lista acima, ou null>",
  "ncm": "<código NCM de 8 dígitos mais provável, SEMPRE como string entre aspas mesmo sendo só números, mantendo zeros à esquerda se houver, ou null se não tiver certeza>",
  "cest": ${instrucaoCest},
  "icms_origem": <origem da mercadoria segundo a tabela oficial da SEFAZ: 0 nacional, 1 estrangeira importação direta, 2 estrangeira adquirida no mercado interno, 3 nacional com mais de 40% de conteúdo importado, 4 nacional produzida conforme processos produtivos básicos, 5 nacional com menos de 40% de conteúdo importado, 6 estrangeira importação direta sem similar nacional, 7 estrangeira adquirida no mercado interno sem similar nacional, 8 nacional com mais de 70% de conteúdo importado. Use 0 quando o produto claramente é de fabricação nacional; use 2 quando é um item tipicamente importado revendido no mercado interno brasileiro (utilidades/bazar de origem asiática, por exemplo); se não der pra deduzir com segurança, use null>,
  "icms_aliquota_interna": <alíquota interna de ICMS que costuma incidir sobre esse NCM no estado ${uf ?? 'do vendedor'}, em porcentagem (ex: 20 para 20%). Use null se não souber com segurança pra esse estado>,
  "ibs_cst": "<CST do IBS/CBS da reforma tributária, 3 dígitos, SEMPRE string (ex: \\"000\\" para tributação integral), ou null se não souber>",
  "ibs_cclasstrib": "<código de Classificação Tributária (cClassTrib) de 6 dígitos correspondente ao CST acima, SEMPRE string, ou null se não souber>",
  "ibs_aliquota": <alíquota de IBS efetivamente em vigor no ano de ${new Date().getFullYear()}, em porcentagem. É a alíquota do período de transição, NÃO a alíquota de referência plena que só valerá no fim da transição. Use null se não tiver certeza do valor deste ano>,
  "cbs_aliquota": <alíquota de CBS efetivamente em vigor no ano de ${new Date().getFullYear()}, em porcentagem, mesma regra do IBS acima. Use null se não tiver certeza do valor deste ano>,
  "descricao_marketplace": "<descrição curta e vendável em português, 2 a 3 frases, pra exibir numa loja online/marketplace, ou null>",
  "peso_kg": <peso estimado do produto embalado, em kg, número, ou null>,
  "altura_cm": <altura estimada da embalagem em cm, número, ou null>,
  "largura_cm": <largura estimada da embalagem em cm, número, ou null>,
  "comprimento_cm": <comprimento estimado da embalagem em cm, número, ou null>
}

${blocoPadraoAnuncio(padrao)}
Se não tiver informação suficiente e confiável pra algum campo, use null nesse campo em vez de chutar um valor genérico.`

  try {
    const resultado = await perguntarJSON(prompt, MODELO_FORTE)

    const nomeCategoriaValido = typeof resultado?.categoria === 'string'
      ? (categorias ?? []).find(c => c.nome.toLowerCase() === resultado.categoria.toLowerCase())?.nome ?? null
      : null
    const nomeMarcaValido = typeof resultado?.marca === 'string'
      ? (marcas ?? []).find(m => m.nome.toLowerCase() === resultado.marca.toLowerCase())?.nome ?? null
      : null
    const ncmValido = digitsOuNull(resultado?.ncm, 8)
    // O CEST devolvido só vale se estiver na lista que a tabela permitiu. Um
    // código fora dela é alucinação, não sugestão — e nesse caso o valor certo
    // é o da tabela (quando único), nunca o do modelo.
    const cestDoModelo = digitsOuNull(resultado?.cest, 7)
    const permitidos = new Set(candidatosCest.map(c => c.cest))
    const cestValido =
      resolucao.certeza === 'unico' ? resolucao.cest
      : resolucao.certeza === 'nao_aplica' ? null
      : cestDoModelo && permitidos.has(cestDoModelo) ? cestDoModelo
      : null
    const descricao = typeof resultado?.descricao_marketplace === 'string'
      ? resultado.descricao_marketplace.trim().slice(0, 1000) || null
      : null
    const tituloBruto = typeof resultado?.titulo_sugerido === 'string' ? resultado.titulo_sugerido.trim().slice(0, 150) : ''
    // Só devolve se for realmente diferente do nome atual — evita mostrar
    // uma "sugestão" que é só o mesmo texto de volta.
    const tituloSugerido = tituloBruto && tituloBruto.toLowerCase() !== produtoNome.trim().toLowerCase() ? tituloBruto : null

    return NextResponse.json({
      ok: true,
      titulo_sugerido: tituloSugerido,
      categoria: nomeCategoriaValido,
      marca: nomeMarcaValido,
      ncm: ncmValido,
      cest: cestValido,
      descricao_marketplace: descricao,
      peso_kg: numOuNull(resultado?.peso_kg, 0, 200),
      altura_cm: numOuNull(resultado?.altura_cm, 0, 300),
      largura_cm: numOuNull(resultado?.largura_cm, 0, 300),
      comprimento_cm: numOuNull(resultado?.comprimento_cm, 0, 300),

      // Fiscal — vindo do regime da empresa (igual pra todo produto)
      cfop: regime.cfop,
      csosn: regime.csosn,
      icms_cst: regime.icms_cst,
      pis_cst: regime.pis_cst,
      cofins_cst: regime.cofins_cst,
      pis_percentual: regime.pis_percentual,
      cofins_percentual: regime.cofins_percentual,

      // Fiscal — vindo da IA (depende do produto/NCM)
      icms_origem: origemOuNull(resultado?.icms_origem),
      // No Simples o ICMS não é destacado por item (está no DAS) — preencher
      // a alíquota interna aqui só confundiria a conferência da contabilidade.
      icms_percentual: regime.simples ? null : percentualOuNull(resultado?.icms_aliquota_interna),
      // IPI fica de fora de propósito: medido contra o catálogo real, a mesma
      // torneira recebeu 0%, 5% e 15% em execuções diferentes — sem
      // estabilidade suficiente pra gravar no cadastro. Continua manual.
      ipi_percentual: null,
      ibs_cst: digitsOuNull(resultado?.ibs_cst, 3),
      ibs_cclasstrib: digitsOuNull(resultado?.ibs_cclasstrib, 6),
      ibs_aliquota: percentualOuNull(resultado?.ibs_aliquota),
      cbs_aliquota: percentualOuNull(resultado?.cbs_aliquota),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao consultar a IA' }, { status: 400 })
  }
}
