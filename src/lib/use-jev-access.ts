import { useQuery } from '@tanstack/react-query'
import { jevApi,JEV_EXPERIMENT_ENABLED } from './jev-benchmark'
export function useJevAccess(userId:string|undefined,demoMode=false) {
  return useQuery({queryKey:['jev-access',userId],queryFn:()=>jevApi.access(userId!),enabled:JEV_EXPERIMENT_ENABLED && !!userId && !demoMode,retry:false,staleTime:30_000})
}
