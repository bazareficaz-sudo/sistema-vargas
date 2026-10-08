// A MEMÓRIA do Getúlio: guarda o que os vigias acharam e decide o que é
// novidade.
//
//   achado de novo, mesma assinatura  → só atualiza (não avisa de novo)
//   achado de novo, assinatura mudou  → volta a ser novidade (entrou item
//                                       novo no grupo, piorou de faixa…)
//   achado de novo, ficou mais grave  → volta a ser novidade
//   não achado (vigia rodou)          → resolvido
//   resolvido e achado de novo        → reaberto como novo, inclusive se
//                                       tinha sido dispensado

import { rodarVigias } from './vigias'
import { ORDEM_GRAVIDADE, VIGIAS, type Gravidade, type Sinal } from './tipos'

export type ResultadoVarredura = {
  abertos: number; novos: number; resolvidos: number
  erros: { vigia: string; erro: string }[]
}

export async function varrer(sb: any, empresaId: string, desligados: string[] = [], agora = new Date()): Promise<ResultadoVarredura> {
  const { sinais, erros, rodados } = await rodarVigias(sb, empresaId, desligados, agora)
  const agoraIso = agora.toISOString()

  const { data: abertosAntes } = await sb.from('getulio_sinais')
    .select('id, chave, vigia, gravidade, dados')
    .eq('empresa_id', empresaId).is('resolvido_em', null)
  const abertoPorChave = new Map<string, any>((abertosAntes ?? []).map((s: any) => [s.chave, s]))

  let novos = 0
  const vistos = new Set<string>()
  for (const s of dedupe(sinais)) {
    vistos.add(s.chave)
    const campos = {
      vigia: s.vigia, gravidade: s.gravidade, titulo: s.titulo, detalhe: s.detalhe,
      valor: s.valor, link: s.link, dados: s.dados ?? {}, atualizado_em: agoraIso,
    }
    const antes = abertoPorChave.get(s.chave)
    if (antes) {
      const mudou = String(antes.dados?.assinatura ?? '') !== String(s.dados?.assinatura ?? '')
      const piorou = ORDEM_GRAVIDADE[s.gravidade] < ORDEM_GRAVIDADE[antes.gravidade as Gravidade]
      await sb.from('getulio_sinais').update({
        ...campos,
        ...(mudou || piorou ? { avisado_em: null, dispensado_em: null } : {}),
      }).eq('id', antes.id)
      if (mudou || piorou) novos++
      continue
    }
    // Novo, ou reaberto: o upsert pela chave cobre os dois.
    const { error } = await sb.from('getulio_sinais').upsert({
      empresa_id: empresaId, chave: s.chave, ...campos,
      detectado_em: agoraIso, resolvido_em: null, avisado_em: null, dispensado_em: null,
    }, { onConflict: 'empresa_id,chave' })
    if (!error) novos++
  }

  // Resolve o que sumiu — mas só de vigia que RODOU (ou foi desligado). Vigia
  // que falhou não viu nada, e "não vi" não é "resolveu".
  const podeResolver = new Set<string>([...rodados, ...desligados.filter(d => VIGIAS.some(v => v.id === d))])
  const sumiram = (abertosAntes ?? []).filter((s: any) => !vistos.has(s.chave) && podeResolver.has(s.vigia))
  if (sumiram.length) {
    await sb.from('getulio_sinais').update({ resolvido_em: agoraIso }).in('id', sumiram.map((s: any) => s.id))
  }

  await sb.from('getulio_config').upsert(
    { empresa_id: empresaId, ultima_varredura: agoraIso, updated_at: agoraIso },
    { onConflict: 'empresa_id' },
  )

  return { abertos: vistos.size, novos, resolvidos: sumiram.length, erros }
}

/** Dois vigias não podem gravar a mesma chave duas vezes na mesma rodada. */
function dedupe(sinais: Sinal[]): Sinal[] {
  const porChave = new Map<string, Sinal>()
  for (const s of sinais) porChave.set(s.chave, s)
  return [...porChave.values()]
}
