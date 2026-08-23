---
key: permission.presets
audience: [admin]
origin: product
summary: Permission presets are added together when several are assigned, and operational permissions such as approval and execution automatically include the corresponding view permissions. There is no deny rule that cancels out a specific permission.
---

# How permission presets work

A permission preset is a unit of assignment, defined by combining permissions that are on or off
with the range they apply to (the scope).

## Multiple assignments are added together

When several presets are assigned to one member, the permissions they hold are **added together**.
Where different scopes are assigned for the same permission, the broader scope takes effect.

## Operations imply viewing

When you turn on an operational permission such as approval, execution, or administration, the view
permissions needed for that operation within its range are enabled automatically. For example, if
you turn on "Approve time punch correction requests", the member can also view correction requests
and attendance records within the range concerned, without those being turned on separately.

## There is no deny rule

The KIZAMI permission model has no "deny" rule that explicitly cancels out a specific permission.
So that assigning several presets does not end up granting broader permissions than intended, check
the list of permissions each preset actually turns on when you assign them.
