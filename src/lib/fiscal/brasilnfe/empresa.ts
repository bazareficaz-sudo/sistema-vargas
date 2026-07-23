import { brasilNFeRequestUserToken } from './client'
import { FiscalProviderError } from '../types'

// Cadastro de empresa na Brasil NFe (doc.brasilnfe.com.br/api/empresas —
// confirmado em 2026-07: POST /services/empresa/AdicionarEmpresa, auth só
// com header UserToken pois a empresa ainda não existe do lado deles).
// Devolve o token específico da empresa recém-criada, que passa a ser
// usado (via header Token) em toda emissão/cancelamento/consulta dali
// em diante — é o mesmo token pros dois ambientes, a troca entre
// produção/homologação acontece por campo (TipoAmbiente) em cada chamada,
// não por token separado como na Focus NFe.

// CRT da Brasil NFe (1 Simples Nacional, 2 Simples c/ excesso de
// sublimite, 3 Lucro Presumido, 4 Lucro Real) é mais granular que o nosso
// campo interno `regime_tributario` — mapeamento conservador: só
// distinguimos Simples (inclui MEI) de "regime normal", que cai em Lucro
// Presumido (3) por ser o mais comum; empresas de Lucro Real precisam
// ajustar isso manualmente depois se for o caso.
function crtBrasilNFe(regimeTributario: string): number {
  if (regimeTributario === 'simples_nacional' || regimeTributario === 'mei') return 1
  return 3
}

export type DadosEmpresaCadastro = {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  inscricaoEstadual?: string | null
  inscricaoMunicipal?: string | null
  regimeTributario: string
  cnae?: string | null
  site?: string | null
  endereco: {
    cep?: string | null
    logradouro?: string | null
    numero?: string | null
    complemento?: string | null
    bairro?: string | null
    codMunicipio?: string | null
    municipio?: string | null
    uf?: string | null
  }
  telefone?: string | null
  email?: string | null
}

export type ResultadoCadastroEmpresa =
  | { ok: true; token: string }
  | { ok: false; erro: string }

export async function cadastrarEmpresa(userToken: string, dados: DadosEmpresaCadastro): Promise<ResultadoCadastroEmpresa> {
  const body = {
    CNPJ: dados.cnpj.replace(/\D/g, ''),
    RzSocial: dados.razaoSocial,
    NmFantasia: dados.nomeFantasia,
    IE: dados.inscricaoEstadual || undefined,
    IM: dados.inscricaoMunicipal || undefined,
    CRT: crtBrasilNFe(dados.regimeTributario),
    CNAE: dados.cnae || undefined,
    Site: dados.site || undefined,
    Endereco: {
      Cep: dados.endereco.cep?.replace(/\D/g, '') || undefined,
      Logradouro: dados.endereco.logradouro || undefined,
      Numero: dados.endereco.numero || undefined,
      Complemento: dados.endereco.complemento || undefined,
      Bairro: dados.endereco.bairro || undefined,
      CodMunicipio: dados.endereco.codMunicipio || undefined,
      Municipio: dados.endereco.municipio || undefined,
      Uf: dados.endereco.uf || undefined,
      CodPais: '1058',
      Pais: 'Brasil',
    },
    Contato: {
      Telefone: dados.telefone || undefined,
      Email: dados.email || undefined,
    },
  }

  const { status, text } = await brasilNFeRequestUserToken(userToken, '/services/empresa/AdicionarEmpresa', body)
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao cadastrar empresa (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }

  if (status >= 400 || json?.Error || json?.status === false) {
    const erro = json?.Error ?? (Array.isArray(json?.Avisos) ? json.Avisos.join('; ') : null) ?? `Erro ${status} ao cadastrar empresa na Brasil NFe`
    return { ok: false, erro }
  }
  if (!json?.token) {
    return { ok: false, erro: 'Brasil NFe não retornou o token da empresa cadastrada.' }
  }
  return { ok: true, token: json.token }
}
