export const BENCHMARK_TYPES = ['axes_phase1','themes_phase2','themes_phase2b_service'] as const
export type BenchmarkType = typeof BENCHMARK_TYPES[number]
export function benchmarkType(value:unknown):BenchmarkType {
  if(value===undefined || value===null)return 'axes_phase1'
  if(value!=='axes_phase1' && value!=='themes_phase2' && value!=='themes_phase2b_service')throw new Error('INVALID_BENCHMARK_TYPE')
  return value
}
