'use client'

import { useState, useEffect } from 'react'
import TransferenciaModal, { ComprovanteTransferencia, type Especie, type Comprovante } from './TransferenciaModal'
import CaixasPdvClient from './CaixasPdvClient'

// Caixa da Empresa (tesouraria) — Fase 1 do controle de caixa.
//
// Responde duas perguntas e permite um lançamento:
//   quanto tem hoje (saldo = soma do ledger, nunca uma coluna)
//   de onde veio / para onde foi cada centavo (extrato)
//   lançar aporte, retirada de sócio, depósito no banco ou ajuste de contagem
//
// Correção de lançamento errado é estorno, não edição — por isso não há
// botão de editar em lugar nenhum desta tela.

type NaturezaFase1 = 'aporte' | 'retirada_socio' | 'deposito_banco' | 'ajuste'
// A Fase 2 acrescenta os dois lados de cada transferência. Quatro naturezas
// e não duas: o extrato da tesouraria diz "Sangria recebida (+)" enquanto o
// do PDV diz "Sangria enviada (−)" — a mesma operação, lida de cada lado.
type Natureza = NaturezaFase1 | 'sangria' | 'sangria_recebida' | 'suprimento' | 'suprimento_entregue'
type Tipo = 'entrada' | 'saida'
type FormaPagamento = 'dinheiro' | 'pix' | 'transferencia'

const NATUREZAS: { valor: NaturezaFase1; label: string; tipo: Tipo | null; ajuda: string }[] = [
  { valor: 'aporte', label: 'Aporte de sócio', tipo: 'entrada', ajuda: 'Dinheiro que o sócio colocou na empresa.' },
  { valor: 'retirada_socio', label: 'Retirada de sócio', tipo: 'saida', ajuda: 'Dinheiro que saiu da tesouraria para o sócio.' },
  { valor: 'deposito_banco', label: 'Depósito no banco', tipo: 'saida', ajuda: 'Dinheiro físico que saiu da tesouraria e foi depositado.' },
  { valor: 'ajuste', label: 'Ajuste de contagem', tipo: null, ajuda: 'Corrige uma diferença encontrada ao contar o caixa físico.' },
]

const FORMAS: { valor: FormaPagamento; label: string }[] = [
  { valor: 'dinheiro', label: 'Dinheiro' },
  { valor: 'pix', label: 'PIX' },
  { valor: 'transferencia', label: 'Transferência' },
]

type Movimento = {
  id: string
  tipo: Tipo
  natureza: Natureza
  valor: number
  forma_pagamento: FormaPagamento | null
  observacao: string | null
  estorno_de_id: string | null
  usuario_id: string
  created_at: string
  transferencia_id: string | null
  contraparte: { id: string; nome: string } | null
}

type Caixa = { id: string; nome: string; tipo: string }

function reais(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR')
}

const ROTULO_NATUREZA: Record<Natureza, string> = {
  aporte: 'Aporte de sócio',
  retirada_socio: 'Retirada de sócio',
  deposito_banco: 'Depósito no banco',
  ajuste: 'Ajuste de contagem',
  sangria: 'Sangria enviada',
  sangria_recebida: 'Sangria recebida',
  suprimento_entregue: 'Suprimento enviado',
  suprimento: 'Suprimento recebido',
}

// Quem enviou mostra para ONDE foi; quem recebeu, de ONDE veio. A
// transferência aparece uma vez em cada caixa — nunca duas no mesmo, que
// faria parecer que o dinheiro andou duas vezes.
function rotuloContraparte(natureza: Natureza): string | null {
  if (natureza === 'sangria' || natureza === 'suprimento_entregue') return 'Destino'
  if (natureza === 'sangria_recebida' || natureza === 'suprimento') return 'Origem'
  return null
}

