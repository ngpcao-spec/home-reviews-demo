import type { Statistics } from '../../src/lib/restaurant-statistics'

// Presentation-only synthetic fixture reproducing the reported sparse shape.
// No provider run, personal review data, or production connection.
export function sparseChart(data: Statistics): Statistics {
  return { ...data, start_date: '2026-08-19', end_date: '2026-11-19', bucket: 'week',
    metrics: { count: 78, average: 4.7435897436, low_count: 6, low_percent: 100 * 6 / 78 },
    distribution: [71, 1, 1, 3, 2].map((count, i) => ({ rating: 5 - i, count })),
    series: [
      {date:'2026-08-17',count:16,average:5}, {date:'2026-08-24',count:24,average:5},
      {date:'2026-08-31',count:6,average:4.5}, {date:'2026-09-07',count:8,average:5},
      {date:'2026-09-14',count:5,average:4}, {date:'2026-09-21',count:5,average:4.6},
      {date:'2026-09-28',count:4,average:5}, {date:'2026-10-19',count:1,average:2},
      {date:'2026-10-26',count:7,average:5}, {date:'2026-11-09',count:2,average:1.5},
    ],
  }
}

// Explicit presentation scenarios requested for review, not current restaurant
// figures. Both means are exactly five without altering any production data.
export function greenHomeChart(data: Statistics): Statistics {
  return { ...data, start_date: '2026-05-19', end_date: '2026-11-19', bucket: 'month',
    metrics: { count: 30, average: 5, low_count: 0, low_percent: 0 },
    distribution: [30, 0, 0, 0, 0].map((count, i) => ({ rating: 5 - i, count })),
    series: [{ date: '2026-10-01', count: 10, average: 5 }, { date: '2026-11-01', count: 20, average: 5 }],
  }
}
