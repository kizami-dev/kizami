---
key: attendance.day-boundary
audience: [employee, admin]
origin: product
summary: The day boundary is the setting for when "one day" starts. For work that crosses dates, such as late-night work, the day boundary decides which attendance date the work belongs to.
companyExample: |
  Our day boundary is 5:00 a.m. (because some departments have a lot of late-night work).
  Work that ends before 5:00 a.m. is counted as the previous day's work.
---

# Day boundary (the start-of-day cutoff)

The day boundary is the cutoff time that determines when "one day" starts and ends for attendance purposes.
Most tenants set the day boundary at midnight, but a workplace with a lot of late-night work can set it to
another time, such as 5:00 a.m.

## Effect on work that crosses dates

Punches before the day boundary are treated as the previous day's work, and punches at or after the day
boundary as the current day's work. For example, with the day boundary set to 5:00 a.m., starting work at
1:00 a.m. and clocking out at 6:00 a.m. means the clock-in and clock-out are both counted as attendance for
the same "work start date" (it is not split even though it crosses the 5:00 a.m. day boundary).

The day boundary setting affects every aggregation that is done on a daily basis, including monthly totals,
the flex balance, and Article 36 agreement alerts. Changing the setting changes how attendance dates are
assigned from then on.
