---
key: attendance.flex-contract
audience: [employee, admin]
origin: product
summary: For each flexible working hours policy, you can choose whether the total working hours are "the statutory limit" (default) or "scheduled days × standard hours" (the contractual limit). Policies that use the contractual limit can also carry shortfalls over to the next month.
companyExample: |
  For the reduced-hours flex policy (6 standard hours), total working hours are scheduled days × standard hours.
  Shortfalls are carried over to the next month (Work Rules, Article ○).
---

# How total working hours are decided under the flexible working hours system, and carrying over shortfalls

This entry explains KIZAMI's settings and how it calculates. For the rules set by law, see
[The total hours limit under a flexible working hours system](./attendance-flex-frame).

## How total working hours are decided

Under "Work-hour policies" in the attendance rules, choose one of the following for each flexible working
hours policy.

| Method | Total working hours | Suited to |
| --- | --- | --- |
| Statutory limit (default) | Statutory weekly working hours × calendar days ÷ 7 | Policies whose total working hours equal the statutory limit |
| Scheduled days × standard hours | Scheduled working days in the month × the policy's standard hours per day (the contractual limit) | Policies whose total working hours are shorter than the statutory limit, such as reduced working hours |

The default is "Statutory limit", which calculates exactly as before, to the minute. Scheduled working days
are counted from the [company holiday calendar](./attendance-holiday-calendar).

Example: in a month with 6 standard hours and 20 scheduled days, the contractual limit is 120 hours. It is
handled separately from the statutory limit (177 hours 8 minutes in a 31-day month).

## Calculation for policies that use the contractual limit

| Actual hours | Shown on the monthly screen as |
| --- | --- |
| Up to the contractual limit | Within the limit (the surplus or shortfall is measured against this limit) |
| Beyond the contractual limit, up to the statutory limit | Excess within the statutory limit (no premium) |
| Beyond the statutory limit | Statutory overtime (overtime work) |

If scheduled working days × standard hours exceed the statutory limit (for example, 8 standard hours in a month
with many scheduled days), KIZAMI **caps it at the statutory limit** and shows a warning. Total working hours
are to be set within the statutory limit, so review the standard hours or the calendar. Overtime work is
always measured against the statutory limit, so the cap never reduces the hours subject to premiums.

## Carrying shortfalls over to the next month

Policies that use the contractual limit can choose "Carry shortfalls over to the next month" (the default is
not to carry over).

- A shortfall is added to the next month's contractual limit. It is added only **up to the next month's
  statutory limit**; the part beyond that is not carried over and is **confirmed as a shortfall for that
  month** (hours that may be deducted in payroll)
- **Excess hours are never carried over.** They are counted in that month as excess within the statutory limit
  or as statutory overtime
- The previous month's shortfall is taken from the values at closing (the snapshot) if the previous month is
  closed, or calculated on the spot if it is not. If the previous month itself received a carry-over, KIZAMI
  goes back further
- KIZAMI goes back **up to 3 months**. If unclosed months continue beyond that, the carry-over is treated as 0
  and a warning is shown. Closing the earlier month resolves it

The "Flex balance" on the monthly screen shows the contractual limit, carry-over received, excess within the
statutory limit, statutory overtime, confirmed shortfall and carry-over to the next month. The CSV export has
columns with the same values.

## What KIZAMI does not calculate

KIZAMI's output stops at the breakdown of hours. It does not calculate amounts such as wages for excess hours
within the statutory limit or deductions for a confirmed shortfall. Calculate them in your payroll software
according to your work rules.
