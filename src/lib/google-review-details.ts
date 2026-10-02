import type { PreferredLanguage } from '../types/domain'

export type DetailKey = 'food' | 'service' | 'atmosphere'
export type VisitKey = 'noise' | 'price_per_person' | 'meal_type' | 'group_size'
const clean = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim()
const key = (value: string) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd')
const aliases: Record<DetailKey | VisitKey, string[]> = {
  food: ['food','cuisine','quality','qualité','đồ ăn','thức ăn'],
  service: ['service','dịch vụ'],
  atmosphere: ['atmosphere','ambience','ambiance','bầu không khí','không gian'],
  noise: ['noise','noise level','niveau sonore','niveau de bruit','độ ồn','mức độ ồn'],
  price_per_person: ['price_per_person','price per person','prix par personne','giá mỗi người'],
  meal_type: ['meal_type','meal type','type de repas','loại hình bữa ăn','loại bữa ăn'],
  group_size: ['group_size','group size','taille du groupe','taille de groupe','quy mô nhóm'],
}
const entries = (raw: unknown): [string, unknown][] => raw && typeof raw==='object' && !Array.isArray(raw) ? Object.entries(raw) : []
const matches = (name:string, canonical:DetailKey|VisitKey) => aliases[canonical].some(alias=>key(alias)===key(name))
export const detailLabels = {
  fr: { title:'Notes détaillées',visitTitle:'Informations de visite',food:'Qualité',service:'Service',atmosphere:'Ambiance',noise:'Niveau de bruit',price_per_person:'Prix par personne',meal_type:'Type de repas',group_size:'Taille du groupe' },
  vi: { title:'Điểm chi tiết',visitTitle:'Thông tin trải nghiệm',food:'Đồ ăn',service:'Dịch vụ',atmosphere:'Không gian',noise:'Độ ồn',price_per_person:'Giá mỗi người',meal_type:'Loại bữa ăn',group_size:'Quy mô nhóm' },
}
export function googleSubratings(raw:unknown) {
  return (['food','service','atmosphere'] as const).flatMap(category=>{
    for(const [name,value] of entries(raw)){
      if(!matches(name,category))continue
      const number=typeof value==='number'?value:typeof value==='string' && /^\d(?:[.,]\d+)?(?:\s*\/\s*5)?$/.test(value.trim())?Number(value.split('/')[0].trim().replace(',','.')):NaN
      if(Number.isFinite(number) && number>=1 && number<=5)return [{key:category,value:number}]
    }
    return []
  })
}
// Standard Google options only. Unknown values remain verbatim, never AI-translated.
const options: Partial<Record<VisitKey, {aliases:string[];fr:string;vi:string}[]>> = {
  noise: [
    {aliases:['Ồn ào, nhưng bạn vẫn trò chuyện được','Ồn ào, nhưng vẫn trò chuyện được','Loud, but you can still talk','Bruyant, mais conversation possible'],fr:'Bruyant, mais conversation possible',vi:'Ồn ào, nhưng vẫn trò chuyện được'},
    {aliases:['Yên tĩnh, dễ trò chuyện','Quiet, easy to talk','Calme, conversation facile'],fr:'Calme, conversation facile',vi:'Yên tĩnh, dễ trò chuyện'},
    {aliases:['Moderate noise','Tiếng ồn vừa phải','Độ ồn vừa phải','Bruit modéré'],fr:'Bruit modéré',vi:'Độ ồn vừa phải'},
    {aliases:['Very loud, hard to hear','Rất ồn, khó nghe','Très bruyant, difficile de s’entendre'],fr:'Très bruyant, difficile de s’entendre',vi:'Rất ồn, khó nghe'},
  ],
  meal_type: [
    {aliases:['Bữa tối','Dinner','Dîner'],fr:'Dîner',vi:'Bữa tối'},
    {aliases:['Bữa trưa','Lunch','Déjeuner'],fr:'Déjeuner',vi:'Bữa trưa'},
    {aliases:['Bữa sáng','Breakfast','Petit-déjeuner'],fr:'Petit-déjeuner',vi:'Bữa sáng'},
    {aliases:['Bữa nửa buổi','Brunch'],fr:'Brunch',vi:'Bữa nửa buổi'},
  ],
  group_size: [
    {aliases:['Phù hợp với mọi quy mô nhóm','Mọi quy mô nhóm','Suitable for all group sizes','All group sizes','Adapté à tous les groupes'],fr:'Adapté à tous les groupes',vi:'Mọi quy mô nhóm'},
  ],
}
export function visitValue(category:VisitKey,raw:string,language:PreferredLanguage){
  const value=clean(raw)
  if(category==='price_per_person'){
    // Only the explicit Vietnamese N (nghìn) + đồng format; no conversion/arithmetic.
    const price=/^(\d+)(?:\s*[-–]\s*(\d+))?\s*N\s*₫$/u.exec(value)
    if(price)return price[1]+(price[2]?'–'+price[2]:'')+' k₫'
  }
  const standard=options[category]?.find(option=>option.aliases.some(alias=>key(alias)===key(value)))
  return standard?.[language] ?? value
}
export function googleVisitInfo(raw:unknown,language:PreferredLanguage){
  return (['noise','price_per_person','meal_type','group_size'] as const).flatMap(category=>{
    const found=entries(raw).find(([name,value])=>matches(name,category)&&typeof value==='string'&&clean(value)!=='')
    return found ? [{key:category,value:visitValue(category,found[1] as string,language)}] : []
  })
}
