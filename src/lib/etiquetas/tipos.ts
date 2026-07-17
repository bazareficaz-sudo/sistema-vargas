export type TipoCampo =
  | 'nome' | 'sku' | 'ean' | 'codigo_barras' | 'qrcode'
  | 'preco_venda' | 'preco_promocional' | 'marca' | 'unidade' | 'categoria'
  | 'localizacao' | 'logo_empresa' | 'texto_livre' | 'data_impressao'

export type CampoEtiqueta = {
  campo: TipoCampo
  fontSize: number
  bold: boolean
  align: 'left' | 'center' | 'right'
  textoLivre?: string // só usado quando campo === 'texto_livre'
}

export type Fabricante = 'pimaco' | 'colacril' | 'a4_generica' | 'termica' | 'zebra' | 'argox' | 'elgin' | 'brother' | 'personalizada'

export const FABRICANTES: { value: Fabricante; label: string }[] = [
  { value: 'a4_generica', label: 'A4 Genérica' },
  { value: 'pimaco', label: 'Pimaco' },
  { value: 'colacril', label: 'Colacril' },
  { value: 'termica', label: 'Térmica' },
  { value: 'zebra', label: 'Zebra' },
  { value: 'argox', label: 'Argox' },
  { value: 'elgin', label: 'Elgin' },
  { value: 'brother', label: 'Brother' },
  { value: 'personalizada', label: 'Personalizada' },
]

export const CAMPOS_DISPONIVEIS: { value: TipoCampo; label: string }[] = [
  { value: 'nome', label: 'Nome do produto' },
  { value: 'sku', label: 'SKU / Código interno' },
  { value: 'ean', label: 'EAN (texto)' },
  { value: 'codigo_barras', label: 'Código de barras' },
  { value: 'qrcode', label: 'QR Code' },
  { value: 'preco_venda', label: 'Preço' },
  { value: 'preco_promocional', label: 'Preço promocional' },
  { value: 'marca', label: 'Marca' },
  { value: 'unidade', label: 'Unidade' },
  { value: 'categoria', label: 'Categoria' },
  { value: 'localizacao', label: 'Localização no depósito' },
  { value: 'logo_empresa', label: 'Logo da empresa' },
  { value: 'texto_livre', label: 'Texto livre' },
  { value: 'data_impressao', label: 'Data da impressão' },
]

export type ModeloEtiqueta = {
  id: string
  empresa_id: string
  nome: string
  fabricante: Fabricante
  tipo_pagina: 'folha' | 'bobina'
  largura_mm: number
  altura_mm: number
  margem_topo_mm: number
  margem_esquerda_mm: number
  espaco_horizontal_mm: number
  espaco_vertical_mm: number
  colunas: number
  linhas: number
  pagina_largura_mm: number
  pagina_altura_mm: number
  orientacao: 'retrato' | 'paisagem'
  campos: CampoEtiqueta[]
  ativo: boolean
}

export type ProdutoParaEtiqueta = {
  id: string
  nome: string
  sku: string | null
  ean: string | null
  preco_venda: number
  preco_promocional: number | null
  marca: string | null
  unidade: string
  categoria: string | null
  localizacao?: string | null
}

export const PRESETS: Record<'a4_generica' | 'termica', Partial<ModeloEtiqueta>> = {
  a4_generica: {
    tipo_pagina: 'folha', largura_mm: 63.5, altura_mm: 38.1,
    margem_topo_mm: 15.09, margem_esquerda_mm: 7, espaco_horizontal_mm: 2.5, espaco_vertical_mm: 0,
    colunas: 3, linhas: 7, pagina_largura_mm: 210, pagina_altura_mm: 297, orientacao: 'retrato',
  },
  termica: {
    tipo_pagina: 'bobina', largura_mm: 60, altura_mm: 40,
    margem_topo_mm: 0, margem_esquerda_mm: 0, espaco_horizontal_mm: 0, espaco_vertical_mm: 0,
    colunas: 1, linhas: 1, pagina_largura_mm: 60, pagina_altura_mm: 40, orientacao: 'retrato',
  },
}
