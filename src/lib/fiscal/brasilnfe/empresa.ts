import { brasilNFeRequest, brasilNFeRequestUserToken } from './client'
import { FiscalProviderError } from '../types'

// Cadastro de empresa na Brasil NFe (doc.brasilnfe.com.br/api/empresas —
// confirmado em 2026-07: POST /services/empresa/AdicionarEmpresa, auth só
// com header UserToken pois a empresa ainda não existe do lado deles).
// Devolve o token específico da empresa recém-criada, que passa a ser
// usado (via header Token) em toda emissão/cancelamento/consulta dali
// em diante — é o mesmo token pros dois ambientes, a troca entre
// produção/homologação acontece por campo (TipoAmbiente) em cada chamada,
// não por token separado como na Focus NFe.

// CRT da Brasil NFe no cadastro de empresa (doc.brasilnfe.com.br/api/empresas,
// lido via WebFetch — confiança moderada, é uma leitura de doc de terceiro
// resumida por IA, não uma fonte primária conferida linha a linha): 1 Simples
// Nacional, 2 Simples c/ excesso de sublimite, 3 Lucro Presumido, 4 Lucro
// Real — mais granular que o CRT oficial da SEFAZ (que só tem 1/2/3, sem
// distinguir Presumido de Real). Agora que o cadastro interno também
// distingue "Simples Nacional (excesso de sublimite)", o mapeamento cobre
// todos os regimes com um valor específico; "isento"/"outro" (sem CRT
// correspondente em nenhuma tabela) caem em Lucro Presumido (3) por ser o
// padrão mais comum — vale conferir manualmente se for um desses dois casos.
function crtBrasilNFe(regimeTributario: string): number {
  switch (regimeTributario) {
    case 'simples_nacional':
    case 'mei':
      return 1
    case 'simples_nacional_excesso':
      return 2
    case 'lucro_real':
      return 4
    case 'lucro_presumido':
    case 'isento':
    case 'outro':
    default:
      return 3
  }
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
  | { ok: false; erro: string; jaExiste?: boolean }

// "Já está cadastrada" é o retorno da Brasil NFe quando o CNPJ tentado em
// AdicionarEmpresa já existe na conta (ex: cadastrado manualmente antes de
// termos essa automação) — não dá pra recadastrar, só recuperar o token
// já existente via buscarTokenPorCnpj().
function indicaEmpresaJaExiste(erro: string): boolean {
  const e = erro.toLowerCase()
  return e.includes('já esta cadastrada') || e.includes('já está cadastrada') || e.includes('ja esta cadastrada') || e.includes('already') || e.includes('duplicad')
}

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
    return { ok: false, erro, jaExiste: indicaEmpresaJaExiste(erro) }
  }
  if (!json?.token) {
    return { ok: false, erro: 'Brasil NFe não retornou o token da empresa cadastrada.' }
  }
  return { ok: true, token: json.token }
}

export type ResultadoBuscaToken =
  | { ok: true; token: string }
  | { ok: false; erro: string }

// Recupera o token de uma empresa que já existe na conta Brasil NFe (ex:
// cadastrada manualmente antes desta automação, ou uma tentativa anterior
// de AdicionarEmpresa que "vazou" sem gravar o token no nosso banco).
// BuscarEmpresa exige o Token da empresa pra identificar qual buscar — como
// é justamente isso que não temos, a única forma de achar por CNPJ é listar
// tudo via BuscarTodasEmpresas (só exige UserToken) e filtrar no cliente.
export async function buscarTokenPorCnpj(userToken: string, cnpj: string): Promise<ResultadoBuscaToken> {
  const { status, text } = await brasilNFeRequestUserToken(userToken, '/services/empresa/BuscarTodasEmpresas', {})
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao listar empresas (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }
  if (status >= 400 || json?.Error) {
    return { ok: false, erro: json?.Error ?? `Erro ${status} ao listar empresas da Brasil NFe` }
  }
  const lista: any[] = Array.isArray(json) ? json : (Array.isArray(json?.Empresas) ? json.Empresas : [])
  const cnpjLimpo = cnpj.replace(/\D/g, '')
  const encontrada = lista.find(e => (e?.CNPJ ?? '').replace(/\D/g, '') === cnpjLimpo)
  if (!encontrada?.Token) {
    return { ok: false, erro: 'Empresa não encontrada na lista de cadastros da Brasil NFe (verifique se o CNPJ está correto ou se foi cadastrada com outra conta/UserToken).' }
  }
  return { ok: true, token: encontrada.Token }
}

export type ResultadoCertificado =
  | { ok: true; expirado: boolean; dtExpiracao: string | null }
  | { ok: false; erro: string }

// Envio do certificado A1 (doc.brasilnfe.com.br/api/empresas#adicionar —
// AlterarCertificado, endpoint SEPARADO do cadastro da empresa): precisa
// do Token da empresa (já cadastrada) + UserToken da conta, e do arquivo
// .pfx/.p12 em base64 junto da senha. Sem tela própria da Brasil NFe pro
// cliente, é este o único jeito de colocar o certificado em produção.
export async function alterarCertificado(
  userToken: string,
  empresaToken: string,
  base64CertificateFile: string,
  senha: string
): Promise<ResultadoCertificado> {
  const { status, text } = await brasilNFeRequest(
    { token: empresaToken, userToken, ambiente: 'producao' },
    '/services/empresa/AlterarCertificado',
    { Senha: senha, Base64CertificateFile: base64CertificateFile }
  )
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao enviar certificado (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }

  if (status >= 400 || json?.status === 2 || json?.Error) {
    const erro = json?.Error ?? (Array.isArray(json?.Avisos) ? json.Avisos.join('; ') : null) ?? `Erro ${status} ao enviar certificado à Brasil NFe`
    return { ok: false, erro }
  }
  return { ok: true, expirado: !!json?.Expirado, dtExpiracao: json?.DtExpiracao ?? null }
}
