export type EnderecoParaEtiqueta = {
  id: string
  codigoInterno: string
  codigoLegivel: string
  descricao: string | null
  depositoNome: string
  tipo: string
  zona: string | null; corredor: string | null; estante: string | null
  modulo: string | null; nivel: string | null; posicao: string | null
}

export type LayoutEtiquetaEndereco = 'termica' | 'a4_generica'

// Geometria reaproveitada dos presets já existentes em tipos.ts — endereço
// não precisa de layout próprio, só de conteúdo diferente (código do
// endereço em vez de dados de produto).
export const LAYOUTS_ENDERECO: { value: LayoutEtiquetaEndereco; label: string }[] = [
  { value: 'termica', label: 'Térmica (60×40mm, 1 por página)' },
  { value: 'a4_generica', label: 'Folha A4 (3 colunas × 7 linhas)' },
]
