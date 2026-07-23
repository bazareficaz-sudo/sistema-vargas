'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Grupo = { id: string; nome: string }

type WizardForm = {
  // Etapa 1 — Dados básicos
  grupo_id: string
  razao_social: string
  nome_fantasia: string
  cnpj: string
  inscricao_estadual: string
  inscricao_municipal: string
  regime_tributario: string
  cnae: string
  status: string
  empresa_principal: boolean
  // Etapa 2 — Endereço
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  ibge: string
  pais: string
  // Etapa 3 — Contato & Responsáveis
  telefone: string
  whatsapp: string
  email: string
  email_financeiro: string
  email_fiscal: string
  site: string
  responsavel_legal: string
  cpf_responsavel: string
  contador: string
  email_contador: string
  telefone_contador: string
  // Etapa 4 — Fiscal
  ambiente_fiscal: string
  serie_nfe: number
  serie_nfce: number
  proximo_nfe: number
  proximo_nfce: number
  csc_nfce: string
  id_csc_nfce: string
  cfop_venda_dentro: string
  cfop_venda_fora: string
  cfop_compra: string
  natureza_operacao: string
  obs_fiscal: string
  // Emissão — token por ambiente e certificado (movido de "XML/NF-e" pra
  // cá a pedido do usuário: quem configura isso é o cliente, na tela da
  // própria empresa, não numa tela solta de importação de XML)
  token_producao: string
  token_homologacao: string
  certificado_ref: string
  certificado_validade: string
  // Etapa 5 — Comercial
  limite_desconto: number
  margem_minima: number
  permite_venda_sem_cliente: boolean
  permite_estoque_negativo: boolean
  permite_fiado: boolean
  permite_credito: boolean
  // Etapa 6 — Estoque
  permite_multiplos_depositos: boolean
  reservar_em_orcamento: boolean
  reservar_em_pedido: boolean
  baixar_estoque_em: string
  tipo_custo: string
  controlar_lote: boolean
  deposito_devolucao_id: string
  // Etapa 7 — Compartilhamento
  compartilhar_produtos: boolean
  compartilhar_clientes: boolean
  compartilhar_fornecedores: boolean
  compartilhar_marcas: boolean
  compartilhar_categorias: boolean
  compartilhar_tabelas_preco: boolean
}

const FORM_INICIAL: WizardForm = {
  grupo_id: '', razao_social: '', nome_fantasia: '', cnpj: '',
  inscricao_estadual: '', inscricao_municipal: '', regime_tributario: 'simples_nacional',
  cnae: '', status: 'ativa', empresa_principal: false,
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '',
  cidade: '', uf: '', ibge: '', pais: 'Brasil',
  telefone: '', whatsapp: '', email: '', email_financeiro: '', email_fiscal: '',
  site: '', responsavel_legal: '', cpf_responsavel: '', contador: '',
  email_contador: '', telefone_contador: '',
  ambiente_fiscal: 'homologacao', serie_nfe: 1, serie_nfce: 1,
  proximo_nfe: 1, proximo_nfce: 1, csc_nfce: '', id_csc_nfce: '',
  cfop_venda_dentro: '5102', cfop_venda_fora: '6102', cfop_compra: '1102',
  natureza_operacao: 'Venda de Mercadorias', obs_fiscal: '',
  token_producao: '', token_homologacao: '', certificado_ref: '', certificado_validade: '',
  limite_desconto: 10, margem_minima: 0, permite_venda_sem_cliente: true,
  permite_estoque_negativo: false, permite_fiado: false, permite_credito: true,
  permite_multiplos_depositos: false, reservar_em_orcamento: false,
  reservar_em_pedido: true, baixar_estoque_em: 'faturamento',
  tipo_custo: 'ultimo', controlar_lote: false, deposito_devolucao_id: '',
  compartilhar_produtos: false, compartilhar_clientes: false,
  compartilhar_fornecedores: false, compartilhar_marcas: false,
  compartilhar_categorias: false, compartilhar_tabelas_preco: false,
}

const ETAPAS = [
  { num: 1, label: 'Dados Básicos' },
  { num: 2, label: 'Endereço' },
  { num: 3, label: 'Contato' },
  { num: 4, label: 'Fiscal' },
  { num: 5, label: 'Comercial' },
  { num: 6, label: 'Estoque' },
  { num: 7, label: 'Compartilhamento' },
  { num: 8, label: 'Revisão' },
]

// CRT (Código de Regime Tributário) é o código numérico exigido no XML da
// NFe/NFCe — diferente do campo "regime_tributario" (texto, cadastro geral
// da empresa) já coletado na Etapa 1. Em vez de pedir de novo numa outra
// etapa, deriva o CRT a partir do regime já escolhido. Tabela oficial
// SEFAZ (só 3 valores possíveis no XML, mesmo que o cadastro interno
// distinga mais regimes pra fins comerciais/de exibição):
// 1 = Simples Nacional, 2 = Simples Nacional (excesso de sublimite),
// 3 = Regime Normal (Lucro Presumido, Lucro Real, isento e demais).
function crtDoRegimeTributario(regime: string): string {
  if (regime === 'simples_nacional_excesso') return '2'
  if (regime === 'simples_nacional' || regime === 'mei') return '1'
  return '3'
}

