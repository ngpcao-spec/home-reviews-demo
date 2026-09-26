import {createClient,type SupabaseClient,type User} from 'npm:@supabase/supabase-js@2.117.2'

export interface AuthContext{user:User;client:SupabaseClient;admin:SupabaseClient}

export async function requireUser(request:Request):Promise<AuthContext>{
  const auth=request.headers.get('Authorization')
  if(!auth?.startsWith('Bearer '))throw new Error('UNAUTHORIZED')
  const url=Deno.env.get('SUPABASE_URL')!;const anon=Deno.env.get('SUPABASE_ANON_KEY')!;const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const {data,error}=await client.auth.getUser()
  if(error||!data.user)throw new Error('UNAUTHORIZED')
  return {user:data.user,client,admin:createClient(url,service,{auth:{persistSession:false}})}
}

export async function assertMembership(client:SupabaseClient,userId:string,organizationId:string,roles?:string[]){
  const {data,error}=await client.from('organization_members').select('role').eq('organization_id',organizationId).eq('user_id',userId).single()
  if(error||!data||roles&&!roles.includes(data.role))throw new Error('FORBIDDEN')
  return data.role as string
}

export async function organizationForEstablishment(client:SupabaseClient,id:string){
  const {data,error}=await client.from('establishments').select('id,organization_id,name,provider_place_ref,google_maps_url,last_synced_at').eq('id',id).single()
  if(error||!data)throw new Error('ESTABLISHMENT_NOT_FOUND')
  return data
}
