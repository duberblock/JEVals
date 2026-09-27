import { HistoryView } from '../../components/operation/history-view'

// History (§55): the full persisted-execution table. Client-side because it
// loads the repository over the same-origin proxy with cursor pagination.
export default function HistoryPage() {
  return <HistoryView />
}
