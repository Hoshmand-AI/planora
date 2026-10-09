# Data Processing Agreement — template

**Status:** template only. It has **not been reviewed by counsel** (POA&M #8). Customers may propose their own DPA instead, and we review reasonable terms.

## 1. Roles
The customer is the controller of the personal data in its account. Hoshmand AI ("Planora") is a processor and acts only on the customer's documented instructions: providing the service, support, and security monitoring.

## 2. Data
- **Personal data:** names and email addresses of the customer's users, names that appear in schedules and audit records, and sign-in metadata (IP address, time).
- **Project data:** schedules, interview answers, reports and uploaded files. This is customer confidential information even where it contains no personal data.
- **Special categories:** none are expected. The customer must not upload CUI or classified information to the commercial cloud service ([../security/CUI-HANDLING.md](../security/CUI-HANDLING.md)).

## 3. Processor obligations
- Process data only to provide the service. No sale of data and no model training on customer data.
- Keep staff with access bound by confidentiality.
- Apply the measures in [../security/SECURITY-OVERVIEW.md](../security/SECURITY-OVERVIEW.md): encryption in transit and at rest, tenant isolation, MFA, audit log, backups.
- Notify the customer of a personal data breach without undue delay, and within 72 hours of becoming aware of it.
- Assist with data subject requests. Erasure and export are available in the product.
- Delete or return the data within 30 days of termination, except where retention is required by law. Backups age out on their normal cycle.

## 4. Subprocessors
The current list is in [SUBPROCESSORS.md](SUBPROCESSORS.md). Planora gives 30 days' notice of a new subprocessor, and the customer may object. Cloud AI (Anthropic by default; OpenAI as an approved alternate) is used only if the customer's admin turns it on, and then request-relevant content is sent to the selected provider.

## 5. Transfers
Data is stored in the United States. Customers that need another region should use the on-premises deployment until regional hosting is available.

## 6. Audits
Planora answers reasonable security questionnaires and shares its evidence pack ([../security/VENDOR-QUESTIONNAIRE.md](../security/VENDOR-QUESTIONNAIRE.md)). Third-party reports are shared under NDA once they exist.

## 7. Liability and term
These follow the main agreement. This DPA ends when the main agreement ends, apart from the obligations to delete or return data.
