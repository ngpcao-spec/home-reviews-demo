import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'

export type WorkingLanguage = 'fr' | 'vi'

export async function preferredLanguageForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<WorkingLanguage> {
  const { data, error } = await admin
    .from('profiles')
    .select('preferred_language')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.preferred_language === 'vi' ? 'vi' : 'fr'
}

export async function preferredLanguageForOrganization(
  admin: SupabaseClient,
  organizationId: string,
): Promise<WorkingLanguage> {
  const { data: organization, error } = await admin
    .from('organizations')
    .select('created_by')
    .eq('id', organizationId)
    .single()
  if (error) throw error
  return preferredLanguageForUser(admin, organization.created_by as string)
}
