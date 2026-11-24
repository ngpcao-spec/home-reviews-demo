import {supabase} from './supabase'
export type DishName={id:string;name:string;parentId:string|null}
export type DishEvidence={runId?:string;sourceRow?:number;name?:string;section?:string;restaurantName?:string;photo?:string;collectedAt?:string;reason?:string}
export type DishAssociation=DishName & {parentName:string|null;status:'proposed'|'confirmed';origin:'automatic'|'manual';evidence:DishEvidence[]}
export type DishProfile={revision:number;shared:boolean;canEdit:boolean;specialty:{id:string;name:string;status:'proposed'|'confirmed';origin:'automatic'|'manual';evidence:unknown}|null;associations:DishAssociation[];unresolved:{name:string;section:string;sourceRow:number;runId:string;reason:string}[]}
export type DishMatch={establishmentId:string;name:string;dish:string;kind:'specialty'|'menu';status:'proposed'|'confirmed'}
export async function dishRpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
 if(!supabase)throw Error('DISH_UNAVAILABLE')
 const {data,error}=await supabase.rpc(name,args)
 if(error)throw Error(error.message.includes('DISH_CONFLICT')?'DISH_CONFLICT':'DISH_UNAVAILABLE')
 return data as T
}
export const readDishes=(id:string)=>dishRpc<DishProfile>('read_restaurant_dishes',{p_establishment:id})
export const searchDishes=(q:string)=>dishRpc<DishMatch[]>('search_restaurants_by_dish',{p_query:q})
