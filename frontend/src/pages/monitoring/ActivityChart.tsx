import { useMemo } from 'react';
import { Empty } from 'antd';

import { Sparkline } from '@/components/viz';

import { asNumber, compactNumber, formatClock } from './format';
import type { ExtensionBucket } from '@/schemas/monitoring';

interface ActivityChartProps {
  buckets: ExtensionBucket[];
  emptyText: string;
  eventsLabel: string;
  rejectedLabel: string;
  height?: number;
}

/**
 * Requests over time for the whole log. The counters alone cannot show whether
 * the inbound is busy right now or was busy hours ago.
 */
export default function ActivityChart({
  buckets,
  emptyText,
  eventsLabel,
  rejectedLabel,
  height = 150,
}: ActivityChartProps) {
  const view = useMemo(() => {
    const events = buckets.map((b) => asNumber(b.events));
    const rejected = buckets.map((b) => asNumber(b.rejected));
    const labels = buckets.map((b) => formatClock(asNumber(b.at)));
    // A flat zero series just adds a legend entry and a line on the axis.
    const anyRejected = rejected.some((n) => n > 0);
    return { events, rejected: anyRejected ? rejected : [], labels };
  }, [buckets]);

  if (view.events.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <Sparkline
      data={view.events}
      data2={view.rejected}
      labels={view.labels}
      name1={eventsLabel}
      name2={rejectedLabel}
      stroke2="#fa541c"
      height={height}
      maxPoints={buckets.length}
      showAxes
      showTooltip
      valueMax={null}
      yFormatter={compactNumber}
      tooltipFormatter={(v) => v.toLocaleString()}
    />
  );
}
