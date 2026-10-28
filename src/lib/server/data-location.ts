// Where this RunF9 deployment keeps a firm's data, and how document search (RAG) runs, in words a
// customer can check. One deployment = one database: a firm that needs a different cloud per client
// runs one deployment in each cloud (docs/strategy/DEPLOYMENT-OPTIONS.md).
//
//   RUNF9_DATA_LOCATION  optional label for this deployment, e.g. "Your Azure subscription · East US".
//                        Unset: described from the deployment kind.

import { deploymentKind } from '@/lib/llm/provider'
import { embeddingsActive } from '@/lib/rag/embeddings'

type Env = Record<string, string | undefined>

export interface DataLocation {
  /** Who runs this deployment: RunF9's cloud, or the customer (their cloud account or servers) */
  hostedBy: 'runf9' | 'customer'
  /** Short label, e.g. "RunF9 Cloud · United States" */
  label: string
  /** Where project files, schedules and the document-search index are stored */
  database: string
  /** How document search works here */
  documentSearch: string
}

export function dataLocation(env: Env = process.env): DataLocation {
  const kind = deploymentKind(env)
  const custom = (env.RUNF9_DATA_LOCATION || '').trim().slice(0, 120)
  const runf9 = kind === 'commercial_cloud'
  const label = custom || (runf9 ? 'RunF9 Cloud · United States' : kind === 'airgapped' ? 'Your servers (air-gapped)' : 'Your own deployment')
  const meaning = embeddingsActive(env).enabled
  return {
    hostedBy: runf9 ? 'runf9' : 'customer',
    label,
    database: runf9
      ? 'RunF9’s managed PostgreSQL (Neon, United States), kept separate from every other firm’s data.'
      : 'Your PostgreSQL database, in your own cloud account or on your servers.',
    documentSearch: meaning
      ? 'Keyword, construction-vocabulary and meaning-based search, all inside this deployment’s database; passages are turned into vectors only by your in-network model.'
      : 'Keyword and construction-vocabulary search inside this deployment’s database. Nothing is sent to an outside search or embedding service.',
  }
}
