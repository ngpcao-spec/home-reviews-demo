import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {useApp} from '../../app/AppContext'
import {useI18n} from '../../i18n'
import {supabase} from '../../lib/supabase'
import {readReviewDisplay,type ReviewDisplay} from '../../lib/review-display'
import type {Review} from '../../types/domain'
type Props={review:Review;quote?:boolean;linkTo?:string;toggle?:boolean}
export function ReviewDisplayText(props:Props){
 const {language}=useI18n(),{currentUser,demoMode}=useApp(),account=currentUser?.id??''
 return <DisplayContent key={`${account}:${language}:${props.review.originalText??props.review.reviewText}`} {...props} account={account} live={Boolean(supabase&&account&&!demoMode)}/>
}
function DisplayContent({review,quote,linkTo,toggle=true,account,live}:Props&{account:string;live:boolean}){
 const {language,messages}=useI18n(),root=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(typeof IntersectionObserver==='undefined'),[data,setData]=useState<ReviewDisplay|null>(null),[unavailable,setUnavailable]=useState(false),[showOriginal,setShowOriginal]=useState(false)
 const original=review.originalText??review.reviewText,hasText=/[\p{L}\p{N}]/u.test(original)
 useEffect(()=>{
  if(typeof IntersectionObserver==='undefined')return
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:'200px'})
  if(root.current)observer.observe(root.current)
  return()=>observer.disconnect()
 },[])
 useEffect(()=>{
  if(!live||!visible||!hasText)return
  let active=true,timer:ReturnType<typeof setTimeout>|undefined
  const read=async()=>{
   try{
    const result=await readReviewDisplay(account,language,review.id)
    if(!active)return
    // Never display a result for another revision, even if the account changes mid-request.
    if(result.original_text!==original){setUnavailable(true);return}
    setData(result);setUnavailable(false)
    if(['queued','processing'].includes(result.status))timer=setTimeout(()=>void read(),3000)
   }catch{if(active)setUnavailable(true)}
  }
  void read()
  return()=>{active=false;if(timer)clearTimeout(timer)}
 },[live,visible,hasText,account,language,review.id,original])
 const translated=live?(data?.status==='translated'?data.translated_text:undefined):review.translatedText
 const isTranslated=Boolean(hasText&&translated&&translated!==original)
 const text=showOriginal?original:isTranslated?translated:live?original:review.reviewText.trim()?review.reviewText:original
 const body=quote?<blockquote>{text}</blockquote>:<p>{text}</p>
 const status=hasText&&live&&!isTranslated&&data?.status!=='original'?(unavailable||['missing','failed','unknown'].includes(data?.status??'')?messages.reviews.displayTranslationUnavailable:messages.reviews.displayTranslationPending):null
 return <div ref={root} className="review-display-text">
  {linkTo?<Link className="review-open" to={linkTo}>{body}</Link>:body}
  {isTranslated&&<small className="review-translation-status">{showOriginal?messages.reviews.original:messages.reviews.displayTranslated}</small>}
  {status&&<small className="review-translation-status" role="status">{status}</small>}
  {isTranslated&&toggle&&<button type="button" className="text-button" onClick={()=>setShowOriginal(v=>!v)}>{showOriginal?messages.reviews.viewTranslation:messages.reviews.viewOriginal}</button>}
 </div>
}
