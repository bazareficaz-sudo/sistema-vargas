'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PagarContasModal from '@/components/contas-pagar/PagarContasModal'
import NovaDespesaModal from '@/components/contas-pagar/NovaDespesaModal'
import type { OrigemDaConta } from '@/lib/contas/origemDaConta'
import {
  painelDoPagar, passaNaSituacao, situacaoDaConta, intervaloDoPeriodo, noIntervalo, grupoDaConta,
  diaMes, diasEntre, nomeDoMes, linhaCsv,
  type Situacao, type Periodo, type Agrupamento,
} from '@/lib/contas/agendaPagar'
import { lerValor, patchDaEdicao } from '@/lib/contas/editarConta'
import { chaveDoFornecedor, type EmpresaPagar } from '@/lib/contas/empresasPagar'
import SeletorEmpresasPagar, { gravarEscolha, EtiquetaEmpresa } from '@/components/contas-pagar/SeletorEmpresasPagar'

export type ContaPagar = {
  id: string; empresa_id: string; descricao: string; valor: number; vencimento: string
  status: string; data_pagamento: string | null; forma_pagamento: string | null
  parcela: number; total_parcelas: number; observacoes: string | null
  valor_pago: number | null; juros: number | null; multa: number | null
  valor_original?: number | null; vencimento_original?: string | null
  tipo_despesa_id: string | null; competencia: string | null
  fornecedor_id: string | null
  fornecedores: { id?: string; razao_social: string; nome_fantasia: string | null; cnpj?: string | null } | null
  origemDoc: OrigemDaConta | null
  pedidoDoc: OrigemDaConta | null
  obsDaEntrada: string | null
}
type Conta = ContaPagar
type Tipo = { id: string; nome: string; cor: string | null; empresa_id?: string }

