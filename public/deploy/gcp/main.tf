# RunF9 in your own Google Cloud project: the RunF9 container on Cloud Run, Cloud SQL for PostgreSQL
# (encrypted, private to the app through the Cloud SQL connector, backups with point-in-time
# recovery), secrets in Secret Manager, and optionally Vertex AI. Schedules, analysis, documents and
# the document-search index all stay in this project. Guide: https://runf9.ai/deploy
#
#   In Cloud Shell:  mkdir runf9 && cd runf9 && curl -fsSLO https://runf9.ai/deploy/gcp/main.tf
#                    terraform init && terraform apply -var project_id=YOUR_PROJECT
#
# Terraform keeps the generated database password and keys in its state: store the state safely
# (a Cloud Storage backend is recommended for anything beyond a trial).

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = ">= 6.0, < 8.0" }
    random = { source = "hashicorp/random", version = ">= 3.5" }
  }
}

variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "image" {
  type        = string
  default     = "hoshmand-ai/runf9:latest"
  description = "RunF9 image path on ghcr.io (pulled through an Artifact Registry remote repository), or a full image URI in Artifact Registry."
}
variable "db_tier" {
  type    = string
  default = "db-custom-1-3840"
}
variable "signup_mode" {
  type        = string
  default     = "open"
  description = "open lets the first person create the organization; switch to invite_only afterwards."
  validation {
    condition     = contains(["open", "invite_only"], var.signup_mode)
    error_message = "signup_mode must be open or invite_only."
  }
}
variable "app_url" {
  type        = string
  default     = ""
  description = "Optional public address for email links, e.g. https://runf9.yourfirm.com."
}
variable "ai_provider" {
  type    = string
  default = "none"
  validation {
    condition     = contains(["none", "vertex"], var.ai_provider)
    error_message = "ai_provider must be none or vertex."
  }
}
variable "vertex_model" {
  type        = string
  default     = ""
  description = "Vertex AI model when ai_provider is vertex (a Claude or Gemini model id enabled in Model Garden)."
}
variable "vertex_location" {
  type    = string
  default = "us-east5"
}
variable "deletion_protection" {
  type    = bool
  default = true
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  apis      = ["run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "aiplatform.googleapis.com", "iam.googleapis.com"]
  use_ai    = var.ai_provider == "vertex"
  image_uri = strcontains(var.image, ".pkg.dev/") ? var.image : "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.ghcr.repository_id}/${var.image}"
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# Pulls the RunF9 image from GitHub Container Registry (Cloud Run only runs images from Artifact Registry).
resource "google_artifact_registry_repository" "ghcr" {
  location      = var.region
  repository_id = "runf9-ghcr"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  remote_repository_config {
    description = "ghcr.io (RunF9 images)"
    docker_repository {
      custom_repository { uri = "https://ghcr.io" }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "random_password" "db" {
  length  = 32
  special = false
}
resource "random_password" "jwt" {
  length  = 48
  special = false
}
resource "random_password" "encryption" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "s" {
  for_each  = toset(["runf9-db-password", "runf9-jwt-secret", "runf9-encryption-key"])
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}
resource "google_secret_manager_secret_version" "db" {
  secret      = google_secret_manager_secret.s["runf9-db-password"].id
  secret_data = random_password.db.result
}
resource "google_secret_manager_secret_version" "jwt" {
  secret      = google_secret_manager_secret.s["runf9-jwt-secret"].id
  secret_data = random_password.jwt.result
}
resource "google_secret_manager_secret_version" "encryption" {
  secret      = google_secret_manager_secret.s["runf9-encryption-key"].id
  secret_data = random_password.encryption.result
}

resource "google_sql_database_instance" "db" {
  name                = "runf9-db"
  database_version    = "POSTGRES_17"
  region              = var.region
  deletion_protection = var.deletion_protection
  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_autoresize   = true
    ip_configuration {
      # Reachable only through the Cloud SQL connector (IAM-authorized); no networks are allowed in.
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      backup_retention_settings { retained_backups = 14 }
    }
  }
  depends_on = [google_project_service.apis]
}
resource "google_sql_database" "runf9" {
  name     = "runf9"
  instance = google_sql_database_instance.db.name
}
resource "google_sql_user" "runf9" {
  name     = "runf9"
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

resource "google_service_account" "app" {
  account_id   = "runf9-app"
  display_name = "RunF9 application"
}
resource "google_project_iam_member" "sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}
resource "google_project_iam_member" "vertex" {
  count   = local.use_ai ? 1 : 0
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}
resource "google_secret_manager_secret_iam_member" "read" {
  for_each  = google_secret_manager_secret.s
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_cloud_run_v2_service" "app" {
  name                = "runf9"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  template {
    service_account = google_service_account.app.email
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = [google_sql_database_instance.db.connection_name] }
    }
    containers {
      image = local.image_uri
      ports { container_port = 3000 }
      resources {
        limits = { cpu = "1", memory = "2Gi" }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "DATABASE_URL"
        value = "postgres://runf9@localhost/runf9?host=/cloudsql/${google_sql_database_instance.db.connection_name}"
      }
      env {
        name = "PGPASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.s["runf9-db-password"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.s["runf9-jwt-secret"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "RUNF9_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.s["runf9-encryption-key"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "RUNF9_DEPLOYMENT"
        value = "onprem"
      }
      env {
        name  = "RUNF9_DATA_LOCATION"
        value = "Your Google Cloud project · ${var.region}"
      }
      env {
        name  = "RUNF9_SIGNUP"
        value = var.signup_mode == "open" ? "open" : ""
      }
      env {
        name  = "APP_URL"
        value = var.app_url
      }
      env {
        name  = "RUNF9_AI_MODE"
        value = local.use_ai ? "cloud" : "offline"
      }
      env {
        name  = "RUNF9_AI_PROVIDER"
        value = local.use_ai ? "vertex" : ""
      }
      env {
        name  = "VERTEX_PROJECT"
        value = var.project_id
      }
      env {
        name  = "VERTEX_LOCATION"
        value = var.vertex_location
      }
      env {
        name  = "VERTEX_MODEL"
        value = var.vertex_model
      }
      startup_probe {
        http_get { path = "/api/health" }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 12
      }
      liveness_probe {
        http_get { path = "/api/health" }
        period_seconds = 30
      }
    }
  }
  depends_on = [google_project_iam_member.sql, google_secret_manager_secret_iam_member.read, google_secret_manager_secret_version.db, google_secret_manager_secret_version.jwt, google_secret_manager_secret_version.encryption, google_sql_database.runf9, google_sql_user.runf9]
}

# Anyone may reach the sign-in page; RunF9 itself requires an account for everything else.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "runf9_url" {
  description = "Open this address and create your organization."
  value       = var.app_url != "" ? var.app_url : google_cloud_run_v2_service.app.uri
}
output "database_instance" { value = google_sql_database_instance.db.connection_name }
