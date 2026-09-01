'use client'

import { Line, LineChart, ResponsiveContainer } from 'recharts'

export default function KpiSparkline({ data, color, label }: {
  data: number[]
  color: string
  label: string
}) {
  const points = data.map((value, index) => ({ index, value }))

  if (points.length < 2) {
    return <div className="h-12 w-28" aria-label={`${label}: histórico insuficiente`} />
  }

  return (
    <div className="h-12 w-28" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 5, right: 3, bottom: 5, left: 3 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
