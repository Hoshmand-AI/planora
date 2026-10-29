# Setting up AWS, Azure and Google Cloud for RunF9 (owner's walkthrough)

Three jobs, in this order:

1. **Create the three cloud accounts** (each comes with free credit).
2. **Give RunF9 its own identity in each cloud**, so customers see "Sign in with Microsoft",
   "Sign in with Google" and "Create the role in AWS" instead of pasting keys. Paste the values into
   Vercel, never into chat or email.
3. **Test as a customer**: connect storage, keep an upload's original there, and (optional) run a
   full private install from runf9.ai/deploy, then delete it.

Values you will reuse:

| | |
|---|---|
| Redirect URI (Microsoft and Google) | `https://runf9.ai/api/storage/oauth/callback` |
| Vercel | Project **planora** → Settings → Environment Variables → Production; then Deployments → Redeploy |

Set a **budget alert** in each cloud on day one (Azure: Cost Management → Budgets; AWS: Billing →
Budgets; Google: Billing → Budgets & alerts). A test install costs a few dollars a day; delete it when
you are done.

---

## 1. Microsoft Azure

### 1a. Account
1. Go to azure.microsoft.com/free → **Start free**. Sign in (or create a Microsoft account), verify by
   phone and card. New accounts get a credit for the first 30 days.
2. In portal.azure.com, search **Microsoft Entra ID**. Note the **Primary domain**
   (e.g. `yourname.onmicrosoft.com`).
3. **Create a work test user** (RunF9's Microsoft sign-in is for work accounts, so a personal
   outlook.com login will not work): Entra ID → Users → **New user** → Create new user →
   `tester@<primary domain>`, set a password. Use this user when you test as a customer.

### 1b. RunF9's app registration ("Sign in with Microsoft")
1. Entra ID → **App registrations** → **New registration**.
   - Name: `RunF9`
   - Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant)**
   - Redirect URI: platform **Web**, `https://runf9.ai/api/storage/oauth/callback`
   - **Register**.
2. On the Overview page copy **Application (client) ID** → Vercel `RUNF9_AZURE_CLIENT_ID`.
3. **Certificates & secrets** → Client secrets → **New client secret** (24 months) → copy the
   **Value** (shown once) → Vercel `RUNF9_AZURE_CLIENT_SECRET`. Put a calendar reminder to renew it.
4. **API permissions** → Add a permission → Microsoft APIs → **Azure Storage** → Delegated →
   `user_impersonation` → Add. Then **Grant admin consent** for your directory.
5. (Later, before selling) **Branding & properties** → add the publisher domain / verify the publisher
   so customers' admins see a verified app.

---

## 2. Google Cloud

### 2a. Account
1. Go to cloud.google.com/free → **Get started for free**, sign in with a Google account, add billing
   (free credit for new accounts).
2. Create a project: console.cloud.google.com → project picker → **New project** → `runf9-platform`.

### 2b. RunF9's OAuth client ("Sign in with Google")
1. Search **Google Auth Platform** (formerly "OAuth consent screen") → **Get started**:
   App name `RunF9`, support email, Audience **External**, contact email → Create.
2. **Data access** → Add or remove scopes → add manually
   `https://www.googleapis.com/auth/devstorage.read_write` → Update → Save.
3. **Audience** → Test users → add the Google account you will test with. (While the app is in
   *Testing*, only these users can sign in and their sign-in lasts 7 days. Google reviews the app
   before you switch it to *In production* for customers.)
4. **Clients** → **Create client** → Web application → name `RunF9 web` → Authorized redirect URIs:
   `https://runf9.ai/api/storage/oauth/callback` → Create.
5. Copy **Client ID** → Vercel `RUNF9_GOOGLE_CLIENT_ID`, and **Client secret** →
   `RUNF9_GOOGLE_CLIENT_SECRET`.

---

## 3. Amazon Web Services

### 3a. Account
1. Go to aws.amazon.com → **Create an AWS Account**: email, account name `RunF9`, card, phone.
2. Sign in as root once to turn on **MFA** (account menu → Security credentials → Assign MFA), then
   create an everyday admin (IAM Identity Center, or IAM → Users with AdministratorAccess) and stop
   using root.
3. Copy the 12-digit **Account ID** (account menu, top right) → Vercel `RUNF9_AWS_ACCOUNT_ID`.

### 3b. RunF9's identity ("Create the role in AWS")
1. IAM → Users → **Create user** `runf9-sts` (no console access) → Next → **Attach policies
   directly** → skip → Create.
