// The Daily Brief RunF9 computed for its built-in sample data center on 11/13/2026, as returned by
// GET /api/schedules/:id/brief on release 6866598 with AI off. Only fields the landing page shows are kept, and
// dates are formatted MM/DD/YYYY; every sentence is the engine's own. Regenerate it, do not edit it by hand
// (docs/marketing/CLAIMS-REGISTER.md).
export const SAMPLE_BRIEF = {
  "asOf": "11/13/2026",
  "project": "Sample: Hyperscale Data Center (60 MW)",
  "headline": {
    "status": "behind",
    "daysBehind": 40,
    "text": "Behind: T8040 Substantial Completion is forecast 08/17/2027, 40 calendar days after the required 07/08/2027."
  },
  "alerts": [
    {
      "level": "act",
      "text": "The forecast is 40 days behind the required date."
    },
    {
      "level": "act",
      "text": "Written notice is due within 7 days of a delay or change. A delay is reported in OAC meeting minutes 11/12/2026 (about P1030 Procure Medium-Voltage Switchgear): confirm the notice has gone out, then add it to the register to clear this reminder."
    },
    {
      "level": "act",
      "text": "Liquidated damages are $50,000 per day. At 40 days behind, the exposure is about $2,000,000."
    },
    {
      "level": "act",
      "text": "The field report describes work on D6010 Data Hall 1 Containment and Cable Tray; the schedule shows it not started. Record the actual start."
    },
    {
      "level": "act",
      "text": "1 register item past due: Generator fuel system inspection on hold for the venting detail."
    },
    {
      "level": "watch",
      "text": "3 delays reported in emails, minutes or field reports, including P1030 Procure Medium-Voltage Switchgear."
    },
    {
      "level": "watch",
      "text": "Today: 1 start and 1 finish are scheduled, some on the critical path."
    },
    {
      "level": "watch",
      "text": "The project documents name 1 kind of work that no activity covers: Fire detection and suppression."
    }
  ],
  "audiences": {
    "pm": [
      "Behind: T8040 Substantial Completion is forecast 08/17/2027, 40 calendar days after the required 07/08/2027.",
      "Driving the finish today: P1030 Procure Medium-Voltage Switchgear, forecast to finish 12/08/2026. 9 open activities on the driving path.",
      "2 open change items (PCOs, change requests, change orders, amendments) carrying up to 5 work days of schedule impact; decide or request time before the work is affected.",
      "What-if: If P1030 Procure Medium-Voltage Switchgear takes 5 work days longer, the finish moves from 08/17/2027 to 08/24/2027 (7 calendar days later)."
    ],
    "field": [
      "Starting today: E4047 Battery Commissioning and Discharge Test.",
      "Must finish today: P1020 Procure Utility Transformers (Long Lead).",
      "Under way: P1030 Procure Medium-Voltage Switchgear (finish 12/08/2026); P1020 Procure Utility Transformers (Long Lead) (finish 11/13/2026); E4030 Set Generators and Fuel System (finish 11/24/2026); E4050 Install Busway and PDUs - Data Hall 1 (finish 11/30/2026); M5030 Install CRAH Units - Data Hall 1 (finish 11/30/2026); and 2 more.",
      "Do not let this slip: P1030 Procure Medium-Voltage Switchgear. It is driving the project finish, so every day lost here is a day lost at the end.",
      "Coming in the next 3 days: U2520 Set Utility Transformers (11/16/2026). Confirm crews, materials and access."
    ],
    "client": [
      "T8040 Substantial Completion is currently forecast 08/17/2027, 40 calendar days later than the required 07/08/2027.",
      "The work is 81% complete by duration (22 of 46 activities finished).",
      "2 change items are open, with up to 5 work days of possible schedule impact under review.",
      "The work currently setting the finish date is Procure Medium-Voltage Switchgear."
    ]
  },
  "signals": [
    {
      "kind": "delay",
      "quote": "The electrical subcontractor reported that the medium-voltage switchgear will be delayed by 3 weeks because the vendor failed the factory breaker test.",
      "source": "OAC meeting minutes 11/12/2026",
      "activity": "P1030 Procure Medium-Voltage Switchgear",
      "days": 15
    },
    {
      "kind": "change",
      "quote": "The owner requested additional hot-aisle containment in Data Hall 2; the contractor will price it as a change order and expects it to add 5 days to the containment work.",
      "source": "OAC meeting minutes 11/12/2026",
      "activity": "D6520 Data Hall 2 Containment and Cabling",
      "days": 5
    },
    {
      "kind": "delay",
      "quote": "BMS controls pulling is behind schedule in the electrical rooms because the conduit was not released; the crew lost 2 days.",
      "source": "Daily field report 11/12/2026",
      "activity": "M5050 BMS and EPMS Controls",
      "days": 2
    },
    {
      "kind": "delay",
      "quote": "The fire marshal inspection of the generator fuel system is on hold pending the revised tank venting detail from the engineer.",
      "source": "Email: generator fuel system inspection",
      "activity": "E4030 Set Generators and Fuel System",
      "days": null
    },
    {
      "kind": "risk",
      "quote": "The interconnect outage window is at risk if the transformers are not set this month.",
      "source": "OAC meeting minutes 11/12/2026",
      "activity": "U2520 Set Utility Transformers",
      "days": null
    }
  ],
  "whatIfs": [
    {
      "title": "Default what-if: P1030 Procure Medium-Voltage Switchgear +5 work days",
      "text": "If P1030 Procure Medium-Voltage Switchgear takes 5 work days longer, the finish moves from 08/17/2027 to 08/24/2027 (7 calendar days later)."
    },
    {
      "title": "Register: PCO-014 Additional hot-aisle containment in Data Hall 2: D6520 Data Hall 2 Containment and Cabling +5 work days",
      "text": "If D6520 Data Hall 2 Containment and Cabling takes 5 work days longer, the finish stays 08/17/2027: it has 23 work days of float, enough to absorb it."
    },
    {
      "title": "Register: Utility has not confirmed the energization date: U2530 Utility Interconnect and Energization +10 work days",
      "text": "If U2530 Utility Interconnect and Energization takes 10 work days longer, the finish stays 08/17/2027: other work sets that date. This activity has no float left (-1 work day), so a date it must meet itself slips further."
    },
    {
      "title": "Correspondence: OAC meeting minutes 11/12/2026: P1030 Procure Medium-Voltage Switchgear +15 work days",
      "text": "If P1030 Procure Medium-Voltage Switchgear takes 15 work days longer, the finish moves from 08/17/2027 to 09/07/2027 (21 calendar days later)."
    },
    {
      "title": "Best recovery option: Crash 6 driving field activities by 15%",
      "text": "Crash 6 driving field activities by 15%: the finish moves from 08/17/2027 to 07/15/2027 (33 calendar days earlier). Trade-off: Higher labor cost and supervision load across the driving path; returns diminish beyond 15–20%, and another path may take over (see the float effect)."
    }
  ],
  "driving": [
    {
      "code": "P1030",
      "name": "Procure Medium-Voltage Switchgear",
      "date": "12/08/2026",
      "float": -28
    },
    {
      "code": "E4020",
      "name": "Set Medium-Voltage Switchgear",
      "date": "01/05/2027",
      "float": -28
    },
    {
      "code": "E4060",
      "name": "Pull and Terminate MV/LV Feeders",
      "date": "02/23/2027",
      "float": -28
    },
    {
      "code": "X7020",
      "name": "Level 3 Pre-Functional Checks and Startup",
      "date": "04/06/2027",
      "float": -28
    },
    {
      "code": "X7030",
      "name": "Level 4 Functional Performance Testing",
      "date": "05/11/2027",
      "float": -28
    },
    {
      "code": "X7040",
      "name": "Level 5 Integrated Systems Test (IST)",
      "date": "06/01/2027",
      "float": -28
    }
  ]
} as const
