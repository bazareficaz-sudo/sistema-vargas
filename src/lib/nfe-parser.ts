// Parser de XML NF-e (layout 4.00 e 3.10)
// Funciona no browser via DOMParser

export type NFeItem = {
  num_item: number
  codigo_fornecedor: string
  ean: string
  descricao_xml: string
  ncm: string
  cest: string
  cfop: string
  unidade_xml: string
  quantidade_xml: number
  valor_unitario_xml: number
  valor_produto: number
  desconto_item: number
  frete_item: number
  seguro_item: number
  outras_desp_item: number
  ipi: number
  icms: number
  icms_st: number
  pis: number
  cofins: number
}

export type NFeDuplicata = {
  num_dup: string
  data_vencimento: string
  valor: number
}

export type NFeData = {
  chave_acesso: string
  numero: string
  serie: string
  modelo: string
  nat_operacao: string
  data_emissao: string
  data_entrada: string

  // Fornecedor (emit)
  cnpj_fornecedor: string
  nome_fornecedor: string
  fantasia_fornecedor: string
  ie_fornecedor: string
  uf_fornecedor: string
  cep_fornecedor: string
  logradouro_fornecedor: string
  numero_fornecedor: string
  bairro_fornecedor: string
  municipio_fornecedor: string
  fone_fornecedor: string

  // Destinatário
  cnpj_destinatario: string

  // Totais
  valor_produtos: number
  valor_frete: number
  valor_seguro: number
  valor_desconto: number
  outras_despesas: number
  valor_ipi: number
  valor_icms: number
  valor_icms_st: number
  valor_pis: number
  valor_cofins: number
  valor_total: number

  // Itens
  itens: NFeItem[]

  // Duplicatas
  duplicatas: NFeDuplicata[]
}

function txt(el: Element | null, tag: string): string {
  if (!el) return ''
  const node = el.getElementsByTagName(tag)[0]
  return node?.textContent?.trim() ?? ''
}

function num(el: Element | null, tag: string): number {
  return parseFloat(txt(el, tag)) || 0
}

// Extrai valor de ICMS — vários sub-grupos possíveis
function getIcms(imposto: Element | null): { icms: number; icms_st: number } {
  if (!imposto) return { icms: 0, icms_st: 0 }
  const icmsEl = imposto.getElementsByTagName('ICMS')[0]
  if (!icmsEl) return { icms: 0, icms_st: 0 }
  const child = icmsEl.children[0]
  if (!child) return { icms: 0, icms_st: 0 }
  const vICMS   = num(child, 'vICMS')
  const vICMSST = num(child, 'vICMSST')
  return { icms: vICMS, icms_st: vICMSST }
}

function getIpi(imposto: Element | null): number {
  if (!imposto) return 0
  const ipiEl = imposto.getElementsByTagName('IPITrib')[0]
    ?? imposto.getElementsByTagName('IPINT')[0]
  return num(ipiEl ?? null, 'vIPI')
}

function getPis(imposto: Element | null): number {
  if (!imposto) return 0
  const pisEl = imposto.getElementsByTagName('PISAliq')[0]
    ?? imposto.getElementsByTagName('PISNT')[0]
    ?? imposto.getElementsByTagName('PISOutr')[0]
    ?? imposto.getElementsByTagName('PISQtde')[0]
  return num(pisEl ?? null, 'vPIS')
}

function getCofins(imposto: Element | null): number {
  if (!imposto) return 0
  const el = imposto.getElementsByTagName('COFINSAliq')[0]
    ?? imposto.getElementsByTagName('COFINSNT')[0]
    ?? imposto.getElementsByTagName('COFINSOutr')[0]
    ?? imposto.getElementsByTagName('COFINSQtde')[0]
  return num(el ?? null, 'vCOFINS')
}

