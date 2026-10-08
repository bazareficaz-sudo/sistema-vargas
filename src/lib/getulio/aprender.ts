import type { Consulta, ResultadoConsulta } from '@/lib/ia/consultas/tipos'
import { VIGIAS } from './tipos'

// O GETÚLIO APRENDE PELO WHATSAPP.
//
// "Não me avise mais disso", 👎 num aviso, "não quero aviso de estoque
// negativo". As três ferramentas abaixo mexem só na CONFIGURAÇÃO do Getúlio
// (o que ele avisa) — nada em canal, venda, estoque ou dinheiro. Por isso
// rodam sem pedir confirmação: tudo se desfaz na Central.

const erro = (mensagem: string): ResultadoConsulta => ({ linhas: [], periodo: '—', ressalvas: [mensagem] })
const LISTA_TIPOS = VIGIAS.map(v => `"${v.id}" (${v.nome})`).join(', ')

export const ACOES_APRENDER: Consulta[] = [
  {
    nome: 'parar_de_avisar',
    descricao: 'Para de avisar UM assunto da última mensagem que o Getúlio mandou (resumo ou alerta), pelo número do item. Use quando o dono disser "não me avise mais disso", "esse não interessa", ou responder 👎 a um aviso. Se a última mensagem foi um alerta, o item é 1. O assunto volta a ser avisado se for resolvido e reaparecer, ou se piorar.',
    parametros: {
      type: 'object',
      properties: { item: { type: 'number', description: 'Número do item na última mensagem (1, 2, 3…).' } },
      required: ['item'],
    },
    async executar(sb, empresaId, args) {
      const item = Math.floor(Number(args.item))
      if (!(item >= 1)) return erro('Informe o número do item.')
      const { data: ultima } = await sb.from('getulio_mensagens')
        .select('sinais, tipo, created_at').eq('empresa_id', empresaId).in('status', ['enviado', 'parcial'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      const id = ultima?.sinais?.[item - 1]
      if (!id) return erro(`A última mensagem não tem o item ${item}.`)
      const { data: sinal } = await sb.from('getulio_sinais')
        .update({ dispensado_em: new Date().toISOString() })
        .eq('id', id).eq('empresa_id', empresaId).select('titulo').maybeSingle()
      if (!sinal) return erro('Esse assunto já não está mais aberto.')
      return { linhas: [{ feito: true, parou_de_avisar: sinal.titulo }], periodo: 'agora', ressalvas: ['Dá para voltar a avisar na Central do Getúlio.'] }
    },
  },
  {
    nome: 'desligar_tipo_de_aviso',
    descricao: `Desliga um TIPO inteiro de aviso, quando o dono não quer mais nada daquele assunto ("não quero mais aviso de estoque negativo"). Tipos: ${LISTA_TIPOS}.`,
    parametros: {
      type: 'object',
      properties: { tipo: { type: 'string', description: 'O id do tipo de aviso.' } },
      required: ['tipo'],
    },
    async executar(sb, empresaId, args) {
      const tipo = String(args.tipo ?? '')
      const vigia = VIGIAS.find(v => v.id === tipo)
      if (!vigia) return erro(`Tipo desconhecido. Use um destes: ${LISTA_TIPOS}.`)
      const { data: cfg } = await sb.from('getulio_config').select('vigias_desligados').eq('empresa_id', empresaId).maybeSingle()
      const desligados = new Set<string>(cfg?.vigias_desligados ?? [])
      desligados.add(tipo)
      await sb.from('getulio_config').update({ vigias_desligados: [...desligados], updated_at: new Date().toISOString() }).eq('empresa_id', empresaId)
      return { linhas: [{ feito: true, desligado: vigia.nome }], periodo: 'agora', ressalvas: ['Dá para religar na Central do Getúlio ou pedindo aqui.'] }
    },
  },
  {
    nome: 'religar_tipo_de_aviso',
    descricao: `Volta a ligar um tipo de aviso desligado antes. Tipos: ${LISTA_TIPOS}.`,
    parametros: {
      type: 'object',
      properties: { tipo: { type: 'string', description: 'O id do tipo de aviso.' } },
      required: ['tipo'],
    },
    async executar(sb, empresaId, args) {
      const tipo = String(args.tipo ?? '')
      const vigia = VIGIAS.find(v => v.id === tipo)
      if (!vigia) return erro(`Tipo desconhecido. Use um destes: ${LISTA_TIPOS}.`)
      const { data: cfg } = await sb.from('getulio_config').select('vigias_desligados').eq('empresa_id', empresaId).maybeSingle()
      const desligados = ((cfg?.vigias_desligados ?? []) as string[]).filter(v => v !== tipo)
      await sb.from('getulio_config').update({ vigias_desligados: desligados, updated_at: new Date().toISOString() }).eq('empresa_id', empresaId)
      return { linhas: [{ feito: true, religado: vigia.nome }], periodo: 'agora' }
    },
  },
]
