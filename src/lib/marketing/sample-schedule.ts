// The built-in sample data center schedule as RunF9 calculated it on 11/13/2026 (GET /api/schedules?id=…,
// release 6866598): its work areas, with the earliest start and latest finish of the activities in each, and how
// many of them are critical. Drives the F9 picture on the landing page. Regenerate it, do not edit it by hand
// (docs/marketing/CLAIMS-REGISTER.md).
export const SAMPLE_SCHEDULE = {
  "project": "Sample: Hyperscale Data Center (60 MW)",
  "spanDays": 697,
  "start": "09/19/2025",
  "finish": "08/17/2027",
  "required": "07/08/2027",
  "dataDate": "11/13/2026",
  "dataDay": 420,
  "requiredDay": 657,
  "activities": 46,
  "critical": 14,
  "daysLate": 40,
  "rows": [
    {
      "name": "Preconstruction and Long-Lead Procurement",
      "start": 0,
      "days": 445,
      "critical": 2,
      "activities": 8,
      "finished": 6
    },
    {
      "name": "Site and Utilities",
      "start": 56,
      "days": 286,
      "critical": 0,
      "activities": 4,
      "finished": 4
    },
    {
      "name": "Core and Shell",
      "start": 98,
      "days": 188,
      "critical": 0,
      "activities": 5,
      "finished": 5
    },
    {
      "name": "Substation and Utility Power",
      "start": 98,
      "days": 385,
      "critical": 2,
      "activities": 3,
      "finished": 1
    },
    {
      "name": "Electrical Systems",
      "start": 287,
      "days": 235,
      "critical": 2,
      "activities": 7,
      "finished": 3
    },
    {
      "name": "Mechanical and Controls",
      "start": 287,
      "days": 186,
      "critical": 0,
      "activities": 4,
      "finished": 3
    },
    {
      "name": "Data Hall 1 Fit-Out",
      "start": 385,
      "days": 136,
      "critical": 0,
      "activities": 5,
      "finished": 0
    },
    {
      "name": "Data Hall 2 Fit-Out",
      "start": 438,
      "days": 111,
      "critical": 0,
      "activities": 2,
      "finished": 0
    },
    {
      "name": "Commissioning",
      "start": 474,
      "days": 195,
      "critical": 5,
      "activities": 5,
      "finished": 0
    },
    {
      "name": "Turnover",
      "start": 620,
      "days": 77,
      "critical": 3,
      "activities": 3,
      "finished": 0
    }
  ]
} as const
