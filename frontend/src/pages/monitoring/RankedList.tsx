import { Empty, Tooltip, Typography } from 'antd';

import { compactNumber } from './format';

export interface RankedItem {
  key: string;
  label: string;
  /** Rendered under the label, e.g. a country name or a client count. */
  meta?: string;
  value: number;
  /** Portion of value that was rejected, drawn as a warning segment. */
  warn?: number;
  title?: string;
}

interface RankedListProps {
  items: RankedItem[];
  emptyText: string;
  onSelect?: (item: RankedItem) => void;
}

/**
 * A ranked bar list. A count alone does not say whether one site dominates the
 * inbound or the traffic is spread thin, so every row is drawn relative to the
 * busiest one.
 */
export default function RankedList({ items, emptyText, onSelect }: RankedListProps) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  const top = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="mon-ranked">
      {items.map((item) => {
        const pct = Math.max(2, Math.round((item.value / top) * 100));
        const warnPct = item.warn ? Math.round((item.warn / top) * 100) : 0;
        const row = (
          <>
            <span className="mon-ranked-bar" aria-hidden="true">
              <span className="mon-ranked-fill" style={{ width: `${pct}%` }} />
              {warnPct > 0 && <span className="mon-ranked-warn" style={{ width: `${warnPct}%` }} />}
            </span>
            <span className="mon-ranked-text">
              <span className="mon-ranked-label">{item.label}</span>
              {item.meta && (
                <Typography.Text type="secondary" className="mon-ranked-meta">
                  {item.meta}
                </Typography.Text>
              )}
            </span>
            <span className="mon-ranked-value">{compactNumber(item.value)}</span>
          </>
        );

        return (
          <Tooltip key={item.key} title={item.title} mouseEnterDelay={0.4}>
            {onSelect ? (
              <button type="button" className="mon-ranked-row" onClick={() => onSelect(item)}>
                {row}
              </button>
            ) : (
              <div className="mon-ranked-row">{row}</div>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
}
