'use client'

import { useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { parseNFeXml, calcularCustoItem, type NFeData } from '@/lib/nfe-parser'

type Entrada = {
  id: string; chave_acesso: string; numero: string | null; serie: string | null
  nome_fornecedor: string | null; cnpj_fornecedor: string | null
  data_emissao: string | null; valor_total: number; status: string
  origem: string; operador_nome: string | null; created_at: string
}
type Deposito = { id: string; nome: string; principal: boolean }
type ConfigSefaz = { focusnfe_token: string | null; ultimo_nsu: string | null; ativo: boolean } | null

const STATUS_LABEL: Record<string, string> = {
  xml_importado:        'XML Importado',
  sefaz_encontrada:     'SEFAZ Encontrada',
  manifesto_pendente:   'Manifesto Pendente',
  manifestada:          'Manifestada',
  xml_baixado:          'XML Baixado',
  aguardando_mapeamento:'Mapeamento',
  aguardando_conferencia:'Conferência',
  aguardando_precos:    'Revisão Preços',
  aguardando_financeiro:'Financeiro',
  pronta:               'Pronta',
  finalizada:           'Finalizada',
  cancelada:            'Cancelada',
  ignorada:             'Ignorada',
  erro:                 'Erro',
}
const STATUS_COR: Record<string, string> = {
  xml_importado:        'bg-blue-50 text-blue-600 border border-blue-100',
  aguardando_mapeamento:'bg-amber-50 text-amber-600 border border-amber-100',
  aguardando_conferencia:'bg-orange-50 text-orange-600 border border-orange-100',
  aguardando_precos:    'bg-purple-50 text-purple-600 border border-purple-100',
  aguardando_financeiro:'bg-indigo-50 text-indigo-600 border border-indigo-100',
  pronta:               'bg-cyan-50 text-cyan-600 border border-cyan-100',
  finalizada:           'bg-emerald-50 text-emerald-600 border border-emerald-100',
  cancelada:            'bg-red-50 text-red-600 border border-red-100',
  ignorada:             'bg-slate-100 text-slate-500',
  erro:                 'bg-red-50 text-red-600 border border-red-100',
  manifestada:          'bg-teal-50 text-teal-600 border border-teal-100',
  manifesto_pendente:   'bg-amber-50 text-amber-600 border border-amber-100',
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) {
  const s = d.split('T')[0].split('-')
  return `${s[2]}/${s[1]}/${s[0]}`
}
function fmtCnpj(c: string) {
  if (!c) return ''
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export default function EntradasXmlClient({
  empresaId, operador, entradasIniciais, depositos, configSefaz
}: {
  empresaId: string; operador: string; entradasIniciais: Entrada[]
  depositos: Deposito[]; configSefaz: ConfigSefaz
}) {
  const sb = createClient()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [entradas, setEntradas] = useState<Entrada[]>(entradasIniciais)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')

  // Modal importar XML
  const [modalImportar, setModalImportar] = useState(false)
  const [arquivos, setArquivos] = useState<File[]>([])
  const [processando, setProcessando] = useState(false)
  const [resultados, setResultados] = useState<{ arquivo: string; status: 'ok' | 'erro' | 'duplicado'; msg: string; id?: string }[]>([])

  // Modal SEFAZ
  const [modalSefaz, setModalSefaz] = useState(false)
  const [consultandoSefaz, setConsultandoSefaz] = useState(false)
  const [nfesSefaz, setNfesSefaz] = useState<any[]>([])
  const [erroSefaz, setErroSefaz] = useState('')

  // Modal configuração FocusNFe
  const [modalConfig, setModalConfig] = useState(false)
  const [configForm, setConfigForm] = useState({
    focusnfe_token: configSefaz?.focusnfe_token ?? '',
    cnpj: '',
    ambiente: 'producao',
  })
  const [salvandoConfig, setSalvandoConfig] = useState(false)

  const depositoPrincipal = depositos.find(d => d.principal)?.id ?? depositos[0]?.id ?? ''

  const entradasFiltradas = useMemo(() => {
    let list = [...entradas]
    if (filtroStatus !== 'todos') list = list.filter(e => e.status === filtroStatus)
    if (busca) {
      const b = busca.toLowerCase()
      list = list.filter(e =>
        (e.nome_fornecedor ?? '').toLowerCase().includes(b) ||
        (e.numero ?? '').includes(b) ||
        (e.chave_acesso ?? '').includes(b) ||
        (e.cnpj_fornecedor ?? '').includes(b)
      )
    }
    return list
  }, [entradas, filtroStatus, busca])

  // ── Importar XML ─────────────────────────────────────────────
  async function processarXmls() {
    if (arquivos.length === 0) return
    setProcessando(true)
    setResultados([])
    const novos: typeof resultados = []

    for (const arquivo of arquivos) {
      try {
        const xml = await arquivo.text()
        const nfe = parseNFeXml(xml)

        if (!nfe) { novos.push({ arquivo: arquivo.name, status: 'erro', msg: 'XML inválido ou não é NF-e' }); continue }
        if (!nfe.chave_acesso || nfe.chave_acesso.length !== 44) { novos.push({ arquivo: arquivo.name, status: 'erro', msg: 'Chave de acesso inválida' }); continue }

        // Verificar duplicado
        const { data: existente } = await sb.from('nfe_entradas').select('id').eq('empresa_id', empresaId).eq('chave_acesso', nfe.chave_acesso).maybeSingle()
        if (existente) { novos.push({ arquivo: arquivo.name, status: 'duplicado', msg: `NF-e ${nfe.numero} já importada` }); continue }

        // Verificar/criar fornecedor
        const fornecedorId = await upsertFornecedor(nfe)

        // Criar entrada
        const { data: entrada, error } = await sb.from('nfe_entradas').insert({
          empresa_id: empresaId,
          chave_acesso: nfe.chave_acesso,
          numero: nfe.numero,
          serie: nfe.serie,
          modelo: nfe.modelo,
          nat_operacao: nfe.nat_operacao,
          data_emissao: nfe.data_emissao || null,
          data_entrada: nfe.data_entrada || null,
          fornecedor_id: fornecedorId,
          cnpj_fornecedor: nfe.cnpj_fornecedor,
          nome_fornecedor: nfe.nome_fornecedor,
          ie_fornecedor: nfe.ie_fornecedor,
          uf_fornecedor: nfe.uf_fornecedor,
          cnpj_destinatario: nfe.cnpj_destinatario,
          valor_produtos: nfe.valor_produtos,
          valor_frete: nfe.valor_frete,
          valor_seguro: nfe.valor_seguro,
          valor_desconto: nfe.valor_desconto,
          outras_despesas: nfe.outras_despesas,
          valor_ipi: nfe.valor_ipi,
          valor_icms: nfe.valor_icms,
          valor_icms_st: nfe.valor_icms_st,
          valor_pis: nfe.valor_pis,
          valor_cofins: nfe.valor_cofins,
          valor_total: nfe.valor_total,
          status: 'aguardando_mapeamento',
          origem: 'manual',
          deposito_id: depositoPrincipal,
          xml_content: xml,
          operador_nome: operador,
        }).select().single()
        if (error) throw error

        // Criar itens
        if (nfe.itens.length > 0) {
          await sb.from('nfe_itens').insert(nfe.itens.map(item => ({
            entrada_id: entrada.id,
            empresa_id: empresaId,
            num_item: item.num_item,
            codigo_fornecedor: item.codigo_fornecedor,
            ean: item.ean || null,
            descricao_xml: item.descricao_xml,
            ncm: item.ncm,
            cest: item.cest,
            cfop: item.cfop,
            unidade_xml: item.unidade_xml,
            quantidade_xml: item.quantidade_xml,
            valor_unitario_xml: item.valor_unitario_xml,
            valor_produto: item.valor_produto,
            desconto_item: item.desconto_item,
            frete_item: item.frete_item,
            seguro_item: item.seguro_item,
            outras_desp_item: item.outras_desp_item,
            ipi: item.ipi,
            icms: item.icms,
            icms_st: item.icms_st,
            pis: item.pis,
            cofins: item.cofins,
            custo_unitario: calcularCustoItem(item),
            custo_total: calcularCustoItem(item) * item.quantidade_xml,
            quantidade_entrada: item.quantidade_xml,
            fator_conversao: 1,
            status_mapeamento: 'nao_mapeado',
          })))
        }

        // Criar duplicatas
        if (nfe.duplicatas.length > 0) {
          await sb.from('nfe_duplicatas').insert(nfe.duplicatas.map(d => ({
            entrada_id: entrada.id,
            empresa_id: empresaId,
            num_dup: d.num_dup,
            data_vencimento: d.data_vencimento,
            valor: d.valor,
          })))
        }

        // Tentar auto-mapeamento
        await autoMapearItens(entrada.id, nfe.cnpj_fornecedor)

        novos.push({ arquivo: arquivo.name, status: 'ok', msg: `NF-e ${nfe.numero} importada com ${nfe.itens.length} item(ns)`, id: entrada.id })
        setEntradas(p => [entrada as Entrada, ...p])
      } catch (e: any) {
        novos.push({ arquivo: arquivo.name, status: 'erro', msg: e.message })
      }
    }

    setResultados(novos)
    setProcessando(false)
  }

  async function upsertFornecedor(nfe: NFeData): Promise<string | null> {
    try {
      const { data: existente } = await sb.from('fornecedores').select('id').eq('empresa_id', empresaId).eq('cnpj', nfe.cnpj_fornecedor).maybeSingle()
      if (existente) return existente.id

      const { data: novo } = await sb.from('fornecedores').insert({
        empresa_id: empresaId,
        nome: nfe.nome_fornecedor,
        nome_fantasia: nfe.fantasia_fornecedor || null,
        cnpj: nfe.cnpj_fornecedor,
        ie: nfe.ie_fornecedor || null,
        uf: nfe.uf_fornecedor || null,
        cep: nfe.cep_fornecedor || null,
        logradouro: nfe.logradouro_fornecedor || null,
        numero: nfe.numero_fornecedor || null,
        bairro: nfe.bairro_fornecedor || null,
        municipio: nfe.municipio_fornecedor || null,
        telefone: nfe.fone_fornecedor || null,
        ativo: true,
      }).select('id').single()
      return novo?.id ?? null
    } catch { return null }
  }

  async function autoMapearItens(entradaId: string, cnpjFornecedor: string) {
    try {
      const { data: itens } = await sb.from('nfe_itens').select('*').eq('entrada_id', entradaId)
      if (!itens?.length) return

      const { data: mapeamentos } = await sb.from('nfe_mapeamentos')
        .select('codigo_fornecedor, ean, produto_id, fator_conversao, unidade_sistema, unidade_xml')
        .eq('empresa_id', empresaId).eq('cnpj_fornecedor', cnpjFornecedor)

      const { data: produtos } = await sb.from('produtos')
        .select('id, ean, sku, unidade').eq('empresa_id', empresaId).eq('ativo', true)

      for (const item of itens) {
        let produtoId: string | null = null
        let fator = 1
        let unidadeSistema = item.unidade_xml

        // 1. Histórico de mapeamentos
        const mapa = mapeamentos?.find(m =>
          (item.codigo_fornecedor && m.codigo_fornecedor === item.codigo_fornecedor) ||
          (item.ean && m.ean === item.ean)
        )
        if (mapa) { produtoId = mapa.produto_id; fator = mapa.fator_conversao; unidadeSistema = mapa.unidade_sistema }

        // 2. EAN exato
        if (!produtoId && item.ean) {
          const p = produtos?.find(p => p.ean === item.ean)
          if (p) { produtoId = p.id; unidadeSistema = p.unidade }
        }

        if (produtoId) {
          await sb.from('nfe_itens').update({
            produto_id: produtoId,
            fator_conversao: fator,
            unidade_sistema: unidadeSistema,
            quantidade_entrada: item.quantidade_xml * fator,
            status_mapeamento: 'auto',
          }).eq('id', item.id)
        }
      }

      // Verificar se todos mapeados → avançar status
      const { data: itensFinal } = await sb.from('nfe_itens').select('status_mapeamento').eq('entrada_id', entradaId)
      const todosMapeados = itensFinal?.every(i => i.status_mapeamento !== 'nao_mapeado')
      if (todosMapeados) {
        await sb.from('nfe_entradas').update({ status: 'aguardando_conferencia' }).eq('id', entradaId)
      }
    } catch {}
  }

  // ── Consulta SEFAZ ───────────────────────────────────────────
  async function consultarSefaz() {
    if (!configSefaz?.focusnfe_token) { setErroSefaz('Configure o token FocusNFe primeiro.'); return }
    setConsultandoSefaz(true); setErroSefaz('')
    try {
      const resp = await fetch('/api/sefaz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'listar', ultimo_nsu: configSefaz.ultimo_nsu }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Erro na consulta')
      setNfesSefaz(data.documentos ?? data.nfes ?? [])
    } catch (e: any) { setErroSefaz(e.message) }
    finally { setConsultandoSefaz(false) }
  }

  async function manifestar(chave: string, tipo: string) {
    try {
      const resp = await fetch('/api/sefaz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: tipo, chave }),
      })
      if (!resp.ok) { const d = await resp.json(); throw new Error(d.error) }
      setNfesSefaz(p => p.map(n => n.chave_nfe === chave ? { ...n, manifestado: tipo } : n))
    } catch (e: any) { alert('Erro manifesto: ' + e.message) }
  }

  async function salvarConfig() {
    setSalvandoConfig(true)
    try {
      await sb.from('nfe_config').upsert({
        empresa_id: empresaId,
        focusnfe_token: configForm.focusnfe_token,
        cnpj: configForm.cnpj,
        ambiente: configForm.ambiente,
        ativo: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })
      setModalConfig(false)
    } catch (e: any) { alert('Erro: ' + e.message) }
    finally { setSalvandoConfig(false) }
  }

  const totalFinalizado = entradas.filter(e => e.status === 'finalizada').reduce((s, e) => s + (e.valor_total ?? 0), 0)
  const totalPendente   = entradas.filter(e => !['finalizada','cancelada','ignorada'].includes(e.status)).reduce((s, e) => s + (e.valor_total ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Entrada por XML / NF-e</h1>
          <p className="text-slate-500 text-sm">{entradasFiltradas.length} registro(s)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModalConfig(true)}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm rounded-xl border border-slate-200 shadow-sm">
            ⚙ FocusNFe
          </button>
          <button onClick={() => { setModalSefaz(true); consultarSefaz() }}
            className="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-xl">
            🔍 Consultar SEFAZ
          </button>
          <button onClick={() => { setModalImportar(true); setArquivos([]); setResultados([]) }}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-xl">
            + Importar XML
          </button>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs">Total importadas</p>
          <p className="text-slate-800 text-lg font-bold mt-1">{entradas.length}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs">Pendentes</p>
          <p className="text-amber-600 text-lg font-bold mt-1">{entradas.filter(e => !['finalizada','cancelada','ignorada'].includes(e.status)).length}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs">Valor pendente</p>
          <p className="text-amber-600 text-lg font-bold mt-1">{fmt(totalPendente)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs">Valor finalizado</p>
          <p className="text-emerald-600 text-lg font-bold mt-1">{fmt(totalFinalizado)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar fornecedor, nº NF-e ou chave..."
          className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm w-72 focus:outline-none focus:border-blue-400 placeholder-slate-400 shadow-sm" />
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="todos">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">NF-e</th>
              <th className="px-4 py-3 text-left">Fornecedor</th>
              <th className="px-4 py-3 text-center">Emissão</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Origem</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {entradasFiltradas.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-slate-400">
                Nenhuma NF-e encontrada. Clique em "Importar XML" para começar.
              </td></tr>
            )}
            {entradasFiltradas.map(e => (
              <tr key={e.id} className="text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/entradas-xml/${e.id}`)}>
                <td className="px-4 py-2.5">
                  <p className="text-slate-800 font-mono text-xs font-medium">NF-e {e.numero ?? '—'}-{e.serie ?? '—'}</p>
                  <p className="text-slate-400 text-xs truncate max-w-[160px]">{e.chave_acesso}</p>
                </td>
                <td className="px-4 py-2.5">
                  <p className="text-slate-800 text-sm">{e.nome_fornecedor ?? '—'}</p>
                  <p className="text-slate-400 text-xs">{fmtCnpj(e.cnpj_fornecedor ?? '')}</p>
                </td>
                <td className="px-4 py-2.5 text-center text-slate-500 text-xs">
                  {e.data_emissao ? fmtDt(e.data_emissao) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(e.valor_total)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className="text-xs text-slate-500">{e.origem === 'manual' ? '📂 XML' : '📡 SEFAZ'}</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COR[e.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {STATUS_LABEL[e.status] ?? e.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={ev => { ev.stopPropagation(); router.push(`/dashboard/entradas-xml/${e.id}`) }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg">
                    Abrir →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MODAL IMPORTAR XML ──────────────────────────────────── */}
      {modalImportar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Importar XML de NF-e</h2>
              <button onClick={() => setModalImportar(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-5 space-y-4">
              {resultados.length === 0 ? (
                <>
                  <div
                    className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.xml'))
                      setArquivos(files)
                    }}>
                    <p className="text-4xl mb-2">📂</p>
                    <p className="text-slate-700 font-medium">Clique ou arraste arquivos XML</p>
                    <p className="text-slate-400 text-sm mt-1">Suporta múltiplos arquivos simultâneos</p>
                    <input ref={fileRef} type="file" accept=".xml" multiple className="hidden"
                      onChange={e => setArquivos(Array.from(e.target.files ?? []))} />
                  </div>
                  {arquivos.length > 0 && (
                    <div className="space-y-1">
                      {arquivos.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm">
                          <span className="text-slate-400">📄</span>
                          <span className="text-slate-700 flex-1 truncate">{f.name}</span>
                          <span className="text-slate-400 text-xs">{(f.size / 1024).toFixed(0)} KB</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {resultados.map((r, i) => (
                    <div key={i} className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
                      r.status === 'ok' ? 'bg-emerald-50 border border-emerald-200' :
                      r.status === 'duplicado' ? 'bg-amber-50 border border-amber-200' :
                      'bg-red-50 border border-red-200'
                    }`}>
                      <span>{r.status === 'ok' ? '✓' : r.status === 'duplicado' ? '⚠' : '✕'}</span>
                      <div className="flex-1">
                        <p className="text-slate-700 font-medium text-xs truncate">{r.arquivo}</p>
                        <p className="text-slate-500 text-xs">{r.msg}</p>
                      </div>
                      {r.id && (
                        <button onClick={() => { setModalImportar(false); router.push(`/dashboard/entradas-xml/${r.id}`) }}
                          className="px-2 py-1 bg-blue-600 text-white text-xs rounded whitespace-nowrap">
                          Abrir →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              {resultados.length > 0 ? (
                <button onClick={() => { setArquivos([]); setResultados([]) }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
                  Importar mais XMLs
                </button>
              ) : (
                <>
                  <button onClick={() => setModalImportar(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
                  <button onClick={processarXmls} disabled={processando || arquivos.length === 0}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                    {processando ? `Processando ${arquivos.length} arquivo(s)...` : `Importar ${arquivos.length} arquivo(s)`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SEFAZ ────────────────────────────────────────── */}
      {modalSefaz && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">NF-e na SEFAZ (via FocusNFe)</h2>
              <button onClick={() => setModalSefaz(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {consultandoSefaz && <p className="text-slate-400 text-center py-8">Consultando SEFAZ...</p>}
              {erroSefaz && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">
                  <p className="font-semibold">Erro na consulta:</p>
                  <p className="mt-1">{erroSefaz}</p>
                  {!configSefaz?.focusnfe_token && (
                    <button onClick={() => { setModalSefaz(false); setModalConfig(true) }}
                      className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-xs rounded">
                      Configurar FocusNFe →
                    </button>
                  )}
                </div>
              )}
              {!consultandoSefaz && !erroSefaz && nfesSefaz.length === 0 && (
                <p className="text-slate-400 text-center py-8">Nenhuma NF-e nova encontrada.</p>
              )}
              {nfesSefaz.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 text-xs border-b border-slate-100">
                      <th className="pb-2 text-left">Chave</th>
                      <th className="pb-2 text-left">Emitente</th>
                      <th className="pb-2 text-right">Valor</th>
                      <th className="pb-2 text-center">Manifesto</th>
                      <th className="pb-2 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nfesSefaz.map((n: any, i) => (
                      <tr key={i} className="text-slate-700">
                        <td className="py-2 text-xs font-mono text-slate-400 truncate max-w-[120px]">{n.chave_nfe}</td>
                        <td className="py-2 text-sm">{n.emitente?.razao_social ?? '—'}</td>
                        <td className="py-2 text-right">{fmt(n.valor_nfe ?? 0)}</td>
                        <td className="py-2 text-center">
                          <span className="text-xs text-slate-500">{n.manifestado ?? 'Pendente'}</span>
                        </td>
                        <td className="py-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => manifestar(n.chave_nfe, 'ciencia')}
                              className="px-2 py-1 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded-lg">Ciência</button>
                            <button onClick={() => manifestar(n.chave_nfe, 'confirmacao')}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg">Confirmar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-between px-5 py-4 border-t border-slate-100">
              <button onClick={consultarSefaz} disabled={consultandoSefaz}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm disabled:opacity-50">
                {consultandoSefaz ? 'Consultando...' : '↺ Atualizar'}
              </button>
              <button onClick={() => setModalSefaz(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL CONFIG FOCUSNFE ──────────────────────────────── */}
      {modalConfig && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Configuração FocusNFe / SEFAZ</h2>
              <button onClick={() => setModalConfig(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                Crie sua conta em <strong>focusnfe.com.br</strong> e copie o token de autenticação.
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Token FocusNFe</label>
                <input type="password" value={configForm.focusnfe_token}
                  onChange={e => setConfigForm(p => ({ ...p, focusnfe_token: e.target.value }))}
                  placeholder="seu-token-aqui"
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Ambiente</label>
                <select value={configForm.ambiente} onChange={e => setConfigForm(p => ({ ...p, ambiente: e.target.value }))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                  <option value="producao">Produção</option>
                  <option value="homologacao">Homologação (testes)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalConfig(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={salvarConfig} disabled={salvandoConfig}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvandoConfig ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