export default function CaixaTesourariaClient({ responsavel }: { responsavel: string }) {
  const [caixa, setCaixa] = useState<Caixa | null>(null)
  const [saldo, setSaldo] = useState<number | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [temMais, setTemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)

  const [natureza, setNatureza] = useState<NaturezaFase1>('aporte')
  const [tipoAjuste, setTipoAjuste] = useState<Tipo>('entrada')
  const [valor, setValor] = useState('')
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | ''>('')
  const [observacao, setObservacao] = useState('')
  const [lancando, setLancando] = useState(false)
  const [erro, setErro] = useState('')
  const [estornando, setEstornando] = useState<string | null>(null)
  const [modal, setModal] = useState<Especie | null>(null)
  const [comprovante, setComprovante] = useState<Comprovante | null>(null)

  async function carregar() {
    const [rSaldo, rMovimentos] = await Promise.all([
      fetch('/api/caixa/tesouraria').then(r => r.json()).catch(() => null),
      fetch('/api/caixa/tesouraria/movimentos?limite=50').then(r => r.json()).catch(() => null),
    ])
    if (rSaldo?.ok) { setCaixa(rSaldo.caixa); setSaldo(rSaldo.saldo) }
    if (rMovimentos?.ok) {
      setMovimentos(rMovimentos.movimentos)
      setTemMais(rMovimentos.movimentos.length === 50)
    }
    setCarregando(false)
  }

  // A carga inicial fica dentro do efeito, e não numa função chamada por
  // ele: o `set` acontece depois do await, e não de forma síncrona na
  // montagem (mesmo padrão de TerminaisPdvClient).
  useEffect(() => {
    let vivo = true
    Promise.all([
      fetch('/api/caixa/tesouraria').then(r => r.json()).catch(() => null),
      fetch('/api/caixa/tesouraria/movimentos?limite=50').then(r => r.json()).catch(() => null),
    ]).then(([rSaldo, rMovimentos]) => {
      if (!vivo) return
      if (rSaldo?.ok) { setCaixa(rSaldo.caixa); setSaldo(rSaldo.saldo) }
      if (rMovimentos?.ok) {
        setMovimentos(rMovimentos.movimentos)
        setTemMais(rMovimentos.movimentos.length === 50)
      }
      setCarregando(false)
    }).catch(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  async function carregarMais() {
    if (movimentos.length === 0) return
    setCarregandoMais(true)
    try {
      const ultimo = movimentos[movimentos.length - 1]
      const d = await fetch(`/api/caixa/tesouraria/movimentos?limite=50&antes=${encodeURIComponent(ultimo.created_at)}`)
        .then(r => r.json())
      if (d?.ok) {
        setMovimentos(prev => [...prev, ...d.movimentos])
        setTemMais(d.movimentos.length === 50)
      }
    } finally {
      setCarregandoMais(false)
    }
  }

  const tipoEfetivo: Tipo = natureza === 'ajuste' ? tipoAjuste : (NATUREZAS.find(n => n.valor === natureza)!.tipo as Tipo)

  async function lancar() {
    const valorNumero = Number(valor.replace(',', '.'))
    if (!valorNumero || valorNumero <= 0) { setErro('Informe um valor maior que zero.'); return }

    setLancando(true); setErro('')
    try {
      const d = await fetch('/api/caixa/tesouraria/movimentos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: tipoEfetivo, natureza, valor: valorNumero,
          forma_pagamento: formaPagamento || null,
          observacao: observacao.trim() || null,
        }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Falha ao lançar.'); return }
      setValor(''); setObservacao(''); setFormaPagamento('')
      carregar()
    } finally {
      setLancando(false)
    }
  }

  async function estornar(m: Movimento) {
    if (!window.confirm(`Estornar este lançamento de ${reais(m.valor)} (${ROTULO_NATUREZA[m.natureza]})?\n\nUm movimento novo, de sinal contrário, será lançado — o original não é apagado nem editado.`)) return
    setEstornando(m.id)
    try {
      const d = await fetch(`/api/caixa/tesouraria/movimentos/${m.id}/estornar`, { method: 'POST' }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Falha ao estornar.'); return }
      carregar()
    } finally {
      setEstornando(null)
    }
  }

  const idsEstornados = new Set(movimentos.filter(m => m.estorno_de_id).map(m => m.estorno_de_id))

  if (carregando) return <p className="text-sm text-gray-400">Carregando...</p>

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-2xl border border-gray-200 p-5">
        <p className="text-xs text-gray-500 mb-1">{caixa?.nome ?? 'Caixa da Empresa'}</p>
        <p className={`text-3xl font-bold ${saldo != null && saldo < 0 ? 'text-red-700' : 'text-gray-900'}`}>
          {saldo != null ? reais(saldo) : '—'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Saldo é sempre a soma dos lançamentos abaixo — nunca um número guardado à parte.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setModal('sangria')}
          className="rounded-2xl border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 p-5 text-left transition">
          <p className="text-base font-semibold text-gray-900">Sangria</p>
          <p className="text-xs text-gray-500 mt-1">
            Dinheiro que saiu da gaveta do PDV e entrou na tesouraria.
          </p>
        </button>
        <button onClick={() => setModal('suprimento')}
          className="rounded-2xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 p-5 text-left transition">
          <p className="text-base font-semibold text-gray-900">Suprimento</p>
          <p className="text-xs text-gray-500 mt-1">
            Dinheiro que a tesouraria entregou ao PDV, normalmente para troco.
          </p>
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-900">Caixas de PDV</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Cada gaveta tem o seu turno: abre com um fundo, opera, e fecha conferindo o dinheiro contado.
          </p>
        </div>
        <div className="p-5">
          <CaixasPdvClient aoMudar={carregar} />
        </div>
      </div>

      {modal && (
        <TransferenciaModal
          especie={modal}
          responsavel={responsavel}
          aoFechar={() => setModal(null)}
          aoConcluir={(c) => { setModal(null); setComprovante(c); carregar() }}
        />
      )}
      {comprovante && (
        <ComprovanteTransferencia c={comprovante} aoFechar={() => setComprovante(null)} />
      )}

      <div className="rounded-2xl border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-900 mb-3">Lançar movimento</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs text-gray-500">Natureza</label>
            <select value={natureza} onChange={e => setNatureza(e.target.value as NaturezaFase1)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
              {NATUREZAS.map(n => <option key={n.valor} value={n.valor}>{n.label}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">{NATUREZAS.find(n => n.valor === natureza)?.ajuda}</p>
          </div>

          {natureza === 'ajuste' && (
            <div>
              <label className="text-xs text-gray-500">Direção</label>
              <select value={tipoAjuste} onChange={e => setTipoAjuste(e.target.value as Tipo)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
                <option value="entrada">Sobrou dinheiro (entrada)</option>
                <option value="saida">Faltou dinheiro (saída)</option>
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500">Valor</label>
            <input value={valor} onChange={e => { setValor(e.target.value); setErro('') }}
              inputMode="decimal" placeholder="0,00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>

          <div>
            <label className="text-xs text-gray-500">Forma (opcional)</label>
            <select value={formaPagamento} onChange={e => setFormaPagamento(e.target.value as FormaPagamento | '')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
              <option value="">—</option>
              {FORMAS.map(f => <option key={f.valor} value={f.valor}>{f.label}</option>)}
            </select>
          </div>

          <div className="col-span-2">
            <label className="text-xs text-gray-500">Observação (opcional)</label>
            <input value={observacao} onChange={e => setObservacao(e.target.value)}
              placeholder="Ex.: aporte inicial para abrir o caixa"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>

        {erro && <p className="text-xs text-red-600 mt-3">{erro}</p>}

        <button onClick={lancar} disabled={lancando}
          className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
          {lancando ? 'Lançando...' : `Lançar ${tipoEfetivo === 'entrada' ? 'entrada' : 'saída'}`}
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-900">Extrato</p>
        </div>
        {movimentos.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nenhum lançamento ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Quando', 'Natureza', 'Valor', 'Contraparte', 'Observação', ''].map(h => (
                    <th key={h} className="text-left font-bold text-gray-700 px-4 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movimentos.map(m => {
                  const jaEstornado = idsEstornados.has(m.id)
                  const ehEstorno = !!m.estorno_de_id
                  // Metade de uma transferência não se estorna daqui: devolveria
                  // o dinheiro a um caixa sem tirá-lo do outro. O servidor
                  // recusa de qualquer forma; esconder o botão evita o clique.
                  const ehTransferencia = !!m.transferencia_id
                  return (
                    <tr key={m.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{quando(m.created_at)}</td>
                      <td className="px-4 py-2 text-gray-900">
                        {ROTULO_NATUREZA[m.natureza]}
                        {ehEstorno && <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">estorno</span>}
                      </td>
                      <td className={`px-4 py-2 font-medium ${m.tipo === 'entrada' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {m.tipo === 'entrada' ? '+' : '-'} {reais(m.valor)}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                        {m.contraparte
                          ? `${rotuloContraparte(m.natureza) ?? ''}: ${m.contraparte.nome}`
                          : (FORMAS.find(f => f.valor === m.forma_pagamento)?.label ?? '—')}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs max-w-[200px] truncate" title={m.observacao ?? ''}>{m.observacao ?? '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {!ehEstorno && !jaEstornado && !ehTransferencia && (
                          <button onClick={() => estornar(m)} disabled={estornando === m.id}
                            className="text-xs text-red-600 hover:underline disabled:opacity-40">
                            {estornando === m.id ? 'estornando...' : 'estornar'}
                          </button>
                        )}
                        {jaEstornado && <span className="text-xs text-gray-400">estornado</span>}
                        {ehTransferencia && !ehEstorno && (
                          <span className="text-xs text-gray-400" title="Estorne a transferência inteira, não um dos lados.">
                            transferência
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {temMais && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button onClick={carregarMais} disabled={carregandoMais}
              className="text-xs text-blue-700 hover:underline disabled:opacity-40">
              {carregandoMais ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <strong>Sangria e suprimento já valem.</strong> O que ainda não existe é a sessão de caixa:
        vendas do PDV não lançam movimento aqui sozinhas, e não há abertura, conferência nem
        fechamento de turno — isso vem na próxima fase.
      </p>
    </div>
  )
}
