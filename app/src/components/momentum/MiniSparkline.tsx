interface Props { prices: number[] }

export function MiniSparkline({ prices }: Props) {
  if (prices.length < 2) {
    return <div className="w-[60px] h-[24px] flex items-center"><div className="w-full h-px bg-slate-600" /></div>
  }
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const w = 60, h = 24
  const pts = prices.map((v, i) => {
    const x = (i / (prices.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const isUp = prices[prices.length - 1] >= prices[0]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={isUp ? '#10b981' : '#ef4444'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
