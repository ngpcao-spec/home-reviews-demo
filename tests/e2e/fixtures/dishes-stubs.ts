const params=new URLSearchParams(location.search)
export const lang=params.get('language')==='vi'?'vi':'fr',user=params.get('user')==='b'?'b':'a'
export const banhId=user==='b'?'30000000-0000-4000-8000-000000000002':'30000000-0000-4000-8000-000000000001'
export const supabase={rpc:async(name:string,args:unknown)=>{
 const r=await fetch('/__dishes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,user})});return r.json()
},functions:{invoke:async()=>({data:{job:null,result:null,canStart:false},error:null})}}
export function useApp(){return {reviews:[],establishments:[
 {id:banhId,name:'Tiệm Bánh Căn Tháng Năm',currentRating:4.3,currentReviewCount:150,city:'Nha Trang',address:'32 Cửu Long',category:'Restaurant',syncStatus:'ok',lastSyncedAt:'2026-11-24T09:00:00Z',nextSyncAt:'2026-11-24T15:00:00Z'},
 ...(user==='a'?[{id:'30000000-0000-4000-8000-000000000003',name:'Phở générique — test',currentRating:4.5,currentReviewCount:150,city:'Nha Trang',category:'Restaurant'},{id:'30000000-0000-4000-8000-000000000004',name:'Bistro Phở gà — test',currentRating:4.5,currentReviewCount:150,city:'Nha Trang',category:'Restaurant'}]:[])],notifications:[],toasts:[],demoMode:false,preferredLanguage:lang,currentUser:{id:user,initials:lang.toUpperCase()},refreshInitialImports:async()=>{},reloadEstablishmentReviews:async()=>{throw Error('PAID_OPERATIONS_DISABLED')},removeEstablishment:async()=>{throw Error('NOT_PART_OF_TEST')}}}
