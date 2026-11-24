import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {requireUser, assertMembership, type AuthContext} from '../_shared/auth.ts'
import {json, preflight} from '../_shared/cors.ts'
import {advanceRainminerMenu} from '../_shared/rainminer-menu-worker.ts'

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export async function handleRainminerMenu(request: Request) {
  if (request.method === 'OPTIONS') return preflight(request)!
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405)
  try {
    const body = await request.json()
    const token = Deno.env.get('APIFY_API_TOKEN')?.trim()
    const workerUrl = Deno.env.get('SUPABASE_URL')!+'/functions/v1/rainminer-menu'
    const enabled = async (admin:AuthContext['admin']) => {
      if (!token) return false
      const setting = await admin.rpc('rainminer_menu_enabled',{p_worker_url:workerUrl})
      return !setting.error && setting.data === true
    }
    if (body.action === 'work') {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
      const auth = await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''})
      if (auth.error || auth.data !== true) return json({error:'UNAUTHORIZED'},401)
      if (!await enabled(admin)) return json({error:'MENU_DISABLED'},503)
      const result = await advanceRainminerMenu(admin,token!)
      return json(result,'error' in result?502:200)
    }
    if (!uuid.test(body.establishment_id??'') || !['status','start'].includes(body.action))
      return json({error:'MENU_INVALID_REQUEST'},400)
    const {client,admin,user} = await requireUser(request)
    const restaurant = await client.from('establishments').select('id,organization_id,place_id')
      .eq('id',body.establishment_id).eq('active',true).single()
    if (restaurant.error) return json({error:'MENU_RESTAURANT_NOT_FOUND'},404)
    const role = await assertMembership(client,user.id,restaurant.data.organization_id)
    const mayStart = ['owner','admin','manager'].includes(role) &&
      /^ChIJ[\w-]+$/.test(restaurant.data.place_id??'') && await enabled(admin)
    if (body.action === 'start') {
      if (!mayStart) return json({error:'MENU_START_UNAVAILABLE'},403)
      if (!uuid.test(body.request_id??'') || body.confirm_paid !== true)
        return json({error:'MENU_PAID_CONFIRMATION_REQUIRED'},400)
      const queued = await admin.rpc('enqueue_rainminer_menu',{
        p_establishment:restaurant.data.id,p_request:body.request_id,p_user:user.id,
      })
      if (queued.error) {
        const code = ['MENU_BUDGET_LIMIT','MENU_LAUNCHES_DISABLED','MENU_PLACE_ID_REQUIRED','MENU_COST_CEILING_UNVERIFIED','MENU_CONFIGURATION_MISSING']
          .find(value=>queued.error!.message.includes(value))??'MENU_ENQUEUE_FAILED'
        return json({error:code},409)
      }
      const accepted = await admin.from('rainminer_menu_jobs').select('id,status,error_code,trigger_kind')
        .eq('id',queued.data).single()
      if (accepted.error) return json({error:'MENU_STATUS_FAILED'},500)
      return json({job:{...accepted.data,request_id:body.request_id}},202)
    }
    const snapshot = await admin.rpc('read_rainminer_menu',{p_establishment:restaurant.data.id,p_user:user.id})
    if (snapshot.error) return json({error:'MENU_STATUS_FAILED'},500)
    return json({...snapshot.data,canStart:mayStart && !snapshot.data?.launchBlock})
  } catch {
    return json({error:'MENU_REQUEST_REJECTED'},403)
  }
}
Deno.serve(handleRainminerMenu)
