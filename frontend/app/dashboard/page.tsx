import type { Metadata } from 'next'
import { WorkspaceApp } from '../../components/workspace-app'

export const metadata: Metadata = { title: 'Management system', robots: { index: false, follow: false } }

export default function DashboardPage() {
  return <WorkspaceApp />
}
