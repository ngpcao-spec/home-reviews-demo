import {it,expect} from 'vitest'
import {adjacentBuckets} from '../../src/lib/restaurant-statistics'
it('joins only adjacent real weeks and months, including year boundaries',()=>{
 expect(adjacentBuckets('2026-11-02','2026-11-09','week')).toBe(true)
 expect(adjacentBuckets('2026-11-02','2026-11-16','week')).toBe(false)
 expect(adjacentBuckets('2026-12-28','2027-01-04','week')).toBe(true)
 expect(adjacentBuckets('2026-12-01','2027-01-01','month')).toBe(true)
 expect(adjacentBuckets('2026-12-01','2027-02-01','month')).toBe(false)
})
