'use client'

import { useState, useEffect, useCallback } from 'react'

type Deposito = { id: string; nome: string; principal: boolean }
type Config = {
  deposito_id: string; modo: 'desativado' | 'opcional' | 'obrigatorio'
  niveis: string[]; separador: string; padding_por_nivel: Record<string, number>
  prefixos_por_nivel: Record<string, string>
}
type ValorLocalizacao = { valor: string; produtos: number; unidades: number }

const NIVEIS_DISPONIVEIS: { chave: string; label: string }[] = [
  { chave: 'zona', label: 'Zona' }, { chave: 'corredor', label: 'Corredor' },
  { chave: 'estante', label: 'Estante' }, { chave: 'modulo', label: 'Módulo' },
  { chave: 'nivel', label: 'Nível' }, { chave: 'posicao', label: 'Posição' },
]

const MODOS: { valor: Config['modo']; label: string; ajuda: string }[] = [
  { valor: 'desativado', label: 'Desativado', ajuda: 'Funcionamento atual, sem endereçamento.' },
  { valor: 'opcional', label: 'Opcional', ajuda: 'Pode existir estoque não endereçado — adoção gradual.' },
  { valor: 'obrigatorio', label: 'Obrigatório', ajuda: 'Reservado para quando a cobertura estiver alta (ainda não bloqueia nada nesta fase).' },
]

