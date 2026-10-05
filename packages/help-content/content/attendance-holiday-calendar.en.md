---
key: attendance.holiday-calendar
audience: [admin]
origin: product
summary: The company holiday calendar is used to count the contractual limit (scheduled days × standard hours) for flexible working hours. It sets company-designated holidays by weekday, national holidays and individual dates. Statutory holidays are always treated as days off regardless of this setting.
companyExample: |
  The year-end and New Year period (December 29 to January 3) and the summer break (August 13 to 15) are company-designated holidays.
---

# Company holiday calendar

The company holiday calendar decides **which days are scheduled working days**. KIZAMI uses it to count the
scheduled working days for flexible working hours policies whose total working hours are "scheduled days ×
standard hours" ([how total working hours are decided](./attendance-flex-contract)). It has no effect on
policies whose total working hours are "the statutory limit".

## What you can set

| Item | Meaning | Default |
| --- | --- | --- |
| Holiday weekdays | Weekdays that are off every week | Saturday and Sunday |
| National holidays | Whether national holidays (including substitute holidays and citizens' holidays) are company-designated holidays | Yes |
| Dates added as holidays | Individual days off, such as the year-end period or a summer break | None |
| Dates removed from holidays | Days that are scheduled working days, such as a national holiday on which you operate | None |

Like the other attendance rules, the calendar is saved as **versions with an effective date**. New versions
can only be added from today onward, and calculations for past months do not change. If the calendar has never
been saved, KIZAMI counts with the default (Saturdays, Sundays and national holidays).

## Relationship with statutory holidays

Statutory holidays (one day per week or four days in four weeks under Article 35 of the Labor Standards Act;
see [the difference between statutory holidays and company-designated holidays](./attendance-legal-holiday)) are
part of the company-designated holidays. When counting scheduled working days, statutory holidays are **always
treated as days off regardless of this calendar** (they never become scheduled working days, even if you leave
the weekday out or list the date as removed from holidays).

Conversely, company-designated holidays in this calendar are never treated as statutory holidays. Only work on
the statutory holidays set in the attendance rules is subject to the holiday work premium (35% or more).

## National holiday data

KIZAMI bundles the list of "national holidays" published by the Cabinet Office to determine holidays. The
Vernal and Autumnal Equinox Days for the following year are fixed around February each year, so the bundled data
is updated once a year. When counting a month in a year not covered by the bundled data, KIZAMI counts national
holidays as scheduled working days and shows a warning.
