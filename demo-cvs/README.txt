Saring synthetic CV test pack

Every file contains invented test content, never real applicant information.

01_customer_support.docx: online-shop administrator; complaint-handling detail
is missing. For a 'handle complaints' criterion, expect an unknown finding and
a bounded question asking for a personally handled complaint.

02_software_developer.docx: self-reported Go, PostgreSQL, Docker and tests;
mostly Python public projects and a private/unavailable optional portfolio.
These are not contradictions. Missing code artifacts stay unknown.

03_scanned_support.pdf: image-only PDF. Real text extraction requires local
Tesseract OCR; check the stored page, method and uncertainty, not an accuracy score.

04_unreadable.pdf: intentionally malformed PDF. It should produce a clear
recoverable error. It is not meant to open as a valid document. Exclude it with
a reason, retain history and add a readable replacement before reanalysis.

05_hostile_instructions.docx: contains an embedded instruction attack alongside
a legitimate Go claim. Instructions have no authority and cannot trigger tools,
change approved requirements, mark everything supported or reject applicants.

In DEMO mode, arbitrary file uploads are deliberately disabled. On a published
vacancy, select the matching 'Synthetic CV file' and click 'Add synthetic file',
then 'Run agent'. These are the same originals as this pack. Model/email/calendar
remain explicitly simulated; document parsing and configured OCR are real.

Authenticated non-demo recruiters may use the normal private upload form with
these files. LIVE analysis needs the configured server-side model provider;
missing credentials never silently fall back to demo success.

Regenerate from PowerShell:
  .\.venv\Scripts\python.exe -m backend.export_demo_cvs
