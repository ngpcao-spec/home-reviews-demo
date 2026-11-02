import type {Category,Citation,Request} from './restaurant-recommendation-engine-v1.ts';

export type FeaturePreference={feature:string;expected:boolean;source:'structured'|'text_hint'};
export type ShortlistPreferences={features:FeaturePreference[];categories:Category[];avoidRepeatedCooking:boolean;
  text_status:'absent'|'partial'|'uninterpreted';suppressed:string[];active:boolean};
const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[’']/g,' ').replace(/[_-]/g,' ').replace(/\s+/g,' ').trim();
const phrases:Record<string,string[]>={
  quiet:['calme','yen tinh','quiet'],live_music:['musique en direct','nhac song','live music'],
  family_friendly:['en famille','gia dinh','family friendly'],kids:['pour les enfants','tre em','child friendly'],
  vegan_options:['vegetalien','vegetalienne','thuan chay','vegan'],vegetarian_options:['vegetarien','vegetarienne','chay','vegetarian'],
  outdoor_seating:['terrasse','ngoai troi','outdoor seating'],air_conditioning:['climatisation','may lanh','dieu hoa','air conditioning'],
  wheelchair_entrance:['entree accessible en fauteuil','loi vao cho xe lan','wheelchair entrance'],
};
const categoryPhrases:Record<Category,RegExp>={quality:/\b(?:qualite des plats|mon an ngon|chat luong mon|food quality)\b/,
  service:/\b(?:service|phuc vu|nhan vien)\b/,ambiance:/\b(?:ambiance|khong gian|atmosphere)\b/};
const abstention=/\b(?:pas forcement|pas necessairement|pas (?:une )?priorite|pas indispensable|pas besoin|ne cherche pas|ne recherche pas|khong can|khong nhat thiet|not necessarily|not required|do not need|don t need)\b/;
const conditional=/\b(?:si|sinon|a condition|sauf|a moins|neu|khi|if|unless|otherwise|avant|apres|before|after|weekends?|cuoi tuan|en semaine|ngay thuong)\b/;
const ambiguousNegation=/\b(?:pas sans|pas eviter|ne pas eviter|not without|not avoid|khong tranh)\b/;
const negativeBefore=/\b(?:sans|pas(?: de| la| le| les)?|aucun\w*|eviter(?: la| le| les)?|ni|tranh|khong muon(?: co)?|khong co|without|no|avoid|nor)\s+$/;
const negation=/\b(?:pas|non|sans|aucun\w*|ni|evit\w*|khong|chua|tranh|not|without|no|avoid|nor)\b/;
// Vietnamese nouns "không gian" / "không khí" are not a negation or a "when" clause.
const syntax=(s:string)=>s.replace(/\bkhong (?:gian|khi)\b/g,'space');
const hasNegation=(s:string)=>negation.test(syntax(s));
const cooking=/\b(?:cuisson|cuit\w*|chin|nau nuong|che bien|cooking|undercooked|overcooked)\b/;
const repetition=/\b(?:recurrent\w*|repet\w*|lap lai|recurring|repeated|visites? differentes|different visits|cac lan (?:ghe|den) khac nhau)\b/;
const avoidNoise=/\b(?:eviter (?:le |les )?bruit\w*|sans bruit|tranh tieng on|khong muon (?:co )?tieng on|avoid (?:the )?noise|without noise)\b/;
const has=(s:string,p:string)=>new RegExp('\\b'+p+'\\b').test(s);

/** Optional hints only. Never infer a hard constraint, dates, prices or an opposite
 * property. Keep the entire free text for the final AI; never log/copy it here. */
export function shortlistPreferences(request:Request,text=''):ShortlistPreferences {
  const features:FeaturePreference[]=(request.preferences?.features??[]).map(feature=>({feature,expected:true,source:'structured'}));
  const categories=[...new Set(request.preferences?.categories??[])],suppressed=new Set<string>();
  let avoidRepeatedCooking=false,hints=0;
  const input=key(text),conditionalText=conditional.test(syntax(input));
  for(const clause of text.split(/[;.!?,\n]+/).map(key).flatMap(x=>x.split(/\b(?:mais|nhung|but|et|va|and)\b/)).map(x=>x.trim()).filter(Boolean)){
    const uncertain=abstention.test(clause)||conditionalText||ambiguousNegation.test(clause);
    for(const [feature,aliases]of Object.entries(phrases)){
      const phrase=aliases.find(p=>has(clause,p));if(!phrase)continue;
      if(feature==='vegetarian_options'&&phrase==='chay'&&has(clause,'thuan chay'))continue;
      if(uncertain){suppressed.add(feature);continue;}
      const position=clause.indexOf(phrase),negative=negativeBefore.test(clause.slice(0,position));
      const trailingNegation=/^\s+(?:n est|ne sont|is|are|khong|chua)\b/.test(clause.slice(position+phrase.length));
      if(trailingNegation||hasNegation(clause.slice(0,position))&&!negative){suppressed.add(feature);continue;}
      // "Not looking for quiet" is abstention, not a request for noise.
      if(negative&&feature==='quiet'){suppressed.add(feature);continue;}
      const previous=features.find(f=>f.feature===feature);
      if(previous?.source==='text_hint'&&previous.expected===negative){suppressed.add(feature);continue;}
      if(!previous){features.push({feature,expected:!negative,source:'text_hint'});hints++;}
    }
    if(!uncertain){
      const noise=avoidNoise.exec(clause);
      if(noise){
        if(hasNegation(clause.slice(0,noise.index)))suppressed.add('quiet');
        else if(!features.some(f=>f.feature==='quiet')){features.push({feature:'quiet',expected:true,source:'text_hint'});hints++;}
      }
      for(const category of ['quality','service','ambiance'] as const)if(categoryPhrases[category].test(clause)
        &&!hasNegation(clause)&&!categories.includes(category)){categories.push(category);hints++;}
      if(cooking.test(clause)&&repetition.test(clause)
        &&/\b(?:evit\w*|aucun\w*|sans|pas de|tranh|khong muon|khong co|avoid|no)\b/.test(clause)){avoidRepeatedCooking=true;hints++;}
    }
  }
  return {features:features.filter(f=>f.source==='structured'||!suppressed.has(f.feature)),categories,avoidRepeatedCooking,text_status:!input?'absent':hints?'partial':'uninterpreted',suppressed:[...suppressed].sort(),
    active:!!input||features.length>0||categories.length>0};
}

/** Evidence verification only. These canonical aliases NEVER feed preselection.
 * A recognized subject must not erase an extra qualifier (heated, babies, etc.). */
export const preferenceProofText=(text:string)=>key(text)
 .replace(/\b(?:en )?(?:familles?|familial|familiaux|familiales?)\b/g,'family friendly')
 .replace(/\b(?:(?:pour les|aux) )?enfants?\b/g,'child friendly')
 .replace(/\b(?:a l |en )?exterieurs?\b|\b(?:en )?terrasses?\b/g,'outdoor seating');
export function boundedPreferenceClause(text:string,subject:string):boolean{
 let rest=preferenceProofText(text),matched=false;
 const feature=subject.startsWith('feature_')?subject.slice(8):null,category=subject.startsWith('category_')?subject.slice(9) as Category:null;
 if(feature)for(const phrase of phrases[feature]??[]){const pattern=new RegExp('\\b'+phrase+'\\b','g');if(pattern.test(rest)){matched=true;rest=rest.replace(pattern,' ');}}
 else if(category&&categoryPhrases[category]){matched=categoryPhrases[category].test(rest);rest=rest.replace(categoryPhrases[category],' ');}
 if(!matched)return false;
 // Another independently recognizable subject may share the clause (notably VI
 // "gia đình ở ngoài trời"). It does not become proof for this criterion; its
 // own quote/evidence/binding is still separate. Unknown qualifiers remain below.
 for(const aliases of Object.values(phrases))for(const phrase of aliases)rest=rest.replace(new RegExp('\\b'+phrase+'\\b','g'),' ');
 for(const pattern of Object.values(categoryPhrases))rest=rest.replace(pattern,' ');
 // Generic suitability/seating wording, not a new property. Leave concrete
 // qualifiers (heating, supervision, babies, menus, times, etc.) unverified.
 rest=rest.replace(/\b(?:adapte|adaptes|adaptee|adaptees|phu hop|cho ngoi)\b/g,' ');
 rest=rest.replace(/\b(?:je|cherche|souhaite|voudrais|un|une|des|le|la|les|de|du|en|au|aux|avec|pour|a|l|d|lieu|endroit|restaurant|repas|cadre|sans|pas|aucun|aucune|eviter|ni|tôi|toi|tim|mong|muon|mot|noi|quan|nha|hang|bua|an|dung|voi|o|khong|co|tranh|a|the|place|restaurant|meal|with|for|no|without|avoid)\b/g,' ').replace(/[\s.!?,;:]+/g,'');
 return rest.length===0;
}

export type CookingConcern={status:'reported_repetition'|'not_established'|'unknown';citations:Citation[]};
/** Attributed report wording, never an incident count or an independently verified
 * safety verdict. No evidence cardinality, stars, length or raw reviews are used. */
export function repeatedCookingConcern(reservations:Citation[]):CookingConcern {
  const isCooking=(s:string)=>cooking.test(key(s))||/\btái\b|\bsống\b/iu.test(s);
  const relevant=reservations.filter(c=>c.category==='quality'&&isCooking(c.text));
  const unproven=(s:string)=>/(?:\b(?:ne|n)\b.*\bpas\b.*\b(?:repet\w*|meme defaut|recurrent)|\b(?:aucun\w*|pas de|absence de)\b.*\b(?:repet\w*|recurrent)|\b(?:repetition|recurrence|recurrent\w*)\s+(?:n est pas|non|inconnue|incertain|not established|not confirmed)(?:\s+(?:etabli\w*|confirm\w*|prouve\w*|demontre\w*))?\b|\b(?:chua|khong)\s+(?:co\s+)?(?:duoc\s+)?(?:xac nhan|chung minh|ghi nhan|du lieu|bang chung|co so)\b.*\b(?:lap lai|cac lan)\b|\bkhong co\b.*\b(?:loi|van de|phan anh)\b.*\blap lai\b|\bdoes not prove\b.*\b(?:recurrence|repetition)|\b(?:un seul|meme|single|same) incident\b|\bcung mot su co\b)/.test(key(s));
  const repeated=relevant.filter(c=>{
    if(unproven(c.text))return false;
    return c.text.split(/[;.!?\n]+/).some(clause=>isCooking(clause)&&repetition.test(key(clause))
      &&/\b(?:signal\w*|rapport\w*|decriv\w*|reported|report\w*|phan anh|ghi nhan)\b/.test(key(clause)));
  });
  if(repeated.length)return {status:'reported_repetition',citations:repeated};
  return {status:relevant.some(c=>unproven(c.text))?'not_established':'unknown',citations:relevant};
}
