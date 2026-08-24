import { contextoAdmin } from '@/lib/commerce/admin'
import FormularioLoja, { type Secao } from '@/components/loja-admin/FormularioLoja'

export const dynamic = 'force-dynamic'

// Aparência.
//
// Personalização CONTROLADA, não construtor de sites — foi decisão explícita
// do projeto, e é o que mantém a qualidade visual sem depender do gosto de
// quem configura. O lojista escolhe logo, favicon e DUAS cores; o resto vem
// do design system.
//
// Duas cores é o limite certo: com uma paleta livre, qualquer combinação vira
// possível, inclusive as que quebram contraste e acessibilidade.

const CAMPOS = ['logo_url', 'favicon_url', 'cor_primaria', 'cor_destaque']

const SECOES: Secao[] = [
  {
    titulo: 'Marca',
    descricao: 'Sem logotipo, a vitrine usa o nome da loja em texto — o que também funciona bem.',
    campos: [
      { nome: 'logo_url', rotulo: 'Logotipo (URL)', max: 500,
        ajuda: 'Fundo transparente (PNG ou SVG) e altura de pelo menos 64px.' },
      { nome: 'favicon_url', rotulo: 'Favicon (URL)', max: 500,
        ajuda: 'O ícone da aba do navegador. Quadrado, 32×32 ou maior.' },
    ],
  },
  {
    titulo: 'Cores',
    descricao: 'Duas cores, e só. É o que garante que a loja continue legível e com aparência profissional.',
    campos: [
      { nome: 'cor_primaria', rotulo: 'Cor principal', tipo: 'cor',
        ajuda: 'Botão de comprar, links e selo de quantidade. Escolha uma cor escura o bastante para texto branco em cima.' },
      { nome: 'cor_destaque', rotulo: 'Cor de oferta', tipo: 'cor',
        ajuda: 'Só o selo de desconto no card. Deixe diferente da principal para o desconto se destacar.' },
    ],
  },
]

export default async function Aparencia() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const { data } = await ctx.sb
    .from('loja_config').select(CAMPOS.join(', ')).eq('id', ctx.lojaId).single()

  return (
    <div className="space-y-4">
      <FormularioLoja lojaId={ctx.lojaId} secoes={SECOES} valores={(data ?? {}) as Record<string, unknown>} />
      <p className="text-xs text-gray-500">
        Banners e blocos da página inicial ficam na aba <strong>Banners / Home</strong>.
      </p>
    </div>
  )
}
