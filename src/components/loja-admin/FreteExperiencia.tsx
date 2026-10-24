'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { botao } from '@/components/ui/botao'
import { normalizarTexto } from '@/lib/commerce/frete/calculo'

// Três blocos do painel de frete voltados ao CLIENTE da loja:
//
//   ExperienciaCliente → quando e como a loja pergunta "para onde entregamos?"
//   BairrosRapido      → cadastrar vários bairros e valores de uma vez
//   PreviaCliente      → o que o cliente lê em cada bairro (a prova do que foi salvo)
//
// Nenhum deles tem regra de cálculo própria: criam e leem as mesmas regras de
// "Regras de entrega", que continuam sendo a fonte de verdade do valor.

export type ExperienciaTela = {
  seletor_gatilho: 'entrada' | 'produto' | 'carrinho' | 'nunca'
  seletor_identificacao: 'bairro' | 'cep' | 'ambos'
  seletor_titulo: string | null
  faixa_topo: boolean
  mostrar_no_produto: boolean
  incentivo_gratis: boolean
}

export type PreviaLinha = { cidade: string | null; bairro: string; texto: string }

const campo = 'h-9 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500'
const rotuloCls = 'block text-xs font-medium text-gray-600'

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function enviar(url: string, metodo: string, corpo?: unknown) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  return { ok: r.ok, d }
}

const GATILHOS: { valor: ExperienciaTela['seletor_gatilho']; titulo: string; texto: string }[] = [
  { valor: 'produto', titulo: 'Quando consultar o frete de um produto', texto: 'O cliente clica em “Calcular frete e prazo” na página do produto. Menos invasivo — recomendado.' },
  { valor: 'entrada', titulo: 'Logo ao entrar na loja', texto: 'Abre na primeira visita. Mais gente informa o bairro, mas interrompe quem só quer olhar.' },
  { valor: 'carrinho', titulo: 'Ao abrir o carrinho', texto: 'Só pergunta quando o cliente já está decidido a comprar.' },
  { valor: 'nunca', titulo: 'Só se o cliente pedir', texto: 'Nunca abre sozinha; o cliente usa o botão “Entregar em…” (se a faixa do topo estiver ligada).' },
]

// ─── Experiência do cliente ──────────────────────────────────────────────────

