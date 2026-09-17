# Project conventions and decisions

- Survey module: user explicitly approved gps_accuracy_m NUMERIC(6,2), accepting 0 through 1000 metres, instead of the initial incompatible NUMERIC(5,2).
- Survey photos: user explicitly approved keeping old files. Upload a new photo, then commit its path through the RPC; do not call browser storage.remove or create UPDATE/DELETE storage policies. This supersedes the original delete-before-upload request.
- Modify existing source files with targeted search/replace or diffs, never whole-file rewrites. A complete new app/survey/page.tsx was requested.