export function parseNFeXml(xmlString: string): NFeData | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlString, 'application/xml')

    if (doc.documentElement.tagName === 'parsererror') return null

    // Suporte a nfeProc e NFe direto
    const infNFe = doc.getElementsByTagName('infNFe')[0]
    if (!infNFe) return null

    const chaveRaw = infNFe.getAttribute('Id') ?? ''
    const chave_acesso = chaveRaw.replace(/^NFe/, '')

    const ide  = infNFe.getElementsByTagName('ide')[0] ?? null
    const emit = infNFe.getElementsByTagName('emit')[0] ?? null
    const dest = infNFe.getElementsByTagName('dest')[0] ?? null
    const totEl= infNFe.getElementsByTagName('ICMSTot')[0] ?? null
    const cobr = infNFe.getElementsByTagName('cobr')[0] ?? null

    // Rateio de frete/seguro/outras por valor proporcional
    const valorFrete     = num(totEl, 'vFrete')
    const valorSeguro    = num(totEl, 'vSeg')
    const outrasDespesas = num(totEl, 'vOutro')
    const valorProdutos  = num(totEl, 'vProd') || 1

    // Itens
    const dets = Array.from(infNFe.getElementsByTagName('det'))
    const itens: NFeItem[] = dets.map(det => {
      const nItem    = parseInt(det.getAttribute('nItem') ?? '0')
      const prod     = det.getElementsByTagName('prod')[0] ?? null
      const imposto  = det.getElementsByTagName('imposto')[0] ?? null

      const vProd    = num(prod, 'vProd')
      const proporcao= valorProdutos > 0 ? vProd / valorProdutos : 0

      const { icms, icms_st } = getIcms(imposto)

      return {
        num_item:           nItem,
        codigo_fornecedor:  txt(prod, 'cProd'),
        ean:                txt(prod, 'cEAN').replace(/^SEM GTIN$/, ''),
        descricao_xml:      txt(prod, 'xProd'),
        ncm:                txt(prod, 'NCM'),
        cest:               txt(prod, 'CEST'),
        cfop:               txt(prod, 'CFOP'),
        unidade_xml:        txt(prod, 'uCom'),
        quantidade_xml:     num(prod, 'qCom'),
        valor_unitario_xml: num(prod, 'vUnCom'),
        valor_produto:      vProd,
        desconto_item:      num(prod, 'vDesc'),
        frete_item:         Math.round(valorFrete * proporcao * 100) / 100,
        seguro_item:        Math.round(valorSeguro * proporcao * 100) / 100,
        outras_desp_item:   Math.round(outrasDespesas * proporcao * 100) / 100,
        ipi:                getIpi(imposto),
        icms,
        icms_st,
        pis:                getPis(imposto),
        cofins:             getCofins(imposto),
      }
    })

    // Duplicatas
    const dups = Array.from(cobr?.getElementsByTagName('dup') ?? [])
    const duplicatas: NFeDuplicata[] = dups.map(dup => ({
      num_dup:         txt(dup, 'nDup'),
      data_vencimento: txt(dup, 'dVenc'),
      valor:           num(dup, 'vDup'),
    }))

    // Se não houver duplicatas, criar uma à vista com valor total
    const valorTotal = num(totEl, 'vNF')
    if (duplicatas.length === 0) {
      duplicatas.push({
        num_dup: '001',
        data_vencimento: txt(ide, 'dEmi') || new Date().toISOString().split('T')[0],
        valor: valorTotal,
      })
    }

    const result: NFeData = {
      chave_acesso,
      numero:        txt(ide, 'nNF'),
      serie:         txt(ide, 'serie'),
      modelo:        txt(ide, 'mod') || '55',
      nat_operacao:  txt(ide, 'natOp'),
      data_emissao:  txt(ide, 'dEmi') || (txt(ide, 'dhEmi').split('T')[0]),
      data_entrada:  txt(ide, 'dSaiEnt') || (txt(ide, 'dhSaiEnt').split('T')[0]),

      cnpj_fornecedor:     txt(emit, 'CNPJ') || txt(emit, 'CPF'),
      nome_fornecedor:     txt(emit, 'xNome'),
      fantasia_fornecedor: txt(emit, 'xFant'),
      ie_fornecedor:       txt(emit, 'IE'),
      uf_fornecedor:       txt(emit?.getElementsByTagName('enderEmit')[0] ?? null, 'UF'),
      cep_fornecedor:      txt(emit?.getElementsByTagName('enderEmit')[0] ?? null, 'CEP'),
      logradouro_fornecedor: txt(emit?.getElementsByTagName('enderEmit')[0] ?? null, 'xLgr'),
      numero_fornecedor:   txt(emit?.getElementsByTagName('enderEmit')[0] ?? null, 'nro'),
      bairro_fornecedor:   txt(emit?.getElementsByTagName('enderEmit')[0] ?? null, 'xBairro'),
      municipio_fornecedor: txt(emit?.getElementsByTagName('enderEmit')[0] ?? null, 'xMun'),
      fone_fornecedor:     txt(emit, 'fone'),

      cnpj_destinatario: txt(dest, 'CNPJ') || txt(dest, 'CPF'),

      valor_produtos:  num(totEl, 'vProd'),
      valor_frete:     num(totEl, 'vFrete'),
      valor_seguro:    num(totEl, 'vSeg'),
      valor_desconto:  num(totEl, 'vDesc'),
      outras_despesas: num(totEl, 'vOutro'),
      valor_ipi:       num(totEl, 'vIPI'),
      valor_icms:      num(totEl, 'vICMS'),
      valor_icms_st:   num(totEl, 'vICMSST') || num(totEl, 'vST'),
      valor_pis:       num(totEl, 'vPIS'),
      valor_cofins:    num(totEl, 'vCOFINS'),
      valor_total:     valorTotal,

      itens,
      duplicatas,
    }

    return result
  } catch {
    return null
  }
}

// Calcular custo unitário final de um item (com rateios)
// Divide pela quantidade já convertida para a unidade do sistema
// (quantidade_entrada = quantidade_xml * fator_conversao) quando disponível,
// pois 1 unidade da NF-e pode corresponder a várias unidades do sistema
// (ex: 1 caixa de 20kg mapeada para um produto vendido por kg).
export function calcularCustoItem(item: NFeItem, incluirIpi = true, incluirIcmsSt = true): number {
  const base   = item.valor_produto - item.desconto_item
  const rateios= item.frete_item + item.seguro_item + item.outras_desp_item
  const impostos = (incluirIpi ? item.ipi : 0) + (incluirIcmsSt ? item.icms_st : 0)
  const total  = base + rateios + impostos
  const quantidade = (item as any).quantidade_entrada || item.quantidade_xml
  return quantidade > 0 ? total / quantidade : 0
}
