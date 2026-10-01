import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, MessageSquareText, Star } from 'lucide-react'
import { ExecutiveSummary } from './ExecutiveSummary'
import { useI18n } from '../i18n'
import { supabase } from '../lib/supabase'
import type { HistoricalReport, ReputationTheme } from '../lib/historical-report'
import './ReputationReport.css'

interface Example { id: string; rating: number; original_text: string | null; text: string | null; author_name: string; published_at: string | null; review_translations: {language:string;translated_text:string}[] }

export function ReputationReport({ report }: {report: HistoricalReport}) {
  const { messages, language } = useI18n()
  const m = messages.reputation
  const data = report.reputation
  const ids = [...(data?.representative_positive_review_ids ?? []).slice(0,3),...(data?.representative_attention_review_ids ?? []).slice(0,3)]
  const idsKey = ids.join(',')
  const { data: examples = [], isError: examplesError, isFetching: examplesLoading } = useQuery({
    queryKey: ['reputation-examples', report.establishmentId, idsKey],
    enabled: Boolean(idsKey && supabase),
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase!.from('reviews')
        .select('id,rating,original_text,text,author_name,published_at,review_translations(language,translated_text)')
        .eq('establishment_id', report.establishmentId).in('id', idsKey.split(','))
      if (error) throw error
      return (rows ?? []) as Example[]
    },
  })
  if (!data) return <p className="card reputation-upgrade">{m.upgrade}</p>
  const number = (n: number | null, digits=1) => n === null ? '—' : Number(n).toLocaleString(language==='vi'?'vi-VN':'fr-FR',{maximumFractionDigits:digits})
  const heading = (n:string,title:string) => <div className="weekly-section-heading"><span className="eyebrow">{n}</span><h2>{title}</h2></div>
  const themes = (items:ReputationTheme[], empty=m.noTheme) => items.length ? <ul className="reputation-themes">{items.map(t=><li key={t.theme_key}><span>{language==='vi'?t.label_vi:t.label_fr}</span><b>{m.mentions.replace('{count}',number(t.mentions,0))}</b></li>)}</ul> : <p className="reputation-muted">{empty}</p>
  const exampleCards = (selectedIds:string[]) => <div className="reputation-examples">
    {examplesLoading && !examples.length ? <p>{messages.common.loading}</p> : examplesError && !examples.length ? <p role="alert">{m.examplesFailed}</p> : !selectedIds.some(id=>examples.some(review=>review.id===id)) ? <p>{m.noExample}</p> : selectedIds.map(id=>{
      const review=examples.find(r=>r.id===id)
      if (!review) return null
      const translated=review.review_translations.find(t=>t.language===language)?.translated_text
      return <Link className="card reputation-example" key={id} to={`/avis/${id}`}>
        <strong>{review.rating} ★</strong><p>{translated || review.original_text || review.text}</p>
        {!translated && <small>{m.untranslated}</small>}
        <footer><span>{review.author_name}</span><time>{review.published_at?new Date(review.published_at).toLocaleDateString(language==='vi'?'vi-VN':'fr-FR',{timeZone:'Asia/Ho_Chi_Minh'}):'—'}</time></footer>
      </Link>
    })}
  </div>
  return <>
    <section className="weekly-section">{heading('01',messages.analytics.overview)}<div className="weekly-kpis">
      <article className="weekly-kpi card"><MessageSquareText/><strong>{number(data.sample_reviews_count,0)}</strong><span>{m.analyzed}</span></article>
      <article className="weekly-kpi card"><Star/><strong>{number(data.sample_average_rating)} ★</strong><span>{m.sampleRating}</span></article>
      <article className="weekly-kpi card"><span className="weekly-percent">%</span><strong>{number(data.positive_rate)} %</strong><span>{m.positive}</span></article>
      <article className="weekly-kpi card reputation-attention"><AlertTriangle/><strong>{number(data.attention_reviews_count,0)}</strong><span>{m.attention}</span></article>
    </div></section>
    <section className="weekly-section">{heading('02',messages.analytics.starDistribution)}<article className="historical-rating-card card">
      {([5,4,3,2,1] as const).map(rating=>{
        const count=report.ratingCounts[rating], percentage=data.sample_reviews_count?count/data.sample_reviews_count*100:0
        return <div className="historical-rating-row reputation-rating-row" key={rating}><strong>{rating}★</strong><span className="historical-rating-track"><i style={{width:`${percentage}%`}}/></span><b>{count}</b><small>{number(percentage)} %</small></div>
      })}
    </article></section>
    <section className="weekly-section">{heading('03',m.summary)}<ExecutiveSummary key={`${report.establishmentId}:${language}`} report={report}/></section>
    <section className="weekly-section">{heading('04',`${m.food} · ${m.service} · ${m.atmosphere}`)}<div className="reputation-categories">
      {(['food','service','atmosphere'] as const).map(category=><article className="card reputation-category" key={category}>
        <h3>{m[category]}</h3><strong className="reputation-score">{number(data[`${category}_average`],2)} / 5</strong>
        <p className="reputation-muted">{data[`${category}_review_count`] ? m.evaluations.replace('{count}',number(data[`${category}_review_count`],0)).replace('{total}',number(data.sample_reviews_count,0)) : m.noSubrating}</p>
        <h4>👍 {m.liked}</h4>{themes(data.positive_themes.filter(t=>t.category===category).slice(0,3))}
        <h4>⚠ {m.watch}</h4>{themes(data.negative_themes.filter(t=>t.category===category).slice(0,3))}
      </article>)}
    </div></section>
    <section className="weekly-section">{heading('05',m.strengths)}<article className="card reputation-theme-card">{themes(data.positive_themes.slice(0,5),m.noStrength)}<small>{m.themeNote}</small></article></section>
    <section className="weekly-section">{heading('06',m.weaknesses)}<article className="card reputation-theme-card">{themes(data.negative_themes.slice(0,5),m.noWatch)}</article></section>
    <section className="weekly-section">{heading('07',m.positiveExamples)}{exampleCards(data.representative_positive_review_ids.slice(0,3))}</section>
    <section className="weekly-section">{heading('08',m.attentionExamples)}{exampleCards(data.representative_attention_review_ids.slice(0,3))}</section>
    <section className="weekly-section">{heading('09',m.replies)}<article className="card reputation-theme-card"><dl className="reputation-replies">
      <div><dt>{m.attention}</dt><dd>{data.attention_reviews_count}</dd></div><div><dt>{m.ready}</dt><dd>{report.readyRepliesCount}</dd></div>
      <div><dt>{m.processed}</dt><dd>{data.processed_reviews_count}</dd></div><div><dt>{m.remaining}</dt><dd>{data.remaining_replies_count}</dd></div>
    </dl><small>{m.remainingNote}</small></article></section>
  </>
}
