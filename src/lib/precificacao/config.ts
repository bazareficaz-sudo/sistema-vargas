import type { ConfigTaxas } from './tipos'

// Leitura/gravação da configuração de taxas, mais os presets de partida.
//
// Os presets existem só pra empresa nova não começar com a tela em branco —
// a partir do momento em que o usuário salva, vale exclusivamente o que está
// no banco. Nenhum cálculo do sistema lê estes números direto.

export const PRESET_SHOPEE: Omit<ConfigTaxas, 'canalId'> = {
  plataforma: 'shopee',
  nome: 'Shopee',
  comissaoModo: 'faixas',
  comissaoPercentual: 0,
  comissaoFixo: 0,
  // Mesmas faixas que estavam fixas em src/lib/shopee/comissao.ts — agora
  // como ponto de partida editável, não como verdade imutável no código.
  comissaoFaixas: [
    { min: 0, max: 79.99, percentual: 20, fixo: 4 },
    { min: 80, max: 99.99, percentual: 14, fixo: 16 },
    { min: 100, max: 199.99, percentual: 14, fixo: 20 },
    { min: 200, max: 499.99, percentual: 14, fixo: 26 },
    { min: 500, max: null, percentual: 14, fixo: 26 },
  ],
  taxas: [],
  freteModo: 'nao',
  freteValor: 0,
  freteLimiteGratis: 0,
  freteCustoMedio: 0,
  freteFaixas: [],
  freteMlImportar: false,
  embalagem: null,
  imposto: null,
  custosExtras: [],
  diasRecebimento: 14,
}

export const PRESET_ML: Omit<ConfigTaxas, 'canalId'> = {
  plataforma: 'mercadolivre',
  nome: 'Mercado Livre',
  // A alíquota real vem da API do ML por categoria e faixa de preço. O modo
  // 'api_ml' faz o sistema consultar em vez de confiar num número digitado.
  comissaoModo: 'api_ml',
  comissaoPercentual: 11.5,
  comissaoFixo: 0,
  comissaoFaixas: [
    { min: 0, max: 199.99, percentual: 11.5, fixo: 0 },
    { min: 200, max: null, percentual: 10.5, fixo: 0 },
  ],
  taxas: [],
  // Valores de partida: o limite de frete grátis e o custo médio mudam por
  // conta e por região, então o usuário confirma na tela.
  freteModo: 'gratis_acima',
  freteValor: 0,
  freteLimiteGratis: 79,
  freteCustoMedio: 22,
  freteFaixas: [],
  freteMlImportar: false,
  embalagem: null,
  imposto: null,
  custosExtras: [],
  diasRecebimento: 12,
}

export function presetDaPlataforma(plataforma: string): Omit<ConfigTaxas, 'canalId'> {
  if (plataforma === 'mercadolivre') return { ...PRESET_ML }
  if (plataforma === 'shopee') return { ...PRESET_SHOPEE }
  return {
    plataforma, nome: plataforma,
    comissaoModo: 'simples', comissaoPercentual: 0, comissaoFixo: 0, comissaoFaixas: [],
    taxas: [], freteModo: 'nao', freteValor: 0, freteLimiteGratis: 0, freteCustoMedio: 0, freteFaixas: [], freteMlImportar: false,
    embalagem: null, imposto: null, custosExtras: [], diasRecebimento: null,
  }
}

export type FaixasSaude = { critica: number; baixa: number; saudavel: number }

export function linhaParaConfig(row: any): ConfigTaxas & { faixasSaude: FaixasSaude } {
  return {
    id: row.id,
    canalId: row.canal_id ?? null,
    plataforma: row.plataforma,
    nome: row.nome,
    comissaoModo: row.comissao_modo,
    comissaoPercentual: Number(row.comissao_percentual ?? 0),
    comissaoFixo: Number(row.comissao_fixo ?? 0),
    comissaoFaixas: row.comissao_faixas ?? [],
    taxas: row.taxas ?? [],
    freteModo: row.frete_modo,
    freteValor: Number(row.frete_valor ?? 0),
    freteLimiteGratis: Number(row.frete_limite_gratis ?? 0),
    freteCustoMedio: Number(row.frete_custo_medio ?? 0),
    freteFaixas: row.frete_faixas ?? [],
    freteMlImportar: row.frete_ml_importar ?? false,
    embalagem: row.embalagem ?? null,
    imposto: row.imposto ?? null,
    custosExtras: row.custos_extras ?? [],
    diasRecebimento: row.dias_recebimento ?? null,
    faixasSaude: {
      critica: Number(row.saude_critica ?? 5),
      baixa: Number(row.saude_baixa ?? 10),
      saudavel: Number(row.saude_saudavel ?? 20),
    },
  }
}

export function configParaLinha(cfg: ConfigTaxas & { faixasSaude?: FaixasSaude }, empresaId: string) {
  return {
    empresa_id: empresaId,
    canal_id: cfg.canalId,
    plataforma: cfg.plataforma,
    nome: cfg.nome,
    comissao_modo: cfg.comissaoModo,
    comissao_percentual: cfg.comissaoPercentual ?? 0,
    comissao_fixo: cfg.comissaoFixo ?? 0,
    comissao_faixas: cfg.comissaoFaixas ?? [],
    taxas: cfg.taxas ?? [],
    frete_modo: cfg.freteModo,
    frete_valor: cfg.freteValor ?? 0,
    frete_limite_gratis: cfg.freteLimiteGratis ?? 0,
    frete_custo_medio: cfg.freteCustoMedio ?? 0,
    frete_faixas: cfg.freteFaixas ?? [],
    frete_ml_importar: cfg.freteMlImportar ?? false,
    embalagem: cfg.embalagem,
    imposto: cfg.imposto,
    custos_extras: cfg.custosExtras ?? [],
    dias_recebimento: cfg.diasRecebimento,
    saude_critica: cfg.faixasSaude?.critica ?? 5,
    saude_baixa: cfg.faixasSaude?.baixa ?? 10,
    saude_saudavel: cfg.faixasSaude?.saudavel ?? 20,
    updated_at: new Date().toISOString(),
  }
}

// Resolve qual configuração vale pra um canal: a do próprio canal, senão a
// padrão da plataforma naquela empresa, senão o preset (nunca falha por
// falta de cadastro — mas avisa que está usando valor de partida).
export async function buscarConfigDoCanal(
  sb: any, empresaId: string, canal: { id: string; plataforma: string },
): Promise<{ cfg: ConfigTaxas & { faixasSaude: FaixasSaude }; origem: 'canal' | 'plataforma' | 'preset' }> {
  const { data: doCanal } = await sb.from('precificacao_config')
    .select('*').eq('canal_id', canal.id).eq('ativo', true).maybeSingle()
  if (doCanal) return { cfg: linhaParaConfig(doCanal), origem: 'canal' }

  const { data: daPlataforma } = await sb.from('precificacao_config')
    .select('*').eq('empresa_id', empresaId).eq('plataforma', canal.plataforma)
    .is('canal_id', null).eq('ativo', true).maybeSingle()
  if (daPlataforma) return { cfg: linhaParaConfig(daPlataforma), origem: 'plataforma' }

  const preset = presetDaPlataforma(canal.plataforma)
  return {
    cfg: { ...preset, canalId: canal.id, faixasSaude: { critica: 5, baixa: 10, saudavel: 20 } },
    origem: 'preset',
  }
}
