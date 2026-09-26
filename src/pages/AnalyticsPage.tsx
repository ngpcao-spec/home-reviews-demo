import { BarChart3, MessageSquareWarning, Star, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../app/AppContext'
import { BrandHeader } from '../components/ui/BrandHeader'
import { ratingTrend } from '../data/mock-data'
import { categoryLabels } from '../lib/review-rules'
import type { Category } from '../types/domain'

export function AnalyticsPage() {
  const { reviews, establishments } = useApp(); const [period,setPeriod]=useState('30'); const [establishment,setEstablishment]=useState('all')
  const filtered = reviews.filter((review)=>establishment==='all'||review.establishmentId===establishment)
  const negative = filtered.filter((review)=>review.rating<=3)
  const categories = Object.entries(negative.reduce<Record<string,number>>((acc,review)=>{ const category=review.analysis?.primaryCategory;if(category)acc[category]=(acc[category]??0)+1;return acc},{})).sort((a,b)=>b[1]-a[1])
  const rating = establishment==='all' ? establishments.reduce((sum,item)=>sum+item.currentRating,0)/establishments.length : establishments.find((item)=>item.id===establishment)?.currentRating??0
  return <><BrandHeader trailing={<select className="header-period" value={period} onChange={(e)=>setPeriod(e.target.value)} aria-label="Période"><option value="7">7 derniers jours</option><option value="30">30 derniers jours</option><option value="90">90 derniers jours</option></select>}/>
    <section className="reference-intro analytics-intro"><h1>Statistiques</h1><p>Analysez les retours de vos clients.</p></section>
    <div className="analytics-filters"><select value={establishment} onChange={(e)=>setEstablishment(e.target.value)} aria-label="Filtrer par établissement"><option value="all">Tous les établissements</option>{establishments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <section className="chart-card card"><div className="chart-heading"><div><h2>Évolution de la note moyenne</h2></div><div><strong>{rating.toFixed(1)}</strong><em><TrendingUp/>+0,3</em><small>vs. période précédente</small></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={ratingTrend}><defs><linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={.45}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="rgba(148,163,205,.14)"/><XAxis dataKey="day" tick={{fill:'#aab5d5',fontSize:11}} axisLine={false} tickLine={false}/><YAxis domain={[1,5]} tick={{fill:'#aab5d5',fontSize:11}} axisLine={false} tickLine={false} width={22}/><Tooltip contentStyle={{background:'#171d35',border:'1px solid rgba(148,163,205,.2)',borderRadius:12}}/><Area isAnimationActive={false} type="monotone" dataKey="rating" stroke="#8b5cf6" strokeWidth={3} fill="url(#ratingFill)"/></AreaChart></ResponsiveContainer></div></section>
    <section className="issues-card card"><div><h2>Répartition des problèmes récurrents</h2></div>{categories.length<2?<div className="insufficient">Pas encore assez de données</div>:<div className="issue-bars">{categories.slice(0,6).map(([category,count])=><div className="issue-row" key={category}><span>{categoryLabels[category as Category]}</span><div><i style={{width:`${count/categories[0][1]*100}%`}}/></div><strong>{Math.round(count/Math.max(1,negative.length)*100)}%</strong></div>)}</div>}</section>
    <div className="analytics-kpis primary-analytics-kpis"><div className="analytics-kpi card negative-card"><MessageSquareWarning/><strong>{negative.length}</strong><span>Avis négatifs</span><em className="negative"><TrendingDown/>-25%</em><small>vs. période précédente</small></div><div className="analytics-kpi card positive-card"><Star/><strong>{rating.toFixed(1)}</strong><span>Note moyenne</span><em className="positive"><TrendingUp/>+0,3</em><small>vs. période précédente</small></div></div>
    <div className="analytics-kpis secondary-analytics-kpis"><div className="analytics-kpi card"><BarChart3/><span>Total avis</span><strong>{filtered.length}</strong><em className="positive"><TrendingUp/>+8%</em></div><div className="analytics-kpi card"><SparkRate/><span>Taux d’action</span><strong>{Math.round(filtered.filter((item)=>item.requiresAction).length/Math.max(1,filtered.length)*100)}%</strong><em>sur la période</em></div></div>
  </>
}

function SparkRate(){return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>}
