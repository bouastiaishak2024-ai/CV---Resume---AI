#!/usr/bin/env python3
"""Generate the activation codes you hand out at the sale.

One permanent URL for everybody, one code per customer. For a cash business you
want codes in hand before the sale, not generated during it — so mint a batch,
paste it into Cloudflare once, and give out one code per customer as you sell.

Each code is independently revocable: delete it from ACCESS_CODES and that one
customer is locked out within seconds, including on a device they had already
activated. Nobody else is affected.

    python3 scripts/make_codes.py --count 25 --site https://your-site.pages.dev

Writes customers.csv (gitignored — it holds who bought what, which is your record,
not something to publish). Re-running appends rather than overwriting.

Codes avoid 0/O/1/I/l so nothing is misread from a handwritten note.

Identical in every detail to the sister job-database project's script of the same
name — this product has its own customers.csv and its own ACCESS_CODES, but there
was no reason to reinvent a script that already works.
"""
import argparse, csv, datetime, pathlib, secrets

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # no 0 O 1 I l
ROOT = pathlib.Path(__file__).resolve().parent.parent
LEDGER = ROOT / "customers.csv"


def make(n=4, group=4):
    """A code like K7M2-PQXR-93TD-BHVW — 20 bits of entropy per group."""
    return "-".join("".join(secrets.choice(ALPHABET) for _ in range(group)) for _ in range(n))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=25, help="how many codes to mint")
    ap.add_argument("--site", default="https://YOUR-SITE.pages.dev",
                    help="your deployed site URL, used to print the ready-to-send links")
    ap.add_argument("--note", default="", help="label for this batch, e.g. 'October stock'")
    a = ap.parse_args()

    existing = set()
    if LEDGER.exists():
        with LEDGER.open(encoding="utf-8") as f:
            existing = {r["code"] for r in csv.DictReader(f)}

    fresh = []
    while len(fresh) < a.count:
        c = make()
        if c not in existing:
            fresh.append(c)
            existing.add(c)

    new = not LEDGER.exists()
    with LEDGER.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["code", "minted", "batch", "sold_to", "sold_on", "revoked"])
        today = datetime.date.today().isoformat()
        for c in fresh:
            w.writerow([c, today, a.note, "", "", ""])

    if fresh:
        print(f"{len(fresh)} codes minted, appended to {LEDGER.name}\n")
    else:
        print(f"No new codes minted. Reprinting the live list from {LEDGER.name}.")
        print("(This is the reprint you want after marking a code revoked.)\n")
    print("=" * 62)
    print("PASTE THIS into Cloudflare -> your Pages project -> Settings ->")
    print("Environment variables -> ACCESS_CODES  (Production).")
    print("If ACCESS_CODES already has codes, append these to the existing value.")
    print("=" * 62)
    with LEDGER.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    live = [r["code"] for r in rows if not r["revoked"].strip()]
    if not live:
        print("(no live codes — every code in the ledger is marked revoked)")
    print(",".join(live))
    print()
    revoked = len(rows) - len(live)
    if revoked:
        print(f"({revoked} revoked code{'s' if revoked != 1 else ''} left out of that list.)")
        print()

    if fresh:
        print("=" * 62)
        print("WHAT THE CUSTOMER GETS — the same address every time,")
        print("plus their own code. They enter it once, on each device.")
        print("=" * 62)
        print(f"  address:  {a.site}")
        print()
        print("  new codes to hand out:")
        for c in fresh:
            print(f"    {c}")
        print()
        print("A direct link also works if messaging is easier than dictating:")
        print(f"    {a.site}/?k={fresh[0]}")
        print()

    print("After changing ACCESS_CODES in Cloudflare you must REDEPLOY —")
    print("environment variables only take effect on a fresh deployment.")
    print()
    print("Record who got which code in the sold_to column of customers.csv.")
    print("To revoke: put 'yes' in that code's revoked column, re-run this script")
    print("with --count 0, and paste the reprinted list back into Cloudflare.")


if __name__ == "__main__":
    main()
