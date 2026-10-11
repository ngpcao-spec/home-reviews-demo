import {negativeHash} from './negative-validation-core.ts'
import {canonicalJson} from './jev-exploratory-core.ts'
import type {ThemeKey} from './jev-themes.ts'

export const EVIDENCE_VERSION='pilot-evidence-explicit-v2'
export const EVIDENCE_VERIFIER='explicit-evidence-rules-v1'
export type EvidencePolarity='positive'|'negative'
export interface EvidenceRule {id:string;theme:ThemeKey;polarity:EvidencePolarity;pattern:string;claim:string;statement_fr:string;statement_vi:string;recommendation_fr:string;recommendation_vi:string}
const rule=(theme:ThemeKey,polarity:EvidencePolarity,claim:string,pattern:string,fr:string,vi:string,recoFr:string,recoVi:string):EvidenceRule=>Object.freeze({id:`${theme}.${polarity}.${claim}`,theme,polarity,claim,pattern,statement_fr:fr,statement_vi:vi,recommendation_fr:recoFr,recommendation_vi:recoVi})
const general=(theme:ThemeKey,polarity:EvidencePolarity,pattern:string,labelFr:string,labelVi:string)=>rule(theme,polarity,theme,pattern,`Le commentaire évalue ${labelFr} ${polarity==='positive'?'positivement':'négativement'}.`,`Nhận xét đánh giá ${labelVi} ${polarity==='positive'?'tích cực':'tiêu cực'}.`,polarity==='negative'?`Examiner les commentaires explicites sur ${labelFr}.`:`Maintenir les pratiques appréciées concernant ${labelFr}.`,polarity==='negative'?`Xem xét nhận xét cụ thể về ${labelVi}.`:`Duy trì những thực hành được đánh giá tốt về ${labelVi}.`)
const food='(?:food|meal|dish(?:es)?|breakfast|pancake|burger|steak|cake|shakshouka|pasta|pizza|salad)',staff='(?:staff|waiter|waitress|server|service|they)',drink='(?:coffee|tea|drink(?:s)?|juice|cocktail|smoothie|beverage(?:s)?)'
// Conservative, versioned lexical gates. Unsupported paraphrases stay pending, not false findings.
// The verifier receives text/theme/polarity only, never a rating, probability or model decision.
export const EVIDENCE_RULES:readonly EvidenceRule[]=Object.freeze([
 rule('attentiveness','positive','customer_attention',`(?:${staff}.{0,35}\\b(?:attentive|responsive|caring)\\b|\\battentive (?:staff|service)|checked (?:on|in on) (?:us|our table|guests)|noticed (?:our|what we) (?:needs|needed)|helped (?:us|me) with|as soon as.{0,35}(?:bring|brought).{0,20}water)`,"Le texte décrit une attention concrète aux clients.",'Nội dung mô tả sự quan tâm cụ thể tới khách.',"Maintenir les pratiques explicites de suivi des besoins des clients.",'Duy trì cách theo sát nhu cầu khách được mô tả cụ thể.'),
 rule('attentiveness','negative','customer_attention',`(?:${staff}.{0,30}(?:ignored|neglected) (?:us|me|our|customers|guests)|(?:nobody|no (?:waiter|server|staff member)).{0,30}(?:came|helped|took (?:our|my) order)|${staff}.{0,25}(?:not\\s+(?:at all\\s+)?|never\\s+|in)attentive|${staff}.{0,20}(?:did not|didn't|never) (?:check on|respond to|help) (?:us|me|our))`,"Le texte décrit un manque explicite de prise en charge.",'Nội dung mô tả rõ việc thiếu chăm sóc khách.',"Vérifier les pratiques de prise en charge et de suivi des demandes décrites.",'Kiểm tra cách tiếp nhận và theo sát yêu cầu được mô tả.'),
 rule('communication','negative','customer_communication','(?:difficult|hard|impossible) to understand|(?:could not|couldn\'t|did not|didn\'t) understand (?:our|my|the) (?:order|request|explanation)|misunderstood (?:our|my) (?:order|request)|(?:poor|bad|unclear) (?:communication|explanation)|language barrier',"Le texte décrit une difficulté de compréhension ou d'échange.",'Nội dung mô tả khó khăn khi hiểu hoặc trao đổi với khách.',"Clarifier les échanges et la compréhension des demandes des clients.",'Làm rõ trao đổi và việc hiểu yêu cầu của khách.'),
 rule('communication','positive','customer_communication','(?:clearly|patiently|well) explained|explained.{0,35}(?:menu|how|options|ingredients)|(?:clear|helpful) (?:explanation|communication)|understood (?:our|my) (?:order|request)',"Le texte décrit une explication ou un échange utile avec le client.",'Nội dung mô tả việc giải thích hoặc trao đổi hữu ích với khách.',"Maintenir les explications et échanges clairement appréciés.",'Duy trì cách giải thích và trao đổi được đánh giá rõ ràng.'),
 rule('location','negative','location_access','(?:hard|difficult|impossible) to (?:find|reach|access|get to)|(?:poor|difficult) access|inaccessible|entrance.{0,20}(?:hard|difficult) to find',"Le texte décrit explicitement une difficulté d'accès ou de repérage.",'Nội dung mô tả rõ khó khăn khi tiếp cận hoặc tìm địa điểm.',"Clarifier les indications d'accès correspondant aux difficultés décrites.",'Làm rõ chỉ dẫn tiếp cận theo khó khăn đã được mô tả.'),
 rule('location','negative','location_distance','too far|far away|long (?:journey|trip|drive)|not worth (?:the )?(?:trip|journey|drive)|remote location',"Le texte critique explicitement la distance ou le déplacement.",'Nội dung phê bình rõ khoảng cách hoặc việc di chuyển.',"Examiner les retours précis sur la distance et le déplacement.",'Xem xét phản hồi cụ thể về khoảng cách và việc di chuyển.'),
 rule('location','negative','location_appeal','(?:poor|bad|unappealing|unpleasant|disappointing) location|location.{0,20}(?:unappealing|disappointing|unpleasant)',"Le texte apprécie négativement l'emplacement, sans conclure sur l'accès.",'Nội dung đánh giá vị trí không tốt, không kết luận về khả năng tiếp cận.',"Examiner les appréciations explicites de l'emplacement.",'Xem xét đánh giá cụ thể về vị trí.'),
 general('location','positive','(?:great|good|convenient|central) location|well located|easy to (?:find|reach|get to)','l’emplacement','vị trí'),
 general('food_quality','positive',`(?:${food}.{0,35}(?:delicious|tasty|excellent|very good|best)|(?:delicious|tasty|excellent|best)\\b.{0,25}${food})`,'le goût et la qualité des plats','hương vị và chất lượng món ăn'),
 general('food_quality','negative',`(?:${food}.{0,45}(?:terrible|bad|tasteless|bland|disappointing|too sweet|not living up)|(?:terrible|tasteless|bland|bad|disappointing)\\b.{0,25}${food})`,'le goût et la qualité des plats','hương vị và chất lượng món ăn'),
 general('drinks','positive',`(?:${drink}.{0,30}(?:delicious|tasty|excellent|great|good)|(?:delicious|excellent|great)\\b.{0,20}${drink})`,'les boissons','đồ uống'),
 general('drinks','negative',`(?:${drink}.{0,30}(?:bad|terrible|tasteless|bland|disappointing)|(?:bad|terrible|tasteless|bland)\\b.{0,20}${drink})`,'les boissons','đồ uống'),
 general('friendly_staff','positive',`(?:${staff}.{0,30}(?:friendly|polite|kind|warm|pleasant)|(?:friendly|polite|kind)\\b.{0,20}${staff})`,'l’amabilité','sự thân thiện'),
 general('friendly_staff','negative',`(?:${staff}.{0,30}(?:rude|impolite|unfriendly)|(?:rude|impolite|unfriendly)\\b.{0,20}${staff})`,'l’amabilité','sự thân thiện'),
 general('professionalism','positive','(?:excellent|superb|great|top-notch|capable|professional) (?:service|staff)|(?:staff|service).{0,20}(?:professional|top-notch|superb)|knowledgeable staff','l’exécution du service','cách thực hiện phục vụ'),
 general('professionalism','negative','(?:unprofessional|incompetent) (?:staff|service|waiter)|(?:staff|service|waiter).{0,25}(?:unprofessional|incompetent)','l’exécution du service','cách thực hiện phục vụ'),
 general('coordination','positive','(?:well organized|well coordinated) (?:service|staff)|staff.{0,25}(?:worked smoothly together|coordinated)|service.{0,20}well organized','l’organisation du service','tổ chức phục vụ'),
 general('coordination','negative','(?:disorganized|uncoordinated) (?:service|staff)|(?:service|staff).{0,25}(?:disorganized|uncoordinated)|orders.{0,20}arrived at different times','l’organisation du service','tổ chức phục vụ'),
 general('wait_time','positive','(?:fast|quick|prompt) service|(?:food|order).{0,20}arrived quickly|did not have to wait|didn\'t have to wait','le temps d’attente','thời gian chờ'),
 general('wait_time','negative','(?:slow service|service.{0,15}slow)|waited.{0,25}(?:minutes|hour|long)|long wait','le temps d’attente','thời gian chờ'),
 general('order_accuracy','negative','(?:forgot|forgotten|missing|wrong|incorrect).{0,25}(?:order|ordered|dish|item)|(?:order|ordered).{0,25}(?:forgotten|missing|wrong|incorrect)','l’exactitude de la commande','độ chính xác đơn hàng'),
 general('order_accuracy','positive','(?:order|ordered).{0,25}(?:correct|accurate|exactly right)|everything we ordered arrived','l’exactitude de la commande','độ chính xác đơn hàng'),
 general('atmosphere','positive','(?:wonderful|great|lovely|relaxing|pleasant|nice).{0,15}(?:atmosphere|ambiance|vibe)|(?:atmosphere|ambiance|vibe).{0,20}(?:wonderful|great|pleasant|relaxing)','l’ambiance ressentie','bầu không khí'),
 general('atmosphere','negative','(?:bad|unpleasant|awful|uncomfortable).{0,15}(?:atmosphere|ambiance|vibe)|(?:atmosphere|ambiance|vibe).{0,25}(?:bad|unpleasant|awful|ruined)','l’ambiance ressentie','bầu không khí'),
 general('decor','positive','(?:beautiful|lovely|great|impressive).{0,15}(?:decor|interior|design|architecture)|(?:decor|interior|design).{0,20}(?:beautiful|lovely|impressive)','la décoration','trang trí'),
 general('decor','negative','(?:ugly|bad|dated|poor).{0,15}(?:decor|interior|design)|(?:decor|interior|design).{0,20}(?:ugly|dated|poor)','la décoration','trang trí'),
 general('comfort','positive','(?:comfortable|spacious|cozy) (?:seats|chairs|room|space)|(?:seats|chairs).{0,20}comfortable','le confort physique','sự thoải mái thể chất'),
 general('comfort','negative','(?:uncomfortable|cramped|hot|cold|stuffy) (?:seats|chairs|room|space)|(?:seats|chairs).{0,20}uncomfortable|room.{0,20}(?:too hot|too cold|cramped)','le confort physique','sự thoải mái thể chất'),
 general('cleanliness','positive','(?:clean|spotless) (?:tables|restaurant|toilets|bathroom|kitchen)|(?:tables|toilets|restaurant).{0,20}(?:clean|spotless)','l’hygiène décrite','vệ sinh được mô tả'),
 general('cleanliness','negative','(?:dirty|filthy|unclean) (?:tables|restaurant|toilets|bathroom|kitchen)|(?:cockroaches|rats|pests).{0,25}(?:restaurant|inside|kitchen)|(?:waiter|staff).{0,25}touch(?:ed|ing) (?:our|my|served) food','l’hygiène décrite','vệ sinh được mô tả'),
 general('noise','positive','(?:quiet|peaceful) (?:restaurant|room|space)|(?:music|noise).{0,20}(?:quiet|pleasant)','le bruit','tiếng ồn'),
 general('noise','negative','too noisy|too loud|loud music|(?:music|noise).{0,20}(?:loud|unbearable)','le bruit','tiếng ồn'),
 general('freshness','positive',`(?:fresh ${food}|${food}.{0,20}(?:fresh|freshly made))`,'la fraîcheur','độ tươi'),
 general('freshness','negative',`(?:stale|spoiled|not fresh).{0,15}${food}|${food}.{0,20}(?:stale|spoiled|not fresh)`,'la fraîcheur','độ tươi'),
 general('cooking','positive',`(?:perfectly|well) (?:cooked|prepared)|${food}.{0,20}(?:well cooked|perfectly prepared)`,'la cuisson et préparation','chế biến và độ chín'),
 general('cooking','negative','overcooked|undercooked|burnt|raw (?:chicken|meat)|(?:poorly|badly) (?:cooked|prepared)','la cuisson et préparation','chế biến và độ chín'),
 general('temperature','positive',`${food}.{0,25}(?:served hot|served warm|right temperature)`,'la température du plat servi','nhiệt độ món khi phục vụ'),
 general('temperature','negative',`${food}.{0,25}(?:served cold|arrived cold|lukewarm)|(?:served cold|lukewarm) ${food}`,'la température du plat servi','nhiệt độ món khi phục vụ'),
 general('portions','positive','(?:generous|large|ample) portions|portions.{0,15}(?:generous|large)','les portions','khẩu phần'),
 general('portions','negative','(?:small|tiny|insufficient) portions|portion.{0,15}(?:small|tiny|insufficient)|not enough food','les portions','khẩu phần'),
 general('presentation','positive','(?:beautiful|lovely|great) (?:presentation|plating)|(?:presented|plated) beautifully','la présentation','trình bày'),
 general('presentation','negative','(?:poor|bad|messy) (?:presentation|plating)|(?:presentation|plating).{0,15}(?:poor|bad|messy)','la présentation','trình bày'),
 general('variety','positive','(?:wide|great|large) (?:variety|selection)|many (?:menu )?options','la diversité disponible','lựa chọn sẵn có'),
 general('variety','negative','(?:menu items|dishes|options|burgers).{0,25}(?:out of stock|unavailable|not available)|(?:limited|poor) (?:menu|selection|variety)','la diversité disponible','lựa chọn sẵn có'),
 general('consistency','positive','(?:consistent|consistently good) (?:quality|food)|same (?:good |great )?quality (?:each|every) (?:visit|time)','la régularité de qualité','sự ổn định chất lượng'),
 general('consistency','negative','(?:quality|food).{0,20}(?:varies|inconsistent)|(?:better|worse) than (?:last|previous) (?:time|visit)|some dishes.{0,25}(?:good|great).{0,30}others.{0,20}(?:bad|poor)','la variation de qualité','biến động chất lượng'),
 general('price_level','negative','(?:a bit|too|very|quite|rather|really) expensive|(?:expensive|overpriced) (?:food|meal|menu|restaurant|place)|(?:food|meal|menu|restaurant|place|prices|it).{0,20}(?:expensive|overpriced)|high prices|prices.{0,15}(?:high|steep)|price.{0,15}too high','le niveau des prix','mức giá'),
 general('price_level','positive','affordable|reasonably priced|reasonable prices|not expensive|inexpensive','le niveau des prix','mức giá'),
 general('value','negative','not worth (?:the )?(?:money|price|cost|paying)|poor value|bad value|too expensive for (?:the |such )?(?:quality|portion|service)|price.{0,25}(?:quality|portion).{0,15}(?:poor|small)','le rapport prestation/prix','giá trị so với giá tiền'),
 general('value','positive','(?:well )?worth (?:the )?(?:money|price|cost|paying)|good value|great value|deserve(?:s)? to be paid for','le rapport prestation/prix','giá trị so với giá tiền'),
 general('billing','negative','(?:wrong|incorrect|extra|unexpected) (?:bill|charge|fee)|overcharged|charged.{0,20}(?:extra|twice)|bill.{0,20}(?:error|mistake)','la facturation','hóa đơn'),
 general('billing','positive','(?:correct|accurate|clear) (?:bill|billing)|no hidden (?:charges|fees)','la facturation','hóa đơn'),
])
export const evidenceRuleHash=()=>negativeHash(canonicalJson({version:EVIDENCE_VERSION,verifier:EVIDENCE_VERIFIER,rules:EVIDENCE_RULES,unit_split:'sentence_and_contrast_v1',negative_guard:'scoped_negation_v1',word_boundaries:'outer_v1'}))
export interface VerifiedExcerpt {rule_id:string;claim:string;start:number;end:number;quote:string}
export interface EvidenceCheck {status:'supported_by_rule'|'review_needed';reason:string;excerpt:VerifiedExcerpt|null;verification_type:'deterministic_rule_check';human_validated:false;ai_verified:false}
function units(text:string){const out:{start:number;end:number;text:string}[]=[];const sentences=text.matchAll(/[^.!?\n;]+(?:[.!?;]+|$)/g);for(const sentence of sentences){const base=sentence.index;let at=0;for(const contrast of sentence[0].matchAll(/\b(?:but|however|although|whereas)\b/gi)){const end=contrast.index;append(at,end);at=end+contrast[0].length}append(at,sentence[0].length);function append(a:number,b:number){const raw=sentence[0].slice(a,b),left=raw.length-raw.trimStart().length,right=raw.trimEnd().length;if(right>left)out.push({start:base+a+left,end:base+a+right,text:raw.slice(left,right)})}}return out}
export function verifyExplicitEvidence(text:string,theme:ThemeKey,polarity:EvidencePolarity):EvidenceCheck{
 const base={verification_type:'deterministic_rule_check' as const,human_validated:false as const,ai_verified:false as const};
 for(const unit of units(text)){if(unit.text.length>1200||(['food_quality','cleanliness'].includes(theme)&&/\b(?:poisoning|sick|vomit|symptoms|hospital)\b/i.test(unit.text))||/\b(?:if|wish|should|might|perhaps|would)\b/i.test(unit.text))continue;
 for(const r of EVIDENCE_RULES.filter(r=>r.theme===theme&&r.polarity===polarity)){const match=new RegExp('\\b(?:'+r.pattern+')\\b','i').exec(unit.text);if(!match)continue;
 // Avoid treating negated praise as positive or 'not expensive' as a price complaint.
 const segment=unit.text.slice(Math.max(0,match.index-18),match.index+match[0].length);
 if(polarity==='positive'&&/\b(?:inattentive|unfriendly|unprofessional|incompetent|uncomfortable|unclean|inconsistent)\b/i.test(segment))continue;
 if(polarity==='positive'&&r.theme!=='price_level'&&/\b(?:not|never|no|wasn['’]t|weren['’]t|isn['’]t|didn['’]t)\b/i.test(segment))continue;
 if(polarity==='negative'&&/\b(?:not|wasn['’]t|isn['’]t)\s+(?:very\s+|at all\s+)?(?:bad|terrible|bland|rude|noisy|slow|dirty|expensive|overpriced|overcooked|undercooked)\b/i.test(segment))continue;
 if(polarity==='negative'&&/\bno\s+(?:long wait|hidden charges|hidden fees)\b/i.test(segment))continue;
 if(r.theme==='price_level'&&polarity==='negative'&&/\b(?:not|isn['’]t|wasn['’]t)\s+(?:very\s+)?expensive\b/i.test(segment))continue;
 return {...base,status:'supported_by_rule',reason:'EXPLICIT_THEME_AND_POLARITY',excerpt:{rule_id:r.id,claim:r.claim,start:unit.start,end:unit.end,quote:unit.text}}
 }}
 const reason=theme==='attentiveness'&&/understand|translator|language|speak English/i.test(text)?'COMMUNICATION_IS_NOT_ATTENTION':theme==='attentiveness'&&/(?:great|excellent|superb|top-notch).{0,25}(?:service|staff)|(?:staff|service).{0,25}(?:excellent|top-notch|superb)/i.test(text)?'GENERIC_SERVICE_IS_NOT_ATTENTION':theme==='location'&&/unassuming|unimpressive|nondescript|not impressive/i.test(text)?'DESCRIPTIVE_LOCATION_IS_NOT_ACCESS':'EXPLICIT_SUPPORT_NOT_ESTABLISHED';
 return {...base,status:'review_needed',reason,excerpt:null}
}
