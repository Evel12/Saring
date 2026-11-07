"""Recruiter-initiated observation of ONE public link.

Bounded by design: no crawling, no search, no logged-in access, no HTML body
storage. Public GitHub data comes from the documented REST API; a LinkedIn
page is only observed for reachability and its public <title> (stop at the
first response). Output is a neutral observation for human review; it never
establishes expertise, authorship or suitability on its own.
"""
import re
import httpx

SUPPORTED = re.compile(r"^https://(www\.)?(github\.com|linkedin\.com)/")
GITHUB_USER = re.compile(r"^https://github\.com/([A-Za-z0-9-]{1,39})/?$")
GITHUB_REPO = re.compile(r"^https://github\.com/([A-Za-z0-9-]{1,39})/([A-Za-z0-9_.-]{1,100})/?$")
TITLE = re.compile(r"<title[^>]*>([^<]{1,200})</title>", re.I)
VISIBLE = re.compile(r"[^\s<>]+")


def _github(url):
    user = GITHUB_USER.match(url)
    repo = GITHUB_REPO.match(url)
    if not user and not repo:
        raise ValueError("GitHub links must be a profile (github.com/name) or repository (github.com/name/repo)")
    subject = ("/repos/{}/{}".format(*repo.groups()) if repo else "/users/" + user.group(1))
    with httpx.Client(timeout=15, follow_redirects=True,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Saring/1"}) as client:
        response = client.get("https://api.github.com" + subject)
        if response.status_code == 404:
            return {"state": "not_found", "message": "No public GitHub account or repository at that address.",
                "url": url}
        if response.status_code == 403 and response.headers.get("x-ratelimit-remaining") == "0":
            return {"state": "manual", "message": "GitHub's public API rate limit is reached; try again later or review manually.",
                "url": url}
        if response.status_code != 200:
            response.raise_for_status()
        data = response.json()
        observation = {"url": url, "state": "observed"}
        if repo:
            languages = client.get("https://api.github.com" + subject + "/languages")
            observation.update({
                "subject": "repository", "title": data.get("full_name"),
                "description": data.get("description") or "", "primary_language": data.get("language") or "",
                "languages": ", ".join(list((languages.json() or {}).keys())[:6]) if languages.status_code == 200 else "",
                "fork": bool(data.get("fork")), "last_public_commit_utc": data.get("pushed_at") or "",
                "message": "Public repository metadata; presence and content do not by themselves establish expertise.",
            })
        else:
            observation.update({
                "subject": "profile", "login": data.get("login") or "", "title": data.get("name") or data.get("login"),
                "bio": data.get("bio") or "", "public_repositories": data.get("public_repos"),
                "joined_utc": data.get("created_at") or "",
                "message": "Public profile metadata from GitHub's documented API; no automated judgment is attached.",
            })
        return observation


def _generic(url):
    """Any other public https link: light-touch reachability only.

    Bounded: a single request, no crawling, no search, no cookies, and only a
    tiny body read for the <title>. A reachable page is still only a neutral
    observation for human review.
    """
    with httpx.Client(timeout=15, follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; Saring/1)"}) as client:
        response = client.get(url)
    title = TITLE.search(response.text[:500000])
    return {"url": url,
        "state": "observed" if response.status_code == 200 and title else "manual",
        "subject": "public page", "title": (title.group(1).strip() if title else ""),
        "status_code": response.status_code,
        "message": ("Link reached a public page as served; content review requires a human recruiter. "
            if response.status_code == 200 else
            "The site answered " + str(response.status_code) + "; review the link manually.")}


def harvest(url):
    """Open one public page and extract readable text for AI review.

    Bounded: single request, redirects followed, only the first 200 kB of
    body, scripts/styles dropped, output capped. Returns the same shape as
    _generic/observe plus "text" (readable page text, possibly empty).
    """
    import html
    with httpx.Client(timeout=20, follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; Saring/1)"}) as client:
        response = client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Saring/1)"})
    body = response.text[:200000]
    title = TITLE.search(body)
    text = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", body)
    text = re.sub(r"(?s)<!--.*?-->", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    # OCR and markup leave stray control bytes (e.g. U+007F bullets).
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text)
    words = VISIBLE.findall(text)
    return {"url": url,
        "state": "observed" if response.status_code == 200 else "manual",
        "status_code": response.status_code,
        "title": (title.group(1).strip() if title else ""),
        "text": " ".join(words)[:20000]}


def _linkedin(url):
    # Gated site: no scraping. Only reachability plus the public page <title>.
    if not re.match(r"^https://www\.linkedin\.com/(in|company)/[A-Za-z0-9._%-]{1,100}/?$", url):
        raise ValueError("LinkedIn links must be a public profile (linkedin.com/in/name) or company page")
    with httpx.Client(timeout=15, follow_redirects=False, headers={"User-Agent": "Mozilla/5.0 (compatible; Saring/1)"}) as client:
        response = client.get(url)
    title = TITLE.search(response.text[:500000])
    return {"url": url, "state": "observed" if response.status_code == 200 and title else "manual",
        "subject": "public page", "title": (title.group(1).strip() if title else ""),
        "message": ("Open page title as publicly served; content review requires a human recruiter. "
            if response.status_code == 200 else
            "The site did not serve the page to this tool; review the link manually.")}


def observe(url, allow_generic=False):
    url = url.strip()
    if len(url) > 500 or not url.startswith("https://"):
        raise ValueError("Provide an https link of at most 500 characters")
    if "github.com" in url or "linkedin.com" in url:
        if not SUPPORTED.match(url):
            raise ValueError("Only public github.com or linkedin.com links are supported")
        try:
            if "github.com" in url:
                return _github(url)
            return _linkedin(url)
        except httpx.HTTPError:
            return {"url": url, "state": "unreachable", "message": "The link could not be reached; review it manually."}
        except httpx.HTTPStatusError as exc:
            return {"url": url, "state": "unreachable", "message": f"Public site answered {exc.response.status_code}; review it manually."}
    if not allow_generic:
        raise ValueError("Only public github.com or linkedin.com links are supported")
    try:
        return _generic(url)
    except httpx.HTTPError:
        return {"url": url, "state": "unreachable", "message": "The link could not be reached; review it manually."}
