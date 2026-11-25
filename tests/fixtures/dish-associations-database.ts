import {readFileSync} from 'node:fs'
import {menuDatabase,ORG,ORG2,USER,USER2} from './rainminer-menu-database'
import {sqlMigrationSource} from './sql-migration-source'
import type {PGlite} from '@electric-sql/pglite'
export {ORG,ORG2,USER,USER2}
export const DISH_MIGRATION='20261124094341_restaurant_dish_associations.sql'
export const PHO_MIGRATION='20261124115519_recognize_numbered_pho_dishes.sql'
export const CONTEXT_MIGRATION='20261125003006_derive_dish_variants_from_menu_sections.sql'
export const savedMenu=JSON.parse(readFileSync('tests/fixtures/banh-can-menu-saved.json','utf8'))
export async function dishDatabase(beforeMigration?:(db:PGlite)=>Promise<void>, stage:'original'|'numbered'|'contextual'='contextual'){
 const db=await menuDatabase()
 await beforeMigration?.(db)
 await db.exec(sqlMigrationSource(readFileSync('supabase/migrations/'+DISH_MIGRATION,'utf8')))
 if (stage!=='original') {
  await db.exec(sqlMigrationSource(readFileSync('supabase/migrations/'+PHO_MIGRATION,'utf8')))
  if (stage==='contextual') await db.exec(sqlMigrationSource(readFileSync('supabase/migrations/'+CONTEXT_MIGRATION,'utf8')))
 }
 return db
}
