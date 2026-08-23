---
key: correction.flow
audience: [employee, admin]
origin: product
summary: Time punches cannot be edited directly. Additions, amendments, and cancellations are all submitted as correction requests, and they are reflected in attendance records only after approval. Every change, including approvals, rejections, and withdrawals, is recorded in the audit log.
companyExample: |
  Submit requests by the end of the business day following the day concerned.
  During busy periods (the last three business days of the month), approval may be delayed until the next business day.
---

# How time punch correction requests work

The time punch records themselves cannot be rewritten directly. To add, amend, or cancel a time
punch, you submit a **correction request**, and the change reaches the attendance records only as
the result of an approval.

## Types of request

- **Addition**: a request to newly register a clock-in, clock-out, or rest period that was not punched
- **Amendment**: a request to change the time or type of an existing time punch
- **Cancellation**: a request to treat an existing time punch as never having been made

## Flow up to approval

1. The person concerned (or a member with delegate permission) submits the request with a reason (status: Pending)
2. A member with approval permission reviews the content and approves or rejects it
3. Once approved, the change is applied to the time punch and reflected in the monthly totals. A rejected request is not applied
4. While the request is pending, the person concerned can also withdraw it

If the month concerned has already been closed, a separate permission to unlock the closing is
required in order to approve the request.

## Everything is kept in the audit log

Submission, approval, rejection, and withdrawal of a request are all recorded in the audit log,
including when and by whom. When the approver and the requester are the same person
(self-approval), that fact is also kept as a record.
