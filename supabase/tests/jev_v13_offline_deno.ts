import {V13_CONFIG,V13_THRESHOLDS,v13Payload,v13ReportedSafety} from '../functions/_shared/jev-v13-config.ts'
import {V12_CONFIG} from '../functions/_shared/jev-v12-config.ts'
import {THEME_KEYS} from '../functions/_shared/jev-themes.ts'
import {canonicalJson} from '../functions/_shared/jev-exploratory-core.ts'
import {V13_CASES} from '../../tests/fixtures/jev-v13-cases.ts'
function assert(value:unknown,message='Assertion failed'){if(!value)throw new Error(message)}
Deno.test('V13 configuration keeps 25 questions, four choices, same thresholds and an independent frozen copy',()=>{assert(Object.keys(V13_CONFIG.questions).length===25);assert(canonicalJson(V13_THRESHOLDS)===canonicalJson(V12_CONFIG.thresholds));assert(V13_THRESHOLDS!==V12_CONFIG.thresholds);for(const k of THEME_KEYS)assert(Object.keys((V13_CONFIG.questions[k] as {criteria:object}).criteria).length===4);assert(Object.isFrozen(V13_CONFIG.questions.cooking))})
Deno.test('19 invented payload cases run offline and never include real review identities',()=>{for(const c of V13_CASES){const p=v13Payload('synthetic_'+c.id,c.text);assert(Object.keys(p.questions).length===25);assert(canonicalJson(p).includes(c.text));assert(!canonicalJson(p).includes('d7d7142c-03ef-48c3-b36e-bacf6d923f40'))}})
Deno.test('medical/safety cues never create a causal claim or an extra theme',()=>{assert(v13ReportedSafety('I later got dengue after mosquito bites.')?.causality_confirmed===false);assert(v13ReportedSafety('I felt sick afterwards.')?.creates_theme===false)})
Deno.test('Google metadata and labels never enter the Jev payload',()=>{const p=v13Payload('r','Only English analytical text');for(const k of ['rating','review_context','original_text','reference','v12'])assert(!Object.keys(p).includes(k));assert(V13_CONFIG.repeat_count===3&&V13_CONFIG.concurrency===8)})
