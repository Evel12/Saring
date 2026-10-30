"""Export the same synthetic originals offered by Saring's closed demo catalog."""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from backend.demo_files import bytes_for

README = """Saring synthetic CV test pack

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
  .\\.venv\\Scripts\\python.exe -m backend.export_demo_cvs
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="demo-cvs")
    args = parser.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    names = [("support", "01_customer_support"), ("developer", "02_software_developer"),
        ("scan", "03_scanned_support"), ("unreadable", "04_unreadable"), ("hostile", "05_hostile_instructions")]
    files = []
    for variant, name in names:
        data, suffix = bytes_for(variant)
        path = root / (name + suffix)
        path.write_bytes(data)
        files.append(path)
    readme = root / "README.txt"
    readme.write_text(README, encoding="utf-8")
    with ZipFile(root / "saring-demo-cvs.zip", "w", ZIP_DEFLATED) as archive:
        for path in [*files, readme]:
            archive.write(path, path.name)
    print(f"Exported five synthetic CV fixtures and ZIP to {root.resolve()}")


if __name__ == "__main__":
    main()
