import { Volume2 } from 'lucide-react'
import type { PreferredLanguage } from '../../types/domain'
import { detailLabels,googleSubratings,googleVisitInfo } from '../../lib/google-review-details'
import './GoogleReviewDetails.css'

export function GoogleReviewDetails({ratings,context,language}:{ratings:unknown;context:unknown;language:PreferredLanguage}){
  const scores=googleSubratings(ratings),visit=googleVisitInfo(context,language),labels=detailLabels[language]
  return <>
    {scores.length>0 && <section className="google-review-details card" aria-labelledby="google-detail-heading">
      <h2 id="google-detail-heading">{labels.title}</h2>
      <dl className="google-subratings">{scores.map(score=><div key={score.key}>
        <dt>{labels[score.key]}</dt><dd>{score.value.toLocaleString(language==='vi'?'vi-VN':'fr-FR')} <span aria-hidden="true">★</span></dd>
      </div>)}</dl>
    </section>}
    {visit.length>0 && <section className="google-review-details card" aria-labelledby="google-visit-heading">
      <h2 id="google-visit-heading">{labels.visitTitle}</h2>
      <dl className="google-visit-info">{visit.map(item=><div key={item.key} className={item.key==='noise'?'google-visit-noise':undefined}>
        <dt>{item.key==='noise' && <Volume2 size={16} aria-hidden="true"/>}{labels[item.key]}</dt><dd>{item.value}</dd>
      </div>)}</dl>
    </section>}
  </>
}
