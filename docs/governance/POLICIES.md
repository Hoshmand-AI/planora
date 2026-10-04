# Information security and privacy policies

Owner: founder, Hoshmand AI. Reviewed: every 12 months, after a SEV1 incident, or on a major architecture change. Everyone with production access confirms each year that they have read these policies.

1. **Access control.**
   - Least privilege, with one account per person.
   - Production access (Vercel, Neon, GitHub admin, OpenAI) is limited to named people, with MFA on every provider account.
   - Access is reviewed every quarter and removed within 1 business day of a role change or departure.
2. **Data handling.**
   - Customer data is used only to provide the service.
   - No customer data on personal devices or in tickets, chat or email beyond what is needed.
   - Production data is never used in development or tests; tests use generated fixtures.
   - Data is classified as in docs/privacy/DATA-MAP.md.
3. **Secure development.**
   - All changes go through pull requests and the automated gates (docs/operations/CHANGE-MANAGEMENT.md).
   - Secrets live only in Vercel and GitHub encrypted settings, never in code.
   - Vulnerabilities are fixed within the limits in docs/security/VULNERABILITY-MANAGEMENT.md.
4. **AI use.** Follows docs/ai/AI-GOVERNANCE.md and the approved model registry.
5. **Vendor management.**
   - New subprocessors are reviewed before use (security posture, data location, terms, DPA) and added to docs/privacy/SUBPROCESSORS.md.
   - Existing vendors are reassessed every year.
6. **Incident response.** Follows docs/operations/INCIDENT-RESPONSE.md, with customer notification within contractual and legal deadlines.
7. **Business continuity.** Backups and restore drills follow docs/operations/BACKUP-AND-RECOVERY.md; RTO and RPO are reviewed every year.
8. **Acceptable use.** Company systems are used for business purposes only. Don't share accounts, don't bypass security controls, and report suspected incidents immediately.
