# Colour palette

Use these roles for new UI components. Add roles here as the interface grows; existing component colours can be migrated in separately agreed steps.

| Role | Colour | Use |
| --- | --- | --- |
| Background | `#F7F9FA` | Page background and quiet hover surfaces |
| Panels | `#FFFFFF` | Rails, drawers and grouped control surfaces |
| Main text | `#203039` | Headings, labels and body text |
| Secondary text | `#586874` | Supporting text and inactive navigation |
| Primary action | `#176B63` | Main action buttons, active text and focus outlines |
| Selected state | `#E8F3F0` | Selected navigation background |
| Divider | `#A9B7BD` | Boundaries between adjacent panels |

Group related controls in white panels with clear headings and spacing. Use the background colour between groups to keep the map and controls easy to scan.

Keep the rail's right divider visible whether its navigation is selected or unselected, so the rail remains distinct from the table. The divider reuses the existing fieldset border colour.

- **Primary:** filled teal with white text for the main action, such as Apply.
- **Secondary:** white with teal text and a teal border for a supporting action.
- **Tertiary:** quiet text with no filled background for a low-emphasis action.
- **Selected navigation:** pale teal with deep teal text. This marks the current selection; reserve the filled teal treatment for primary actions.

The left rail and attribute settings drawer use this palette. Future: Apply these roles to other new components.