type Filtro = {
  situacao: Situacao; periodo: Periodo; de: string; ate: string; q: string
  fornecedor: string; tipo: string; agrupar: Agrupamento
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
const dataBr = (iso: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''

function rotuloCompetencia(iso: string) {
  const [a, m] = iso.split('-').map(Number)
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

const SITUACOES: [Situacao, string][] = [
  ['aberto', 'Em aberto'], ['vencido', 'Vencidos'], ['a_vencer', 'A vencer'],
  ['pago', 'Pagos'], ['todos', 'Todos'], ['cancelado', 'Cancelados'],
]
const PERIODOS: [Periodo, string][] = [
  ['todos', 'Qualquer data'], ['hoje', 'Hoje'], ['semana', 'Esta semana'], ['proxima_semana', 'Semana que vem'],
  ['mes', 'Este mês'], ['proximo_mes', 'Próximo mês'], ['personalizado', 'Escolher datas…'],
]
const AGRUPAR: [Agrupamento, string][] = [
  ['semana', 'Agrupar por semana'], ['dia', 'Agrupar por dia'], ['mes', 'Agrupar por mês'],
  ['fornecedor', 'Agrupar por fornecedor'], ['nenhum', 'Sem agrupar'],
]

const BADGE: Record<string, [string, string]> = {
  a_vencer:  ['bg-yellow-100 text-yellow-700', 'A vencer'],
  vencido:   ['bg-red-100 text-red-600', 'Vencido'],
  pago:      ['bg-green-100 text-green-700', 'Pago'],
  cancelado: ['bg-gray-100 text-gray-500', 'Cancelado'],
}

const PADRAO: Filtro = { situacao: 'aberto', periodo: 'todos', de: '', ate: '', q: '', fornecedor: '', tipo: '', agrupar: 'semana' }

function Cartao({ titulo, valor, linha, cor, onClick, marcado, destaque, porEmpresa }: {
  titulo: string; valor: number; linha: React.ReactNode; cor: string; onClick: () => void; marcado: boolean; destaque?: string
  /** Com mais de uma empresa na tela: quanto do valor é de cada uma. */
  porEmpresa?: { empresa: EmpresaPagar; valor: number }[]
}) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${marcado ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 hover:border-gray-300'} ${destaque ?? 'bg-white'}`}>
      <p className="text-[11px] text-gray-500 truncate">{titulo}</p>
      <p className={`text-lg sm:text-xl font-bold ${cor}`}>{fmt(valor)}</p>
      <p className="text-[11px] text-gray-500 leading-tight">{linha}</p>
      {porEmpresa && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-0.5">
          {porEmpresa.map(({ empresa, valor: v }) => (
            <p key={empresa.id} className="flex items-center justify-between gap-1 text-[11px] leading-tight">
              <span className="inline-flex items-center gap-1 min-w-0 text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: empresa.cor }} />
                <span className="truncate">{empresa.curto}</span>
              </span>
              <span className={v ? 'text-gray-800 font-medium' : 'text-gray-300'}>{fmt(v)}</span>
            </p>
          ))}
        </div>
      )}
    </button>
  )
}

export default function ContasPagarClient({
  contas: inicial, tipos, desde, filtroInicial, empresaId, empresas, empresasIniciais, hojeIso,
}: {
  /** Todas as contas em aberto + pagas/canceladas desde `desde`. */
  contas: Conta[]
  tipos: Tipo[]
  desde: string
  filtroInicial: Record<string, string>
  /** A empresa em que a sessão está trabalhando. */
  empresaId: string
  /** Empresas que o usuário pode ver aqui; mais de uma liga o seletor. */
  empresas: EmpresaPagar[]
  empresasIniciais: string[]
  hojeIso: string
}) {
  const router = useRouter()
  // A LISTA PRECISA SEGUIR O SERVIDOR, e `useState(inicial)` não segue.
  //
  // `useState(x)` usa `x` UMA vez, na primeira renderização. Depois de pagar
  // ou criar despesa, `router.refresh()` traz a lista nova como prop — mas o
  // componente não é remontado. O estado local existe porque pagar, cancelar
  // e editar a OBS atualizam a linha na hora; então ressincroniza quando a
  // prop muda, durante a renderização (o padrão que o React documenta, e o
  // lint deste projeto proíbe setState em efeito).
  const [contas, setContas] = useState(inicial)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [baseDoServidor, setBaseDoServidor] = useState(inicial)
  if (inicial !== baseDoServidor) {
    setBaseDoServidor(inicial)
    setContas(inicial)
    // Marcação some junto: pagar em massa uma seleção que mudou por baixo é
    // exatamente o que não pode acontecer.
    setSelecionadas(new Set())
  }
  const [modalPgto, setModalPgto] = useState<Conta[] | null>(null)
  const [modalNova, setModalNova] = useState(false)

  // FILTROS NA TELA, não no servidor. A lista inteira já está aqui (são
  // centenas de linhas, não milhares), então combinar "vencidos + a vencer",
  // "desta semana", "deste fornecedor" é instantâneo — e os cartões do topo
  // somam sobre os mesmos dados que a lista mostra.
  const [f, setF] = useState<Filtro>(() => ({
    ...PADRAO,
    situacao: (SITUACOES.some(([s]) => s === filtroInicial.situacao) ? filtroInicial.situacao : 'aberto') as Situacao,
    periodo: (PERIODOS.some(([p]) => p === filtroInicial.periodo) ? filtroInicial.periodo : 'todos') as Periodo,
    de: filtroInicial.de ?? '', ate: filtroInicial.ate ?? '', q: filtroInicial.q ?? '',
  }))
  const [ordem, setOrdem] = useState<'vencimento' | 'fornecedor' | 'valor'>('vencimento')

  // EMPRESAS. As contas de todas as empresas permitidas já vieram; escolher
  // quais mostrar é um filtro como os outros, e a escolha fica gravada para
  // a próxima vez.
  const [empresasSel, setEmpresasSel] = useState(empresasIniciais)
  const infoEmpresa = new Map(empresas.map(e => [e.id, e]))
  const variasEmpresas = empresasSel.length > 1
  function escolherEmpresas(ids: string[]) {
    setEmpresasSel(ids)
    gravarEscolha(ids, empresas.map(e => e.id))
    if (!ids.length || (ids.length < 2 && f.agrupar === 'empresa')) mudar({ agrupar: 'semana' })
  }

  function mudar(p: Partial<Filtro>) {
    const novo = { ...f, ...p }
    setF(novo)
    // O endereço guarda o recorte: dá para voltar, favoritar ou mandar o link.
    const sp = new URLSearchParams()
    if (novo.situacao !== 'aberto') sp.set('situacao', novo.situacao)
    if (novo.periodo !== 'todos') sp.set('periodo', novo.periodo)
    if (novo.periodo === 'personalizado') { if (novo.de) sp.set('de', novo.de); if (novo.ate) sp.set('ate', novo.ate) }
    if (novo.q) sp.set('q', novo.q)
    window.history.replaceState(null, '', `?${sp.toString()}`)
  }

  const nomeForn = (c: Conta) => c.fornecedores?.nome_fantasia || c.fornecedores?.razao_social || ''
  const nomeTipo = new Map(tipos.map(t => [t.id, t]))
  // Cada empresa tem a sua lista de tipos; o filtro junta pelo NOME, para
  // "Energia" das duas empresas ser uma opção só.
  const chaveTipo = (id: string | null) => (id ? nomeTipo.get(id)?.nome.trim().toLowerCase() ?? id : '__sem__')
  const tiposVisiveis = [...new Map(tipos
    .filter(t => !t.empresa_id || empresasSel.includes(t.empresa_id))
    .map(t => [t.nome.trim().toLowerCase(), t.nome])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))

  const dasEmpresas = contas.filter(c => empresasSel.includes(c.empresa_id))

  // Seletor de fornecedor: só quem tem conta carregada, com quantas estão em
  // aberto. POR CNPJ (ou id), NÃO POR NOME — dois homônimos somariam a dívida
  // dos dois; e o mesmo fornecedor nas duas empresas, que são dois cadastros,
  // vira uma opção só pelo CNPJ.
  const chaveForn = (c: Conta) => chaveDoFornecedor(c.fornecedor_id, c.fornecedores?.cnpj)
  const fornecedores = (() => {
    const m = new Map<string, { nome: string; abertas: number }>()
    for (const c of dasEmpresas) {
      if (c.status === 'cancelado') continue
      const id = chaveForn(c)
      const at = m.get(id) ?? { nome: nomeForn(c) || '(sem fornecedor)', abertas: 0 }
      if (c.status !== 'pago') at.abertas += 1
      m.set(id, at)
    }
    return [...m.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))
  })()

  const buscaNorm = f.q.trim().toLowerCase()
  const casaBusca = (c: Conta) => !buscaNorm || [
    c.descricao, nomeForn(c), c.origemDoc?.rotulo, c.observacoes, c.obsDaEntrada,
    Number(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
  ].some(t => String(t ?? '').toLowerCase().includes(buscaNorm))

  // Fornecedor e tipo valem para tudo, inclusive os cartões: escolher um
  // fornecedor responde "quanto devo a ele, vencido, nesta semana, neste mês".
  const doRecorte = dasEmpresas.filter(c =>
    (!f.fornecedor || chaveForn(c) === f.fornecedor)
    && (!f.tipo || chaveTipo(c.tipo_despesa_id) === f.tipo))
  const painel = painelDoPagar(doRecorte, hojeIso)
  const paineisPorEmpresa = variasEmpresas
    ? empresas.filter(e => empresasSel.includes(e.id)).map(e => ({ empresa: e, p: painelDoPagar(doRecorte.filter(c => c.empresa_id === e.id), hojeIso) }))
    : null
  const divisao = (campo: (p: typeof painel) => number) =>
    paineisPorEmpresa?.map(({ empresa, p }) => ({ empresa, valor: campo(p) }))

  const intervalo = intervaloDoPeriodo(f.periodo, hojeIso, f.de, f.ate)
  const base = doRecorte.filter(c => noIntervalo(c.vencimento, intervalo) && casaBusca(c))
  const contagem = Object.fromEntries(SITUACOES.map(([s]) => [s, base.filter(c => passaNaSituacao(c, s, hojeIso)).length]))

  const filtradas = base
    .filter(c => passaNaSituacao(c, f.situacao, hojeIso))
    .sort((a, b) => {
      if (ordem === 'fornecedor') {
        const porNome = nomeForn(a).localeCompare(nomeForn(b), 'pt-BR')
        if (porNome !== 0) return porNome
      }
      if (ordem === 'valor') return Number(b.valor) - Number(a.valor)
      return String(a.vencimento ?? '').localeCompare(String(b.vencimento ?? ''))
    })

  type Grupo = { chave: string; rotulo: string; atraso?: boolean; contas: Conta[]; total: number }
  const grupos: Grupo[] = (() => {
    if (f.agrupar === 'nenhum') return [{ chave: '', rotulo: '', contas: filtradas, total: 0 }]
    const m = new Map<string, Grupo>()
    for (const c of filtradas) {
      const g = grupoDaConta({ ...c, fornecedorNome: nomeForn(c), empresaNome: infoEmpresa.get(c.empresa_id)?.nome }, f.agrupar, hojeIso)
      const at = m.get(g.chave) ?? { ...g, contas: [], total: 0 }
      at.contas.push(c); at.total += Number(c.valor)
      m.set(g.chave, at)
    }
    return [...m.values()].sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR'))
  })()

  const somaDe = (l: Conta[]) => l.reduce((s, c) => s + Number(c.valor), 0)
  const totalFiltrado = somaDe(filtradas)
  const abertoFiltrado = somaDe(filtradas.filter(c => c.status !== 'pago'))
  const pagoFiltrado = totalFiltrado - abertoFiltrado

  // Conta paga ou cancelada não entra em pagamento em massa. O que será pago
  // é a interseção do que está marcado com o que está NA TELA: se o filtro
  // muda depois de marcar, o que saiu de vista não vai junto sem ser visto.
  const podePagar = (c: Conta) => c.status !== 'pago' && c.status !== 'cancelado'
  const selecionaveis = filtradas.filter(podePagar)
  const marcadas = selecionaveis.filter(c => selecionadas.has(c.id))

  function marcar(ids: string[], sim: boolean) {
    setSelecionadas(prev => { const n = new Set(prev); for (const id of ids) { if (sim) n.add(id); else n.delete(id) } return n })
  }

  // A gravação em si é do modal — ele é quem sabe o rateio de juros/multa por
  // conta. Aqui só refletimos o resultado na lista.
  function aplicarPagamento(ids: string[], dados: { data: string; forma: string }) {
    setContas(prev => prev.map(c => ids.includes(c.id)
      ? { ...c, status: 'pago', data_pagamento: dados.data, forma_pagamento: dados.forma }
      : c))
    setSelecionadas(new Set())
    setModalPgto(null)
    router.refresh()
  }

  // OBS editável direto na linha: é uma frase curta ("boleto no email do dia
  // 12"), e abrir uma janela para quinze caracteres custa mais que o texto.
  const [editandoObs, setEditandoObs] = useState<string | null>(null)
  const [rascunhoObs, setRascunhoObs] = useState('')
  const [salvandoObs, setSalvandoObs] = useState(false)

  function abrirObs(c: Conta) { setEditandoObs(c.id); setRascunhoObs(c.observacoes ?? '') }

  async function salvarObs(id: string) {
    const texto = rascunhoObs.trim()
    const anterior = contas.find(c => c.id === id)?.observacoes ?? ''
    if (texto === anterior.trim()) { setEditandoObs(null); return }
    setSalvandoObs(true)
    const { error } = await createClient().from('contas_pagar').update({ observacoes: texto || null }).eq('id', id)
    setSalvandoObs(false)
    if (error) {
      // Não fecha o campo: o texto continua na tela para não se perder.
      alert(`Não foi possível salvar a observação: ${error.message}`)
      return
    }
    setContas(prev => prev.map(c => c.id === id ? { ...c, observacoes: texto || null } : c))
    setEditandoObs(null)
  }

  // VALOR E VENCIMENTO EDITÁVEIS NA LINHA — boleto prorrogado ou com valor
  // corrigido não precisa mais ser cancelado e lançado de novo (o que perdia
  // a NF de origem, a parcela e a OBS). Clica no valor ou na data, digita,
  // Enter grava; Esc desiste. As regras (as duas colunas de vencimento, a
  // situação que acompanha a data, o original guardado) estão em
  // editarConta.ts.
  const [edicao, setEdicao] = useState<{ id: string; campo: 'valor' | 'vencimento' } | null>(null)
  const [rascunhoEd, setRascunhoEd] = useState('')
  const [salvandoEd, setSalvandoEd] = useState(false)

  function abrirEdicao(c: Conta, campo: 'valor' | 'vencimento') {
    if (!podePagar(c)) return
    setEdicao({ id: c.id, campo })
    setRascunhoEd(campo === 'valor'
      ? Number(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(c.vencimento ?? '').slice(0, 10))
  }

  async function salvarEdicao(c: Conta) {
    if (!edicao || salvandoEd) return
    const mudanca = edicao.campo === 'valor' ? { valor: lerValor(rascunhoEd) } : { vencimento: rascunhoEd }
    const { patch, erro } = patchDaEdicao(c, mudanca, hojeIso)
    if (erro) { alert(erro); return }
    if (!patch) { setEdicao(null); return }
    setSalvandoEd(true)
    const { error } = await createClient().from('contas_pagar').update(patch).eq('id', c.id)
    setSalvandoEd(false)
    if (error) { alert(`Não foi possível salvar: ${error.message}`); return }
    setContas(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x))
    setEdicao(null)
  }

  function campoEdicao(c: Conta, campo: 'valor' | 'vencimento', classe: string) {
    return (
      <input autoFocus type={campo === 'vencimento' ? 'date' : 'text'} inputMode={campo === 'valor' ? 'decimal' : undefined}
        value={rascunhoEd} disabled={salvandoEd}
        onChange={e => setRascunhoEd(e.target.value)}
        onBlur={() => void salvarEdicao(c)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void salvarEdicao(c) }
          if (e.key === 'Escape') setEdicao(null)
        }}
        onFocus={e => { if (campo === 'valor') e.target.select() }}
        className={`border border-blue-400 rounded px-1.5 py-1 text-base sm:text-xs focus:outline-none bg-white ${classe}`} />
    )
  }

  const editando = (c: Conta, campo: 'valor' | 'vencimento') => edicao?.id === c.id && edicao.campo === campo

  /** Valor da linha: clicável quando a conta está em aberto. */
  function valorDaConta(c: Conta, classe: string) {
    if (editando(c, 'valor')) return campoEdicao(c, 'valor', 'w-28 text-right')
    const alterado = c.valor_original != null && Math.abs(Number(c.valor_original) - Number(c.valor)) >= 0.005
    const texto = (
      <>
        <span className={classe}>{fmt(Number(c.valor))}</span>
        {alterado && <span className="block text-[10px] text-gray-400 font-normal" title="Valor original da conta">era {fmt(Number(c.valor_original))}</span>}
      </>
    )
    if (!podePagar(c)) return texto
    return (
      <button type="button" onClick={() => abrirEdicao(c, 'valor')} title="Clique para alterar o valor"
        className="text-right rounded hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 px-1 -mx-1 cursor-text">
        {texto}
      </button>
    )
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar esta conta?')) return
    await createClient().from('contas_pagar').update({ status: 'cancelado' }).eq('id', id)
    setContas(prev => prev.map(c => c.id === id ? { ...c, status: 'cancelado' } : c))
  }

  function exportar() {
    const comEmpresa = empresas.length > 1
    const cab = [...(comEmpresa ? ['Empresa'] : []), 'Vencimento', 'Descrição', 'Fornecedor', 'Documento', 'Tipo de despesa', 'Competência', 'Parcela',
      'Valor', 'Situação', 'Pago em', 'Forma', 'Valor pago', 'Observação']
    const linhas = filtradas.map(c => linhaCsv([
      ...(comEmpresa ? [infoEmpresa.get(c.empresa_id)?.nome ?? ''] : []),
      dataBr(c.vencimento), c.descricao, nomeForn(c), c.origemDoc?.rotulo ?? '',
      c.tipo_despesa_id ? nomeTipo.get(c.tipo_despesa_id)?.nome ?? '' : '',
      c.competencia ? c.competencia.slice(0, 7) : '', c.total_parcelas > 1 ? `${c.parcela}/${c.total_parcelas}` : '',
      Number(c.valor), BADGE[situacaoDaConta(c, hojeIso)]?.[1] ?? c.status, dataBr(c.data_pagamento), c.forma_pagamento ?? '',
      c.valor_pago != null ? Number(c.valor_pago) : null, c.observacoes ?? '',
    ]))
    const blob = new Blob(['﻿' + [linhaCsv(cab), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `contas-a-pagar_${hojeIso}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const filtrosAtivos = f.periodo !== 'todos' || f.q || f.fornecedor || f.tipo || f.situacao !== 'aberto'
  const nomeDoFornecedor = f.fornecedor ? fornecedores.find(([id]) => (id || '__sem__') === f.fornecedor)?.[1].nome : null
  const ativo = (s: Situacao, p: Periodo) => f.situacao === s && f.periodo === p

  // ── Pedaços da linha, usados na tabela e no cartão do celular ──
  function vencimento(c: Conta) {
    if (editando(c, 'vencimento')) return campoEdicao(c, 'vencimento', 'w-36')
    const s = situacaoDaConta(c, hojeIso)
    const dias = diasEntre(hojeIso, c.vencimento)
    const original = c.vencimento_original && c.vencimento_original.slice(0, 10) !== String(c.vencimento).slice(0, 10)
      ? c.vencimento_original : null
    const conteudo = (
      <>
        <span className="text-xs text-gray-700">{dataBr(c.vencimento)}</span>
        {(s === 'vencido' || s === 'a_vencer') && (
          <span className={`block text-[11px] ${dias < 0 ? 'text-red-600 font-medium' : dias === 0 ? 'text-orange-600 font-medium' : dias <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
            {dias < 0 ? `${-dias}d de atraso` : dias === 0 ? 'vence hoje' : dias === 1 ? 'amanhã' : `em ${dias}d`}
          </span>
        )}
        {original && <span className="block text-[10px] text-gray-400" title="Vencimento original da conta">era {dataBr(original)}</span>}
      </>
    )
    if (!podePagar(c)) return conteudo
    return (
      <button type="button" onClick={() => abrirEdicao(c, 'vencimento')} title="Clique para alterar o vencimento"
        className="text-left rounded hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 px-1 -mx-1 cursor-text">
        {conteudo}
      </button>
    )
  }

  function situ(c: Conta) {
    const [cls, txt] = BADGE[situacaoDaConta(c, hojeIso)] ?? ['bg-gray-100 text-gray-500', c.status]
    return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{txt}</span>
  }

  function obs(c: Conta) {
    if (editandoObs === c.id) return (
      <input autoFocus value={rascunhoObs} disabled={salvandoObs}
        onChange={e => setRascunhoObs(e.target.value)}
        onBlur={() => void salvarObs(c.id)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void salvarObs(c.id) }
          if (e.key === 'Escape') setEditandoObs(null)
        }}
        placeholder="observação..."
        className="w-full border border-blue-400 rounded px-1.5 py-1 text-base sm:text-xs focus:outline-none" />
    )
    // Duas frases de autores diferentes podem conviver aqui: a da conta
    // (quem paga) e a da entrada (quem recebeu a mercadoria), marcada.
    return (
      <div onClick={() => abrirObs(c)} title={c.observacoes ?? 'Clique para escrever uma observação'} className="cursor-text min-h-[1.25rem] min-w-0">
        {c.observacoes
          ? <p className="text-xs text-gray-700 truncate">📝 {c.observacoes}</p>
          : <p className="text-xs text-gray-300 sm:opacity-0 sm:group-hover:opacity-100">+ observação</p>}
        {c.obsDaEntrada && (
          <p className="text-[11px] text-gray-500 truncate" title={`Da entrada: ${c.obsDaEntrada}`}>
            <span className="text-gray-400">da entrada:</span> {c.obsDaEntrada}
          </p>
        )}
      </div>
    )
  }

  function detalhes(c: Conta) {
    const tipo = c.tipo_despesa_id ? nomeTipo.get(c.tipo_despesa_id) : null
    return (
      <>
        {c.total_parcelas > 1 && <span className="text-[11px] text-gray-400">parcela {c.parcela}/{c.total_parcelas}</span>}
        {tipo && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 ml-2 first:ml-0">
            <span className="w-2 h-2 rounded-full" style={{ background: tipo.cor ?? '#d1d5db' }} />{tipo.nome}
          </span>
        )}
        {/* Competência só aparece quando difere do mês do vencimento — é aí
            que a informação muda alguma coisa para quem lê. */}
        {c.competencia && c.competencia.slice(0, 7) !== String(c.vencimento).slice(0, 7) && (
          <span className="text-[11px] text-blue-600 ml-2 first:ml-0" title="Mês a que a despesa pertence">
            competência {rotuloCompetencia(c.competencia)}
          </span>
        )}
      </>
    )
  }

  // O documento de outra empresa só abre com a sessão nela: a tela da
  // entrada procura na empresa ativa. Então o clique troca de empresa antes,
  // avisando — trocar em silêncio faria a próxima tela gravar na empresa
  // errada sem ninguém perceber.
  async function abrirDeOutraEmpresa(e: React.MouseEvent, c: Conta, href: string) {
    if (c.empresa_id === empresaId) return
    e.preventDefault()
    const nome = infoEmpresa.get(c.empresa_id)?.nome ?? 'a outra empresa'
    if (!confirm(`Este documento é de ${nome}. Para abrir, o sistema vai passar a trabalhar em ${nome}. Continuar?`)) return
    const r = await fetch('/api/empresa-ativa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresaId: c.empresa_id }) })
    if (!r.ok) { alert('Não foi possível trocar de empresa.'); return }
    window.location.href = href
  }

  function origem(c: Conta) {
    return (
      <>
        {c.origemDoc && (
          <a href={c.origemDoc.href} onClick={e => void abrirDeOutraEmpresa(e, c, c.origemDoc!.href)} title={c.origemDoc.descricao} className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium">
            {c.origemDoc.rotulo}
          </a>
        )}
        {c.pedidoDoc && (
          <a href={c.pedidoDoc.href} onClick={e => void abrirDeOutraEmpresa(e, c, c.pedidoDoc!.href)} title={c.pedidoDoc.descricao} className="block text-[11px] text-blue-600 hover:underline">
            {c.pedidoDoc.rotulo}
          </a>
        )}
      </>
    )
  }

  function cabecalhoGrupo(g: Grupo) {
    const abertas = g.contas.filter(podePagar)
    const todas = abertas.length > 0 && abertas.every(c => selecionadas.has(c.id))
    return (
      <div className="flex items-center gap-3">
        {abertas.length > 0 && (
          <input type="checkbox" checked={todas} title="Marcar todas deste grupo"
            onChange={e => marcar(abertas.map(c => c.id), e.target.checked)} className="w-4 h-4 accent-blue-600" />
        )}
        <span className="min-w-0">
          <span className={`text-sm font-semibold ${g.atraso ? 'text-red-700' : 'text-gray-800'}`}>{g.rotulo}</span>
          <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{g.contas.length} conta(s)</span>
        </span>
        <span className={`ml-auto text-sm font-bold whitespace-nowrap ${g.atraso ? 'text-red-700' : 'text-gray-900'}`}>{fmt(g.total)}</span>
      </div>
    )
  }

  const faltaPago = ({ falta, pago, qtd }: { falta: number; pago: number; qtd: number }) => (
    qtd === 0 ? <>nenhum boleto</> : <>
      {falta > 0 ? <span className="block text-gray-700">falta pagar {fmt(falta)}</span> : <span className="block text-green-700">tudo pago</span>}
      {pago > 0 && falta > 0 && <span className="block text-green-700">já pago {fmt(pago)}</span>}
    </>
  )

  return (
    <div className="max-w-[1400px]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-gray-900 text-xl font-semibold">Contas a Pagar</h1>
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard/contas-pagar/relatorio"
            className="px-3 py-1.5 border border-gray-300 bg-white text-gray-700 text-sm rounded-lg hover:bg-gray-50">
            📊 Relatórios
          </a>
          <button onClick={() => setModalNova(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
            + Nova despesa
          </button>
        </div>
      </div>

      {empresas.length > 1 && (
        <div className="mb-3"><SeletorEmpresasPagar empresas={empresas} valor={empresasSel} onChange={escolherEmpresas} /></div>
      )}

      {/* PAINEL. Cada cartão é uma pergunta de quem paga boleto, e clicar nele
          filtra a lista para mostrar exatamente o que ele somou. */}
      {nomeDoFornecedor && (
        <p className="text-xs text-gray-600 mb-2">Painel de <strong>{nomeDoFornecedor}</strong> — todas as contas dele, não só as da lista.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3 mb-5">
        <Cartao titulo="🔴 Vencidos" valor={painel.vencido.total} cor={painel.vencido.quantidade ? 'text-red-600' : 'text-gray-400'}
          destaque={painel.vencido.quantidade ? 'bg-red-50' : undefined}
          linha={painel.vencido.quantidade ? <>{painel.vencido.quantidade} boleto(s) · desde {diaMes(painel.vencido.maisAntigo!)}</> : 'nada em atraso'}
          porEmpresa={divisao(p => p.vencido.total)}
          marcado={ativo('vencido', 'todos')} onClick={() => mudar({ situacao: 'vencido', periodo: 'todos' })} />
        <Cartao titulo="⏰ Vence hoje" valor={painel.hoje.total} cor={painel.hoje.quantidade ? 'text-orange-600' : 'text-gray-400'}
          linha={`${painel.hoje.quantidade} boleto(s)`}
          porEmpresa={divisao(p => p.hoje.total)}
          marcado={ativo('aberto', 'hoje')} onClick={() => mudar({ situacao: 'aberto', periodo: 'hoje' })} />
        <Cartao titulo={`📅 Esta semana · ${diaMes(painel.semana.de)} a ${diaMes(painel.semana.ate)}`} valor={painel.semana.total} cor="text-gray-900"
          linha={faltaPago({falta: painel.semana.aberto.total, pago: painel.semana.pago.total, qtd: painel.semana.quantidade})}
          porEmpresa={divisao(p => p.semana.total)}
          marcado={ativo('todos', 'semana')} onClick={() => mudar({ situacao: 'todos', periodo: 'semana' })} />
        <Cartao titulo={`🗓 ${nomeDoMes(painel.mes.mes)} (este mês)`} valor={painel.mes.total} cor="text-gray-900"
          linha={faltaPago({falta: painel.mes.aberto.total, pago: painel.mes.pago.total, qtd: painel.mes.quantidade})}
          porEmpresa={divisao(p => p.mes.total)}
          marcado={ativo('todos', 'mes')} onClick={() => mudar({ situacao: 'todos', periodo: 'mes' })} />
        <Cartao titulo={`➡️ ${nomeDoMes(painel.proximoMes.mes)} (próximo mês)`} valor={painel.proximoMes.total} cor="text-blue-700"
          linha={faltaPago({falta: painel.proximoMes.aberto.total, pago: painel.proximoMes.pago.total, qtd: painel.proximoMes.quantidade})}
          porEmpresa={divisao(p => p.proximoMes.total)}
          marcado={ativo('todos', 'proximo_mes')} onClick={() => mudar({ situacao: 'todos', periodo: 'proximo_mes' })} />
        <Cartao titulo="💳 Total em aberto" valor={painel.totalAberto.total} cor="text-gray-900"
          linha={`${painel.totalAberto.quantidade} boleto(s), vencidos e a vencer`}
          porEmpresa={divisao(p => p.totalAberto.total)}
          marcado={ativo('aberto', 'todos')} onClick={() => mudar({ situacao: 'aberto', periodo: 'todos' })} />
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 space-y-3">
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0.5">
          {SITUACOES.map(([s, l]) => (
            <button key={s} onClick={() => mudar({ situacao: s })}
              className={`shrink-0 px-3 py-1.5 text-xs rounded-lg border transition-colors ${f.situacao === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {l} <span className={f.situacao === s ? 'text-blue-100' : 'text-gray-400'}>{contagem[s]}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 items-center">
          <select value={f.periodo} onChange={e => mudar({ periodo: e.target.value as Periodo })} title="Vencimento"
            className="col-span-2 sm:col-span-1 border border-gray-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-none focus:border-blue-500">
            {PERIODOS.map(([p, l]) => <option key={p} value={p}>{p === 'todos' ? 'Vencimento: qualquer data' : `Vence: ${l.toLowerCase()}`}</option>)}
          </select>
          {f.periodo === 'personalizado' && (
            <div className="col-span-2 flex items-center gap-1.5">
              <input type="date" value={f.de} onChange={e => mudar({ de: e.target.value })}
                className="flex-1 sm:flex-none border border-gray-300 rounded-lg px-2 py-1.5 text-base sm:text-sm bg-white" />
              <span className="text-xs text-gray-400">até</span>
              <input type="date" value={f.ate} onChange={e => mudar({ ate: e.target.value })}
                className="flex-1 sm:flex-none border border-gray-300 rounded-lg px-2 py-1.5 text-base sm:text-sm bg-white" />
            </div>
          )}
          <select value={f.fornecedor} onChange={e => mudar({ fornecedor: e.target.value })}
            className="col-span-2 sm:col-span-1 border border-gray-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-none focus:border-blue-500 sm:max-w-[16rem]">
            <option value="">Todos os fornecedores</option>
            {fornecedores.map(([id, x]) => (
              <option key={id || '__sem__'} value={id || '__sem__'}>{x.nome}{x.abertas ? ` (${x.abertas} em aberto)` : ''}</option>
            ))}
          </select>
          {tiposVisiveis.length > 0 && (
            <select value={f.tipo} onChange={e => mudar({ tipo: e.target.value })}
              className="col-span-2 sm:col-span-1 border border-gray-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="">Todos os tipos de despesa</option>
              {tiposVisiveis.map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}
              <option value="__sem__">Sem tipo</option>
            </select>
          )}
          <input value={f.q} onChange={e => mudar({ q: e.target.value })} placeholder="🔎 Descrição, NF, valor, obs…"
            className="col-span-2 sm:col-span-1 border border-gray-300 rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-sm focus:outline-none focus:border-blue-500 bg-white sm:w-56" />
          <select value={f.agrupar} onChange={e => mudar({ agrupar: e.target.value as Agrupamento })}
            className="border border-gray-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-none focus:border-blue-500">
            {AGRUPAR.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
            {variasEmpresas && <option value="empresa">Agrupar por empresa</option>}
          </select>
          <select value={ordem} onChange={e => setOrdem(e.target.value as typeof ordem)} title="Ordem dentro de cada grupo"
            className="border border-gray-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-none focus:border-blue-500">
            <option value="vencimento">Ordem: vencimento</option>
            <option value="fornecedor">Ordem: fornecedor</option>
            <option value="valor">Ordem: maior valor</option>
          </select>
          <div className="col-span-2 sm:col-span-1 sm:ml-auto flex items-center gap-3">
            {filtrosAtivos && (
              <button onClick={() => mudar({ ...PADRAO, agrupar: f.agrupar })} className="text-xs text-gray-500 hover:text-gray-700 underline">limpar filtros</button>
            )}
            <button onClick={exportar} disabled={filtradas.length === 0}
              className="ml-auto sm:ml-0 px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm rounded-lg">
              ⬇ Exportar (Excel)
            </button>
          </div>
        </div>
      </div>

      {/* Ações em massa */}
      {marcadas.length > 0 && (
        <div className="sticky top-0 z-10 bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-medium text-green-700">{marcadas.length} conta(s) · {fmt(somaDe(marcadas))}</span>
          <button onClick={() => setModalPgto(marcadas)}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
            ✓ Registrar pagamento
          </button>
          <button onClick={() => setSelecionadas(new Set())} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Desmarcar</button>
        </div>
      )}

      {/* Totais do que está na lista */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2 px-1 text-sm">
        <span className="text-gray-600">{filtradas.length} conta(s)</span>
        <span className="font-semibold text-gray-900">{fmt(totalFiltrado)}</span>
        {abertoFiltrado > 0 && pagoFiltrado > 0 && (
          <span className="text-xs text-gray-500">em aberto {fmt(abertoFiltrado)} · pago {fmt(pagoFiltrado)}</span>
        )}
        {selecionaveis.length > 0 && (
          <span className="w-full sm:w-auto text-[11px] text-gray-400">
            ✏️ <span className="sm:hidden">toque</span><span className="hidden sm:inline">clique</span> no valor ou no vencimento de uma conta em aberto para alterar
          </span>
        )}
        {selecionaveis.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-blue-600"
              checked={marcadas.length === selecionaveis.length}
              onChange={e => marcar(selecionaveis.map(c => c.id), e.target.checked)} />
            marcar todas
          </label>
        )}
      </div>

      {filtradas.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">
          Nenhuma conta neste filtro.
        </div>
      ) : (
        <>
          {/* Celular: um cartão por conta, os grupos em blocos separados */}
          <div className="md:hidden space-y-3">
            {grupos.map(g => (
              <div key={g.chave || 'lista'} className={`bg-white border rounded-xl overflow-hidden ${g.atraso ? 'border-red-200' : 'border-gray-200'}`}>
                {g.rotulo && <div className={`px-3 py-2 border-b ${g.atraso ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200'}`}>{cabecalhoGrupo(g)}</div>}
                <ul className="divide-y divide-gray-100">
                  {g.contas.map(c => (
                    <li key={c.id} className={`px-3 py-2.5 flex gap-2.5 ${situacaoDaConta(c, hojeIso) === 'vencido' ? 'bg-red-50/40' : ''}`}>
                      <div className="w-5 pt-0.5 shrink-0">
                        {podePagar(c) && (
                          <input type="checkbox" checked={selecionadas.has(c.id)} onChange={e => marcar([c.id], e.target.checked)} className="w-4 h-4 accent-blue-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900 break-words">{nomeForn(c) || c.descricao}</p>
                          <div className="shrink-0 text-right">{valorDaConta(c, 'text-sm font-semibold text-gray-900')}</div>
                        </div>
                        {nomeForn(c) && <p className="text-xs text-gray-500 break-words">{c.descricao}</p>}
                        <div className="flex flex-wrap items-center gap-x-2">
                          {variasEmpresas && <EtiquetaEmpresa empresa={infoEmpresa.get(c.empresa_id)} />}{origem(c)}{detalhes(c)}
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div className="flex items-center gap-2">
                            {situ(c)}
                            {c.status === 'pago'
                              ? <span className="text-[11px] text-gray-500">em {dataBr(c.data_pagamento)}{c.forma_pagamento ? ` · ${c.forma_pagamento}` : ''}</span>
                              : <span className="leading-tight">{vencimento(c)}</span>}
                          </div>
                          {podePagar(c) && (
                            <div className="flex gap-3 shrink-0">
                              <button onClick={() => cancelar(c.id)} className="text-xs text-gray-400">Cancelar</button>
                              <button onClick={() => setModalPgto([c])} className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded-lg">Pagar</button>
                            </div>
                          )}
                        </div>
                        {obs(c)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Computador: uma tabela só, para as colunas dos grupos alinharem */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 uppercase tracking-wide">
                  <th className="w-10 px-4 py-2.5"></th>
                  {variasEmpresas && <th className="text-left px-3 py-2.5 font-medium">Empresa</th>}
                  <th className="text-left px-3 py-2.5 font-medium">Fornecedor / descrição</th>
                  <th className="text-left px-3 py-2.5 font-medium" title="Documento que originou a conta">Origem</th>
                  <th className="text-left px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="text-right px-3 py-2.5 font-medium">Valor</th>
                  <th className="text-center px-3 py-2.5 font-medium">Situação</th>
                  <th className="text-left px-3 py-2.5 font-medium">Pagamento</th>
                  <th className="text-left px-3 py-2.5 font-medium" title="Clique para escrever">OBS</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              {grupos.map(g => (
                <tbody key={g.chave || 'lista'} className="divide-y divide-gray-100 border-b border-gray-200 last:border-b-0">
                  {g.rotulo && (
                    <tr className={g.atraso ? 'bg-red-50' : 'bg-slate-50'}>
                      <td colSpan={variasEmpresas ? 10 : 9} className="px-4 py-2">{cabecalhoGrupo(g)}</td>
                    </tr>
                  )}
                  {g.contas.map(c => (
                    <tr key={c.id} className={`hover:bg-gray-50 group ${situacaoDaConta(c, hojeIso) === 'vencido' ? 'bg-red-50/30' : ''}`}>
                      <td className="w-10 px-4 py-2.5">
                        {podePagar(c) && (
                          <input type="checkbox" checked={selecionadas.has(c.id)} onChange={e => marcar([c.id], e.target.checked)} className="w-4 h-4 accent-blue-600" />
                        )}
                      </td>
                      {variasEmpresas && <td className="px-3 py-2.5"><EtiquetaEmpresa empresa={infoEmpresa.get(c.empresa_id)} /></td>}
                      <td className="px-3 py-2.5 max-w-[22rem]">
                        <p className="text-gray-900 font-medium text-xs truncate" title={nomeForn(c)}>{nomeForn(c) || '—'}</p>
                        <p className="text-[11px] text-gray-500 truncate" title={c.descricao}>{c.descricao}</p>
                        <div className="flex flex-wrap items-center">{detalhes(c)}</div>
                      </td>
                      <td className="px-3 py-2.5">{origem(c)}{!c.origemDoc && !c.pedidoDoc && <span className="text-xs text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{vencimento(c)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{valorDaConta(c, 'font-medium text-gray-900')}</td>
                      <td className="px-3 py-2.5 text-center">{situ(c)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {c.data_pagamento && (
                          <>
                            <p>{dataBr(c.data_pagamento)}</p>
                            {c.forma_pagamento && <p className="text-gray-400 capitalize">{c.forma_pagamento}</p>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 max-w-[14rem]">{obs(c)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-right">
                        {podePagar(c) && (
                          <div className="flex gap-3 justify-end">
                            <button onClick={() => cancelar(c.id)} className="text-xs text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100">Cancelar</button>
                            <button onClick={() => setModalPgto([c])} className="text-xs text-green-600 hover:text-green-800 font-medium">Pagar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td colSpan={variasEmpresas ? 5 : 4} className="px-4 py-2.5 text-xs text-gray-500">{filtradas.length} conta(s)</td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-gray-900 whitespace-nowrap">{fmt(totalFiltrado)}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {(f.situacao === 'pago' || f.situacao === 'todos' || f.situacao === 'cancelado') && (
        <p className="text-[11px] text-gray-400 mt-3">
          Pagas e canceladas aparecem a partir de {dataBr(desde)}. Para o que saiu do caixa em cada período, veja os Relatórios.
        </p>
      )}

      {modalNova && (
        <NovaDespesaModal
          // Com uma empresa na tela, a despesa é dela; com várias, o modal
          // pergunta, começando pela empresa em que a sessão está.
          empresaId={empresasSel.length === 1 ? empresasSel[0] : (empresasSel.includes(empresaId) ? empresaId : empresasSel[0])}
          empresas={variasEmpresas ? empresas.filter(e => empresasSel.includes(e.id)) : undefined}
          onFechar={() => setModalNova(false)}
          onCriada={qtd => {
            setModalNova(false)
            alert(qtd > 1 ? `${qtd} contas criadas.` : 'Despesa criada.')
            router.refresh()
          }}
        />
      )}

      {modalPgto && (
        <PagarContasModal
          contas={modalPgto}
          // Tipo de despesa é por empresa: só dá para escolher um quando as
          // contas do pagamento são todas da mesma.
          empresaId={new Set(modalPgto.map(c => c.empresa_id)).size === 1 ? modalPgto[0].empresa_id : null}
          onFechar={() => setModalPgto(null)}
          onPago={aplicarPagamento}
        />
      )}
    </div>
  )
}