function Toggle({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-sm text-slate-800 font-medium">{label}</p>
        {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${value ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

function Field({ label, children, half }: { label: string; children: React.ReactNode; half?: boolean }) {
  return (
    <div className={half ? 'col-span-1' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

const INPUT = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 bg-white placeholder-slate-400'
const SELECT = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 bg-white'

type Deposito = { id: string; nome: string }

type Props = {
  grupos: Grupo[]
  empresaEditando: any | null
  depositos?: Deposito[]
  onClose: () => void
  onSaved: () => void
}

export default function NovaEmpresaWizard({ grupos, empresaEditando, depositos = [], onClose, onSaved }: Props) {
  const [etapa, setEtapa] = useState(1)
  const [form, setForm] = useState<WizardForm>(FORM_INICIAL)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [buscandoCep, setBuscandoCep] = useState(false)

  const editando = !!empresaEditando

  useEffect(() => {
    if (empresaEditando) {
      setForm({
        ...FORM_INICIAL,
        grupo_id: empresaEditando.grupo_id ?? '',
        razao_social: empresaEditando.razao_social ?? '',
        nome_fantasia: empresaEditando.nome_fantasia ?? empresaEditando.nome ?? '',
        cnpj: empresaEditando.cnpj ?? '',
        inscricao_estadual: empresaEditando.inscricao_estadual ?? '',
        inscricao_municipal: empresaEditando.inscricao_municipal ?? '',
        regime_tributario: empresaEditando.regime_tributario ?? 'simples_nacional',
        cnae: empresaEditando.cnae ?? '',
        status: empresaEditando.status ?? 'ativa',
        empresa_principal: empresaEditando.empresa_principal ?? false,
        cep: empresaEditando.cep ?? '',
        logradouro: empresaEditando.logradouro ?? '',
        numero: empresaEditando.numero ?? '',
        complemento: empresaEditando.complemento ?? '',
        bairro: empresaEditando.bairro ?? '',
        cidade: empresaEditando.cidade ?? '',
        uf: empresaEditando.uf ?? '',
        ibge: empresaEditando.ibge ?? '',
        pais: empresaEditando.pais ?? 'Brasil',
        telefone: empresaEditando.telefone ?? '',
        whatsapp: empresaEditando.whatsapp ?? '',
        email: empresaEditando.email ?? '',
        email_financeiro: empresaEditando.email_financeiro ?? '',
        email_fiscal: empresaEditando.email_fiscal ?? '',
        site: empresaEditando.site ?? '',
        responsavel_legal: empresaEditando.responsavel_legal ?? '',
        cpf_responsavel: empresaEditando.cpf_responsavel ?? '',
        contador: empresaEditando.contador ?? '',
        email_contador: empresaEditando.email_contador ?? '',
        telefone_contador: empresaEditando.telefone_contador ?? '',
        // Fiscal — antes esta etapa inteira resetava pro default a cada
        // edição, mesmo com dados já salvos (bug pré-existente, corrigido
        // aqui de passagem já que mexi nesta etapa).
        ambiente_fiscal: empresaEditando.empresa_config_fiscal?.ambiente ?? 'homologacao',
        serie_nfe: empresaEditando.empresa_config_fiscal?.serie_nfe ?? 1,
        serie_nfce: empresaEditando.empresa_config_fiscal?.serie_nfce ?? 1,
        proximo_nfe: empresaEditando.empresa_config_fiscal?.proximo_nfe ?? 1,
        proximo_nfce: empresaEditando.empresa_config_fiscal?.proximo_nfce ?? 1,
        csc_nfce: empresaEditando.empresa_config_fiscal?.csc_nfce ?? '',
        id_csc_nfce: empresaEditando.empresa_config_fiscal?.id_csc_nfce ?? '',
        cfop_venda_dentro: empresaEditando.empresa_config_fiscal?.cfop_venda_dentro ?? '5102',
        cfop_venda_fora: empresaEditando.empresa_config_fiscal?.cfop_venda_fora ?? '6102',
        cfop_compra: empresaEditando.empresa_config_fiscal?.cfop_compra ?? '1102',
        natureza_operacao: empresaEditando.empresa_config_fiscal?.natureza_operacao ?? 'Venda de Mercadorias',
        obs_fiscal: empresaEditando.empresa_config_fiscal?.observacoes ?? '',
        certificado_ref: empresaEditando.empresa_config_fiscal?.certificado_ref ?? '',
        certificado_validade: empresaEditando.empresa_config_fiscal?.certificado_validade ?? '',
        token_producao: empresaEditando.nfe_config?.credenciais?.token_producao ?? '',
        token_homologacao: empresaEditando.nfe_config?.credenciais?.token_homologacao ?? '',
        permite_multiplos_depositos: empresaEditando.empresa_config_estoque?.permite_multiplos_depositos ?? false,
        reservar_em_orcamento: empresaEditando.empresa_config_estoque?.reservar_em_orcamento ?? false,
        reservar_em_pedido: empresaEditando.empresa_config_estoque?.reservar_em_pedido ?? true,
        baixar_estoque_em: empresaEditando.empresa_config_estoque?.baixar_estoque_em ?? 'faturamento',
        tipo_custo: empresaEditando.empresa_config_estoque?.tipo_custo ?? 'ultimo',
        controlar_lote: empresaEditando.empresa_config_estoque?.controlar_lote ?? false,
        deposito_devolucao_id: empresaEditando.empresa_config_estoque?.deposito_devolucao_id ?? '',
      })
    } else {
      setForm(FORM_INICIAL)
    }
    setEtapa(1)
    setErro('')
  }, [empresaEditando])

  function set<K extends keyof WizardForm>(field: K, value: WizardForm[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function buscarCEP(cep: string) {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    setBuscandoCep(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setForm(prev => ({
          ...prev,
          logradouro: data.logradouro ?? prev.logradouro,
          bairro: data.bairro ?? prev.bairro,
          cidade: data.localidade ?? prev.cidade,
          uf: data.uf ?? prev.uf,
          ibge: data.ibge ?? prev.ibge,
        }))
      }
    } catch {}
    setBuscandoCep(false)
  }

  async function salvar() {
    setSalvando(true)
    setErro('')
    const sb = createClient()

    try {
      const dadosEmpresa = {
        nome: form.nome_fantasia || form.razao_social,
        razao_social: form.razao_social || null,
        nome_fantasia: form.nome_fantasia || null,
        cnpj: form.cnpj || null,
        inscricao_estadual: form.inscricao_estadual || null,
        inscricao_municipal: form.inscricao_municipal || null,
        regime_tributario: form.regime_tributario,
        cnae: form.cnae || null,
        status: form.status,
        empresa_principal: form.empresa_principal,
        grupo_id: form.grupo_id || null,
        cep: form.cep || null,
        logradouro: form.logradouro || null,
        numero: form.numero || null,
        complemento: form.complemento || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        uf: form.uf || null,
        ibge: form.ibge || null,
        pais: form.pais || 'Brasil',
        telefone: form.telefone || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        email_financeiro: form.email_financeiro || null,
        email_fiscal: form.email_fiscal || null,
        site: form.site || null,
        responsavel_legal: form.responsavel_legal || null,
        cpf_responsavel: form.cpf_responsavel || null,
        contador: form.contador || null,
        email_contador: form.email_contador || null,
        telefone_contador: form.telefone_contador || null,
        updated_at: new Date().toISOString(),
      }

      let empresaId: string

      if (editando) {
        const { error } = await sb.from('empresas').update(dadosEmpresa).eq('id', empresaEditando.id)
        if (error) throw error
        empresaId = empresaEditando.id
      } else {
        const { data, error } = await sb.from('empresas').insert(dadosEmpresa).select('id').single()
        if (error) throw error
        empresaId = data.id
      }

      // Config fiscal
      await sb.from('empresa_config_fiscal').upsert({
        empresa_id: empresaId,
        ambiente: form.ambiente_fiscal,
        serie_nfe: form.serie_nfe,
        serie_nfce: form.serie_nfce,
        proximo_nfe: form.proximo_nfe,
        proximo_nfce: form.proximo_nfce,
        csc_nfce: form.csc_nfce || null,
        id_csc_nfce: form.id_csc_nfce || null,
        cfop_venda_dentro: form.cfop_venda_dentro,
        cfop_venda_fora: form.cfop_venda_fora,
        cfop_compra: form.cfop_compra,
        natureza_operacao: form.natureza_operacao,
        crt: crtDoRegimeTributario(form.regime_tributario),
        certificado_ref: form.certificado_ref || null,
        certificado_validade: form.certificado_validade || null,
        observacoes: form.obs_fiscal || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })

      // Credenciais de emissão fiscal (token por ambiente). O provedor
      // (Focus NFe / Brasil NFe) NÃO é definido aqui — é decisão do admin
      // do sistema (saas-admin/fiscal), não do assinante. Numa empresa
      // nova, herda o padrão configurado pelo admin; numa edição, o campo
      // fica de fora do payload de propósito pra não sobrescrever o que
      // já foi definido (aqui ou por um override manual do admin).
      const tokenAtivo = form.ambiente_fiscal === 'homologacao' ? form.token_homologacao : form.token_producao
      const nfeConfigPayload: Record<string, any> = {
        empresa_id: empresaId,
        cnpj: form.cnpj,
        ambiente: form.ambiente_fiscal,
        credenciais: { token_producao: form.token_producao, token_homologacao: form.token_homologacao },
        focusnfe_token: tokenAtivo || null, // espelho — outras checagens no sistema ainda leem este campo direto
        ativo: !!tokenAtivo,
        updated_at: new Date().toISOString(),
      }
      if (!editando) {
        const { data: configPadrao } = await sb.from('sistema_config_fiscal').select('provider_padrao').maybeSingle()
        nfeConfigPayload.provider = configPadrao?.provider_padrao ?? 'focusnfe'
      }
      await sb.from('nfe_config').upsert(nfeConfigPayload, { onConflict: 'empresa_id' })

      // Empresa nova + provider Brasil NFe: cadastra automaticamente na
      // API deles (o token por empresa é obrigatório antes de qualquer
      // emissão funcionar) — melhor esforço, não trava a criação da
      // empresa se falhar (pode ser refeito depois em saas-admin/fiscal).
      if (!editando && nfeConfigPayload.provider === 'brasilnfe' && form.cnpj) {
        try {
          const resp = await fetch('/api/fiscal/brasilnfe/cadastrar-empresa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresaId }),
          })
          const data = await resp.json()
          if (!data.ok) alert('Empresa criada, mas o cadastro automático na Brasil NFe falhou: ' + data.erro + '\n\nVocê pode tentar de novo em saas-admin → Fiscal.')
        } catch (e: any) {
          alert('Empresa criada, mas o cadastro automático na Brasil NFe falhou: ' + (e?.message ?? 'erro desconhecido') + '\n\nVocê pode tentar de novo em saas-admin → Fiscal.')
        }
      }

      // Config comercial
      await sb.from('empresa_config_comercial').upsert({
        empresa_id: empresaId,
        limite_desconto: form.limite_desconto,
        margem_minima: form.margem_minima,
        permite_venda_sem_cliente: form.permite_venda_sem_cliente,
        permite_estoque_negativo: form.permite_estoque_negativo,
        permite_fiado: form.permite_fiado,
        permite_credito: form.permite_credito,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })

      // Config estoque
      await sb.from('empresa_config_estoque').upsert({
        empresa_id: empresaId,
        permite_multiplos_depositos: form.permite_multiplos_depositos,
        reservar_em_orcamento: form.reservar_em_orcamento,
        reservar_em_pedido: form.reservar_em_pedido,
        baixar_estoque_em: form.baixar_estoque_em,
        tipo_custo: form.tipo_custo,
        controlar_lote: form.controlar_lote,
        deposito_devolucao_id: form.deposito_devolucao_id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })

      // Compartilhamento
      await sb.from('empresa_compartilhamento_dados').upsert({
        empresa_id: empresaId,
        grupo_id: form.grupo_id || null,
        compartilhar_produtos: form.compartilhar_produtos,
        compartilhar_clientes: form.compartilhar_clientes,
        compartilhar_fornecedores: form.compartilhar_fornecedores,
        compartilhar_marcas: form.compartilhar_marcas,
        compartilhar_categorias: form.compartilhar_categorias,
        compartilhar_tabelas_preco: form.compartilhar_tabelas_preco,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })

      // Se nova empresa: criar depósito principal automaticamente — só se
      // ela ainda não tiver nenhum (evita duplicar depósito com
      // principal=true, o que não tem trava única no banco).
      if (!editando) {
        const { data: jaTemPrincipal } = await sb.from('depositos').select('id').eq('empresa_id', empresaId).eq('principal', true).limit(1).maybeSingle()
        if (!jaTemPrincipal) {
          await sb.from('depositos').insert({
            empresa_id: empresaId,
            nome: 'Depósito Principal',
            principal: true,
            ativo: true,
          })
        }
      }

      onSaved()
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao salvar empresa')
      setSalvando(false)
    }
  }

  const progresso = ((etapa - 1) / (ETAPAS.length - 1)) * 100

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[700px] bg-white h-full flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-slate-900 font-bold text-lg">
                {editando ? 'Editar Empresa' : 'Nova Empresa'}
              </h2>
              <p className="text-slate-500 text-xs mt-0.5">
                Etapa {etapa} de {ETAPAS.length} — {ETAPAS[etapa - 1].label}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
          </div>

          {/* Barra de progresso */}
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${progresso}%` }}
            />
          </div>

          {/* Steps pills */}
          <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1">
            {ETAPAS.map(e => (
              <button
                key={e.num}
                onClick={() => setEtapa(e.num)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs shrink-0 transition-colors ${
                  e.num === etapa
                    ? 'bg-blue-600 text-white font-medium'
                    : e.num < etapa
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span>{e.num < etapa ? '✓' : e.num}</span>
                <span>{e.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo da etapa */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── ETAPA 1: DADOS BÁSICOS ── */}
          {etapa === 1 && (
            <div className="space-y-4">
              <Field label="Grupo empresarial *">
                <select value={form.grupo_id} onChange={e => set('grupo_id', e.target.value)} className={SELECT}>
                  <option value="">— Selecione o grupo —</option>
                  {grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Razão Social *">
                  <input value={form.razao_social} onChange={e => set('razao_social', e.target.value)} className={INPUT} placeholder="Razão social completa" />
                </Field>
                <Field label="Nome Fantasia">
                  <input value={form.nome_fantasia} onChange={e => set('nome_fantasia', e.target.value)} className={INPUT} placeholder="Nome fantasia" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="CNPJ *">
                  <input value={form.cnpj} onChange={e => set('cnpj', e.target.value)} className={`${INPUT} font-mono`} placeholder="00.000.000/0000-00" maxLength={18} />
                </Field>
                <Field label="Inscrição Estadual">
                  <input value={form.inscricao_estadual} onChange={e => set('inscricao_estadual', e.target.value)} className={`${INPUT} font-mono`} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Inscrição Municipal">
                  <input value={form.inscricao_municipal} onChange={e => set('inscricao_municipal', e.target.value)} className={INPUT} />
                </Field>
                <Field label="CNAE Principal">
                  <input value={form.cnae} onChange={e => set('cnae', e.target.value)} className={`${INPUT} font-mono`} placeholder="0000-0/00" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Regime tributário">
                  <select value={form.regime_tributario} onChange={e => set('regime_tributario', e.target.value)} className={SELECT}>
                    <option value="simples_nacional">Simples Nacional</option>
                    <option value="simples_nacional_excesso">Simples Nacional (excesso de sublimite)</option>
                    <option value="lucro_presumido">Lucro Presumido</option>
                    <option value="lucro_real">Lucro Real</option>
                    <option value="mei">MEI</option>
                    <option value="isento">Isento</option>
                    <option value="outro">Outro</option>
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={e => set('status', e.target.value)} className={SELECT}>
                    <option value="ativa">Ativa</option>
                    <option value="em_implantacao">Em implantação</option>
                    <option value="suspensa">Suspensa</option>
                    <option value="inativa">Inativa</option>
                  </select>
                </Field>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <Toggle
                  label="Empresa principal do grupo"
                  desc="Marca esta como a empresa principal para relatórios consolidados"
                  value={form.empresa_principal}
                  onChange={v => set('empresa_principal', v)}
                />
              </div>
            </div>
          )}

          {/* ── ETAPA 2: ENDEREÇO ── */}
          {etapa === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="CEP">
                    <div className="relative">
                      <input
                        value={form.cep}
                        onChange={e => set('cep', e.target.value)}
                        onBlur={e => buscarCEP(e.target.value)}
                        className={`${INPUT} ${buscandoCep ? 'opacity-60' : ''}`}
                        placeholder="00000-000"
                        maxLength={9}
                      />
                      {buscandoCep && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-blue-500">buscando...</span>
                      )}
                    </div>
                  </Field>
                </div>
                <Field label="País">
                  <input value={form.pais} onChange={e => set('pais', e.target.value)} className={INPUT} />
                </Field>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-3">
                  <Field label="Logradouro">
                    <input value={form.logradouro} onChange={e => set('logradouro', e.target.value)} className={INPUT} placeholder="Rua, Avenida..." />
                  </Field>
                </div>
                <Field label="Número">
                  <input value={form.numero} onChange={e => set('numero', e.target.value)} className={INPUT} placeholder="Nº" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Complemento">
                  <input value={form.complemento} onChange={e => set('complemento', e.target.value)} className={INPUT} placeholder="Sala, Andar..." />
                </Field>
                <Field label="Bairro">
                  <input value={form.bairro} onChange={e => set('bairro', e.target.value)} className={INPUT} />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Cidade">
                    <input value={form.cidade} onChange={e => set('cidade', e.target.value)} className={INPUT} />
                  </Field>
                </div>
                <Field label="UF">
                  <select value={form.uf} onChange={e => set('uf', e.target.value)} className={SELECT}>
                    <option value="">UF</option>
                    {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(u => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Código IBGE do município">
                <input value={form.ibge} onChange={e => set('ibge', e.target.value)} className={`${INPUT} font-mono w-48`} placeholder="0000000" maxLength={7} />
              </Field>
            </div>
          )}

          {/* ── ETAPA 3: CONTATO & RESPONSÁVEIS ── */}
          {etapa === 3 && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Contato da empresa</p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Telefone">
                      <input value={form.telefone} onChange={e => set('telefone', e.target.value)} className={INPUT} placeholder="(00) 0000-0000" />
                    </Field>
                    <Field label="WhatsApp">
                      <input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} className={INPUT} placeholder="(00) 00000-0000" />
                    </Field>
                  </div>
                  <Field label="E-mail principal">
                    <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={INPUT} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="E-mail financeiro">
                      <input type="email" value={form.email_financeiro} onChange={e => set('email_financeiro', e.target.value)} className={INPUT} />
                    </Field>
                    <Field label="E-mail fiscal/NF-e">
                      <input type="email" value={form.email_fiscal} onChange={e => set('email_fiscal', e.target.value)} className={INPUT} />
                    </Field>
                  </div>
                  <Field label="Site">
                    <input value={form.site} onChange={e => set('site', e.target.value)} className={INPUT} placeholder="https://..." />
                  </Field>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Responsável legal</p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nome do responsável">
                      <input value={form.responsavel_legal} onChange={e => set('responsavel_legal', e.target.value)} className={INPUT} />
                    </Field>
                    <Field label="CPF do responsável">
                      <input value={form.cpf_responsavel} onChange={e => set('cpf_responsavel', e.target.value)} className={`${INPUT} font-mono`} placeholder="000.000.000-00" />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Contador</p>
                <div className="space-y-3">
                  <Field label="Nome do contador">
                    <input value={form.contador} onChange={e => set('contador', e.target.value)} className={INPUT} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="E-mail do contador">
                      <input type="email" value={form.email_contador} onChange={e => set('email_contador', e.target.value)} className={INPUT} />
                    </Field>
                    <Field label="Telefone do contador">
                      <input value={form.telefone_contador} onChange={e => set('telefone_contador', e.target.value)} className={INPUT} />
                    </Field>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ETAPA 4: FISCAL ── */}
          {etapa === 4 && (
            <div className="space-y-5">
              <div className={`p-4 rounded-xl border ${form.ambiente_fiscal === 'producao' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-sm font-semibold text-slate-800 mb-1">Ambiente fiscal</p>
                <p className="text-xs text-slate-500 mb-3">
                  {form.ambiente_fiscal === 'producao'
                    ? '✅ Produção — NFs emitidas têm validade jurídica'
                    : '🧪 Homologação — NFs de teste, sem validade fiscal'}
                </p>
                <div className="flex gap-2">
                  {['homologacao', 'producao'].map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => set('ambiente_fiscal', a)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        form.ambiente_fiscal === a
                          ? a === 'producao' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {a === 'producao' ? '✅ Produção' : '🧪 Homologação'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-600">Emissão de notas — credenciais e certificado</p>
                  <span className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                    Provedor: <strong className="text-slate-700">
                      {editando
                        ? (empresaEditando?.nfe_config?.provider === 'brasilnfe' ? 'Brasil NFe' : 'Focus NFe')
                        : 'definido automaticamente ao salvar'}
                    </strong>
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 -mt-2">O provedor é definido pelo administrador do sistema, não é escolhido aqui — só o token e o certificado.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Token — Produção">
                    <input type="password" value={form.token_producao} onChange={e => set('token_producao', e.target.value)}
                      className={`${INPUT} font-mono text-xs`} placeholder="token de produção" />
                  </Field>
                  <Field label="Token — Homologação">
                    <input type="password" value={form.token_homologacao} onChange={e => set('token_homologacao', e.target.value)}
                      className={`${INPUT} font-mono text-xs`} placeholder="token de homologação (testes)" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Certificado digital (referência)">
                    <input value={form.certificado_ref} onChange={e => set('certificado_ref', e.target.value)}
                      className={INPUT} placeholder="cadastrado no painel do provedor" />
                  </Field>
                  <Field label="Validade do certificado">
                    <input type="date" value={form.certificado_validade} onChange={e => set('certificado_validade', e.target.value)} className={INPUT} />
                  </Field>
                </div>
                <p className="text-[11px] text-slate-400">
                  O certificado A1 em si é cadastrado direto no painel do provedor fiscal (não aqui) — este campo é só uma referência/validade pra controle.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">NF-e</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Série">
                      <input type="number" min={1} value={form.serie_nfe} onChange={e => set('serie_nfe', parseInt(e.target.value) || 1)} className={INPUT} />
                    </Field>
                    <Field label="Próx. número">
                      <input type="number" min={1} value={form.proximo_nfe} onChange={e => set('proximo_nfe', parseInt(e.target.value) || 1)} className={INPUT} />
                    </Field>
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">NFC-e</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Série">
                      <input type="number" min={1} value={form.serie_nfce} onChange={e => set('serie_nfce', parseInt(e.target.value) || 1)} className={INPUT} />
                    </Field>
                    <Field label="Próx. número">
                      <input type="number" min={1} value={form.proximo_nfce} onChange={e => set('proximo_nfce', parseInt(e.target.value) || 1)} className={INPUT} />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="CSC NFC-e">
                  <input value={form.csc_nfce} onChange={e => set('csc_nfce', e.target.value)} className={`${INPUT} font-mono text-xs`} placeholder="Token CSC" />
                </Field>
                <Field label="ID CSC NFC-e">
                  <input value={form.id_csc_nfce} onChange={e => set('id_csc_nfce', e.target.value)} className={`${INPUT} font-mono text-xs`} placeholder="000001" />
                </Field>
              </div>

              <Field label="Natureza de operação padrão">
                <input value={form.natureza_operacao} onChange={e => set('natureza_operacao', e.target.value)} className={INPUT} />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="CFOP venda dentro do estado">
                  <input value={form.cfop_venda_dentro} onChange={e => set('cfop_venda_dentro', e.target.value)} className={`${INPUT} font-mono`} placeholder="5102" maxLength={5} />
                </Field>
                <Field label="CFOP venda fora do estado">
                  <input value={form.cfop_venda_fora} onChange={e => set('cfop_venda_fora', e.target.value)} className={`${INPUT} font-mono`} placeholder="6102" maxLength={5} />
                </Field>
                <Field label="CFOP de compra">
                  <input value={form.cfop_compra} onChange={e => set('cfop_compra', e.target.value)} className={`${INPUT} font-mono`} placeholder="1102" maxLength={5} />
                </Field>
              </div>

              <Field label="Observações fiscais">
                <textarea value={form.obs_fiscal} onChange={e => set('obs_fiscal', e.target.value)} rows={3}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 bg-white resize-none" />
              </Field>
            </div>
          )}

          {/* ── ETAPA 5: COMERCIAL ── */}
          {etapa === 5 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Limite máximo de desconto (%)">
                  <input type="number" min={0} max={100} step={0.5} value={form.limite_desconto}
                    onChange={e => set('limite_desconto', parseFloat(e.target.value) || 0)} className={INPUT} />
                </Field>
                <Field label="Margem mínima permitida (%)">
                  <input type="number" min={0} max={100} step={0.5} value={form.margem_minima}
                    onChange={e => set('margem_minima', parseFloat(e.target.value) || 0)} className={INPUT} />
                </Field>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 divide-y divide-slate-100">
                <Toggle label="Permitir venda sem cliente identificado" value={form.permite_venda_sem_cliente} onChange={v => set('permite_venda_sem_cliente', v)} />
                <Toggle label="Permitir venda com estoque negativo" value={form.permite_estoque_negativo} onChange={v => set('permite_estoque_negativo', v)} />
                <Toggle
                  label="Permitir fiado / venda na caderneta"
                  desc="Vendas a prazo sem geração de NF nem cobrança formal"
                  value={form.permite_fiado}
                  onChange={v => set('permite_fiado', v)}
                />
                <Toggle
                  label="Permitir crédito de cliente"
                  desc="Saldo positivo resultante de devoluções ou pagamentos excedentes"
                  value={form.permite_credito}
                  onChange={v => set('permite_credito', v)}
                />
              </div>
            </div>
          )}

          {/* ── ETAPA 6: ESTOQUE ── */}
          {etapa === 6 && (
            <div className="space-y-5">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 divide-y divide-slate-100">
                <Toggle label="Múltiplos depósitos" desc="Controlar estoque em mais de um local/depósito" value={form.permite_multiplos_depositos} onChange={v => set('permite_multiplos_depositos', v)} />
                <Toggle label="Reservar estoque em orçamento" value={form.reservar_em_orcamento} onChange={v => set('reservar_em_orcamento', v)} />
                <Toggle label="Reservar estoque em pedido" value={form.reservar_em_pedido} onChange={v => set('reservar_em_pedido', v)} />
                <Toggle label="Controlar lote e validade" desc="Preparado para uso futuro" value={form.controlar_lote} onChange={v => set('controlar_lote', v)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Baixar estoque no momento do">
                  <select value={form.baixar_estoque_em} onChange={e => set('baixar_estoque_em', e.target.value)} className={SELECT}>
                    <option value="pedido">Pedido</option>
                    <option value="faturamento">Faturamento</option>
                    <option value="pagamento">Pagamento</option>
                    <option value="separacao">Separação</option>
                  </select>
                </Field>
                <Field label="Tipo de custo">
                  <select value={form.tipo_custo} onChange={e => set('tipo_custo', e.target.value)} className={SELECT}>
                    <option value="ultimo">Último custo</option>
                    <option value="medio">Custo médio</option>
                    <option value="manual">Custo manual</option>
                  </select>
                </Field>
              </div>

              <Field label="Depósito para devoluções de venda">
                <select value={form.deposito_devolucao_id} onChange={e => set('deposito_devolucao_id', e.target.value)} className={SELECT} disabled={depositos.length === 0}>
                  <option value="">{depositos.length === 0 ? 'Nenhum depósito cadastrado ainda' : 'Selecione um depósito'}</option>
                  {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">Quando uma devolução é feita no PDV, o estoque devolvido é creditado neste depósito.</p>
              </Field>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-medium mb-1">💡 Criação automática</p>
                <p>Ao salvar, o sistema criará automaticamente um <strong>Depósito Principal</strong> para esta empresa.</p>
              </div>
            </div>
          )}

          {/* ── ETAPA 7: COMPARTILHAMENTO ── */}
          {etapa === 7 && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                <p className="font-medium mb-1">⚠️ Atenção</p>
                <p>Cadastros compartilhados são visíveis em todas as empresas do grupo. Dados financeiros, estoque, vendas e NFs nunca são compartilhados.</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {[
                  { field: 'compartilhar_produtos' as const, label: 'Compartilhar produtos', desc: 'Cadastro de produtos visível em todo o grupo' },
                  { field: 'compartilhar_clientes' as const, label: 'Compartilhar clientes', desc: 'Cadastro de clientes compartilhado' },
                  { field: 'compartilhar_fornecedores' as const, label: 'Compartilhar fornecedores', desc: 'Cadastro de fornecedores compartilhado' },
                  { field: 'compartilhar_marcas' as const, label: 'Compartilhar marcas', desc: 'Lista de marcas unificada no grupo' },
                  { field: 'compartilhar_categorias' as const, label: 'Compartilhar categorias', desc: 'Categorias de produto unificadas' },
                  { field: 'compartilhar_tabelas_preco' as const, label: 'Compartilhar tabelas de preço', desc: 'Tabelas de preço visíveis entre empresas' },
                ].map(item => (
                  <div key={item.field} className="px-4">
                    <Toggle
                      label={item.label}
                      desc={item.desc}
                      value={form[item.field]}
                      onChange={v => set(item.field, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ETAPA 8: REVISÃO ── */}
          {etapa === 8 && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                <p className="text-sm font-bold text-slate-800 mb-3">
                  {form.nome_fantasia || form.razao_social || '(sem nome)'}
                </p>

                {[
                  { label: 'Grupo', valor: grupos.find(g => g.id === form.grupo_id)?.nome ?? '—' },
                  { label: 'CNPJ', valor: form.cnpj || '—' },
                  { label: 'Regime', valor: { simples_nacional: 'Simples Nacional', simples_nacional_excesso: 'Simples Nacional (excesso de sublimite)', lucro_presumido: 'Lucro Presumido', lucro_real: 'Lucro Real', mei: 'MEI', isento: 'Isento', outro: 'Outro' }[form.regime_tributario] ?? form.regime_tributario },
                  { label: 'Status', valor: { ativa: 'Ativa', em_implantacao: 'Em implantação', suspensa: 'Suspensa', inativa: 'Inativa' }[form.status] ?? form.status },
                  { label: 'Cidade / UF', valor: form.cidade && form.uf ? `${form.cidade} / ${form.uf}` : '—' },
                  { label: 'Ambiente fiscal', valor: form.ambiente_fiscal === 'producao' ? 'Produção ✅' : 'Homologação 🧪' },
                  { label: 'NF-e', valor: `Série ${form.serie_nfe} · Próx. ${form.proximo_nfe}` },
                  { label: 'NFC-e', valor: `Série ${form.serie_nfce} · Próx. ${form.proximo_nfce}` },
                  { label: 'Limite de desconto', valor: `${form.limite_desconto}%` },
                  { label: 'Baixa de estoque', valor: { pedido: 'Pedido', faturamento: 'Faturamento', pagamento: 'Pagamento', separacao: 'Separação' }[form.baixar_estoque_em] },
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className="text-xs text-slate-800 font-medium">{row.valor}</span>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-medium mb-1">✅ O sistema irá criar automaticamente:</p>
                <ul className="space-y-0.5 ml-3 list-disc text-blue-600">
                  <li>Depósito Principal</li>
                  <li>Configurações fiscais (ambiente: {form.ambiente_fiscal})</li>
                  <li>Configurações comerciais e de estoque</li>
                  <li>Configurações de compartilhamento</li>
                </ul>
              </div>

              {erro && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                  {erro}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — navegação */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-white">
          <button
            onClick={() => etapa > 1 ? setEtapa(e => e - 1) : onClose()}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {etapa === 1 ? 'Cancelar' : '← Anterior'}
          </button>

          <div className="flex items-center gap-2">
            {etapa < ETAPAS.length ? (
              <button
                onClick={() => setEtapa(e => e + 1)}
                className="px-5 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
              >
                Próximo →
              </button>
            ) : (
              <button
                onClick={salvar}
                disabled={salvando}
                className="px-6 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors font-medium"
              >
                {salvando ? 'Criando empresa...' : editando ? '✓ Salvar alterações' : '✓ Criar empresa'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
