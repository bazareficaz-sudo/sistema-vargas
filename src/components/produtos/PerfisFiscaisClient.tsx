'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  SITUACOES, REGIMES, REGRAS_PADRAO, conferirRegra, exigeDifal,
  type RegraPerfil, type RegimeRegra, type SituacaoOperacao,
} from '@/lib/fiscal/perfilFiscal'

export type PerfilComRegras = {
  id: string
  nome: string
  descricao: string | null
  chave: string | null
  regras: RegraPerfil[]
  produtos: number
}

type Props = {
  perfisIniciais: PerfilComRegras[]
  semPerfil: number
  empresasPorRegime: Record<RegimeRegra, string[]>
  tenantId: string
}

const chaveRegra = (regime: RegimeRegra, situacao: SituacaoOperacao) => `${regime}|${situacao}`

// As 8 células da grade sempre existem na tela, mesmo que o banco não tenha a
// linha — célula vazia é "a definir", e é exatamente o que precisa aparecer.
function grade(regras: RegraPerfil[]): Record<string, RegraPerfil> {
  const g: Record<string, RegraPerfil> = {}
  for (const r of REGIMES) for (const s of SITUACOES) {
    const salva = regras.find(x => x.regime === r.chave && x.situacao === s.chave)
    g[chaveRegra(r.chave, s.chave)] = {
      regime: r.chave, situacao: s.chave,
      cfop: salva?.cfop ?? null, icms_situacao: salva?.icms_situacao ?? null,
    }
  }
  return g
}

const INPUT = 'w-full border border-gray-300 rounded-md px-2 py-1 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500'

