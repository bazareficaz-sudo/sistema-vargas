import { contextoAdmin } from '@/lib/commerce/admin'
import FormularioLoja, { type Secao } from '@/components/loja-admin/FormularioLoja'

export const dynamic = 'force-dynamic'

const CAMPOS = [
  'nome', 'descricao', 'telefone', 'whatsapp', 'email',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'instagram', 'facebook', 'tiktok', 'horario_atendimento',
  'seo_title', 'meta_description', 'og_image_url', 'indexavel',
]

const SECOES: Secao[] = [
  {
    titulo: 'Informações da loja',
    descricao: 'Aparecem no rodapé e nas páginas de produto.',
    campos: [
      { nome: 'nome', rotulo: 'Nome da loja', max: 120 },
      { nome: 'descricao', rotulo: 'Descrição curta', tipo: 'area', max: 400,
        ajuda: 'Uma frase sobre o que a loja vende. Aparece no rodapé e no compartilhamento.' },
      { nome: 'whatsapp', rotulo: 'WhatsApp', max: 40, placeholder: '21999999999',
        ajuda: 'Só números, com DDD. É o botão de atendimento da loja.' },
      { nome: 'telefone', rotulo: 'Telefone', max: 40 },
      { nome: 'email', rotulo: 'E-mail', max: 200 },
      { nome: 'horario_atendimento', rotulo: 'Horário de atendimento', max: 200,
        placeholder: 'Seg a Sex, 8h às 18h' },
    ],
  },
  {
    titulo: 'Endereço',
    descricao: 'Usado no rodapé e, mais adiante, na retirada na loja.',
    campos: [
      { nome: 'cep', rotulo: 'CEP', max: 20 },
      { nome: 'logradouro', rotulo: 'Rua', max: 200 },
      { nome: 'numero', rotulo: 'Número', max: 20 },
      { nome: 'complemento', rotulo: 'Complemento', max: 100 },
      { nome: 'bairro', rotulo: 'Bairro', max: 100 },
      { nome: 'cidade', rotulo: 'Cidade', max: 100 },
      { nome: 'uf', rotulo: 'UF', max: 2 },
    ],
  },
  {
    titulo: 'Redes sociais',
    campos: [
      { nome: 'instagram', rotulo: 'Instagram', max: 300, placeholder: 'https://instagram.com/sualoja' },
      { nome: 'facebook', rotulo: 'Facebook', max: 300 },
      { nome: 'tiktok', rotulo: 'TikTok', max: 300 },
    ],
  },
  {
    titulo: 'Busca do Google',
    descricao: 'Como a loja aparece nos resultados e ao ser compartilhada.',
    campos: [
      { nome: 'seo_title', rotulo: 'Título', max: 120,
        ajuda: 'Vazio usa o nome da loja. Até 60 caracteres é o que o Google mostra inteiro.' },
      { nome: 'meta_description', rotulo: 'Descrição', tipo: 'area', max: 200,
        ajuda: 'O texto abaixo do título no resultado da busca. Até 160 caracteres.' },
      { nome: 'og_image_url', rotulo: 'Imagem de compartilhamento', max: 500,
        ajuda: 'Aparece quando o link da loja é colado no WhatsApp. Sem ela, o link vira um retângulo cinza.' },
      { nome: 'indexavel', rotulo: 'Permitir que o Google encontre a loja', tipo: 'bool',
        ajuda: 'Deixe desligado enquanto monta o catálogo. Ligar cedo faz o Google indexar uma loja incompleta, e desfazer isso leva semanas.' },
    ],
  },
]

export default async function Configuracoes() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const { data } = await ctx.sb
    .from('loja_config').select(CAMPOS.join(', ')).eq('id', ctx.lojaId).single()

  return <FormularioLoja lojaId={ctx.lojaId} secoes={SECOES} valores={(data ?? {}) as Record<string, unknown>} />
}
