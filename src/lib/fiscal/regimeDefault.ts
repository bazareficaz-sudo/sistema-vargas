// Campos fiscais que dependem só do REGIME da empresa, não do produto — são
// iguais pra todo item do catálogo dela. CSOSN só existe no Simples; CST de
// ICMS só no regime normal — mandar o do regime errado a SEFAZ rejeita na
// hora (mesma regra usada em src/lib/fiscal/emitirParaVenda.ts pra decidir
// qual código mandar na emissão).
//
// Extraído de src/app/api/produtos/ia-enriquecer/route.ts (que já usava isto
// pra sugerir campo fiscal em produto novo) pra ser reaproveitado também por
// src/lib/produtos/clonarParaEmpresa.ts — duplicar produto entre empresas do
// grupo tem exatamente o mesmo problema: os campos fiscais do produto de
// ORIGEM não servem pro produto de DESTINO se as empresas forem de regimes
// diferentes. Ver também src/lib/produtos/vinculo.ts, cujo comentário já
// deixava a regra geral clara: "nunca propaga preço, estoque ou campos
// fiscais — cada empresa mantém os seus, sempre".

export type FiscalDoRegime = {
  cfop: string
  csosn: string | null
  icms_cst: string | null
  pis_cst: string
  cofins_cst: string
  pis_percentual: number | null
  cofins_percentual: number | null
  simples: boolean
}

export function fiscalPadraoDoRegime(crt: string, regimeTributario: string | null, cfopPadrao: string | null): FiscalDoRegime {
  const simples = crt === '1' || crt === '2'
  // Lucro Real apura PIS/COFINS pelo não-cumulativo (1,65 / 7,60); os demais
  // regimes normais (presumido, arbitrado) usam o cumulativo (0,65 / 3,00).
  const naoCumulativo = regimeTributario === 'lucro_real'
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
