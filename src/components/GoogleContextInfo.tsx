import type { Axis } from '../../supabase/functions/_shared/consultant-contract'
import type { StructuredContextStats } from '../../supabase/functions/_shared/structured-review-context'

export function GoogleContextInfo({stats,axis,language}:{stats?:StructuredContextStats;axis:Axis;language:'fr'|'vi'}) {
  if(!stats) return null
  const fr=language==='fr'
  let title='',items:{value:string;count:number}[]=[]
  if(axis==='atmosphere') {
    title=fr?'Niveau sonore':'Độ ồn'
    items=[
      {value:fr?'Calme / conversation facile':'Yên tĩnh / dễ trò chuyện',count:stats.noise.quiet},
      {value:fr?'Modéré':'Ồn ào ở mức vừa phải',count:stats.noise.moderate},
      {value:fr?'Bruyant, mais conversation possible':'Ồn ào, nhưng vẫn trò chuyện được',count:stats.noise.noisy_conversation_possible},
      {value:fr?'Autre niveau renseigné':'Mức khác được ghi nhận',count:stats.noise.unknown},
    ]
  } else if(axis==='service') {
    title=fr?'Temps d’attente':'Thời gian chờ'
    items=[{value:fr?'Sans attente':'Không phải chờ',count:stats.wait_time.no_wait},
      {value:fr?'≤ 10 min':'≤ 10 phút',count:stats.wait_time.under_10_min},{value:fr?'10–30 min':'10–30 phút',count:stats.wait_time.from_10_to_30_min},
      {value:fr?'30–60 min':'30–60 phút',count:stats.wait_time.from_30_to_60_min},{value:fr?'> 60 min':'> 60 phút',count:stats.wait_time.over_60_min},
      {value:fr?'Autre durée renseignée':'Thời gian khác được ghi nhận',count:stats.wait_time.unknown}]
  } else if(axis==='price') {
    title=fr?'Prix par personne — principales tranches renseignées':'Giá mỗi người — các khoảng giá phổ biến'
    items=stats.price_per_person.ranges.slice(0,3)
  }
  items=items.filter(item=>item.count>0)
  if(!items.length) return null
  return <aside className="v6-google-context" data-context-axis={axis}>
    <h3>{fr?'Informations Google':'Thông tin Google'}</h3><p>{title}</p>
    <ul>{items.map(item=><li key={item.value}><span>{item.value}</span><span>{item.count}</span></li>)}</ul>
    <small>{fr?'Données descriptives des visites, sans jugement positif ou négatif.':'Thông tin mô tả trải nghiệm, không phải nhận xét tích cực hay tiêu cực.'}</small>
  </aside>
}
