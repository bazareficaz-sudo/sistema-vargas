'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'
import type { ResultadoFrete } from '@/lib/commerce/frete/calculo'
import {
  BairrosRapido, ExperienciaCliente, PreviaCliente,
  type ExperienciaTela, type PreviaLinha,
} from './FreteExperiencia'

// Painel do frete: configuração geral, regras, simulador e produtos especiais.
//
// Os campos numéricos ficam como TEXTO no formulário e vão para o servidor
// como vieram; quem converte e valida é `validar.ts`. Assim "6,50" e "6.50"
// funcionam, e a mensagem de erro vem de um lugar só.

export type ConfigFreteTela = {
  ativo: boolean
  origem_lat: number | null
  origem_lng: number | null
  fator_estrada: number
  frete_gratis_acima: number | null
  pedido_minimo: number | null
  sem_regra: 'combinar' | 'nao_entrega'
  peso_padrao_kg: number
  arredondar_para: number | null
  mensagem: string | null
}

export type RegraTela = {
  id: string
  nome: string
  servico: string
  ativo: boolean
  prioridade: number
  area_tipo: 'toda_loja' | 'bairros' | 'cep' | 'raio'
  bairros: string[]
  cidade: string | null
  cep_faixas: { de: string; ate: string }[]
  km_min: number | null
  km_max: number | null
  calculo_tipo: 'fixo' | 'por_km' | 'faixas'
  valor_fixo: number
  valor_base: number
  valor_por_km: number
  faixas_base: 'distancia' | 'peso' | 'subtotal'
  faixas: { ate: number | null; valor: number }[]
  peso_franquia_kg: number | null
  adicional_por_kg: number
  peso_max_kg: number | null
  frete_gratis_acima: number | null
  pedido_minimo: number | null
  prazo_texto: string | null
}

export type ProdutoEspecialTela = {
  produtoId: string
  nome: string
  sku: string | null
  freteGratis: boolean
  somenteRetirada: boolean
  adicionalUnidade: number
  pesoKg: number | null
}

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const s = (v: unknown) => (v == null ? '' : String(v))

const ROTULO_AREA = { toda_loja: 'Toda a cidade/região', bairros: 'Por bairro', cep: 'Por faixa de CEP', raio: 'Por distância (km)' }
const ROTULO_CALCULO = { fixo: 'Valor fixo', por_km: 'Base + valor por km', faixas: 'Tabela de faixas' }
const ROTULO_BASE = { distancia: 'distância (km)', peso: 'peso (kg)', subtotal: 'valor do pedido (R$)' }

const campo = 'h-9 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500'
const rotuloCls = 'block text-xs font-medium text-gray-600'

async function enviar(url: string, metodo: string, corpo?: unknown) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  return { ok: r.ok, d }
}

export default function FreteClient({
  lojaId, config, regras, produtos, entregaAtiva, enderecoLojaOk, experiencia, previa, cidadeLoja,
}: {
  lojaId: string
  config: ConfigFreteTela | null
  regras: RegraTela[]
  produtos: ProdutoEspecialTela[]
  entregaAtiva: boolean
  enderecoLojaOk: boolean
  experiencia: ExperienciaTela
  previa: PreviaLinha[]
  cidadeLoja: string | null
}) {
  return (
    <div className="space-y-5">
      {!entregaAtiva && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          A <strong>entrega</strong> está desligada nas Configurações da loja — o cliente só vê “Retirar na loja”.
          Ligue lá para o frete aparecer no checkout.
        </div>
      )}
      <ConfiguracaoGeral lojaId={lojaId} config={config} enderecoLojaOk={enderecoLojaOk} />
      <ExperienciaCliente lojaId={lojaId} experiencia={experiencia} temBairros={previa.length > 0} />
      <BairrosRapido
        lojaId={lojaId} cidadeLoja={cidadeLoja}
        bairrosExistentes={regras.filter(r => r.area_tipo === 'bairros').flatMap(r => r.bairros.map(b => ({ cidade: r.cidade, bairro: b })))}
      />
      <Regras lojaId={lojaId} regras={regras} />
      <PreviaCliente linhas={previa} />
      <Simulador lojaId={lojaId} temConfig={!!config} />
      <ProdutosEspeciais lojaId={lojaId} produtos={produtos} />
    </div>
  )
}

