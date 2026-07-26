'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NovaEmpresaWizard from './NovaEmpresaWizard'

type ConfigFiscal = {
  ambiente: string | null
  certificado_validade: string | null
  serie_nfe: number | null
  proximo_nfe: number | null
}

type Empresa = {
  id: string
  nome: string
  razao_social: string | null
  nome_fantasia: string | null
  cnpj: string | null
  inscricao_estadual: string | null
  regime_tributario: string | null
  status: string
  empresa_principal: boolean
  cidade: string | null
  uf: string | null
  telefone: string | null
  email: string | null
  logo_url: string | null
  cor_primaria: string | null
  created_at: string
  grupo_id: string | null
  grupos_empresariais: { id: string; nome: string } | null
  empresa_config_fiscal: ConfigFiscal | null
  empresa_config_comercial: { id: string } | null
  empresa_config_estoque: {
    id: string
    permite_multiplos_depositos: boolean | null
    reservar_em_orcamento: boolean | null
    reservar_em_pedido: boolean | null
    baixar_estoque_em: string | null
    tipo_custo: string | null
    controlar_lote: boolean | null
    deposito_devolucao_id: string | null
  } | null
}

type Grupo = { id: string; nome: string }
type Deposito = { id: string; nome: string; empresa_id: string }

type Props = {
  empresas: Empresa[]
  grupos: Grupo[]
  empresaAtualId: string
  tenantId: string
  depositosPorEmpresa: string[]
  depositos: Deposito[]
  role: string
}

const STATUS_LABEL: Record<string, string> = {
  ativa: 'Ativa',
  inativa: 'Inativa',
  suspensa: 'Suspensa',
  em_implantacao: 'Em implantação',
}

const STATUS_COR: Record<string, string> = {
  ativa: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
  inativa: 'bg-slate-100 text-slate-500 border border-slate-200',
  suspensa: 'bg-red-50 text-red-600 border border-red-200',
  em_implantacao: 'bg-amber-50 text-amber-600 border border-amber-200',
}

const REGIME_LABEL: Record<string, string> = {
  simples_nacional: 'Simples Nacional',
  simples_nacional_excesso: 'Simples Nacional (excesso de sublimite)',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI',
  isento: 'Isento',
  outro: 'Outro',
}

