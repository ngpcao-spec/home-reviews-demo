import { BarChart3, MessageSquareWarning, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../app/AppContext'
import { BrandHeader } from '../components/ui/BrandHeader'

export function AnalyticsPage() {
  const { reviews, establishments } = useApp()
  const [period, setPeriod] = useState('30')
  const [establishment, setEstablishment] = useState('all')
  const cutoff = Date.now() - Number(period) * 86_400_000
  const filtered = useMemo(() => reviews.filter((review) =>
    (establishment === 'all' || review.establishmentId === establishment)
    && new Date(review.publishedAt).getTime() >= cutoff),
  [reviews, establishment, cutoff])
  const negative = filtered.filter((review) => review.rating <= 3)
  const distribution = [1, 2, 3].map((value) => ({
    label: `${value} étoile${value > 1 ? 's' : ''}`,
    count: negative.filter((review) => review.rating === value).length,
  }))
  const maxDistribution = Math.max(1, ...distribution.map((item) => item.count))
  const selectedEstablishments = establishment === 'all'
    ? establishments
    : establishments.filter((item) => item.id === establishment)
  const rating = selectedEstablishments.length
    ? selectedEstablishments.reduce((sum, item) => sum + item.currentRating, 0) / selectedEstablishments.length
    : 0
  const chartData = useMemo(() => {
    const grouped = filtered.reduce<Record<string, { total: number; count: number }>>((acc, review) => {
      const day = new Date(review.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      const item = acc[day] ?? { total: 0, count: 0 }
      item.total += review.rating
      item.count += 1
      acc[day] = item
      return acc
    }, {})
    return Object.entries(grouped).map(([day, item]) => ({ day, rating: Number((item.total / item.count).toFixed(2)) })).slice(-12)
  }, [filtered])
  const actionRate = Math.round(filtered.filter((item) => item.status === 'to_process').length / Math.max(1, filtered.length) * 100)

  return <><BrandHeader trailing={<select className="header-period" value={period} onChange={(event)=>setPeriod(event.target.value)} aria-label="Période"><option value="7">7 derniers jours</option><option value="30">30 derniers jours</option><option value="90">90 derniers jours</option></select>}/>
    <section className="reference-intro analytics-intro"><h1>Statistiques</h1><p>Analysez les retours de vos clients.</p></section>
    <div className="analytics-filters"><select value={establishment} onChange={(event)=>setEstablishment(event.target.value)} aria-label="Filtrer par établissement"><option value="all">Tous les établissements</option>{establishments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <section className="chart-card card"><div className="chart-heading"><div><h2>Note des avis reçus</h2></div><div><strong>{rating.toFixed(1)}</strong><small>note Google actuelle</small></div></div><div className="chart-wrap">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={.45}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="rgba(148,163,205,.14)"/><XAxis dataKey="day" tick={{fill:'#aab5d5',fontSize:11}} axisLine={false} tickLine={false}/><YAxis domain={[1,5]} tick={{fill:'#aab5d5',fontSize:11}} axisLine={false} tickLine={false} width={22}/><Tooltip contentStyle={{background:'#171d35',border:'1px solid rgba(148,163,205,.2)',borderRadius:12}}/><Area isAnimationActive={false} type="monotone" dataKey="rating" stroke="#8b5cf6" strokeWidth={3} fill="url(#ratingFill)"/></AreaChart></ResponsiveContainer> : <div className="insufficient">Pas encore assez de données</div>}</div></section>
    <section className="issues-card card"><div><h2>Avis nécessitant une attention</h2></div>{negative.length === 0 ? <div className="insufficient">Aucun avis 1 à 3 étoiles sur cette période</div> : <div className="issue-bars">{distribution.map((item)=><div className="issue-row" key={item.label}><span>{item.label}</span><div><i style={{width:`${item.count / maxDistribution * 100}%`}}/></div><strong>{item.count}</strong></div>)}</div>}</section>
    <div className="analytics-kpis primary-analytics-kpis"><div className="analytics-kpi card negative-card"><MessageSquareWarning/><strong>{negative.length}</strong><span>Avis 1 à 3★</span><small>sur la période</small></div><div className="analytics-kpi card positive-card"><Star/><strong>{rating.toFixed(1)}</strong><span>Note Google</span><small>valeur actuelle</small></div></div>
    <div className="analytics-kpis secondary-analytics-kpis"><div className="analytics-kpi card"><BarChart3/><span>Avis reçus</span><strong>{filtered.length}</strong><em>sur la période</em></div><div className="analytics-kpi card"><SparkRate/><span>À traiter</span><strong>{actionRate}%</strong><em>sur la période</em></div></div>
  </>
}

function SparkRate(){return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>}