export function ExperienciaCliente({ lojaId, experiencia, temBairros }: {
  lojaId: string; experiencia: ExperienciaTela; temBairros: boolean
}) {
  const router = useRouter()
  const [f, setF] = useState<ExperienciaTela>(experiencia)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const up = <K extends keyof ExperienciaTela>(k: K, v: ExperienciaTela[K]) => setF(x => ({ ...x, [k]: v }))

  async function salvar() {
    setSalvando(true); setMsg(null)
    const { ok, d } = await enviar('/api/loja-admin/frete/experiencia', 'PUT', {
      lojaId, ...f, seletor_titulo: f.seletor_titulo ?? '',
    })
    setSalvando(false)
    if (!ok) return setMsg({ tipo: 'erro', texto: d.erro ?? 'Não foi possível salvar.' })
    setMsg({ tipo: 'ok', texto: 'Salvo. A loja já usa as novas escolhas.' })
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">Experiência do cliente</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Como a loja pergunta “para onde entregamos?” e mostra o frete antes do carrinho.
          Só aparece para o cliente se o cálculo de frete acima estiver ligado.
        </p>
      </div>

      <div className="space-y-5 p-4">
        <fieldset>
          <legend className="text-sm font-medium text-gray-900">Quando a janela de bairro abre sozinha</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {GATILHOS.map(g => (
              <label key={g.valor} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${f.seletor_gatilho === g.valor ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'}`}>
                <input type="radio" name="gatilho" checked={f.seletor_gatilho === g.valor} onChange={() => up('seletor_gatilho', g.valor)} className="mt-0.5" />
                <span>
                  <span className="font-medium text-gray-900">{g.titulo}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{g.texto}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={rotuloCls}>O que o cliente informa</span>
            <select className={campo} value={f.seletor_identificacao} onChange={e => up('seletor_identificacao', e.target.value as ExperienciaTela['seletor_identificacao'])}>
              <option value="ambos">Escolhe o bairro ou digita o CEP</option>
              <option value="bairro">Só escolhe o bairro da lista</option>
              <option value="cep">Só digita o CEP</option>
            </select>
            {!temBairros && f.seletor_identificacao !== 'cep' && (
              <span className="mt-1 block text-[11px] text-amber-700">
                Ainda não há regra “Por bairro”: enquanto isso a loja pede só o CEP. Cadastre os bairros abaixo.
              </span>
            )}
          </div>
          <div>
            <span className={rotuloCls}>Título da janela (opcional)</span>
            <input className={campo} maxLength={80} value={f.seletor_titulo ?? ''} onChange={e => up('seletor_titulo', e.target.value)} placeholder="Para onde entregamos?" />
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={f.faixa_topo} onChange={e => up('faixa_topo', e.target.checked)} />
            <span><strong className="font-medium text-gray-900">Faixa no topo da loja</strong> — “Entregar em Bairro X · frete R$ Y · Trocar”, sempre visível.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={f.mostrar_no_produto} onChange={e => up('mostrar_no_produto', e.target.checked)} />
            <span><strong className="font-medium text-gray-900">Frete na página do produto</strong> — o cliente vê o frete e o prazo antes de pôr no carrinho.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={f.incentivo_gratis} onChange={e => up('incentivo_gratis', e.target.checked)} />
            <span><strong className="font-medium text-gray-900">Incentivo de frete grátis</strong> — “Faltam R$ X para o frete grátis” no carrinho. Aumenta o valor médio do pedido.</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={salvar} disabled={salvando} className={botao('primario', 'md')}>
            {salvando ? 'Salvando…' : 'Salvar experiência'}
          </button>
          {msg && <span className={`text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.texto}</span>}
        </div>
      </div>
    </section>
  )
}

// ─── Cadastro rápido de bairros ──────────────────────────────────────────────

type Linha = {
  bairro: string; valor: number; gratisAcima: number | null; pedidoMinimo: number | null; prazo: string | null
}

const numero = (v: string | undefined): number | null => {
  const t = (v ?? '').trim().replace(/^R\$\s*/i, '').replace(/\./g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

/**
 * Uma linha por bairro: `Bairro; valor; grátis acima de; prazo; pedido mínimo`.
 * Só o bairro é obrigatório — o que faltar vem dos valores-padrão acima.
 */
function lerLinhas(texto: string, padrao: Omit<Linha, 'bairro'>): { linhas: Linha[]; erros: string[] } {
  const linhas: Linha[] = []
  const erros: string[] = []
  texto.split('\n').map(l => l.trim()).filter(Boolean).forEach((l, i) => {
    const [bairro, valor, gratis, prazo, minimo] = l.split(/[;\t]/).map(p => p.trim())
    if (!bairro) return
    const v = valor ? (/^gr[aá]tis$/i.test(valor) ? 0 : numero(valor)) : padrao.valor
    const g = gratis ? numero(gratis) : padrao.gratisAcima
    const m = minimo ? numero(minimo) : padrao.pedidoMinimo
    if (v == null || Number.isNaN(v)) { erros.push(`Linha ${i + 1} (${bairro}): informe o valor da entrega.`); return }
    if (Number.isNaN(g)) { erros.push(`Linha ${i + 1} (${bairro}): “grátis acima de” inválido.`); return }
    if (Number.isNaN(m)) { erros.push(`Linha ${i + 1} (${bairro}): pedido mínimo inválido.`); return }
    linhas.push({ bairro, valor: v, gratisAcima: g, pedidoMinimo: m, prazo: prazo || padrao.prazo })
  })
  return { linhas, erros }
}

export function BairrosRapido({ lojaId, bairrosExistentes, cidadeLoja }: {
  lojaId: string; bairrosExistentes: { cidade: string | null; bairro: string }[]; cidadeLoja: string | null
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [cidade, setCidade] = useState(cidadeLoja ?? '')
  const [servico, setServico] = useState('Entrega')
  const [padrao, setPadrao] = useState({ valor: '', gratis: '', minimo: '', prazo: '' })
  const [texto, setTexto] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const { linhas, erros } = useMemo(() => lerLinhas(texto, {
    valor: numero(padrao.valor) as number, gratisAcima: numero(padrao.gratis),
    pedidoMinimo: numero(padrao.minimo), prazo: padrao.prazo.trim() || null,
  }), [texto, padrao])

  // Bairros com o mesmo valor, grátis, mínimo e prazo viram UMA regra: dez
  // bairros a R$ 5,00 não precisam de dez regras para o gestor manter.
  const grupos = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) {
      const k = `${l.valor}|${l.gratisAcima}|${l.pedidoMinimo}|${l.prazo}`
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return [...m.values()]
  }, [linhas])

  const jaCadastrados = useMemo(() => {
    const set = new Set(bairrosExistentes.map(b => normalizarTexto(b.bairro)))
    return linhas.filter(l => set.has(normalizarTexto(l.bairro))).map(l => l.bairro)
  }, [linhas, bairrosExistentes])

  async function criar() {
    setSalvando(true); setMsg(null)
    let feitas = 0
    for (const g of grupos) {
      const x = g[0]
      const { ok, d } = await enviar('/api/loja-admin/frete/regras', 'POST', {
        lojaId,
        nome: `${cidade.trim() ? `${cidade.trim()} · ` : ''}${x.valor > 0 ? reais(x.valor) : 'Grátis'}${x.prazo ? ` · ${x.prazo}` : ''}`.slice(0, 80),
        servico: servico.trim() || 'Entrega', ativo: true,
        // Antes da regra “Qualquer endereço” (100), que fecha a fila.
        prioridade: 50,
        area_tipo: 'bairros', bairros: g.map(l => l.bairro), cidade: cidade.trim(),
        calculo_tipo: 'fixo', valor_fixo: x.valor,
        frete_gratis_acima: x.gratisAcima ?? '', pedido_minimo: x.pedidoMinimo ?? '',
        prazo_texto: x.prazo ?? '',
      })
      if (!ok) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `${feitas > 0 ? `${feitas} regra(s) criada(s) antes do erro. ` : ''}${d.erro ?? 'Não foi possível salvar.'}` })
        if (feitas > 0) router.refresh()
        return
      }
      feitas++
    }
    setSalvando(false)
    setMsg({ tipo: 'ok', texto: `${linhas.length} bairro(s) cadastrado(s) em ${feitas} regra(s).` })
    setTexto('')
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4">
        <div>
          <h2 className="font-semibold text-gray-900">Cadastro rápido de bairros</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Cole a lista de bairros com o valor de cada um. Os que tiverem as mesmas condições viram uma regra só.
          </p>
        </div>
        <button onClick={() => setAberto(a => !a)} className={botao(aberto ? 'secundario' : 'primario', 'sm')}>
          {aberto ? 'Fechar' : 'Cadastrar bairros'}
        </button>
      </div>

      {aberto && (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <span className={rotuloCls}>Cidade</span>
              <input className={campo} value={cidade} onChange={e => setCidade(e.target.value)} placeholder="ex.: Rio de Janeiro" />
            </div>
            <div>
              <span className={rotuloCls}>Serviço</span>
              <input className={campo} value={servico} onChange={e => setServico(e.target.value)} />
            </div>
            <div>
              <span className={rotuloCls}>Valor padrão (R$)</span>
              <input className={campo} value={padrao.valor} onChange={e => setPadrao(p => ({ ...p, valor: e.target.value }))} placeholder="ex.: 5,00" />
            </div>
            <div>
              <span className={rotuloCls}>Grátis acima de (R$)</span>
              <input className={campo} value={padrao.gratis} onChange={e => setPadrao(p => ({ ...p, gratis: e.target.value }))} placeholder="sem frete grátis" />
            </div>
            <div>
              <span className={rotuloCls}>Pedido mínimo (R$)</span>
              <input className={campo} value={padrao.minimo} onChange={e => setPadrao(p => ({ ...p, minimo: e.target.value }))} placeholder="sem mínimo" />
            </div>
            <div className="sm:col-span-3">
              <span className={rotuloCls}>Prazo mostrado ao cliente</span>
              <input className={campo} value={padrao.prazo} onChange={e => setPadrao(p => ({ ...p, prazo: e.target.value }))} placeholder="ex.: Entrega em até 24h" />
            </div>
          </div>

          <div>
            <span className={rotuloCls}>Bairros — um por linha</span>
            <textarea
              rows={7} value={texto} onChange={e => setTexto(e.target.value)}
              placeholder={'Bangu\nPadre Miguel; 6,00\nRealengo; 8,00; 200; Entrega em até 48h\nCampo Grande; grátis'}
              className="w-full rounded-lg border border-gray-300 p-3 font-mono text-sm outline-none focus:border-blue-500"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Formato: <code>Bairro; valor; grátis acima de; prazo; pedido mínimo</code>. Só o bairro é obrigatório — o que
              faltar usa os valores padrão acima. Escreva <code>grátis</code> no valor para entrega sem custo.
            </p>
          </div>

          {erros.length > 0 && (
            <ul className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {erros.slice(0, 5).map(e => <li key={e}>{e}</li>)}
            </ul>
          )}
          {jaCadastrados.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Já existe regra para {jaCadastrados.slice(0, 5).join(', ')}{jaCadastrados.length > 5 ? '…' : ''}. Vale a regra de
              menor prioridade — as novas ficam na frente (prioridade 50). Se quiser trocar, exclua a antiga depois.
            </p>
          )}

          {grupos.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <p className="font-medium text-gray-900">Isto vai criar {grupos.length} regra(s):</p>
              <ul className="mt-1 space-y-0.5 text-gray-700">
                {grupos.map(g => (
                  <li key={`${g[0].valor}|${g[0].gratisAcima}|${g[0].pedidoMinimo}|${g[0].prazo}`}>
                    <strong>{g.length}</strong> bairro(s) ({g.slice(0, 3).map(l => l.bairro).join(', ')}{g.length > 3 ? '…' : ''}) —{' '}
                    {g[0].valor > 0 ? reais(g[0].valor) : 'grátis'}
                    {g[0].gratisAcima != null && ` · grátis acima de ${reais(g[0].gratisAcima)}`}
                    {g[0].pedidoMinimo != null && ` · mínimo ${reais(g[0].pedidoMinimo)}`}
                    {g[0].prazo && ` · ${g[0].prazo}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={criar} disabled={salvando || linhas.length === 0 || erros.length > 0} className={botao('primario', 'md')}>
              {salvando ? 'Criando…' : 'Criar regras'}
            </button>
            {msg && <span className={`text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.texto}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

// ─── O que o cliente vê ──────────────────────────────────────────────────────

export function PreviaCliente({ linhas }: { linhas: PreviaLinha[] }) {
  if (linhas.length === 0) return null
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">O que o cliente vê em cada bairro</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Estes são os bairros da lista da janela, com o texto que aparece depois que o cliente escolhe. Para mudar algo, edite a regra.
        </p>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr><th className="p-3">Bairro</th><th className="p-3">O cliente lê</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map(l => (
              <tr key={`${l.cidade}|${l.bairro}`}>
                <td className="whitespace-nowrap p-3 font-medium text-gray-900">
                  {l.bairro}{l.cidade && <span className="font-normal text-gray-500"> · {l.cidade}</span>}
                </td>
                <td className="p-3 text-gray-700">{l.texto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
