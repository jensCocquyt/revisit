import type { Item } from "./api";
import { describeStatus } from "./format";

export function StatusBadge({ item }: { item: Item }) {
  const status = describeStatus(item);
  if (!status) return null;
  return (
    <span className="badge" data-tone={status.tone}>
      {status.label}
    </span>
  );
}