// ─── Configuração geral ──────────────────────────────────────────────────────

function ConfiguracaoGeral({ lojaId, config, enderecoLojaOk }: {
  lojaId: string; config: ConfigFreteTela | null; enderecoLojaOk: boolean
}) {
  const router = useRouter()
  const [f, setF] = useState({
    ativo: config?.ativo ?? false,
    origem_lat: s(config?.origem_lat), origem_lng: s(config?.origem_lng),
    fator_estrada: s(config?.fator_estrada ?? 1.3),
    frete_gratis_acima: s(config?.frete_gratis_acima),
    pedido_minimo: s(config?.pedido_minimo),
    sem_regra: config?.sem_regra ?? 'combinar',
    peso_padrao_kg: s(config?.peso_padrao_kg ?? 0.3),
    arredondar_para: s(config?.arredondar_para),
    mensagem: s(config?.mensagem),
  })
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [localizando, setLocalizando] = useState(false)
  const up = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }))

  async function localizar() {
    setLocalizando(true); setMsg(null)
    const { ok, d } = await enviar('/api/loja-admin/frete/origem', 'POST', { lojaId })
    setLocalizando(false)
    if (!ok) return setMsg({ tipo: 'erro', texto: d.erro ?? 'Não foi possível localizar.' })
    up('origem_lat', String(d.lat)); up('origem_lng', String(d.lng))
    setMsg({ tipo: 'ok', texto: 'Endereço localizado. Confira as coordenadas e clique em Salvar.' })
  }

  async function salvar() {
    setSalvando(true); setMsg(null)
    const { ok, d } = await enviar('/api/loja-admin/frete/config', 'PUT', { lojaId, ...f })
    setSalvando(false)
    if (!ok) return setMsg({ tipo: 'erro', texto: d.erro ?? 'Não foi possível salvar.' })
    setMsg({ tipo: 'ok', texto: 'Configuração salva.' })
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">Configuração do frete</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Desligado, a loja continua combinando o frete pelo WhatsApp. Ligue só depois de montar e testar as regras abaixo.
        </p>
      </div>
      <div className="space-y-4 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <input type="checkbox" checked={f.ativo} onChange={e => up('ativo', e.target.checked)} />
          Calcular o frete automaticamente no checkout
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className={rotuloCls}>Latitude da loja</span>
            <input className={campo} value={f.origem_lat} onChange={e => up('origem_lat', e.target.value)} placeholder="-23.550520" />
          </div>
          <div>
            <span className={rotuloCls}>Longitude da loja</span>
            <input className={campo} value={f.origem_lng} onChange={e => up('origem_lng', e.target.value)} placeholder="-46.633308" />
          </div>
          <div className="flex items-end">
            <button onClick={localizar} disabled={localizando || !enderecoLojaOk} className={botao('secundario', 'md')}
              title={enderecoLojaOk ? '' : 'Preencha o CEP da loja em Configurações'}>
              {localizando ? 'Localizando…' : 'Localizar pelo endereço da loja'}
            </button>
          </div>
        </div>
        <p className="-mt-2 text-xs text-gray-500">
          Só é necessário para regras por distância. É o ponto de onde as entregas saem.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className={rotuloCls}>Fator de estrada</span>
            <input className={campo} value={f.fator_estrada} onChange={e => up('fator_estrada', e.target.value)} />
            <span className="text-[11px] text-gray-500">Linha reta × fator ≈ distância por rua. 1,3 é um bom início.</span>
          </div>
          <div>
            <span className={rotuloCls}>Frete grátis acima de (R$)</span>
            <input className={campo} value={f.frete_gratis_acima} onChange={e => up('frete_gratis_acima', e.target.value)} placeholder="sem frete grátis" />
          </div>
          <div>
            <span className={rotuloCls}>Pedido mínimo para entrega (R$)</span>
            <input className={campo} value={f.pedido_minimo} onChange={e => up('pedido_minimo', e.target.value)} placeholder="sem mínimo" />
          </div>
          <div>
            <span className={rotuloCls}>Peso assumido sem cadastro (kg)</span>
            <input className={campo} value={f.peso_padrao_kg} onChange={e => up('peso_padrao_kg', e.target.value)} />
            <span className="text-[11px] text-gray-500">Para produto sem peso informado.</span>
          </div>
          <div>
            <span className={rotuloCls}>Arredondar frete para cima (R$)</span>
            <input className={campo} value={f.arredondar_para} onChange={e => up('arredondar_para', e.target.value)} placeholder="ex.: 0,50" />
          </div>
          <div>
            <span className={rotuloCls}>Endereço fora das regras</span>
            <select className={campo} value={f.sem_regra} onChange={e => up('sem_regra', e.target.value)}>
              <option value="combinar">Combinar com a loja (WhatsApp)</option>
              <option value="nao_entrega">Não entregar (só retirada)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={salvar} disabled={salvando} className={botao('primario', 'md')}>
            {salvando ? 'Salvando…' : 'Salvar configuração'}
          </button>
          {msg && <span className={`text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.texto}</span>}
        </div>
      </div>
    </section>
  )
}

// ─── Regras ──────────────────────────────────────────────────────────────────

function resumoRegra(r: RegraTela): string {
  const onde =
    r.area_tipo === 'toda_loja' ? 'Qualquer endereço'
    : r.area_tipo === 'bairros' ? `${r.bairros.length} bairro(s)${r.cidade ? ` em ${r.cidade}` : ''}`
    : r.area_tipo === 'cep' ? `${r.cep_faixas.length} faixa(s) de CEP`
    : `${r.km_min ?? 0} a ${r.km_max ?? '∞'} km`
  const quanto =
    r.calculo_tipo === 'fixo' ? reais(r.valor_fixo)
    : r.calculo_tipo === 'por_km' ? `${reais(r.valor_base)} + ${reais(r.valor_por_km)}/km`
    : `tabela por ${ROTULO_BASE[r.faixas_base]} (${r.faixas.length} faixas)`
  return `${onde} · ${quanto}`
}

function Regras({ lojaId, regras }: { lojaId: string; regras: RegraTela[] }) {
  const router = useRouter()
  const [editando, setEditando] = useState<string | 'nova' | null>(null)

  async function excluir(id: string) {
    if (!confirm('Excluir esta regra?')) return
    const { ok, d } = await enviar(`/api/loja-admin/frete/regras/${id}?lojaId=${lojaId}`, 'DELETE')
    if (ok) router.refresh(); else alert(d.erro ?? 'Não foi possível excluir')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4">
        <div>
          <h2 className="font-semibold text-gray-900">Regras de entrega</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Para cada <strong>serviço</strong> (ex.: “Entrega”, “Entrega expressa”) vale a <strong>primeira</strong> regra
            que combina com o endereço, na ordem de prioridade (menor número primeiro). Termine com uma regra “Qualquer endereço”.
          </p>
        </div>
        {editando !== 'nova' && (
          <button onClick={() => setEditando('nova')} className={botao('primario', 'sm')}>+ Nova regra</button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {editando === 'nova' && (
          <div className="p-4">
            <RegraForm lojaId={lojaId} aoFechar={() => { setEditando(null); router.refresh() }} aoCancelar={() => setEditando(null)} />
          </div>
        )}
        {regras.length === 0 && editando !== 'nova' && (
          <p className="p-4 text-sm text-gray-500">Nenhuma regra. Sem regra, o frete é sempre combinado com a loja.</p>
        )}
        {regras.map(r => (
          <div key={r.id} className="p-4">
            {editando === r.id ? (
              <RegraForm lojaId={lojaId} regra={r} aoFechar={() => { setEditando(null); router.refresh() }} aoCancelar={() => setEditando(null)} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-8 shrink-0 text-center text-xs font-semibold text-gray-400" title="Prioridade">{r.prioridade}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{r.nome}</p>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{r.servico}</span>
                    {!r.ativo && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Desativada</span>}
                  </div>
                  <p className="truncate text-xs text-gray-500">{resumoRegra(r)}{r.prazo_texto ? ` · ${r.prazo_texto}` : ''}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setEditando(r.id)} className={botao('secundario', 'sm')}>Editar</button>
                  <button onClick={() => excluir(r.id)} className={botao('perigo', 'sm')}>Excluir</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function RegraForm({ lojaId, regra, aoFechar, aoCancelar }: {
  lojaId: string; regra?: RegraTela; aoFechar: () => void; aoCancelar: () => void
}) {
  const [f, setF] = useState({
    nome: regra?.nome ?? '', servico: regra?.servico ?? 'Entrega', ativo: regra?.ativo ?? true,
    prioridade: s(regra?.prioridade ?? 100), prazo_texto: s(regra?.prazo_texto),
    area_tipo: regra?.area_tipo ?? 'toda_loja',
    bairros: (regra?.bairros ?? []).join('\n'), cidade: s(regra?.cidade),
    km_min: s(regra?.km_min), km_max: s(regra?.km_max),
    calculo_tipo: regra?.calculo_tipo ?? 'fixo',
    valor_fixo: s(regra?.valor_fixo ?? ''), valor_base: s(regra?.valor_base ?? ''), valor_por_km: s(regra?.valor_por_km ?? ''),
    faixas_base: regra?.faixas_base ?? 'distancia',
    peso_franquia_kg: s(regra?.peso_franquia_kg), adicional_por_kg: s(regra?.adicional_por_kg || ''),
    peso_max_kg: s(regra?.peso_max_kg), frete_gratis_acima: s(regra?.frete_gratis_acima), pedido_minimo: s(regra?.pedido_minimo),
  })
  const [faixas, setFaixas] = useState<{ ate: string; valor: string }[]>(
    (regra?.faixas ?? []).map(x => ({ ate: s(x.ate), valor: s(x.valor) })))
  const [cepFaixas, setCepFaixas] = useState<{ de: string; ate: string }[]>(regra?.cep_faixas ?? [])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const up = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }))

  async function salvar() {
    setSalvando(true); setErro(null)
    const corpo = {
      lojaId, ...f,
      bairros: f.bairros.split(/[\n;]/).map(b => b.trim()).filter(Boolean),
      faixas, cep_faixas: cepFaixas,
    }
    const { ok, d } = regra
      ? await enviar(`/api/loja-admin/frete/regras/${regra.id}`, 'PUT', corpo)
      : await enviar('/api/loja-admin/frete/regras', 'POST', corpo)
    setSalvando(false)
    if (!ok) return setErro(d.erro ?? 'Não foi possível salvar.')
    aoFechar()
  }

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <span className={rotuloCls}>Nome da regra</span>
          <input className={campo} value={f.nome} onChange={e => up('nome', e.target.value)} placeholder="ex.: Bairros do centro" />
        </div>
        <div>
          <span className={rotuloCls}>Serviço</span>
          <input className={campo} value={f.servico} onChange={e => up('servico', e.target.value)} />
        </div>
        <div>
          <span className={rotuloCls}>Prioridade</span>
          <input className={campo} value={f.prioridade} onChange={e => up('prioridade', e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <span className={rotuloCls}>Prazo mostrado ao cliente</span>
          <input className={campo} value={f.prazo_texto} onChange={e => up('prazo_texto', e.target.value)} placeholder="ex.: Entrega no mesmo dia" />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={e => up('ativo', e.target.checked)} /> Ativa
        </label>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Onde vale</legend>
        <select className={campo} value={f.area_tipo} onChange={e => up('area_tipo', e.target.value)}>
          {Object.entries(ROTULO_AREA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {f.area_tipo === 'bairros' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <span className={rotuloCls}>Bairros (um por linha)</span>
              <textarea rows={5} className="w-full rounded-lg border border-gray-300 p-3 text-sm outline-none focus:border-blue-500"
                value={f.bairros} onChange={e => up('bairros', e.target.value)} />
            </div>
            <div>
              <span className={rotuloCls}>Cidade (opcional)</span>
              <input className={campo} value={f.cidade} onChange={e => up('cidade', e.target.value)} />
              <span className="text-[11px] text-gray-500">Evita confundir bairros de mesmo nome em outra cidade.</span>
            </div>
          </div>
        )}

        {f.area_tipo === 'cep' && (
          <div className="space-y-2">
            {cepFaixas.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={campo} placeholder="CEP inicial" value={c.de}
                  onChange={e => setCepFaixas(l => l.map((x, n) => n === i ? { ...x, de: e.target.value } : x))} />
                <span className="text-xs text-gray-500">até</span>
                <input className={campo} placeholder="CEP final" value={c.ate}
                  onChange={e => setCepFaixas(l => l.map((x, n) => n === i ? { ...x, ate: e.target.value } : x))} />
                <button onClick={() => setCepFaixas(l => l.filter((_, n) => n !== i))} className={botao('perigo', 'sm')}>×</button>
              </div>
            ))}
            <button onClick={() => setCepFaixas(l => [...l, { de: '', ate: '' }])} className={botao('secundario', 'sm')}>+ Faixa de CEP</button>
          </div>
        )}

        {f.area_tipo === 'raio' && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div>
              <span className={rotuloCls}>De (km)</span>
              <input className={campo} value={f.km_min} onChange={e => up('km_min', e.target.value)} placeholder="0" />
            </div>
            <div>
              <span className={rotuloCls}>Até (km)</span>
              <input className={campo} value={f.km_max} onChange={e => up('km_max', e.target.value)} placeholder="sem limite" />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Quanto custa</legend>
        <select className={campo} value={f.calculo_tipo} onChange={e => up('calculo_tipo', e.target.value)}>
          {Object.entries(ROTULO_CALCULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {f.calculo_tipo === 'fixo' && (
          <div className="max-w-xs">
            <span className={rotuloCls}>Valor (R$)</span>
            <input className={campo} value={f.valor_fixo} onChange={e => up('valor_fixo', e.target.value)} placeholder="0,00" />
          </div>
        )}

        {f.calculo_tipo === 'por_km' && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div>
              <span className={rotuloCls}>Valor base (R$)</span>
              <input className={campo} value={f.valor_base} onChange={e => up('valor_base', e.target.value)} />
            </div>
            <div>
              <span className={rotuloCls}>Por km rodado (R$)</span>
              <input className={campo} value={f.valor_por_km} onChange={e => up('valor_por_km', e.target.value)} />
            </div>
            <p className="col-span-2 text-xs text-gray-500">Exige a localização da loja na configuração acima.</p>
          </div>
        )}

        {f.calculo_tipo === 'faixas' && (
          <div className="space-y-2">
            <div className="max-w-xs">
              <span className={rotuloCls}>A tabela é medida por</span>
              <select className={campo} value={f.faixas_base} onChange={e => up('faixas_base', e.target.value)}>
                {Object.entries(ROTULO_BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {faixas.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-10 text-xs text-gray-500">até</span>
                <input className={campo} placeholder="vazio = acima de tudo" value={x.ate}
                  onChange={e => setFaixas(l => l.map((y, n) => n === i ? { ...y, ate: e.target.value } : y))} />
                <span className="text-xs text-gray-500">cobra R$</span>
                <input className={campo} value={x.valor}
                  onChange={e => setFaixas(l => l.map((y, n) => n === i ? { ...y, valor: e.target.value } : y))} />
                <button onClick={() => setFaixas(l => l.filter((_, n) => n !== i))} className={botao('perigo', 'sm')}>×</button>
              </div>
            ))}
            <button onClick={() => setFaixas(l => [...l, { ate: '', valor: '' }])} className={botao('secundario', 'sm')}>+ Faixa</button>
          </div>
        )}
      </fieldset>

      <fieldset className="rounded-lg border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Adicionais e limites (opcional)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className={rotuloCls}>Peso sem custo extra até (kg)</span>
            <input className={campo} value={f.peso_franquia_kg} onChange={e => up('peso_franquia_kg', e.target.value)} />
          </div>
          <div>
            <span className={rotuloCls}>Adicional por kg acima (R$)</span>
            <input className={campo} value={f.adicional_por_kg} onChange={e => up('adicional_por_kg', e.target.value)} />
          </div>
          <div>
            <span className={rotuloCls}>Peso máximo desta regra (kg)</span>
            <input className={campo} value={f.peso_max_kg} onChange={e => up('peso_max_kg', e.target.value)} />
          </div>
          <div>
            <span className={rotuloCls}>Frete grátis acima de (R$)</span>
            <input className={campo} value={f.frete_gratis_acima} onChange={e => up('frete_gratis_acima', e.target.value)} />
          </div>
          <div>
            <span className={rotuloCls}>Pedido mínimo nesta regra (R$)</span>
            <input className={campo} value={f.pedido_minimo} onChange={e => up('pedido_minimo', e.target.value)} />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button onClick={salvar} disabled={salvando} className={botao('primario', 'md')}>
          {salvando ? 'Salvando…' : regra ? 'Salvar regra' : 'Criar regra'}
        </button>
        <button onClick={aoCancelar} className={botao('secundario', 'md')}>Cancelar</button>
        {erro && <span className="text-sm text-red-700">{erro}</span>}
      </div>
    </div>
  )
}

// ─── Simulador ───────────────────────────────────────────────────────────────

function Simulador({ lojaId, temConfig }: { lojaId: string; temConfig: boolean }) {
  const [f, setF] = useState({ cep: '', bairro: '', cidade: '', distanciaKm: '', subtotal: '100', pesoKg: '1' })
  const [saida, setSaida] = useState<{
    resultado: ResultadoFrete; distanciaKm: number | null; semOrigem: boolean
    endereco: { bairro: string; cidade: string; uf: string } | null
  } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [rodando, setRodando] = useState(false)
  const up = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))

  async function simular() {
    setRodando(true); setErro(null); setSaida(null)
    const { ok, d } = await enviar('/api/loja-admin/frete/simular', 'POST', { lojaId, ...f })
    setRodando(false)
    if (!ok) return setErro(d.erro ?? 'Não foi possível simular.')
    setSaida(d)
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">Simulador</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Confira quanto sai para um endereço, antes de ligar o frete. Usa as regras <strong>salvas</strong>.
        </p>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div><span className={rotuloCls}>CEP</span><input className={campo} value={f.cep} onChange={e => up('cep', e.target.value)} placeholder="00000-000" /></div>
          <div><span className={rotuloCls}>Bairro (opcional)</span><input className={campo} value={f.bairro} onChange={e => up('bairro', e.target.value)} /></div>
          <div><span className={rotuloCls}>Cidade (opcional)</span><input className={campo} value={f.cidade} onChange={e => up('cidade', e.target.value)} /></div>
          <div><span className={rotuloCls}>Ou distância (km)</span><input className={campo} value={f.distanciaKm} onChange={e => up('distanciaKm', e.target.value)} /></div>
          <div><span className={rotuloCls}>Pedido (R$)</span><input className={campo} value={f.subtotal} onChange={e => up('subtotal', e.target.value)} /></div>
          <div><span className={rotuloCls}>Peso (kg)</span><input className={campo} value={f.pesoKg} onChange={e => up('pesoKg', e.target.value)} /></div>
        </div>
        <button onClick={simular} disabled={rodando || !temConfig} className={botao('primario', 'md')}
          title={temConfig ? '' : 'Salve a configuração antes'}>
          {rodando ? 'Calculando…' : 'Simular'}
        </button>
        {erro && <p className="text-sm text-red-700">{erro}</p>}

        {saida && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="text-xs text-gray-500">
              {saida.endereco ? `${saida.endereco.bairro || 's/ bairro'} · ${saida.endereco.cidade}/${saida.endereco.uf} · ` : ''}
              {saida.distanciaKm != null ? `${saida.distanciaKm} km` : 'distância não disponível'}
              {' · '}peso {saida.resultado.pesoTotalKg} kg
            </p>
            {saida.semOrigem && f.cep && (
              <p className="mt-1 text-xs text-amber-700">A loja ainda não tem localização — regras por distância não conseguem calcular.</p>
            )}
            {saida.resultado.status === 'opcoes' ? (
              <ul className="mt-2 space-y-1">
                {saida.resultado.opcoes.map(o => (
                  <li key={o.servico} className="flex justify-between gap-3">
                    <span><strong>{o.servico}</strong> <span className="text-gray-500">— regra “{o.nome}”{o.prazo ? ` · ${o.prazo}` : ''}</span></span>
                    <strong>{o.valor > 0 ? reais(o.valor) : 'Grátis'}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2">
                <strong>{saida.resultado.status === 'combinar' ? 'A combinar' : 'Entrega indisponível'}</strong>
                <span className="text-gray-600"> — {saida.resultado.motivo}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Produtos especiais ──────────────────────────────────────────────────────

function ProdutosEspeciais({ lojaId, produtos }: { lojaId: string; produtos: ProdutoEspecialTela[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [achados, setAchados] = useState<{ id: string; nome: string; sku: string | null; peso_kg: number | null }[]>([])
  const [editando, setEditando] = useState<ProdutoEspecialTela | null>(null)

  async function buscar(v: string) {
    setQ(v)
    if (v.trim().length < 2) return setAchados([])
    const r = await fetch(`/api/loja-admin/frete/produtos?q=${encodeURIComponent(v)}`)
    const d = await r.json().catch(() => ({}))
    setAchados(d.produtos ?? [])
  }

  async function remover(produtoId: string) {
    if (!confirm('Remover a regra especial deste produto?')) return
    const { ok, d } = await enviar(`/api/loja-admin/frete/produtos?lojaId=${lojaId}&produtoId=${produtoId}`, 'DELETE')
    if (ok) router.refresh(); else alert(d.erro ?? 'Não foi possível remover')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900">Produtos com regra especial</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Marque produtos <strong>frete grátis</strong>, <strong>somente retirada</strong> (volumosos, frágeis), com
          <strong> adicional por unidade</strong> ou com <strong>peso próprio</strong>. Produto sem peso no cadastro usa o peso padrão.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {editando ? (
          <ProdutoForm lojaId={lojaId} produto={editando}
            aoFechar={() => { setEditando(null); setQ(''); setAchados([]); router.refresh() }}
            aoCancelar={() => setEditando(null)} />
        ) : (
          <>
            <div className="relative max-w-md">
              <input className={campo} placeholder="Buscar produto pelo nome para adicionar…" value={q} onChange={e => buscar(e.target.value)} />
              {achados.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {achados.map(p => (
                    <li key={p.id}>
                      <button className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onClick={() => setEditando({
                          produtoId: p.id, nome: p.nome, sku: p.sku,
                          freteGratis: false, somenteRetirada: false, adicionalUnidade: 0, pesoKg: p.peso_kg,
                        })}>
                        {p.nome}{p.sku ? <span className="text-xs text-gray-500"> · {p.sku}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {produtos.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum produto com regra especial.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {produtos.map(p => (
                  <li key={p.produtoId} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{p.nome}</p>
                      <p className="text-xs text-gray-500">
                        {[
                          p.freteGratis && 'frete grátis',
                          p.somenteRetirada && 'somente retirada',
                          p.adicionalUnidade > 0 && `+${reais(p.adicionalUnidade)} por unidade`,
                          p.pesoKg != null && `peso ${p.pesoKg} kg`,
                        ].filter(Boolean).join(' · ') || 'sem alteração'}
                      </p>
                    </div>
                    <button onClick={() => setEditando(p)} className={botao('secundario', 'sm')}>Editar</button>
                    <button onClick={() => remover(p.produtoId)} className={botao('perigo', 'sm')}>Remover</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function ProdutoForm({ lojaId, produto, aoFechar, aoCancelar }: {
  lojaId: string; produto: ProdutoEspecialTela; aoFechar: () => void; aoCancelar: () => void
}) {
  const [f, setF] = useState({
    frete_gratis: produto.freteGratis, somente_retirada: produto.somenteRetirada,
    adicional_unidade: s(produto.adicionalUnidade || ''), peso_kg: s(produto.pesoKg),
  })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true); setErro(null)
    const { ok, d } = await enviar('/api/loja-admin/frete/produtos', 'PUT', { lojaId, produtoId: produto.produtoId, ...f })
    setSalvando(false)
    if (!ok) return setErro(d.erro ?? 'Não foi possível salvar.')
    aoFechar()
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <p className="text-sm font-medium text-gray-900">{produto.nome}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.frete_gratis}
            onChange={e => setF(x => ({ ...x, frete_gratis: e.target.checked, somente_retirada: e.target.checked ? false : x.somente_retirada }))} />
          Frete grátis
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.somente_retirada}
            onChange={e => setF(x => ({ ...x, somente_retirada: e.target.checked, frete_gratis: e.target.checked ? false : x.frete_gratis }))} />
          Somente retirada na loja
        </label>
      </div>
      <div className="grid max-w-md grid-cols-2 gap-3">
        <div>
          <span className={rotuloCls}>Adicional por unidade (R$)</span>
          <input className={campo} value={f.adicional_unidade} onChange={e => setF(x => ({ ...x, adicional_unidade: e.target.value }))} />
        </div>
        <div>
          <span className={rotuloCls}>Peso próprio (kg)</span>
          <input className={campo} value={f.peso_kg} onChange={e => setF(x => ({ ...x, peso_kg: e.target.value }))} placeholder="usa o do cadastro" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={salvar} disabled={salvando} className={botao('primario', 'md')}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        <button onClick={aoCancelar} className={botao('secundario', 'md')}>Cancelar</button>
        {erro && <span className="text-sm text-red-700">{erro}</span>}
      </div>
    </div>
  )
}