2. Open the user → Permissions → Add permissions → **Create inline policy** → JSON:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{ "Effect": "Allow", "Action": "sts:AssumeRole", "Resource": "arn:aws:iam::*:role/RunF9-Storage-*" }]
   }
   ```
   Name it `AssumeCustomerRunF9Roles`.
3. Security credentials → **Create access key** → *Application running outside AWS* → copy both →
   Vercel `RUNF9_AWS_ACCESS_KEY_ID` and `RUNF9_AWS_SECRET_ACCESS_KEY`.
4. Publish the two CloudFormation templates (AWS opens one-click templates only from S3):
   1. S3 → **Create bucket** `runf9-public-templates` (us-east-1). Under *Block Public Access*, clear
      "Block all public access" and acknowledge.
   2. Upload `https://runf9.ai/cloud/aws-storage-role.yaml` and `https://runf9.ai/deploy/aws/runf9.yaml`
      (download them first).
   3. Permissions → Bucket policy:
      ```json
      {
        "Version": "2012-10-17",
        "Statement": [{ "Effect": "Allow", "Principal": "*", "Action": "s3:GetObject",
          "Resource": ["arn:aws:s3:::runf9-public-templates/aws-storage-role.yaml", "arn:aws:s3:::runf9-public-templates/runf9.yaml"] }]
      }
      ```
   4. Copy each object's URL → Vercel `RUNF9_AWS_TEMPLATE_URL` (the role template) and
      `RUNF9_AWS_DEPLOY_TEMPLATE_URL` (the full install).

### 3c. Redeploy
Vercel → Deployments → the latest production deployment → **Redeploy**. Organization → Cloud storage
now offers sign-in for each cloud you configured.

---

## 4. Test as a customer (storage)

Use separate "customer" resources (they can be in the same accounts).

**Azure**
1. Storage accounts → **Create** (Standard, LRS, your region) → Containers → **+ Container** `runf9-test`.
2. On the container → Access control (IAM) → Add role assignment → **Storage Blob Data Contributor** →
   the `tester@…` user.
3. In RunF9 (signed in as an admin): Organization → Cloud storage → **Microsoft Azure** → name, storage
   account, container → **Sign in with Microsoft** → sign in as `tester@…` → Accept. You return to
   RunF9 with the connection showing *Import files* and *Keep originals*.

**Google Cloud**
1. Cloud Storage → **Create bucket** `runf9-test-<something unique>` (uniform access).
2. Your test account owns the project, so it already has access (otherwise grant *Storage Object
   Admin* on the bucket).
3. RunF9 → Cloud storage → **Google Cloud Storage** → bucket → **Sign in with Google**.

**AWS**
1. S3 → **Create bucket** `runf9-test-<unique>`.
2. RunF9 → Cloud storage → **Amazon S3 (AWS)** → bucket, region → **Create the role in AWS** → AWS
   opens with everything filled in → tick the IAM acknowledgement → **Create stack**.
3. When it shows CREATE_COMPLETE: Outputs → copy **RoleArn** → paste in RunF9 → **Test and connect**.

**Then for each:** New project → Upload a schedule → *Keep the original file in*: the new connection →
Upload & Parse. Check the bucket/container: `runf9/schedules/<date>-<hash>-<file>` is there. Download
the original from the project (Export → Original) to confirm it reads back. Upload a file into the
bucket yourself and import it with *Upload from*.

No identities configured yet? Each form also has **Use a key instead** (Azure SAS token, AWS access key,
Google HMAC key), which works without step 1b/2b/3b.

---

## 5. Test the full private install (optional)

1. Publish the image: GitHub → Actions → **Release image** → Run workflow → version `0.1.0`. Then
   github.com/orgs/Hoshmand-AI/packages → `runf9` → Package settings → **Change visibility → Public**
   (or keep it private and use a read-only token in the template's registry fields).
2. runf9.ai/deploy → pick a cloud and follow its steps (Azure: **Deploy to Azure**; AWS: **Launch in
   AWS**; Google: Cloud Shell commands).
3. Open the output URL, create the organization, upload a schedule. Organization → Where your data
   lives shows your account and region.
4. **Delete it when done**: Azure: delete the resource group. AWS: RDS → the database → Modify → turn
   off deletion protection, then delete the CloudFormation stack. Google: `terraform apply
   -var project_id=… -var deletion_protection=false`, then `terraform destroy`.

If anything fails, send the error text (never keys or secrets) and the step number.
