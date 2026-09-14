import { contextoAdmin } from '@/lib/commerce/admin'
import FormularioLoja, { type Secao } from '@/components/loja-admin/FormularioLoja'
import DominioProprioClient from '@/components/loja-admin/DominioProprioClient'

export const dynamic = 'force-dynamic'

const CAMPOS = ['subdominio', 'dominio_proprio', 'ativo', 'em_manutencao']

const SECOES: Secao[] = [
  {
    titulo: 'Endereço da loja',
    descricao: 'É pelo endereço que o sistema descobre de qual loja se trata — por isso ele é único em toda a plataforma.',
    campos: [
      { nome: 'subdominio', rotulo: 'Subdomínio', max: 63, placeholder: 'minhaloja',
        ajuda: 'Só letras minúsculas, números e hífen. Trocar depois de divulgar quebra todo link já compartilhado.' },
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

      {/* Domínio próprio ganhou tela própria: diferente do subdomínio (que só
          grava um campo), ativar um domínio de cliente depende do DNS dele e
          da Vercel reconhecer o domínio — por isso o assistente, e não um
          campo de texto que "parece salvo" e não funciona. */}
      <DominioProprioClient lojaId={ctx.lojaId} dominioAtivo={(data as any)?.dominio_proprio ?? null} />
    </div>
  )
}
