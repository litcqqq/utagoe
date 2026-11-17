#!/usr/bin/env python3
"""Download/attention stats for a GitHub-hosted extension.

Usage:  python3 scripts/stats.py [owner/repo]
Token:  $GH_TOKEN, or ~/.github_token

What this can and cannot tell you, honestly:

  release asset download_count  — real, cumulative, never resets. Counts every
      HTTP fetch of the .zip: your own re-downloads, CI, mirrors, bots. It is a
      *download* count, not an install count. Someone who downloads and never
      loads it still increments this.
  traffic views / clones        — needs admin scope. GitHub only retains 14 days,
      so it is a trend line, not a total. After that the data is gone for good.
  stars / forks / watchers      — public, permanent, but a proxy for interest,
      not for use.

A user who installs from the Chrome Web Store never touches this repo, so none
of it appears here. Only the store dashboard counts real installs.
"""
import json
import os
import subprocess
import sys

API = "https://api.github.com"


def token():
    t = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if t:
        return t.strip()
    p = os.path.expanduser("~/.github_token")
    if os.path.exists(p):
        return open(p).read().strip()
    return None


def get(path, tok=None):
    """Return (data, error). Never raises — a 403 is information, not a crash."""
    cmd = ["curl", "-s", "-w", "\n%{http_code}", API + path]
    if tok:
        cmd += ["-H", "Authorization: token " + tok]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    body, _, code = out.rpartition("\n")
    if code != "200":
        try:
            msg = json.loads(body).get("message", body[:120])
        except Exception:
            msg = body[:120] or "no body"
        return None, "HTTP %s: %s" % (code, msg)
    return json.loads(body), None


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "litcqqq/utagoe"
    tok = token()

    print("=" * 62)
    print(" %s" % repo)
    print("=" * 62)

    # --- downloads: the only number that is real and cumulative ---
    rels, err = get("/repos/%s/releases" % repo, tok)
    print("\nRELEASE DOWNLOADS")
    if err:
        print("  ! %s" % err)
    else:
        total = 0
        for r in rels:
            print("  %s  (%s)" % (r["tag_name"], str(r["published_at"])[:10]))
            for a in r.get("assets", []):
                total += a["download_count"]
                print("      %-26s %5d downloads  %5.1f MB"
                      % (a["name"], a["download_count"], a["size"] / 1e6))
        print("  %-30s %5d" % ("TOTAL (all releases)", total))
        print("  note: includes your own re-downloads and CI fetches.")

    # --- traffic: expires after 14 days ---
    print("\nTRAFFIC (14-day window, admin scope required)")
    for key, label in (("views", "page views"), ("clones", "clones")):
        d, e = get("/repos/%s/traffic/%s" % (repo, key), tok)
        if e:
            print("  %-12s ! %s" % (label, e))
            print("  %-12s   open https://github.com/%s/graphs/traffic"
                  % ("", repo))
        else:
            print("  %-12s %d total, %d unique"
                  % (label, d.get("count", 0), d.get("uniques", 0)))

    d, e = get("/repos/%s/traffic/popular/referrers" % repo, tok)
    if e:
        print("  %-12s ! needs admin scope" % "referrers")
    elif d:
        print("  where visits came from:")
        for r in d[:8]:
            print("      %-34s %5d views / %4d uniques"
                  % (r["referrer"], r["count"], r["uniques"]))
    else:
        print("  referrers    no external traffic yet")

    # --- interest proxies: permanent and public ---
    print("\nINTEREST (public, permanent)")
    d, e = get("/repos/%s" % repo, tok)
    if not e:
        print("  stars %d | forks %d | watchers %d | open issues %d"
              % (d["stargazers_count"], d["forks_count"],
                 d["subscribers_count"], d["open_issues_count"]))

    print("\nREMINDERS")
    print("  - A GitHub download is not an install. Nothing in this repo can")
    print("    tell you whether the zip was actually loaded into Chrome.")
    print("  - Traffic data older than 14 days is deleted by GitHub.")
    print("  - Real install numbers only exist in the Chrome Web Store")
    print("    dashboard, once the extension is published there.")


if __name__ == "__main__":
    main()