export default function ConfigDepositoEnderecamentoClient({ depositos, depositoIdInicial }: {
  depositos: Deposito[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')
  const [config, setConfig] = useState<Config | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const [valoresLivres, setValoresLivres] = useState<ValorLocalizacao[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [importando, setImportando] = useState(false)

  const carregar = useCallback(async () => {
    if (!depositoId) return
    const r = await fetch(`/api/enderecamento/config-deposito?depositoId=${depositoId}`).then(r => r.json()).catch(() => null)
    if (r?.ok) setConfig(r.config)
    const r2 = await fetch(`/api/enderecamento/importar-localizacoes?depositoId=${depositoId}`).then(r => r.json()).catch(() => null)
    if (r2?.ok) setValoresLivres(r2.valores)
    setSelecionados(new Set())
  }, [depositoId])

  useEffect(() => { carregar() }, [carregar])

  // Prévia com valores de exemplo, para o gestor ver o formato antes de
  // gerar centenas de endereços com o padrão errado — foi assim que saíram
  // 60 endereços "E-01-1-02" que não diziam nada e tiveram que ser apagados.
  function previaCodigo() {
    if (!config) return ''
    const exemplo: Record<string, string> = {
      zona: 'A', corredor: '01', estante: '1', modulo: '2', nivel: '3', posicao: '02',
    }
    const ordem = ['zona', 'corredor', 'estante', 'modulo', 'nivel', 'posicao']
    return ordem
      .filter(n => config.niveis.includes(n))
      .map(n => `${config.prefixos_por_nivel?.[n] ?? ''}${exemplo[n]}`)
      .join(config.separador) || '(nenhum nível ativo)'
  }

  function toggleNivel(chave: string) {
    if (!config) return
    const ativo = config.niveis.includes(chave)
    setConfig({ ...config, niveis: ativo ? config.niveis.filter(n => n !== chave) : [...config.niveis, chave] })
  }

  async function salvar() {
    if (!config) return
    setSalvando(true)
    const r = await fetch('/api/enderecamento/config-deposito', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        depositoId, niveis: config.niveis, separador: config.separador,
        prefixosPorNivel: config.prefixos_por_nivel, modo: config.modo,
      }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setSalvando(false)
    setMsg(r.ok ? 'Configuração salva.' : (r.erro ?? 'Erro ao salvar.'))
    setTimeout(() => setMsg(''), 3000)
  }

  function toggleValor(valor: string) {
    setSelecionados(prev => { const n = new Set(prev); n.has(valor) ? n.delete(valor) : n.add(valor); return n })
  }

  async function importarSelecionados() {
    if (selecionados.size === 0) return
    setImportando(true)
    const r = await fetch('/api/enderecamento/importar-localizacoes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositoId, valores: [...selecionados] }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setImportando(false)
    if (r.ok) {
      setMsg(`${r.enderecosCriados} endereço(s) criado(s), ${r.produtosEnderecados} produto(s) endereçado(s).`)
      carregar()
    } else {
      setMsg(r.erro ?? 'Erro ao importar.')
    }
    setTimeout(() => setMsg(''), 5000)
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Configurar Endereçamento</h1>
          <p className="text-slate-500 text-sm mt-0.5">Hierarquia e modo de adoção, por depósito.</p>
        </div>
        {depositos.length > 0 && (
          <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        )}
      </div>

      {msg && <div className="bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-xl px-4 py-2">{msg}</div>}

      {config && (
        <>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Níveis de hierarquia usados neste depósito</p>
              <div className="flex flex-wrap gap-2">
                {NIVEIS_DISPONIVEIS.map(n => (
                  <button key={n.chave} onClick={() => toggleNivel(n.chave)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      config.niveis.includes(n.chave) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}>
                    {n.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Um depósito pequeno pode usar só Corredor + Posição, por exemplo — nada obriga usar todos os níveis.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Separador do código</label>
              <input value={config.separador} onChange={e => setConfig({ ...config, separador: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-20" maxLength={3} />
              <span className="text-xs text-slate-400 ml-2">Ex: A{config.separador}01{config.separador}03</span>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 mb-1">Prefixo de cada nível</p>
              <p className="text-xs text-slate-400 mb-2">
                Sem prefixo o código sai só com números e não diz o que é cada parte — quem separa o pedido
                lê &quot;01-1-02&quot; e não sabe se aquilo é gaveta ou prateleira. Com prefixo vira
                &quot;EST1-GAV02&quot;. O texto é colado no valor: <b>GAV</b> gera GAV02, <b>GAV-</b> gera GAV-02.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {NIVEIS_DISPONIVEIS.filter(n => config.niveis.includes(n.chave)).map(n => (
                  <div key={n.chave}>
                    <label className="block text-[10px] font-medium text-slate-500 uppercase mb-0.5">{n.label}</label>
                    <input value={config.prefixos_por_nivel?.[n.chave] ?? ''} placeholder="sem prefixo"
                      onChange={e => setConfig({
                        ...config,
                        prefixos_por_nivel: { ...(config.prefixos_por_nivel ?? {}), [n.chave]: e.target.value },
                      })}
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Vai ficar assim: <span className="font-mono font-medium text-slate-800">{previaCodigo()}</span>
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Modo de adoção</p>
              <div className="space-y-2">
                {MODOS.map(m => (
                  <label key={m.valor} className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="modo" checked={config.modo === m.valor}
                      onChange={() => setConfig({ ...config, modo: m.valor })} className="mt-1 accent-blue-600" />
                    <span>
                      <span className="text-sm font-medium text-slate-800">{m.label}</span>
                      <span className="text-xs text-slate-400 block">{m.ajuda}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button onClick={salvar} disabled={salvando}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {salvando ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-700 mb-1">Importar localizações de texto existentes</p>
            <p className="text-xs text-slate-400 mb-3">
              O campo de localização livre já usado no Estoque Detalhado vira endereço de verdade aqui — escolha quais
              valores importar. Cada um vira um endereço próprio, com o estoque que já estava marcado nele.
            </p>
            {valoresLivres.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma localização de texto livre encontrada neste depósito.</p>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
                  {valoresLivres.map(v => (
                    <label key={v.valor} className="flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={selecionados.has(v.valor)} onChange={() => toggleValor(v.valor)} className="accent-blue-600" />
                        {v.valor}
                      </span>
                      <span className="text-xs text-slate-400">{v.produtos} produto(s), {v.unidades} un.</span>
                    </label>
                  ))}
                </div>
                <button onClick={importarSelecionados} disabled={importando || selecionados.size === 0}
                  className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  {importando ? 'Importando...' : `Importar ${selecionados.size} selecionado(s)`}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
