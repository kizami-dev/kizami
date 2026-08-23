---
key: attendance.warnings
audience: [employee, admin]
origin: product
summary: When punches are incomplete, KIZAMI interprets the missing or contradictory parts conservatively. Intervals with no matching punch are left out of the totals, and punches that do not add up are invalidated.
---

# How incomplete punches are handled

A forgotten punch or a mistaken action can leave clock-in, clock-out or rest period punches incomplete.
KIZAMI **interprets such cases conservatively**.

## Why the interpretation is conservative

Working hours have to record "the hours actually worked" correctly. Filling in an interval with a missing
punch by guesswork and counting it as working hours risks recording more (or less) working time than there
actually was. So that intervals it cannot confirm are never fabricated as working hours, KIZAMI follows the
policy of **leaving missing information out of the totals**. Where this differs from the actual working hours,
supply the correct punches with a correction request.

## Main patterns

| Situation | How KIZAMI handles it |
| --- | --- |
| No clock-out punch | That work interval is excluded from the totals (not counted as hours worked) |
| A duplicate clock-in punch while already working | The later duplicate clock-in punch is invalidated |
| A clock-out punch while not clocked in | That clock-out punch is invalidated |
| A rest period punch outside of work | That rest period punch is invalidated |
| A duplicate rest period start punch while already on a rest period | The later duplicate rest period start punch is invalidated |
| A rest period end punch with no matching rest period start | That rest period end punch is invalidated |
| A clock-out punch during a rest period | Treated as having ended the rest period and clocked out |

These are shown in the warnings column of the monthly screen. Where they differ from the actual working
hours, use "Correct" for that day to request the correct punches.
