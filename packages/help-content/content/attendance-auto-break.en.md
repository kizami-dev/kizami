---
key: attendance.auto-break
audience: [employee, admin]
origin: product
basis: KIZAMI aggregation behavior built on Article 34 of the Labor Standards Act (rest periods)
summary: When automatic deduction is enabled, the prescribed rest period is subtracted from actual working hours even without rest period punches. On a day when you could not actually take a rest period, submitting a cancellation request removes the deduction, and a rest period shortfall warning appears accordingly.
companyExample: |
  This company has automatic deduction of rest periods enabled (45 minutes over 6 hours, 60 minutes over 8 hours).
  On a day when work made it impossible to take a rest period, submit a cancellation request and report it to your supervisor the same day.
---

# Automatic deduction of rest periods

Depending on the company's settings, the prescribed rest period for the hours worked is subtracted from
actual working hours automatically, even without rest period punches.

## Types of behavior

| Setting | Behavior |
| --- | --- |
| Time punch method | Subtracts only rest periods that were punched (no automatic deduction) |
| Automatic deduction | Subtracts the prescribed rest period for the hours worked, regardless of punches |
| Combined | Uses the rest periods that were punched and additionally subtracts only the shortfall against the prescribed time |

The default is the **time punch method** (automatic deduction off). Whether automatic deduction is used
depends on the company's settings; to enable it, either "Automatic deduction" or "Combined" in the table
above is selected.

Automatically deducted time is **shown separately** from punch-derived rest periods in the monthly list.
This is so that you can notice that "a rest period is being deducted even though I did not punch it".

## When you could not actually take a rest period

Automatic deduction subtracts on the assumption that a rest period was taken.
**If it is subtracted as-is on a day when you could not actually take one, your working hours are recorded as
less than they were.**

Submit a **cancellation request** for that day. Once it is approved:

- The automatic deduction for that day is removed, and actual working hours return to what the punches show
- If the rest period falls short of the statutory minimum (45 minutes over 6 hours, 60 minutes over 8 hours),
  a rest period shortfall warning is displayed — this indicates that the company has not met its
  obligation to let workers take a rest period, not that your records are wrong

## When the deduction would drop you below the threshold

On a day with 6 hours 5 minutes of work, subtracting 45 minutes would leave 5 hours 20 minutes, which breaks
the very premise that "45 minutes applies once 6 hours is exceeded".
In such cases KIZAMI **deducts only down to the point where the threshold is exactly met**
(actual working hours are never cut below the threshold). In the 6 hours 5 minutes example, only 5 minutes
are subtracted, leaving exactly 6 hours, and nothing more is cut.

Note that when the result after subtraction lands exactly on the threshold, the full amount is deducted as
usual. Being present for 9 hours from 9:00 to 18:00 and subtracting 60 minutes leaves exactly 8 hours, but
that is precisely the most common way of working — "8 hours of work plus a 60-minute lunch break" — so it is
recorded that way.

## Relationship to the principles of simultaneous granting and free use

In addition to the rule on the quantity (number of hours) of rest periods (Article 34(1)), there is the
**principle of granting rest periods simultaneously** (Article 34(2); exceptions are possible by
labor-management agreement) and the **principle of free use of rest periods** (Article 34(3)). What KIZAMI
detects and deducts automatically is only the number of hours that can be determined mechanically from punch
data; whether rest periods were granted simultaneously or could be used freely is outside what it detects.
