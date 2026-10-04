# Independent validation plan: CPM, DCMA and interoperability

**Goal:** show that Planora's dates, float and DCMA results match Primavera P6 and Microsoft Project on a maintained reference corpus.

1. **Corpus:** 30+ real or realistic schedules covering:
   - 5-day, 7-day and 6×10 calendars with holidays;
   - FS/SS/FF/SF relationships with positive lags;
   - SNET/FNLT/MSO/MFO constraints;
   - in-progress activities with actuals;
   - 1k–20k activities.
   Store them anonymized under `src/lib/parsers/__fixtures__/reference/`.
2. **Oracle:** schedule each file in P6 (F9, retained logic, "most critical" total float) and in MS Project. Export the early/late dates and total float.
3. **Comparison:** for each activity, compare dates (an exact match is expected) and total float (±0 work days). Record mismatches with their root cause.
4. **DCMA:** compare each of the 14 metrics with a reference tool such as Acumen Fuse or Deltek, using the same thresholds.
5. **Automation:** run the comparison in CI on each change, and fail on regressions.
6. **Publication:** a supported-versions and compatibility matrix (P6 versions, MSP versions) on the website.
