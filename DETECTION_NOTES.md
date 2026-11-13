# Public research behind detection version 1.3

Reviewed on November 12, 2026. These are published implementation patterns and vendor documentation, not proof that a live class on the current account was tested.

| Source | Detection approach | Application to this project |
| --- | --- | --- |
| [aszaw/byeClicker content.js](https://github.com/aszaw/byeClicker/blob/main/content.js) | Observes DOM insertions/style changes; detects a visible join container, `#btnJoin`, `#/polling`, `.polling-page-wrapper`, answer-button containers and question images. | Add published Join/poll selectors, DOM-change inspection, image-backed questions and direct answer-button handling. Source code age/compatibility remains a limitation. |
| [JeetVaidya1/iclicker-notifier](https://github.com/JeetVaidya1/iclicker-notifier) and its [content script](https://github.com/JeetVaidya1/iclicker-notifier/blob/main/content.js) | Combines URL changes, MutationObserver, text patterns and WebSocket message monitoring; tracks question identity. | Independent timer, DOM and navigation signals are supplemented with passive debugger network activity hints. Internal event schemas and existing-socket delivery remain unverified. Hints trigger inspection/alerts and never replace visible control validation. |
| [DuckyCodes/iClicker](https://github.com/DuckyCodes/iClicker) | Describes Selenium-based login, class detection and poll interaction, gated by class schedule. | Confirms browser automation is a public approach; schedule alone does not establish that a class or question is live. The extension continues watching actual page state. |
| [Official iClicker poll participation guide](https://mhe.my.site.com/iclicker/s/article/How-to-Participate-in-a-Poll-with-the-iClicker-Student-App) | Select the course, click Join when class starts. A-E selections submit single-choice answers; other supported types use Send Answer. | Correct the original assumption that every question has a separate Submit button. |
| [University of Illinois student instructions](https://courses.physics.illinois.edu/phys100/fa2020/iclickerstudentsteps.pdf) | Documents the instructor-started banner, Join, checked-in waiting state and Answer Received confirmation. This is older documentation. | Add waiting/receipt wording as recognition signals; receipts must correspond to the same question fingerprint. |

The application reads rendered page content and acts through visible controls. It does not copy third-party projects' credential extraction, direct answer/reporting API calls, majority-answer selection, geolocation spoofing, or backend participation logic. Random single-choice fallback was added separately at the user's explicit request, with alerts and receipt checks.

## What can be verified without controlling a class

- Native Join and waiting-state recognition can be exercised with local fixtures.
- Native single-choice behavior, image delivery, hidden images, ambiguous controls, stale question fingerprints and receipt handling have automated regression coverage.
- The control panel can show which signals match the selected page now; this does not require an instructor account.
- The next real instructor-controlled session is still needed to establish that the current live markup, solver account and notification path work together. The previous browser inspection found completed poll history only. Public repositories can be stale, and the notifier's claimed user counts/reliability have not been independently verified.

Version 1.3 uses passive WebSocket event observation through the existing debugger attachment, without replacing the website's WebSocket constructor. It also adds tab-navigation wakeups, accessible-label/test-attribute fallbacks, accessible same-origin iframe probing, persisted command receipts, bounded solver deadlines, and unambiguous class-URL reconnection. These mechanisms degrade independently; none guarantee compatibility with every future redesign.

Keep the selected tab on the live course lobby. The application does not automatically navigate from archived poll history into a new class. Hidden/missing/unreadable question content produces an alert and, when enabled with clear live single-choice controls, an explicitly random choice. It never invents the missing question or treats network hints as permission to choose a different class or click an unclear control.
