'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  degrauVigente, vigenciaDe, pendenciasDaForma, hojeISO,
  type FormaComTaxas, type TaxaDegrau, type LiquidacaoForma,
} from '@/lib/financeiro/taxas'

// O CADASTRO QUE NÃO EXISTIA.
//
// A lista de formas de pagamento era um array fixo em
// `src/lib/pdv/formasPagamento.ts`, copiado em sete arquivos que já
// divergiam. As taxas eram sete colunas em `saude_config`, sem histórico e
// sem prazo. Forma nova ou taxa nova exigia programador.
//
// A tela mostra, por forma: para onde o dinheiro vai, a tabela de taxas que
// está valendo, o prazo de recebimento e o que ainda falta preencher.

type Conta = { id: string; nome: string; tipo: string }

const LIQUIDACAO_LABEL: Record<LiquidacaoForma, string> = {
  imediata: 'Cai na hora',
  adquirente: 'Passa na maquininha',
  fiado: 'Fica a receber',
}

const LIQUIDACAO_AJUDA: Record<LiquidacaoForma, string> = {
  imediata: 'Entra no caixa no ato — dinheiro na gaveta, pix na conta.',
  adquirente: 'Entra no saldo da adquirente e espera o prazo para cair na conta.',
  fiado: 'Não entra no caixa: vira título em Contas a Receber.',
}

function pct(n: number) {
  return `${n.toFixed(2).replace('.', ',')}%`
}

function dataBR(iso: string) {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export default function FormasPagamentoClient() {
  const [formas, setFormas] = useState<FormaComTaxas[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [novaVigencia, setNovaVigencia] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    try {
      const r = await fetch('/api/financeiro/formas-pagamento')
      const d = await r.json()
      if (!d.ok) throw new Error(d.erro ?? 'Não foi possível carregar.')
      setFormas(d.formas)
      setContas(d.contas)
    } catch (e: any) { setErro(e?.message ?? 'Erro ao carregar.') }
    finally { setCarregando(false) }
  }

  useEffect(() => { carregar() }, [])

  const hoje = useMemo(() => hojeISO(), [])

  function avisar(mensagem: string) {
    setOk(mensagem); setErro('')
    setTimeout(() => setOk(''), 4000)
  }

  if (carregando) {
    return <p className="text-sm text-slate-400">Carregando as formas de pagamento…</p>
  }

  return (
    <div className="space-y-5">
      {formas.map(f => (
        <CartaoForma
          key={f.id}
          forma={f}
          contas={contas}
          hoje={hoje}
          aberto={editando === f.id}
          abrindoVigencia={novaVigencia === f.id}
          onAbrir={() => setEditando(editando === f.id ? null : f.id)}
          onAbrirVigencia={() => setNovaVigencia(novaVigencia === f.id ? null : f.id)}
          onSalvo={(msg) => { avisar(msg); setEditando(null); setNovaVigencia(null); carregar() }}
          onErro={setErro}
        />
      ))}

      {ok && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg">
          {ok}
        </div>
      )}
      {erro && (
        <div className="fixed bottom-6 right-6 bg-red-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg max-w-md">
          {erro}
        </div>
      )}
    </div>
  )
}

