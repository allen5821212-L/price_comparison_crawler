# Crawler monitor validation

Validated in the authenticated development dashboard on 2026-08-16.

- The `/crawler` page rendered the persisted completed full-platform job (`#60001`) created by the persistent cloud worker.
- The page rendered the corresponding `爬蟲工作完成` monitoring event and calculated summary state without remaining in the loading skeleton.
- The monitor queries now run inside the authenticated dashboard without waiting for the client-side role hydration condition; server-side `adminProcedure` remains the authorization boundary.
