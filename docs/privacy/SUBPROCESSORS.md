# Subprocessors

| Provider | Service | Data | Location | When |
|---|---|---|---|---|
| Vercel Inc. | Application hosting, request logs | All application traffic | United States (default region iad1) | Cloud service |
| Neon Inc. | Managed PostgreSQL, backups (point-in-time recovery) | All stored data | Region of the project's database (confirm in the Neon console) | Cloud service |
| OpenAI, L.L.C. | Model inference via API | Request-relevant schedule content | United States | Only when an organization allows AI **and** the deployment is in cloud AI mode |
| GitHub, Inc. | Encrypted off-provider backup artifacts | Encrypted database dump | United States | Only if the nightly backup workflow is enabled |

On-premises / air-gapped deployments use none of these. Customers are notified 30 days before a new subprocessor that processes customer data is added.
