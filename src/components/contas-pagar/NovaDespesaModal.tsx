'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Criar despesa a pagar à mão: luz, água, combustível, alimentação — tudo
// que não entra por nota fiscal. Com competência (o mês a que a despesa
// pertence) e recorrência (gera as próximas de uma vez).

type TipoDespesa = { id: string; nome: string }
type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

// Soma meses preservando o dia. Dia 31 em mês de 30 cai no último dia — é o
// que o boleto faz na vida real, não pula para o dia 1 do mês seguinte.
function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const alvo = new Date(a, m - 1 + n, 1)
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  const dia = Math.min(d, ultimoDia)
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function mesDe(iso: string) { return iso.slice(0, 7) }
function primeiroDia(mes: string) { return `${mes}-01` }

function rotuloMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export default function NovaDespesaModal({
  empresaId, onFechar, onCriada,
}: { empresaId: string; onFechar: () => void; onCriada: (qtd: number) => void }) {
  const hoje = new Date().toISOString().split('T')[0]

  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(hoje)
  const [competencia, setCompetencia] = useState(mesDe(hoje))
  const [competenciaTocada, setCompetenciaTocada] = useState(false)
  const [tipoId, setTipoId] = useState('')
  const [fornecedorId, setFornecedorId] = useState('')
  const [observacoes, setObservacoes] = useState('')

  const [recorrente, setRecorrente] = useState(false)
  const [meses, setMeses] = useState(12)

  const [tipos, setTipos] = useState<TipoDespesa[]>([])
  const [forns, setForns] = useState<Fornecedor[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const sb = createClient()
    sb.from('tipos_despesa').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome')
      .then(({ data }) => setTipos(data ?? []))
    sb.from('fornecedores').select('id, razao_social, nome_fantasia').eq('empresa_id', empresaId)
      .order('razao_social').limit(500)
      .then(({ data }) => setForns(data ?? []))
  }, [empresaId])

  // Enquanto o usuário não mexer na competência, ela acompanha o vencimento.
  // Quem paga luz vai corrigir para o mês anterior; quem paga aluguel não
  // precisa fazer nada.
  function mudarVencimento(v: string) {
    setVencimento(v)
    if (!competenciaTocada && v) setCompetencia(mesDe(v))
  }

  const valorNum = Number(String(valor).replace(',', '.')) || 0
  const qtd = recorrente ? Math.max(1, Math.min(60, Number(meses) || 1)) : 1

  // Prévia real das datas geradas — recorrência sem prévia é fé cega.
  const previa = Array.from({ length: qtd }, (_, i) => ({
    venc: somarMeses(vencimento, i),
    comp: mesDe(somarMeses(primeiroDia(competencia), i)),
  }))

  async function salvar() {
    if (!descricao.trim()) { setErro('Informe a descrição.'); return }
    if (valorNum <= 0) { setErro('Informe um valor maior que zero.'); return }
    if (!vencimento) { setErro('Informe o vencimento.'); return }

    setSalvando(true); setErro('')
    try {
      const sb = createClient()
      const recorrenciaId = qtd > 1 ? crypto.randomUUID() : null

      const linhas = previa.map((p, i) => ({
        empresa_id: empresaId,
        descricao: qtd > 1 ? `${descricao.trim()} (${i + 1}/${qtd})` : descricao.trim(),
        valor: valorNum,
        vencimento: p.venc,
        data_vencimento: p.venc,   // as duas colunas existem na tabela e são lidas em telas diferentes
        competencia: primeiroDia(p.comp),
        status: 'pendente',
        fornecedor_id: fornecedorId || null,
        tipo_despesa_id: tipoId || null,
        observacoes: observacoes.trim() || null,
        parcela: i + 1,
        total_parcelas: qtd,
        origem: 'manual',
        recorrencia_id: recorrenciaId,
        recorrencia_indice: recorrenciaId ? i + 1 : null,
        recorrencia_total: recorrenciaId ? qtd : null,
      }))

      const { error } = await sb.from('contas_pagar').insert(linhas)
      if (error) throw new Error(error.message)
      onCriada(qtd)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar a despesa')
      setSalvando(false)
    }
  }

  const compDiferente = competencia !== mesDe(vencimento)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Nova despesa</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Contas que não entram por nota fiscal: luz, água, combustível, alimentação.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descrição *</label>
            <input value={descricao} onChange={e => setDescricao(e.target.value)}
              placeholder="Ex.: Conta de luz — loja centro"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valor *</label>
              <input type="number" step="0.01" min="0" value={valor} onChange={e => setValor(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vencimento *</label>
              <input type="date" value={vencimento} onChange={e => mudarVencimento(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Competência *</label>
            <input type="month" value={competencia}
              onChange={e => { setCompetencia(e.target.value); setCompetenciaTocada(true) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-500 mt-1">
              O mês a que a despesa <b>pertence</b>. A luz de julho vence em agosto, mas o gasto é de
              julho — mudar aqui é o que faz o relatório comparar mês a mês corretamente.
            </p>
            {compDiferente && (
              <p className="text-[11px] text-blue-700 mt-1">
                Vence em {mesDe(vencimento).split('-').reverse().join('/')}, mas conta como
                despesa de {rotuloMes(competencia)}.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de despesa</label>
              <select value={tipoId} onChange={e => setTipoId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                <option value="">Sem classificação</option>
                {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fornecedor</label>
              <select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                <option value="">Nenhum</option>
                {forns.map(f => (
                  <option key={f.id} value={f.id}>{f.nome_fantasia || f.razao_social}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500" />
          </div>

          {/* Recorrência */}
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)}
                className="w-4 h-4 accent-blue-600 mt-0.5" />
              <span className="text-sm text-gray-900">
                <b>Despesa recorrente</b>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Cria as contas dos próximos meses de uma vez, com o mesmo valor.
                </span>
              </span>
            </label>

            {recorrente && (
              <div className="mt-3 pl-6 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Quantidade de meses</label>
                  <input type="number" min={2} max={60} value={meses}
                    onChange={e => setMeses(Number(e.target.value))}
                    className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-blue-500" />
                  <div className="flex gap-1">
                    {[3, 6, 12, 24].map(n => (
                      <button key={n} onClick={() => setMeses(n)}
                        className={`px-2 py-1 text-xs rounded-md border ${
                          meses === n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
                        }`}>{n}</button>
                    ))}
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-h-40 overflow-y-auto">
                  <p className="text-[11px] text-gray-500 mb-1.5">
                    Serão criadas <b>{qtd}</b> contas, somando <b>{fmt(valorNum * qtd)}</b>:
                  </p>
                  <div className="space-y-0.5">
                    {previa.slice(0, 6).map((p, i) => (
                      <p key={i} className="text-[11px] text-gray-600">
                        {i + 1}. vence {p.venc.split('-').reverse().join('/')} · competência {rotuloMes(p.comp)}
                      </p>
                    ))}
                    {previa.length > 6 && (
                      <p className="text-[11px] text-gray-400">
                        … e mais {previa.length - 6}, até {previa[previa.length - 1].venc.split('-').reverse().join('/')}.
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-gray-400">
                  Valor fixo em todas. Para conta que varia (luz, água), crie mês a mês ou ajuste o
                  valor de cada uma depois — gerar 12 contas com um valor chutado erra o fluxo de caixa.
                </p>
              </div>
            )}
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onFechar} className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Criando...' : qtd > 1 ? `Criar ${qtd} contas` : 'Criar despesa'}
          </button>
        </div>
      </div>
    </div>
  )
}
