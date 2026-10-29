// One-click private deployments (RunF9 in the customer's own AWS, Azure or Google Cloud account):
// where each template lives and the link that starts it. Templates: public/deploy/*.
//   RUNF9_AWS_DEPLOY_TEMPLATE_URL  an S3 copy of public/deploy/aws/runf9.yaml (CloudFormation's
//                                  quick-create only opens templates stored in S3)

type Env = Record<string, string | undefined>

export interface DeployOption {
  id: 'aws' | 'azure' | 'gcp'
  cloud: string
  runs: string
  database: string
  ai: string
  template: string
  /** Opens the cloud's console with the template loaded, when the cloud supports it */
  launchUrl: string | null
  launchLabel: string
  steps: string[]
  /** Commands to paste (Google Cloud Shell) */
  commands?: string
}

export function deployOptions(origin: string, env: Env = process.env): DeployOption[] {
  const base = origin.replace(/\/+$/, '')
  const awsTemplate = (env.RUNF9_AWS_DEPLOY_TEMPLATE_URL || '').trim()
  return [
    {
      id: 'azure', cloud: 'Microsoft Azure',
      runs: 'Azure Container Apps', database: 'Azure Database for PostgreSQL (flexible server, TLS, 14-day backups)', ai: 'None, or Azure OpenAI in your subscription',
      template: `${base}/deploy/azure/runf9.json`,
      launchUrl: `https://portal.azure.com/#create/Microsoft.Template/uri/${encodeURIComponent(`${base}/deploy/azure/runf9.json`)}`,
      launchLabel: 'Deploy to Azure',
      steps: [
        'Choose Deploy to Azure and sign in to the Azure portal.',
        'Pick a subscription and create a resource group (for example runf9), and a region.',
        'Fill in the database password, session secret and encryption key (random, 32+ characters each; keep them safe). Leave the rest as they are, or pick Azure OpenAI.',
        'Review + create. In about 10 minutes the deployment\'s Outputs show runf9Url: open it and create your organization.',
      ],
    },
    {
      id: 'aws', cloud: 'Amazon Web Services',
      runs: 'Amazon ECS on Fargate behind a load balancer', database: 'Amazon RDS for PostgreSQL (encrypted, private subnets, 14-day backups)', ai: 'None, or Amazon Bedrock in your account',
      template: `${base}/deploy/aws/runf9.yaml`,
      launchUrl: awsTemplate ? `https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate?templateURL=${encodeURIComponent(awsTemplate)}&stackName=RunF9` : null,
      launchLabel: awsTemplate ? 'Launch in AWS' : 'Download the template',
      steps: [
        awsTemplate ? 'Choose Launch in AWS and sign in to the AWS console (pick your region at the top right).' : 'Download the template, then in the AWS console open CloudFormation > Create stack > Upload a template file.',
        'Leave the defaults (or choose Bedrock for AI, with a model you enabled in the Bedrock console). For your own domain, give an ACM certificate ARN.',
        'Tick "I acknowledge that AWS CloudFormation might create IAM resources" and create the stack.',
        'In about 15 minutes the stack\'s Outputs show RunF9Url: open it and create your organization.',
      ],
    },
    {
      id: 'gcp', cloud: 'Google Cloud',
      runs: 'Cloud Run', database: 'Cloud SQL for PostgreSQL (encrypted, point-in-time recovery)', ai: 'None, or Vertex AI in your project',
      template: `${base}/deploy/gcp/main.tf`,
      launchUrl: 'https://shell.cloud.google.com/?show=terminal',
      launchLabel: 'Open Cloud Shell',
      steps: [
        'Open Cloud Shell in your Google Cloud project (billing must be on).',
        'Paste the commands below. Terraform shows what it will create; type yes.',
        'In about 15 minutes it prints runf9_url: open it and create your organization.',
      ],
      commands: `mkdir -p runf9 && cd runf9 && curl -fsSLO ${base}/deploy/gcp/main.tf\nterraform init\nterraform apply -var project_id=$GOOGLE_CLOUD_PROJECT`,
    },
  ]
}
