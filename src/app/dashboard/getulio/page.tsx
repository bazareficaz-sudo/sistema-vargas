import GetulioClient from '@/components/getulio/GetulioClient'
import { guardaGetulio, lerConfig } from '@/lib/getulio/acesso'

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
  const [config, { data: sinais }, { data: mensagens }, { data: wpp }] = await Promise.all([
    lerConfig(sb, empresaId),
    sb.from('getulio_sinais')
      .select('id, vigia, gravidade, titulo, detalhe, valor, link, detectado_em, atualizado_em, avisado_em, dispensado_em')
      .eq('empresa_id', empresaId).is('resolvido_em', null),
    sb.from('getulio_mensagens')
      .select('id, tipo, texto, gerado_por, status, erro, created_at')
      .eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(10),
    sb.from('whatsapp_config').select('ativo, instance_id, status_conexao').eq('empresa_id', empresaId).maybeSingle(),
  ])

  return (
    <GetulioClient
      configInicial={config}
      sinaisIniciais={sinais ?? []}
      mensagens={mensagens ?? []}
      whatsappPronto={!!(wpp?.ativo && wpp?.instance_id)}
    />
  )
}
