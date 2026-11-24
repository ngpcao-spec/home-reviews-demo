import {useEffect,useState} from 'react'
import {searchDishes,type DishMatch} from './restaurant-dishes'
export function useDishSearch(query:string,scope:string){
 const [state,setState]=useState<{key:string;matches:DishMatch[];error:boolean}>(),[retry,setRetry]=useState(0)
 const key=scope+'\n'+query.trim()
 useEffect(()=>{
  if(!query.trim())return
  let gone=false
  const timer=window.setTimeout(()=>{void searchDishes(query.trim()).then(matches=>{if(!gone)setState({key,matches,error:false})}).catch(()=>{if(!gone)setState({key,matches:[],error:true})})},200)
  return()=>{gone=true;window.clearTimeout(timer)}
 },[key,query,retry])
 return {matches:state?.key===key?state.matches:[],error:state?.key===key&&state.error,loading:!!query.trim()&&state?.key!==key,retry:()=>setRetry(n=>n+1)}
}
