import {francAll} from 'npm:franc-min@6.2.0'

const aliases:Record<string,string>={iw:'he',in:'id',ji:'yi',english:'en',french:'fr',vietnamese:'vi'}
export function displayLanguage(value:string|null|undefined):string|null{
 const code=value?.trim().toLowerCase().replaceAll('_','-').split('-')[0]??''
 const normalized=aliases[code]??code
 if(!/^[a-z]{2}$/.test(normalized))return null
 try{return new Intl.DisplayNames(['en'],{type:'language'}).of(normalized)===normalized?null:normalized}catch{return null}
}
export function hasDisplayText(text:string){return /[\p{L}\p{N}]/u.test(text)}
/** Statistical disagreement is a reason to verify, never an authoritative replacement. */
export function reliableProviderLanguage(text:string,hint:string|null|undefined,provider:string|null|undefined):string|null{
 const language=displayLanguage(hint)
 if(!language||!['apify','outscraper','detected'].includes(provider??''))return null
 const letters=[...text].filter(c=>/\p{L}/u.test(c)),latin=letters.filter(c=>/\p{Script=Latin}/u.test(c)).length
 if(['fr','vi','en'].includes(language)&&letters.length&&latin/letters.length<0.65)return null
 if(text.length>=45){
  const top=francAll(text)[0],expected:Record<string,string>={fr:'fra',vi:'vie',en:'eng'}
  if(top&&expected[language]&&top[0]!==expected[language]&&top[0]!=='und')return null
 }
 return language
}