function formatCNPJ(cnpj: string): string {
  const n = cnpj.replace(/\D/g, '')
  if (n.length !== 14) return cnpj
  return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`
}

function diasParaVencer(validade: string | null): number | null {
  if (!validade) return null
  const hoje = new Date()
  const venc = new Date(validade)
  return Math.ceil((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
}

function calcularAlertas(e: Empresa, temDeposito: boolean) {
  const alertas: { msg: string; cor: string; icone: string; urgente: boolean }[] = []

  const fiscal = e.empresa_config_fiscal
  if (!fiscal) {
    alertas.push({ msg: 'Configuração fiscal não iniciada', cor: 'text-amber-600', icone: '⚠️', urgente: true })
  } else {
    if (fiscal.ambiente === 'homologacao') {
      alertas.push({ msg: 'Ambiente fiscal: Homologação', cor: 'text-amber-500', icone: '🧪', urgente: false })
    }
    const dias = diasParaVencer(fiscal.certificado_validade)
    if (dias !== null) {
      if (dias < 0) alertas.push({ msg: 'Certificado digital VENCIDO', cor: 'text-red-600', icone: '🔴', urgente: true })
      else if (dias <= 30) alertas.push({ msg: `Certificado vence em ${dias} dias`, cor: 'text-amber-600', icone: '⚠️', urgente: true })
    }
  }

  if (!e.empresa_config_comercial) {
    alertas.push({ msg: 'Configurações comerciais incompletas', cor: 'text-slate-500', icone: '📋', urgente: false })
  }
  if (!temDeposito) {
    alertas.push({ msg: 'Sem depósito principal cadastrado', cor: 'text-amber-600', icone: '🏭', urgente: false })
  }

  return alertas
}

function EmpresaCard({
  empresa,
  ativa,
  temDeposito,
  onEditar,
}: {
  empresa: Empresa
  ativa: boolean
  temDeposito: boolean
  onEditar: (e: Empresa) => void
}) {
  const alertas = calcularAlertas(empresa, temDeposito)
  const temAlerta = alertas.some(a => a.urgente)
  const nomeExibido = empresa.nome_fantasia || empresa.razao_social || empresa.nome

  return (
    <div className={`bg-white border rounded-2xl shadow-sm flex flex-col transition-shadow hover:shadow-md ${
      ativa ? 'border-blue-300 ring-2 ring-blue-100' : temAlerta ? 'border-amber-200' : 'border-slate-100'
    }`}>
      {/* Header do card */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {empresa.empresa_principal && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-200 rounded-full">
                  ⭐ PRINCIPAL
                </span>
              )}
              {ativa && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-full">
                  EMPRESA ATIVA
                </span>
              )}
              <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${STATUS_COR[empresa.status] ?? STATUS_COR.inativa}`}>
                {STATUS_LABEL[empresa.status] ?? empresa.status}
              </span>
            </div>

            {/* Nome */}
            <h3 className="text-slate-900 font-bold text-base leading-tight truncate">{nomeExibido}</h3>
            {empresa.razao_social && empresa.razao_social !== nomeExibido && (
              <p className="text-slate-500 text-sm truncate mt-0.5">{empresa.razao_social}</p>
            )}
            {empresa.cnpj && (
              <p className="text-slate-400 text-xs font-mono mt-1">{formatCNPJ(empresa.cnpj)}</p>
            )}
          </div>

          {/* Ícone empresa */}
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xl shrink-0"
            style={{ background: empresa.cor_primaria ?? '#2563eb' }}
          >
            🏢
          </div>
        </div>

        {/* Detalhes */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          {empresa.grupos_empresariais && (
            <span className="flex items-center gap-1">
              <span className="text-slate-300">▸</span>
              {empresa.grupos_empresariais.nome}
            </span>
          )}
          {empresa.regime_tributario && (
            <span>{REGIME_LABEL[empresa.regime_tributario] ?? empresa.regime_tributario}</span>
          )}
          {empresa.cidade && empresa.uf && (
            <span>{empresa.cidade} / {empresa.uf}</span>
          )}
        </div>

        {/* Alertas */}
        {alertas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
            {alertas.map((a, i) => (
              <div key={i} className={`flex items-center gap-1.5 text-xs ${a.cor}`}>
                <span>{a.icone}</span>
                <span>{a.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer com ações */}
      <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
        <button
          onClick={() => onEditar(empresa)}
          className="flex-1 px-3 py-1.5 text-xs border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
        >
          ✎ Editar
        </button>
        <button className="flex-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium">
          ⚙ Configurações
        </button>
      </div>
    </div>
  )
}

export default function EmpresasClient({
  empresas: inicial,
  grupos,
  empresaAtualId,
  tenantId,
  depositosPorEmpresa,
  depositos,
  role,
}: Props) {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>(inicial)
  // router.refresh() busca props novas do servidor, mas useState só usa o
  // valor inicial — sem isso a lista fica travada na primeira carga mesmo
  // depois de salvar (mesmo bug já corrigido antes em PedidosEcommerceClient.tsx).
  useEffect(() => { setEmpresas(inicial) }, [inicial])
  const [busca, setBusca] = useState('')
  const [filtroGrupo, setFiltroGrupo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [wizardAberto, setWizardAberto] = useState(false)
  const [editando, setEditando] = useState<Empresa | null>(null)

  const empresasFiltradas = useMemo(() => {
    return empresas.filter(e => {
      const texto = busca.toLowerCase()
      const matchBusca = !busca || [
        e.nome, e.nome_fantasia, e.razao_social, e.cnpj
      ].some(v => v?.toLowerCase().includes(texto))
      const matchGrupo = !filtroGrupo || e.grupo_id === filtroGrupo
      const matchStatus = !filtroStatus || e.status === filtroStatus
      return matchBusca && matchGrupo && matchStatus
    })
  }, [empresas, busca, filtroGrupo, filtroStatus])

  const totalAtivas = empresas.filter(e => e.status === 'ativa').length
  const totalAlertas = empresas.filter(e =>
    calcularAlertas(e, depositosPorEmpresa.includes(e.id)).some(a => a.urgente)
  ).length

  function onSaved() {
    setWizardAberto(false)
    setEditando(null)
    router.refresh()
  }

  function abrirEditar(e: Empresa) {
    setEditando(e)
    setWizardAberto(true)
  }

  return (
    <>
      {/* Wizard */}
      {wizardAberto && (
        <NovaEmpresaWizard
          grupos={grupos}
          tenantId={tenantId}
          empresaEditando={editando}
          depositos={editando ? depositos.filter(d => d.empresa_id === editando.id) : []}
          onClose={() => { setWizardAberto(false); setEditando(null) }}
          onSaved={onSaved}
        />
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
        <span className="hover:text-slate-600 cursor-pointer">início</span>
        <span>›</span>
        <span className="hover:text-slate-600 cursor-pointer">configurações</span>
        <span>›</span>
        <span className="text-slate-600 font-medium">empresas</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Empresas</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Gerencie suas empresas, grupos e configurações por CNPJ
          </p>
        </div>
        <button
          onClick={() => { setEditando(null); setWizardAberto(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Nova Empresa
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          {
            label: 'Total de empresas',
            valor: empresas.length,
            icon: '🏢',
            bg: 'bg-blue-50',
            cor: 'text-blue-600',
            borda: 'border-blue-100',
          },
          {
            label: 'Empresas ativas',
            valor: totalAtivas,
            icon: '✅',
            bg: 'bg-emerald-50',
            cor: 'text-emerald-600',
            borda: 'border-emerald-100',
          },
          {
            label: 'Com alertas',
            valor: totalAlertas,
            icon: '⚠️',
            bg: totalAlertas > 0 ? 'bg-amber-50' : 'bg-slate-50',
            cor: totalAlertas > 0 ? 'text-amber-600' : 'text-slate-400',
            borda: totalAlertas > 0 ? 'border-amber-100' : 'border-slate-100',
          },
        ].map(stat => (
          <div key={stat.label} className={`${stat.bg} border ${stat.borda} rounded-2xl p-4 flex items-center gap-3`}>
            <div className="text-2xl">{stat.icon}</div>
            <div>
              <p className={`text-2xl font-bold ${stat.cor}`}>{stat.valor}</p>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CNPJ ou razão social..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 bg-white"
          />
        </div>

        <select
          value={filtroGrupo}
          onChange={e => setFiltroGrupo(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:border-blue-400"
        >
          <option value="">Todos os grupos</option>
          {grupos.map(g => (
            <option key={g.id} value={g.id}>{g.nome}</option>
          ))}
        </select>

        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:border-blue-400"
        >
          <option value="">Todos os status</option>
          <option value="ativa">Ativa</option>
          <option value="em_implantacao">Em implantação</option>
          <option value="suspensa">Suspensa</option>
          <option value="inativa">Inativa</option>
        </select>

        {(busca || filtroGrupo || filtroStatus) && (
          <button
            onClick={() => { setBusca(''); setFiltroGrupo(''); setFiltroStatus('') }}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
          >
            ⊗ limpar
          </button>
        )}
      </div>

      {/* Grid de cards */}
      {empresasFiltradas.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-5xl mb-3">🏢</p>
          <p className="text-base font-medium text-slate-500">
            {empresas.length === 0 ? 'Nenhuma empresa cadastrada' : 'Nenhuma empresa encontrada'}
          </p>
          {empresas.length === 0 && (
            <button
              onClick={() => setWizardAberto(true)}
              className="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              + Criar primeira empresa
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {empresasFiltradas.map(e => (
            <EmpresaCard
              key={e.id}
              empresa={e}
              ativa={e.id === empresaAtualId}
              temDeposito={depositosPorEmpresa.includes(e.id)}
              onEditar={abrirEditar}
            />
          ))}
        </div>
      )}
    </>
  )
}
