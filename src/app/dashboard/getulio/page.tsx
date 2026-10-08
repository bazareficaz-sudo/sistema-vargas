import GetulioClient from '@/components/getulio/GetulioClient'
import { guardaGetulio, lerConfig } from '@/lib/getulio/acesso'
import { urlWebhookZapi } from '@/lib/getulio/webhook'

export const dynamic = 'force-dynamic'

export default async function GetulioPage() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) {
    return (
      <div className="p-8 text-sm text-gray-600">
        A Central do Getúlio é para quem administra a empresa — peça acesso a um administrador.
      </div>
    )
  }
  const empresaId = guarda.empresaId
  const [config, { data: sinais }, { data: mensagens }, { data: wpp }, { data: conversas }, { data: ultimaRecebida }] = await Promise.all([
    lerConfig(sb, empresaId),
    sb.from('getulio_sinais')
      .select('id, vigia, gravidade, titulo, detalhe, valor, link, detectado_em, atualizado_em, avisado_em, dispensado_em')
      .eq('empresa_id', empresaId).is('resolvido_em', null),
    sb.from('getulio_mensagens')
      .select('id, tipo, texto, gerado_por, status, erro, created_at')
      .eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(10),
    sb.from('whatsapp_config').select('ativo, instance_id, status_conexao, webhook_url').eq('empresa_id', empresaId).maybeSingle(),
    sb.from('getulio_conversas').select('id, numero, papel, texto, consultas, erro, created_at')
      .eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(20),
    // Prova de que a Z-API está chamando o sistema: a última mensagem que chegou.
    sb.from('whatsapp_mensagens').select('created_at')
      .eq('empresa_id', empresaId).eq('tipo', 'recebida').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  return (
    <GetulioClient
      configInicial={config}
      sinaisIniciais={sinais ?? []}
      mensagens={mensagens ?? []}
      whatsappPronto={!!(wpp?.ativo && wpp?.instance_id)}
      recebimentoConectado={String(wpp?.webhook_url ?? '').includes('/api/webhooks/zapi?k=')}
      /* Endereço completo, com a chave: é o que vai no campo "Ao receber" da
         Z-API. A tela já é só de quem administra a empresa. */
      enderecoRecebimento={wpp?.instance_id ? urlWebhookZapi(wpp.instance_id) : null}
      ultimaMensagemRecebida={ultimaRecebida?.created_at ?? null}
      conversas={[...(conversas ?? [])].reverse()}
    />
  )
}
