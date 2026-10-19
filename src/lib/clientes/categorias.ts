// Categorias de cliente (etiquetas): Eletricista, Pedreiro… Tabelas em
// supabase/migrations/20261020120000_cliente_categorias.sql. Aqui só o que
// não depende do banco: cores, sugestões e a conta do que muda ao salvar.

export type Categoria = { id: string; nome: string; cor: CorCategoria }
export type CorCategoria = 'cinza' | 'vermelho' | 'laranja' | 'amarelo' | 'verde' | 'azul' | 'roxo' | 'rosa'

/** Mesma lista do CHECK do banco. Classes do Tailwind escritas por inteiro. */
export const CORES: Record<CorCategoria, { rotulo: string; chip: string; ponto: string }> = {
  cinza: { rotulo: 'Cinza', chip: 'bg-gray-100 text-gray-700 border-gray-200', ponto: 'bg-gray-400' },
  vermelho: { rotulo: 'Vermelho', chip: 'bg-red-100 text-red-700 border-red-200', ponto: 'bg-red-500' },
  laranja: { rotulo: 'Laranja', chip: 'bg-orange-100 text-orange-700 border-orange-200', ponto: 'bg-orange-500' },
  amarelo: { rotulo: 'Amarelo', chip: 'bg-amber-100 text-amber-800 border-amber-200', ponto: 'bg-amber-400' },
  verde: { rotulo: 'Verde', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', ponto: 'bg-emerald-500' },
  azul: { rotulo: 'Azul', chip: 'bg-sky-100 text-sky-700 border-sky-200', ponto: 'bg-sky-500' },
  roxo: { rotulo: 'Roxo', chip: 'bg-violet-100 text-violet-700 border-violet-200', ponto: 'bg-violet-500' },
  rosa: { rotulo: 'Rosa', chip: 'bg-pink-100 text-pink-700 border-pink-200', ponto: 'bg-pink-500' },
}
export const corValida = (c: unknown): CorCategoria => (typeof c === 'string' && c in CORES ? c as CorCategoria : 'cinza')

/** Oferecidas quando a empresa ainda não tem nenhuma (nada é criado sozinho). */
export const SUGERIDAS: { nome: string; cor: CorCategoria }[] = [
  { nome: 'Eletricista', cor: 'amarelo' },
  { nome: 'Bombeiro hidráulico', cor: 'azul' },
  { nome: 'Pedreiro', cor: 'laranja' },
  { nome: 'Gesseiro', cor: 'cinza' },
  { nome: 'Pintor', cor: 'rosa' },
  { nome: 'Mecânico', cor: 'vermelho' },
  { nome: 'Marceneiro', cor: 'laranja' },
  { nome: 'Serralheiro', cor: 'cinza' },
  { nome: 'Construtora', cor: 'roxo' },
  { nome: 'Consumidor final', cor: 'verde' },
]

/** Nome como fica no banco: sem espaços sobrando, até 40 letras. Vazio = inválido. */
export function nomeCategoria(v: string | null | undefined): string | null {
  const nome = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return nome || null
}

/** Já existe uma com esse nome (sem diferenciar maiúscula)? Mesma regra do índice único. */
export const nomeRepetido = (lista: { nome: string; id?: string }[], nome: string, ignorar?: string) =>
  lista.some(c => c.id !== ignorar && c.nome.trim().toLowerCase() === nome.trim().toLowerCase())

/** O que inserir e o que apagar para o cliente ficar com `quer`. */
export function diferenca(tem: string[], quer: string[]): { inserir: string[]; apagar: string[] } {
  const a = new Set(tem), b = new Set(quer)
  return { inserir: [...b].filter(x => !a.has(x)), apagar: [...a].filter(x => !b.has(x)) }
}

/** Ordena por nome (pt-BR), para a lista aparecer igual em toda tela. */
export const emOrdem = <T extends { nome: string }>(lista: T[]) => [...lista].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'))
