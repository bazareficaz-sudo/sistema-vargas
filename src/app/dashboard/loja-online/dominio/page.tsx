import { contextoAdmin } from '@/lib/commerce/admin'
import FormularioLoja, { type Secao } from '@/components/loja-admin/FormularioLoja'

export const dynamic = 'force-dynamic'

const CAMPOS = ['subdominio', 'dominio_proprio', 'ativo', 'em_manutencao']

const SECOES: Secao[] = [
  {
    titulo: 'Endereço da loja',
    descricao: 'É pelo endereço que o sistema descobre de qual loja se trata — por isso ele é único em toda a plataforma.',
    campos: [
      { nome: 'subdominio', rotulo: 'Subdomínio', max: 63, placeholder: 'minhaloja',
        ajuda: 'Só letras minúsculas, números e hífen. Trocar depois de divulgar quebra todo link já compartilhado.' },
      { nome: 'dominio_proprio', rotulo: 'Domínio próprio (opcional)', max: 253,
        placeholder: 'loja.suaempresa.com.br',
        ajuda: 'Precisa apontar para a plataforma no DNS antes de funcionar. Enquanto não apontar, o subdomínio continua valendo.' },
    ],
  },
  {
    titulo: 'Publicação',
    campos: [
      { nome: 'ativo', rotulo: 'Loja ativa', tipo: 'bool',
        ajuda: 'Desligado, o endereço não responde nada. É o desligamento completo.' },
      { nome: 'em_manutencao', rotulo: 'Em manutenção', tipo: 'bool',
        ajuda: 'Ligado, quem entrar vê um aviso e o botão de WhatsApp — sem catálogo. Serve para montar a loja com ela já no ar.' },
    ],
  },
]

export default async function Dominio() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const { data } = await ctx.sb
    .from('loja_config').select(CAMPOS.join(', ')).eq('id', ctx.lojaId).single()

  return (
    <div className="space-y-4">
      <FormularioLoja lojaId={ctx.lojaId} secoes={SECOES} valores={(data ?? {}) as Record<string, unknown>} />

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p className="font-medium text-gray-900">Para o endereço funcionar de verdade</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>O domínio curinga (<code className="font-mono text-xs">*.seu-dominio</code>) precisa estar
              cadastrado no projeto da Vercel — uma vez só, e vale para todas as lojas.</li>
          <li>A variável <code className="font-mono text-xs">NEXT_PUBLIC_LOJA_DOMINIO_RAIZ</code> precisa
              conter o domínio raiz, sem <code className="font-mono text-xs">www</code>.</li>
          <li>Domínio próprio exige, além disso, um CNAME apontando para a Vercel.</li>
        </ul>
      </div>
    </div>
  )
}
