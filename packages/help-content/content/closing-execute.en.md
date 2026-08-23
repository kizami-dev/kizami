---
key: closing.execute
audience: [employee, admin]
origin: product
summary: Performing a monthly closing confirms that month's attendance records, and any punch or correction afterwards requires a request and approval. The figures as of the moment of confirmation are fixed as a snapshot.
companyExample: |
  The previous month is closed on the 5th of each month. Complete your correction requests before then.
  If a correction is needed after the closing, contact the HR department through your supervisor.
---

# Monthly closing

A closing is the operation that "confirms" the attendance records for the target month. The figures as of the
moment of closing, such as the totals by category and the flex balance, are fixed as a **snapshot** and do not
change retroactively afterwards, even if punches or the method of aggregation change.

## What happens after closing

- After closing, punches can no longer be added, corrected or cancelled; changing them requires **a correction request and its approval**
- Unlocking the closing (releasing the confirmation) returns the month to a freely editable state. Unlocking requires a separate permission
- Every closing, unlocking and post-closing amendment is recorded in the audit log

Because a closing is the starting point for downstream processing such as payroll, it exists to keep the
figures of a closed month from changing unintentionally.
