import { createClient } from '@/lib/supabase/server'
import GerenciarBlogClient from '@/components/saas-admin/GerenciarBlogClient'

export const dynamic = 'force-dynamic'

export default async function BlogAdminPage() {
  const supabase = await createClient()

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('*')
    .order('created_at', { ascending: false })

  return <GerenciarBlogClient posts={posts ?? []} />
}
