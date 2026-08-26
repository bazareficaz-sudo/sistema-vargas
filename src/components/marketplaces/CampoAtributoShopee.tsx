'use client'

// Um atributo da categoria da Shopee. O tipo de campo vem dela (input_type),
// e não de um palpite nosso: lista fechada, lista com opção de digitar, texto
// livre (às vezes com unidade) ou múltipla escolha.
//
// Alguns valores abrem atributos-filho — "Cabos Elétricos = Sim" revela o
// número de registro do INMETRO, também obrigatório. Por isso o componente
// se chama a si mesmo.
//
// Mora aqui, e não dentro do modal de criação, porque a mesma ficha técnica é
// preenchida em dois lugares: ao publicar um anúncio novo e ao editar um que
// já existe. Duas cópias divergiriam no primeiro `input_type` novo.

// Espelha o tipo devolvido por src/lib/shopee/listing.ts. `input_type`:
// 1 lista fechada · 2 lista ou texto · 3 texto livre · 4/5 múltipla escolha.
export type ValorAtributoShopee = { value_id: number; original_value_name: string; filhos: AtributoShopee[] }
export type AtributoShopee = {
  attribute_id: number; attribute_name: string; is_mandatory: boolean
  input_type: number; quantitativo: boolean; unidades: string[]
  attribute_value_list: ValorAtributoShopee[]
}
export type ValorEscolhidoShopee = { valueId?: number; valueIds?: number[]; texto?: string; unidade?: string }

/** Os atributos que estão de fato em jogo: um filho só conta quando o valor
 *  que o revela está marcado. É esta lista que vale para "falta preencher". */
export function atributosVisiveis(
  lista: AtributoShopee[], valores: Record<number, ValorEscolhidoShopee>,
): AtributoShopee[] {
  const saida: AtributoShopee[] = []
  for (const a of lista) {
    saida.push(a)
    const escolhido = valores[a.attribute_id]
    const marcados = escolhido?.valueIds ?? (escolhido?.valueId != null ? [escolhido.valueId] : [])
    for (const v of a.attribute_value_list) {
      if (v.filhos.length > 0 && marcados.includes(v.value_id)) saida.push(...atributosVisiveis(v.filhos, valores))
    }
  }
  return saida
}

export function atributoPreenchido(a: AtributoShopee, valores: Record<number, ValorEscolhidoShopee>): boolean {
  const v = valores[a.attribute_id]
  if (!v) return false
  return v.valueId != null || (v.valueIds?.length ?? 0) > 0 || !!v.texto?.trim()
}

export default function CampoAtributo({ atributo: a, valores, setValores, nivel = 0 }: {
  atributo: AtributoShopee
  valores: Record<number, ValorEscolhidoShopee>
  setValores: React.Dispatch<React.SetStateAction<Record<number, ValorEscolhidoShopee>>>
  nivel?: number
}) {
  const v = valores[a.attribute_id] ?? {}
  const temLista = a.attribute_value_list.length > 0
  const multi = a.input_type === 4 || a.input_type === 5
  const aceitaTexto = a.input_type === 2 || a.input_type === 3 || a.input_type === 5
  const marcados = v.valueIds ?? (v.valueId != null ? [v.valueId] : [])

  function set(patch: ValorEscolhidoShopee) {
    setValores(prev => ({ ...prev, [a.attribute_id]: patch }))
  }

  const filhos = a.attribute_value_list
    .filter(x => x.filhos.length > 0 && marcados.includes(x.value_id))
    .flatMap(x => x.filhos)

  return (
    <div className={nivel > 0 ? 'ml-4 pl-3 border-l-2 border-blue-200' : ''}>
      <label className="block text-xs text-gray-600 mb-1">
        {a.attribute_name} {a.is_mandatory && <span className="text-red-500">*</span>}
        {a.quantitativo && a.unidades.length > 0 && <span className="text-gray-400"> (com unidade)</span>}
      </label>

      {temLista && !multi && (
        <select
          value={v.valueId != null ? String(v.valueId) : (v.texto ? '__outro' : '')}
          onChange={e => {
            const val = e.target.value
            if (val === '__outro') set({ texto: v.texto ?? '' })
            else set({ valueId: Number(val) || undefined })
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Selecione...</option>
          {a.attribute_value_list.map(x => <option key={x.value_id} value={x.value_id}>{x.original_value_name}</option>)}
          {aceitaTexto && <option value="__outro">Outro — digitar</option>}
        </select>
      )}

      {temLista && multi && (
        <div className="flex flex-wrap gap-1.5">
          {a.attribute_value_list.map(x => {
            const on = marcados.includes(x.value_id)
            return (
              <button key={x.value_id} type="button"
                onClick={() => set({ ...v, valueIds: on ? marcados.filter(i => i !== x.value_id) : [...marcados, x.value_id], valueId: undefined })}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {x.original_value_name}
              </button>
            )
          })}
        </div>
      )}

      {/* Texto: quando não há lista, ou quando a pessoa escolheu "Outro". */}
      {(!temLista || (aceitaTexto && v.texto != null && v.valueId == null)) && (
        <div className="flex gap-2 mt-1">
          <input
            value={v.texto ?? ''}
            onChange={e => set({ ...v, texto: e.target.value, valueId: undefined })}
            placeholder={a.quantitativo ? 'Valor' : ''}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          {a.unidades.length > 0 && (
            <select value={v.unidade ?? a.unidades[0]}
              onChange={e => set({ ...v, unidade: e.target.value })}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white">
              {a.unidades.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
        </div>
      )}

      {filhos.length > 0 && (
        <div className="mt-2 space-y-3">
          {filhos.map(f => (
            <CampoAtributo key={f.attribute_id} atributo={f} valores={valores} setValores={setValores} nivel={nivel + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
