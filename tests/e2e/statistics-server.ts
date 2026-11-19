import type { Plugin } from 'vite'
import { statisticsDatabase, estA, estB, userA, userB, restaurant } from '../fixtures/statistics-database'

// Test-only HTTP adapter -> actual PostgreSQL RPCs. No provider or production access.
// Supabase JWT verification is outside this fixture; database authorization runs as
// authenticated with the selected account claim, not as a privileged caller.
export function statisticsServer(): Plugin {
  return { name: 'isolated-statistics-postgres', configureServer(server) {
    const ready = statisticsDatabase().then(async db => {
      await db.exec(`insert into private.shared_restaurant_review_translations
        select restaurant_id,external_id,l,encode(extensions.digest(original_text,'sha256'),'hex'),case l when 'fr' then 'Une cuisine savoureuse et un service attentif.' else 'Món ăn ngon và phục vụ chu đáo.' end
        from private.shared_restaurant_reviews cross join (values('fr'),('vi')) langs(l) where external_id in('source-400','source-800');
        update private.shared_restaurant_reviews set original_text='' where external_id='source-1200';
        insert into private.shared_jev_analyses(identity_sha256,establishment_id,google_review_id,state,identity,result)
        select 'analysis-'||external_review_id,establishment_id,external_review_id,'ready',jsonb_build_object('analysis_language','en','analysis_text_sha256',encode(extensions.digest(original_text,'sha256'),'hex')),
        '{"categories":{"service":{"status":"classified","classification":"positive"},"quality":{"status":"classified","classification":"mixed"},"price":{"status":"classified","classification":"negative"}}}' from public.reviews where external_review_id in('source-4','source-5','source-6');
        insert into private.shared_restaurant_jev_keys select '${restaurant}',identity_sha256,identity_sha256 from private.shared_jev_analyses;`)
      return db
    })
    let queue = Promise.resolve()
    server.middlewares.use('/__statistics', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      let body = ''; req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        queue = queue.then(async () => {
          const db = await ready
          const { name, args, language, state } = JSON.parse(body)
          if (!['read_restaurant_statistics','read_restaurant_statistic_reviews'].includes(name)) throw Error('FORBIDDEN_TEST_RPC')
          if (state === 'error') { res.statusCode = 500; res.end(JSON.stringify({error:'TEST_UNAVAILABLE'})); return }
          await db.exec('begin')
          try {
            if (state === 'complete') await db.exec(`delete from public.reviews;delete from private.shared_restaurant_reviews;
              insert into private.shared_restaurant_reviews(restaurant_id,external_id,published_at,rating,original_text,public_payload) values
              ('${restaurant}','new-1',now()-interval '1 day',5,'','{}'),('${restaurant}','new-2',now()-interval '16 days',3,'','{}'),('${restaurant}','old',now()-interval '100 days',2,'','{}');
              update public.establishments set total_reviews=3,review_collection_status='complete',review_collection_expected=3,review_collection_unique=3,review_collection_checked_at=now();`)
            if (state === 'empty') await db.exec('delete from public.reviews;delete from private.shared_restaurant_reviews')
            if (args.p_establishment === 'other') await db.exec('delete from private.shared_restaurant_pilot_places;delete from public.reviews')
            await db.exec(`set request.jwt.claim.sub='${language === 'vi' ? userB : userA}';set role authenticated`)
            const id = language === 'vi' ? estB : estA
            const result = name === 'read_restaurant_statistics'
              ? await db.query<{data:Record<string,unknown>}>('select public.read_restaurant_statistics($1,$2) data',[id,args.p_period])
              : await db.query<{data:Record<string,unknown>}>('select public.read_restaurant_statistic_reviews($1,$2,$3,$4,$5,$6,$7,$8) data',[id,args.p_period,args.p_ratings,args.p_topic,args.p_polarity,args.p_before,args.p_before_id,args.p_limit])
            const data = result.rows[0].data
            if (name === 'read_restaurant_statistics') data.establishment_id = args.p_establishment // fixture route alias only
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}))
          } finally { await db.exec('rollback') }
        }).catch(error => { res.statusCode=500;res.end(JSON.stringify({error:String(error)})) })
      })
    })
    server.httpServer?.once('close',()=>{void ready.then(db=>db.close())})
  } }
}