function CartaoForma({ forma, contas, hoje, aberto, abrindoVigencia, onAbrir, onAbrirVigencia, onSalvo, onErro }: {
  forma: FormaComTaxas
  contas: Conta[]
  hoje: string
  aberto: boolean
  abrindoVigencia: boolean
  onAbrir: () => void
  onAbrirVigencia: () => void
  onSalvo: (msg: string) => void
  onErro: (e: string) => void
}) {
  const vigencia = vigenciaDe(forma.taxas, hoje)
  const degrausAtuais = forma.taxas
    .filter(t => t.vigente_de === vigencia)
    .sort((a, b) => a.parcelas_min - b.parcelas_min)
  const pendencias = pendenciasDaForma(forma, hoje)
  const taxaAVista = degrauVigente(forma.taxas, 1, hoje)

  const destino = contas.find(c => c.id === forma.caixa_destino_id)
  const adquirente = contas.find(c => c.id === forma.adquirente_caixa_id)

  return (
    <div className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
      forma.ativo ? 'border-slate-100' : 'border-slate-200 bg-slate-50'
    }`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">{forma.icone}</span>
              <h3 className="font-semibold text-slate-800">{forma.nome}</h3>
              {forma.tecla && (
                <span className="text-xs text-slate-400 border border-slate-200 rounded px-1.5">
                  tecla {forma.tecla}
                </span>
              )}
              {!forma.ativo && (
                <span className="text-xs text-slate-500 bg-slate-200 rounded-full px-2 py-0.5">desligada</span>
              )}
            </div>

            <p className="text-sm text-slate-500 mt-1.5">
              {LIQUIDACAO_LABEL[forma.liquidacao]}
              {forma.liquidacao === 'adquirente' && adquirente && <> — {adquirente.nome}</>}
              {forma.liquidacao === 'imediata' && destino && <> — entra em {destino.nome}</>}
              {forma.liquidacao === 'imediata' && !destino && <> — no caixa do terminal que vendeu</>}
            </p>

            <p className="text-sm text-slate-600 mt-1">
              {taxaAVista
                ? <>Taxa à vista <strong>{pct(taxaAVista.taxa_pct)}</strong>
                    {taxaAVista.prazo_dias !== null
                      ? <> · cai em {taxaAVista.prazo_dias === 0 ? 'no mesmo dia' : `${taxaAVista.prazo_dias} dias`}</>
                      : <> · <span className="text-amber-700">prazo não informado</span></>}
                    {vigencia && <span className="text-slate-400"> · vigente desde {dataBR(vigencia)}</span>}
                  </>
                : <span className="text-amber-700">sem taxa cadastrada</span>}
            </p>
          </div>

          <button onClick={onAbrir}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex-shrink-0">
            {aberto ? 'Fechar' : 'Alterar'}
          </button>
        </div>

        {pendencias.length > 0 && (
          // O aviso é específico de propósito. "Configuração incompleta" faria
          // o gestor abrir a tela e procurar o que falta.
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <p className="text-xs text-amber-800">
              <strong>Falta preencher:</strong> {pendencias.join(' · ')}.
              {' '}Sem isso, a venda nesta forma não tem como ser lançada no caixa.
            </p>
          </div>
        )}

        {degrausAtuais.length > 1 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500 mb-1.5">
              Tabela que está valendo{vigencia && ` (desde ${dataBR(vigencia)})`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {degrausAtuais.map(d => (
                <span key={d.parcelas_min}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600">
                  {d.parcelas_min}x <strong className="text-slate-800">{pct(d.taxa_pct)}</strong>
                  {d.prazo_dias !== null && <span className="text-slate-400"> · {d.prazo_dias}d</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {aberto && (
        <div className="border-t border-slate-100 bg-slate-50 p-5 space-y-5">
          <EditorForma forma={forma} contas={contas} onSalvo={onSalvo} onErro={onErro} />

          <div className="border-t border-slate-200 pt-4">
            <button onClick={onAbrirVigencia}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              {abrindoVigencia ? 'Cancelar nova tabela' : '+ Nova tabela de taxas'}
            </button>
            <p className="text-xs text-slate-500 mt-1">
              A taxa mudou no contrato? Cadastre a tabela nova com a data em que passa a valer.
              A anterior fica no histórico — é ela que explica a taxa das vendas antigas.
            </p>
            {abrindoVigencia && (
              <EditorVigencia forma={forma} degrausBase={degrausAtuais} onSalvo={onSalvo} onErro={onErro} />
            )}
          </div>

          <HistoricoVigencias forma={forma} vigenciaAtual={vigencia} />
        </div>
      )}
    </div>
  )
}

function EditorForma({ forma, contas, onSalvo, onErro }: {
  forma: FormaComTaxas
  contas: Conta[]
  onSalvo: (m: string) => void
  onErro: (e: string) => void
}) {
  const [nome, setNome] = useState(forma.nome)
  const [ativo, setAtivo] = useState(forma.ativo)
  const [liquidacao, setLiquidacao] = useState<LiquidacaoForma>(forma.liquidacao)
  const [destino, setDestino] = useState(forma.caixa_destino_id ?? '')
  const [adquirente, setAdquirente] = useState(forma.adquirente_caixa_id ?? '')
  const [parcela, setParcela] = useState(forma.aceita_parcelamento)
  const [pmax, setPmax] = useState(forma.parcelas_max)
  const [salvando, setSalvando] = useState(false)

  const bancos = contas.filter(c => c.tipo === 'banco')
  const maquininhas = contas.filter(c => c.tipo === 'adquirente')

  async function salvar() {
    setSalvando(true)
    try {
      const r = await fetch('/api/financeiro/formas-pagamento', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: forma.id, nome, ativo, liquidacao,
          caixa_destino_id: destino || null,
          adquirente_caixa_id: adquirente || null,
          aceita_parcelamento: parcela, parcelas_max: pmax,
        }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.erro)
      onSalvo(`${nome} salva.`)
    } catch (e: any) { onErro(e?.message ?? 'Erro ao salvar.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Nome na tela</label>
          <input value={nome} onChange={e => setNome(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          {/* O código é o que está gravado nas vendas. Mostrar e não deixar
              editar evita a pergunta "posso trocar?" — e a resposta é não. */}
          <p className="text-xs text-slate-400 mt-1">
            Código no histórico: <code>{forma.codigo}</code> — não muda, porque está
            gravado nas vendas já feitas.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Para onde o dinheiro vai</label>
          <select value={liquidacao} onChange={e => setLiquidacao(e.target.value as LiquidacaoForma)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {(Object.keys(LIQUIDACAO_LABEL) as LiquidacaoForma[]).map(k => (
              <option key={k} value={k}>{LIQUIDACAO_LABEL[k]}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">{LIQUIDACAO_AJUDA[liquidacao]}</p>
        </div>

        {liquidacao === 'adquirente' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Em qual adquirente</label>
            <select value={adquirente} onChange={e => setAdquirente(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— escolha —</option>
              {maquininhas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            {maquininhas.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Nenhuma adquirente cadastrada. Cadastre em Bancos e Contas.
              </p>
            )}
          </div>
        )}

        {liquidacao === 'imediata' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Conta que recebe</label>
            <select value={destino} onChange={e => setDestino(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="">No caixa do terminal que vendeu</option>
              {bancos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Dinheiro fica na gaveta de quem atendeu; pix cai direto na conta.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} />
          Disponível no balcão
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={parcela} onChange={e => setParcela(e.target.checked)} />
          Aceita parcelamento
        </label>

        {parcela && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            até
            <input type="number" min={1} max={36} value={pmax}
              onChange={e => setPmax(Math.max(1, Math.min(36, parseInt(e.target.value) || 1)))}
              className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm" />
            parcelas
          </label>
        )}
      </div>

      <button onClick={salvar} disabled={salvando}
        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  )
}

function EditorVigencia({ forma, degrausBase, onSalvo, onErro }: {
  forma: FormaComTaxas
  degrausBase: TaxaDegrau[]
  onSalvo: (m: string) => void
  onErro: (e: string) => void
}) {
  // Começa com a tabela que está valendo, não em branco: quem renegociou
  // mudou alguns degraus, não todos, e digitar seis linhas de novo convida ao
  // erro de digitação.
  const inicial = degrausBase.length > 0
    ? degrausBase.map(d => ({ parcelas_min: d.parcelas_min, taxa: String(d.taxa_pct), prazo: d.prazo_dias === null ? '' : String(d.prazo_dias) }))
    : [{ parcelas_min: 1, taxa: '0', prazo: '' }]

  const [de, setDe] = useState(hojeISO())
  const [linhas, setLinhas] = useState(inicial)
  const [salvando, setSalvando] = useState(false)

  function mudar(i: number, campo: 'taxa' | 'prazo', valor: string) {
    setLinhas(p => p.map((l, k) => k === i ? { ...l, [campo]: valor } : l))
  }

  async function salvar() {
    setSalvando(true)
    try {
      const r = await fetch('/api/financeiro/formas-pagamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forma_id: forma.id,
          vigente_de: de,
          degraus: linhas.map(l => ({
            parcelas_min: l.parcelas_min,
            taxa_pct: Number(String(l.taxa).replace(',', '.')),
            prazo_dias: l.prazo === '' ? null : Number(l.prazo),
          })),
        }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.erro)
      onSalvo(`Nova tabela de ${forma.nome} valendo desde ${dataBR(de)}.`)
    } catch (e: any) { onErro(e?.message ?? 'Erro ao salvar.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Passa a valer em</label>
        <input type="date" value={de} onChange={e => setDe(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        <p className="text-xs text-slate-400 mt-1">
          Venda feita antes desta data continua medida pela tabela anterior.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 text-left">
            <th className="font-medium py-1">Parcelas</th>
            <th className="font-medium py-1">Taxa %</th>
            <th className="font-medium py-1">Prazo em dias</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.parcelas_min}>
              <td className="py-1 pr-3 text-slate-600">{l.parcelas_min}x{i === linhas.length - 1 && linhas.length > 1 ? ' ou mais' : ''}</td>
              <td className="py-1 pr-3">
                <input value={l.taxa} onChange={e => mudar(i, 'taxa', e.target.value)}
                  className="w-24 bg-white border border-slate-200 rounded px-2 py-1" />
              </td>
              <td className="py-1">
                <input value={l.prazo} onChange={e => mudar(i, 'prazo', e.target.value)}
                  placeholder="não sei"
                  className="w-24 bg-white border border-slate-200 rounded px-2 py-1" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-slate-400">
        Prazo em branco fica como <strong>não informado</strong> — e não como "cai no mesmo dia".
        Zero significa que o dinheiro entra na hora.
      </p>

      <button onClick={salvar} disabled={salvando}
        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
        {salvando ? 'Salvando…' : 'Cadastrar tabela'}
      </button>
    </div>
  )
}

function HistoricoVigencias({ forma, vigenciaAtual }: { forma: FormaComTaxas; vigenciaAtual: string | null }) {
  const datas = [...new Set(forma.taxas.map(t => t.vigente_de))]
    .filter(d => d !== vigenciaAtual)
    .sort((a, b) => (a < b ? 1 : -1))

  if (datas.length === 0) return null

  return (
    <div className="border-t border-slate-200 pt-4">
      <p className="text-xs font-medium text-slate-500 mb-2">Tabelas anteriores</p>
      {datas.map(data => (
        <div key={data} className="mb-2">
          <p className="text-xs text-slate-400">desde {dataBR(data)}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {forma.taxas.filter(t => t.vigente_de === data)
              .sort((a, b) => a.parcelas_min - b.parcelas_min)
              .map(d => (
                <span key={d.parcelas_min} className="text-xs text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">
                  {d.parcelas_min}x {pct(d.taxa_pct)}
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
