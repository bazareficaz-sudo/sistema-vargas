'use client'

import { useState, useEffect } from 'react'

type Tipo = { codigo: string; nome: string; cor: string | null }
type Config = { niveis: string[]; separador: string }
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

export default function EnderecoFormModal({ depositoId, tipos, endereco, onClose, onSaved }: {
  depositoId: string; tipos: Tipo[]; endereco?: Endereco | null
  onClose: () => void; onSaved: () => void
}) {
  const [config, setConfig] = useState<Config>({ niveis: ['zona', 'corredor', 'estante', 'nivel', 'posicao'], separador: '-' })
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
      if (r?.ok) setConfig({ niveis: r.config.niveis, separador: r.config.separador })
    }).catch(() => {})
  }, [depositoId])

  async function salvar() {
    setSalvando(true); setErro('')
    if (endereco) {
      const r = await fetch(`/api/enderecamento/enderecos/${endereco.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao: descricao || null, tipo, exclusivo }),
      }).then(r => r.json()).catch(() => ({ ok: false }))
      setSalvando(false)
      if (!r.ok) { setErro(r.erro ?? 'Erro ao salvar.'); return }
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">{endereco ? 'Editar endereço' : 'Novo endereço'}</h2>

        {!endereco && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {CAMPOS_NIVEL.filter(c => config.niveis.includes(c.chave as string)).map(c => (
              <div key={c.chave}>
                <label className="block text-[10px] font-medium text-slate-500 uppercase mb-0.5">{c.label}</label>
                <input value={valores[c.chave as string]} onChange={e => setValores({ ...valores, [c.chave as string]: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
            ))}
          </div>
        )}
        {endereco && (
          <p className="text-sm text-slate-500 mb-3">Código: <span className="font-mono font-medium text-slate-800">{endereco.codigo_legivel}</span> (não editável)</p>
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
          <button onClick={salvar} disabled={salvando}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
