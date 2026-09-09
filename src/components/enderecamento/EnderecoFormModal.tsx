'use client'

import { useState, useEffect, useMemo } from 'react'
import { montarCodigoEndereco } from '@/lib/enderecamento/estoque'

// EDITAR O ENDEREÇO, e não só a descrição dele.
//
// Antes, editar mostrava "Código: C04-LE-E05-P5 (não editável)" e só deixava
// mexer em descrição/tipo/exclusivo. No depósito real o código muda: a caixa
// CX02 passa a existir dentro de uma prateleira que já estava cadastrada, e
// o endereço precisa ganhar mais um nível. Sem isso, a única saída era
// excluir e recriar — o que o sistema recusa quando há saldo, e o que jogaria
// fora o histórico do endereço.
//
// O código continua MONTADO, nunca digitado: a mesma `montarCodigoEndereco`
// que o servidor usa monta a prévia aqui, com os níveis, separador, padding
// e prefixos configurados para o depósito. Um segundo jeito de escrever
// código de endereço divergiria do primeiro no primeiro conserto.

type Tipo = { codigo: string; nome: string; cor: string | null }
type Config = {
  niveis: string[]
  separador: string
  padding: Record<string, number>
  prefixos: Record<string, string>
}
type Endereco = {
  id: string; deposito_id: string; codigo_interno: string; codigo_legivel: string
  descricao: string | null; tipo: string; status: string; exclusivo: boolean
  zona: string | null; corredor: string | null; estante: string | null
  modulo: string | null; nivel: string | null; posicao: string | null
}

const CAMPOS_NIVEL: { chave: keyof Endereco; label: string }[] = [
  { chave: 'zona', label: 'Zona' }, { chave: 'corredor', label: 'Corredor' },
  { chave: 'estante', label: 'Estante' }, { chave: 'modulo', label: 'Módulo' },
  { chave: 'nivel', label: 'Nível' }, { chave: 'posicao', label: 'Posição' },
]

const CONFIG_PADRAO: Config = {
  niveis: ['zona', 'corredor', 'estante', 'nivel', 'posicao'],
  separador: '-', padding: {}, prefixos: {},
}

export default function EnderecoFormModal({ depositoId, tipos, endereco, onClose, onSaved }: {
  depositoId: string; tipos: Tipo[]; endereco?: Endereco | null
  onClose: () => void; onSaved: () => void
}) {
  const [config, setConfig] = useState<Config>(CONFIG_PADRAO)
  const [valores, setValores] = useState<Record<string, string>>({
    zona: endereco?.zona ?? '', corredor: endereco?.corredor ?? '', estante: endereco?.estante ?? '',
    modulo: endereco?.modulo ?? '', nivel: endereco?.nivel ?? '', posicao: endereco?.posicao ?? '',
  })
  const [descricao, setDescricao] = useState(endereco?.descricao ?? '')
  const [tipo, setTipo] = useState(endereco?.tipo ?? tipos[0]?.codigo ?? 'ARMAZENAGEM')
  const [exclusivo, setExclusivo] = useState(endereco?.exclusivo ?? false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetch(`/api/enderecamento/config-deposito?depositoId=${depositoId}`).then(r => r.json()).then(r => {
      if (r?.ok) setConfig({
        niveis: r.config.niveis ?? CONFIG_PADRAO.niveis,
        separador: r.config.separador ?? '-',
        padding: r.config.padding_por_nivel ?? {},
        prefixos: r.config.prefixos_por_nivel ?? {},
      })
    }).catch(() => {})
  }, [depositoId])

  // A PRÉVIA É O PONTO DA TELA. Quem acrescenta CX02 precisa ver, antes de
  // salvar, que o código vai virar "C04-LE-E05-P5-CX02" — o padding e o
  // prefixo do depósito mudam o resultado e não estão à vista nos campos.
  const codigoPrevisto = useMemo(
    () => montarCodigoEndereco(config.niveis, valores, config.separador, config.padding, config.prefixos),
    [config, valores],
  )
  const codigoMudou = !!endereco && !!codigoPrevisto && codigoPrevisto !== endereco.codigo_legivel

  async function salvar() {
    setSalvando(true); setErro('')
    if (endereco) {
      const r = await fetch(`/api/enderecamento/enderecos/${endereco.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao: descricao || null, tipo, exclusivo, ...valores }),
      }).then(r => r.json()).catch(() => ({ ok: false }))
      setSalvando(false)
      if (!r.ok) { setErro(r.erro ?? 'Erro ao salvar.'); return }
      // O aviso vem DEPOIS de gravar e diz os dois códigos: a etiqueta na
      // prateleira ainda tem o antigo, e quem renomeou é quem tem como
      // mandar reimprimir.
      if (r.codigoAnterior) {
        alert(`Endereço renomeado de ${r.codigoAnterior} para ${r.endereco.codigo_legivel}.\n\nA etiqueta física ainda mostra o código antigo — reimprima em Endereçamento → Etiquetas.`)
      }
    } else {
      const r = await fetch('/api/enderecamento/enderecos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositoId, descricao: descricao || null, tipo, exclusivo, ...valores }),
      }).then(r => r.json()).catch(() => ({ ok: false }))
      setSalvando(false)
      if (!r.ok) { setErro(r.erro ?? 'Erro ao criar.'); return }
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">{endereco ? 'Editar endereço' : 'Novo endereço'}</h2>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {CAMPOS_NIVEL.filter(c => config.niveis.includes(c.chave as string)).map(c => (
            <div key={c.chave}>
              <label className="block text-[10px] font-medium text-slate-500 uppercase mb-0.5">{c.label}</label>
              <input value={valores[c.chave as string]} onChange={e => setValores({ ...valores, [c.chave as string]: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            </div>
          ))}
        </div>

        <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          {endereco && (
            <p className="text-[11px] text-slate-500">
              Código atual: <span className="font-mono text-slate-700">{endereco.codigo_legivel}</span>
            </p>
          )}
          <p className="text-sm text-slate-600">
            {endereco ? 'Ficará: ' : 'Código: '}
            <span className={`font-mono font-semibold ${codigoMudou ? 'text-amber-700' : 'text-slate-900'}`}>
              {codigoPrevisto || '—'}
            </span>
          </p>
        </div>

        {codigoMudou && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            O código vai mudar. O estoque e o histórico deste endereço continuam onde estão — mas
            a <strong>etiqueta impressa</strong> (código de barras e QR) precisará ser reimpressa.
          </p>
        )}

        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Descrição</label>
          <input value={descricao} onChange={e => setDescricao(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
          </select>
        </div>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input type="checkbox" checked={exclusivo} onChange={e => setExclusivo(e.target.checked)} className="accent-blue-600" />
          <span className="text-sm text-slate-700">Exclusivo (só um produto por vez)</span>
        </label>

        {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !codigoPrevisto}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
