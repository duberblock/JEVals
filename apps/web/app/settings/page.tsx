import { SettingsView } from '../../components/settings/settings-view'

// The provider-configuration screen: the four integration cards (endpoint,
// model, encrypted-at-rest API key). Deliberately OUTSIDE the canonical nav
// (plan §3 keeps Principal/Investigación/Operación) — the access point is
// the header's utility zone beside the help link, mirroring /how-it-works.
export default function SettingsPage() {
  return <SettingsView />
}