export default function PerfisFiscaisClient({ perfisIniciais, semPerfil, empresasPorRegime, tenantId }: Props) {
  const router = useRouter()
  const [novoNome, setNovoNome] = useState('')
  const [copiarDe, setCopiarDe] = useState<string>(perfisIniciais.find(p => p.chave === 'tributada')?.id ?? '')
  const [criando, setCriando] = useState(false)
  const [erroNovo, setErroNovo] = useState('')

  async function criarPerfil() {
    const nome = novoNome.trim()
    if (!nome) return
    setCriando(true); setErroNovo('')
    const sb = createClient()
    const { data: perfil, error } = await sb.from('perfis_fiscais')
      .insert({ tenant_id: tenantId, nome }).select('id').single()
    if (error || !perfil) {
      setCriando(false)
      setErroNovo(error?.code === '23505' ? 'Já existe um perfil com esse nome.' : (error?.message ?? 'Erro ao criar o perfil'))
      return
    }
    const base = perfisIniciais.find(p => p.id === copiarDe)?.regras ?? REGRAS_PADRAO.tributada
    const { error: erroRegras } = await sb.from('perfil_fiscal_regras').insert(
      Object.values(grade(base)).map(r => ({ perfil_id: perfil.id, ...r })))
    setCriando(false)
    if (erroRegras) { setErroNovo(erroRegras.message); return }
    setNovoNome('')
    router.refresh()
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
          <span>início</span><span>›</span><span>cadastros</span><span>›</span>
          <Link href="/dashboard/produtos" className="hover:text-gray-600">produtos</Link><span>›</span>
          <span className="text-gray-600 font-medium">perfis fiscais</span>
        </div>
        <h1 className="text-gray-900 text-xl font-semibold">Perfis fiscais</h1>
        <p className="text-gray-500 text-sm mt-0.5 max-w-3xl">
          O CFOP e o CSOSN/CST dependem de <strong>para quem</strong> e <strong>para onde</strong> se vende — não só do produto.
          Cada produto aponta para um perfil, e o perfil diz o código de cada situação. Mudar uma linha aqui muda
          a nota de todos os produtos do perfil.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 text-xs text-blue-900 space-y-1">
        <p>
          <strong>Onde isto vale:</strong> na NF-e de marketplace (em construção). A NFC-e do PDV continua usando o
          CFOP/CST do cadastro de cada produto, como hoje.
        </p>
        <p>
          <strong>Células vazias</strong> ficam “a definir” e bloqueiam só a emissão que cair nelas, com uma mensagem.
          Os códigos devem ser confirmados com a contabilidade — em especial a venda para outro estado de mercadoria com ST.
        </p>
      </div>

      {semPerfil > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-900">
          <strong>{semPerfil}</strong> produto(s) ativo(s) sem perfil fiscal. Use “Mover produtos por NCM” abaixo, ou
          selecione-os na lista de produtos e use <em>Ações em massa → Perfil fiscal</em>.
        </div>
      )}

      <div className="space-y-5">
        {perfisIniciais.map(p => (
          <CartaoPerfil key={p.id} perfil={p} empresasPorRegime={empresasPorRegime} onMudou={() => router.refresh()} />
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mt-6">
        <h2 className="text-sm font-medium text-gray-700 mb-1">Novo perfil</h2>
        <p className="text-xs text-gray-400 mb-3">Ex.: “Monofásico PIS/COFINS”, “Produção própria”. Começa como cópia de um perfil existente.</p>
        <div className="flex flex-wrap gap-3">
          <input value={novoNome} onChange={e => setNovoNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && criarPerfil()}
            placeholder="Nome do perfil"
            className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
          <select value={copiarDe} onChange={e => setCopiarDe(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-blue-500">
            <option value="">Regras de revenda tributada</option>
            {perfisIniciais.map(p => <option key={p.id} value={p.id}>Copiar de: {p.nome}</option>)}
          </select>
          <button onClick={criarPerfil} disabled={criando || !novoNome.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {criando ? '...' : '+ Criar perfil'}
          </button>
        </div>
        {erroNovo && <p className="text-xs text-red-600 mt-2">{erroNovo}</p>}
      </div>
    </div>
  )
}

function CartaoPerfil({ perfil, empresasPorRegime, onMudou }: {
  perfil: PerfilComRegras
  empresasPorRegime: Record<RegimeRegra, string[]>
  onMudou: () => void
}) {
  const [regras, setRegras] = useState(() => grade(perfil.regras))
  const [nome, setNome] = useState(perfil.nome)
  const [descricao, setDescricao] = useState(perfil.descricao ?? '')
  const [alterado, setAlterado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const problemas = Object.fromEntries(Object.entries(regras).map(([k, r]) => [k, conferirRegra(r)]))
  const temProblema = Object.values(problemas).some(Boolean)

  function mudar(regime: RegimeRegra, situacao: SituacaoOperacao, campo: 'cfop' | 'icms_situacao', valor: string) {
    const k = chaveRegra(regime, situacao)
    setRegras(prev => ({ ...prev, [k]: { ...prev[k], [campo]: valor.replace(/\D/g, '') || null } }))
    setAlterado(true); setMensagem(null)
  }

  async function salvar() {
    if (temProblema || !nome.trim()) return
    setSalvando(true); setMensagem(null)
    const sb = createClient()
    const { error: erroPerfil } = await sb.from('perfis_fiscais')
      .update({ nome: nome.trim(), descricao: descricao.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', perfil.id)
    const { error } = erroPerfil ? { error: erroPerfil } : await sb.from('perfil_fiscal_regras').upsert(
      Object.values(regras).map(r => ({ perfil_id: perfil.id, ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'perfil_id,regime,situacao' })
    setSalvando(false)
    if (error) {
      setMensagem({ tipo: 'erro', texto: error.code === '23505' ? 'Já existe um perfil com esse nome.' : error.message })
      return
    }
    setAlterado(false)
    setMensagem({ tipo: 'ok', texto: `Salvo. Vale para os ${perfil.produtos} produto(s) deste perfil.` })
    onMudou()
  }

  async function excluir() {
    if (!confirm(`Excluir o perfil "${perfil.nome}"?`)) return
    const sb = createClient()
    const { error } = await sb.from('perfis_fiscais').delete().eq('id', perfil.id)
    if (error) { setMensagem({ tipo: 'erro', texto: error.message }); return }
    onMudou()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-60 space-y-1">
          <input value={nome} onChange={e => { setNome(e.target.value); setAlterado(true) }}
            className="w-full text-base font-semibold text-gray-900 border-b border-transparent hover:border-gray-200 focus:border-blue-500 focus:outline-none" />
          <input value={descricao} onChange={e => { setDescricao(e.target.value); setAlterado(true) }} placeholder="Descrição (opcional)"
            className="w-full text-xs text-gray-500 border-b border-transparent hover:border-gray-200 focus:border-blue-500 focus:outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1">{perfil.produtos} produto(s)</span>
          {perfil.produtos === 0 && (
            <button onClick={excluir} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">Excluir</button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50">
              <th className="text-left font-medium px-5 py-2">Situação da venda</th>
              {REGIMES.map(r => (
                <th key={r.chave} colSpan={2} className="text-left font-medium px-3 py-2 border-l border-gray-100">
                  {r.rotulo}
                  <span className="block font-normal text-[11px] text-gray-400">
                    {empresasPorRegime[r.chave].length > 0 ? empresasPorRegime[r.chave].join(', ') : 'nenhuma empresa do grupo'}
                  </span>
                </th>
              ))}
            </tr>
            <tr className="text-[11px] text-gray-400 bg-gray-50">
              <th />
              {REGIMES.map(r => [
                <th key={`${r.chave}-cfop`} className="text-left font-normal px-3 pb-2 border-l border-gray-100 w-24">CFOP</th>,
                <th key={`${r.chave}-cod`} className="text-left font-normal px-3 pb-2 w-24">{r.codigo}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {SITUACOES.map(s => {
              const erros = REGIMES.map(r => problemas[chaveRegra(r.chave, s.chave)]).filter(Boolean)
              return (
                <tr key={s.chave} className="border-t border-gray-100 align-top">
                  <td className="px-5 py-2.5">
                    <p className="text-gray-800">{s.rotulo}</p>
                    <p className="text-[11px] text-gray-400">{s.exemplo}</p>
                    {erros.map((e, i) => <p key={i} className="text-[11px] text-red-600 mt-1">⚠ {e}</p>)}
                  </td>
                  {REGIMES.map(r => {
                    const k = chaveRegra(r.chave, s.chave)
                    const regra = regras[k]
                    const vazia = !regra.cfop && !regra.icms_situacao
                    const cls = `${INPUT} ${problemas[k] ? 'border-red-400 bg-red-50' : vazia ? 'border-amber-300 bg-amber-50' : ''}`
                    return [
                      <td key={`${k}-cfop`} className="px-3 py-2.5 border-l border-gray-100">
                        <input value={regra.cfop ?? ''} onChange={e => mudar(r.chave, s.chave, 'cfop', e.target.value)}
                          placeholder="a definir" maxLength={4} className={cls} />
                      </td>,
                      <td key={`${k}-cod`} className="px-3 py-2.5">
                        <input value={regra.icms_situacao ?? ''} onChange={e => mudar(r.chave, s.chave, 'icms_situacao', e.target.value)}
                          placeholder="a definir" maxLength={3} className={cls} />
                        {exigeDifal(r.chave, s.chave) && (
                          <p className="text-[10px] text-gray-400 mt-1" title="Venda a consumidor final de outro estado no regime normal: a nota leva o grupo de DIFAL (EC 87/2015).">+ DIFAL</p>
                        )}
                      </td>,
                    ]
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          {mensagem && <span className={mensagem.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}>{mensagem.texto}</span>}
          {!mensagem && temProblema && <span className="text-red-600">Corrija as linhas marcadas para salvar.</span>}
        </div>
        <button onClick={salvar} disabled={!alterado || salvando || temProblema || !nome.trim()}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
          {salvando ? 'Salvando...' : 'Salvar perfil'}
        </button>
      </div>

      <MoverPorNcm perfil={perfil} onMovido={onMudou} />
    </div>
  )
}

// Mudança em massa sem selecionar produto por produto: ST é atributo da
// mercadoria, e a mercadoria é identificada pelo NCM. A contagem vem antes de
// mover, para ninguém descobrir depois que "84" pegou o catálogo inteiro.
function MoverPorNcm({ perfil, onMovido }: { perfil: PerfilComRegras; onMovido: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [ncm, setNcm] = useState('')
  const [soSemPerfil, setSoSemPerfil] = useState(false)
  const [previa, setPrevia] = useState<number | null>(null)
  const [trabalhando, setTrabalhando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function chamar(simular: boolean) {
    setTrabalhando(true); setMensagem(null)
    const sb = createClient()
    const { data, error } = await sb.rpc('atribuir_perfil_fiscal_por_ncm', {
      p_perfil: perfil.id, p_ncm_prefixo: ncm, p_somente_sem_perfil: soSemPerfil, p_simular: simular,
    })
    setTrabalhando(false)
    if (error) { setMensagem({ tipo: 'erro', texto: error.message }); setPrevia(null); return }
    if (simular) { setPrevia(Number(data ?? 0)); return }
    setPrevia(null)
    setMensagem({ tipo: 'ok', texto: `${data} produto(s) movido(s) para "${perfil.nome}".` })
    onMovido()
  }

  if (!aberto) {
    return (
      <div className="px-5 py-2.5 border-t border-gray-100">
        <button onClick={() => setAberto(true)} className="text-xs text-blue-600 hover:text-blue-800">
          Mover produtos para este perfil por NCM →
        </button>
        {mensagem && <span className="text-xs text-green-700 ml-3">{mensagem.texto}</span>}
      </div>
    )
  }

  return (
    <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
      <p className="text-xs text-gray-600 mb-2">
        Todos os produtos do grupo (todas as empresas) cujo NCM começa com:
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input value={ncm} onChange={e => { setNcm(e.target.value); setPrevia(null) }} placeholder="Ex.: 8481 ou 3924.10"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-900 w-44 focus:outline-none focus:border-blue-500" />
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={soSemPerfil} onChange={e => { setSoSemPerfil(e.target.checked); setPrevia(null) }} className="accent-blue-600" />
          só os que estão sem perfil
        </label>
        {previa === null ? (
          <button onClick={() => chamar(true)} disabled={trabalhando || ncm.replace(/\D/g, '').length < 2}
            className="px-3 py-1.5 border border-gray-300 bg-white text-sm text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-40">
            {trabalhando ? '...' : 'Contar produtos'}
          </button>
        ) : previa === 0 ? (
          <span className="text-xs text-gray-500">Nenhum produto a mover com esse NCM.</span>
        ) : (
          <button onClick={() => chamar(false)} disabled={trabalhando}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
            {trabalhando ? 'Movendo...' : `Mover ${previa} produto(s)`}
          </button>
        )}
        <button onClick={() => { setAberto(false); setPrevia(null) }} className="text-xs text-gray-400 hover:text-gray-600">Fechar</button>
      </div>
      {mensagem && <p className={`text-xs mt-2 ${mensagem.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{mensagem.texto}</p>}
    </div>
  )
}
