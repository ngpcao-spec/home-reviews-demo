import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {importRainminerMenu, RAINMINER_ACTOR, RAINMINER_ACTOR_ID} from '../supabase/functions/_shared/rainminer-menu.mjs';

// One restaurant per invocation. Archive mode is entirely offline.
const [placeId, mode, source, target] = process.argv.slice(2);
if (!/^ChIJ[\w-]+$/.test(placeId ?? '') || !['archive', 'run'].includes(mode) || !source || !target) {
  throw Error('Usage: node scripts/menu-reference-rainminer.mjs PLACE_ID archive|run ARCHIVE_DIR|RUN_ID OUTPUT_DIR');
}

let raw;
let provenanceText;
if (mode === 'archive') {
  const dir = resolve(source);
  const readArchive = async name => {
    try {
      return await readFile(join(dir, name), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return readFile(join(dir, 'KHOUSE_' + name), 'utf8');
    }
  };
  raw = await readArchive('APIFY_MENU_RAW.json');
  provenanceText = await readArchive('APIFY_RUN_INFO.json');
} else {
  const token = process.env.APIFY_API_TOKEN;
  if (!token || !/^[a-zA-Z0-9]+$/.test(source)) throw Error('APIFY_TOKEN_OR_RUN_ID_INVALID');
  const get = async path => {
    const response = await fetch('https://api.apify.com/v2/' + path, {
      headers: {Authorization: 'Bearer ' + token},
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('APIFY_READ_HTTP_' + response.status);
    return response.json();
  };
  const {data: run} = await get('actor-runs/' + source);
  if (run.actId !== RAINMINER_ACTOR_ID || run.status !== 'SUCCEEDED') throw Error('MENU_RUN_NOT_READY_OR_WRONG_ACTOR');
  const input = await get('key-value-stores/' + run.defaultKeyValueStoreId + '/records/INPUT');
  if (input.placeIds?.length !== 1 || input.placeIds[0] !== placeId ||
      input.startUrls?.length || input.textQueries?.length) throw Error('MENU_RUN_IDENTITY_MISMATCH');
  const items = [];
  for (let offset = 0;; offset += 100) {
    const page = await get(`datasets/${run.defaultDatasetId}/items?clean=false&limit=100&offset=${offset}`);
    items.push(...page);
    if (page.length < 100) break;
  }
  raw = JSON.stringify(items, null, 2);
  provenanceText = JSON.stringify({
    actor: {id: run.actId, name: RAINMINER_ACTOR}, runId: run.id,
    datasetId: run.defaultDatasetId, input, build: run.buildNumber,
    startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status,
  }, null, 2);
}
const provenance = JSON.parse(provenanceText);
const result = importRainminerMenu(JSON.parse(raw), provenance, placeId);
if (!/^[a-zA-Z0-9]+$/.test(provenance.runId)) throw Error('INVALID_MENU_RUN_ID');
const directory = resolve(target, placeId, provenance.runId);
await mkdir(directory, {recursive: true});
await writeFile(join(directory, 'APIFY_MENU_RAW.json'), raw);
await writeFile(join(directory, 'APIFY_RUN_INFO.json'), provenanceText);
await writeFile(join(directory, 'MENU_REFERENCES.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({directory, ...result.counts}));
