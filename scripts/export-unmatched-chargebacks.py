import csv
import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path("/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current")
CONTACTS = json.loads((ROOT / "hubspot-snapshot/raw/contacts.json").read_text())
LEDGER = json.loads((ROOT / "ledger/canonical-ledger.json").read_text())
OUTPUT = ROOT / "review/unmatched-chargeback-dispute-payments.csv"

def normalize_email(value):
    return str(value or "").strip().lower()

def split_emails(value):
    return [normalize_email(item) for item in re.split(r"[;,\s]+", str(value or "")) if "@" in item]

def normalize_name(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()

def name_tokens(value):
    return tuple(sorted(normalize_name(value).split()))

current_emails = defaultdict(list)
current_names = defaultdict(list)
current_name_strings = []
for contact in CONTACTS:
    properties = contact.get("properties", {})
    for field in ("email", "hs_additional_emails", "legacy_email", "work_email", "hs_conversations_visitor_email"):
        for address in split_emails(properties.get(field)):
            current_emails[address].append(contact)
    names = []
    for first, last in ((properties.get("firstname"), properties.get("lastname")), (properties.get("legacy_firstname"), properties.get("legacy_lastname"))):
        full_name = normalize_name(f"{first or ''} {last or ''}")
        if len(full_name) >= 4:
            names.append(full_name)
            current_names[name_tokens(full_name)].append(contact)
    current_name_strings.append((contact, names))

ledger_emails = defaultdict(list)
ledger_names = defaultdict(list)
for record in LEDGER:
    if normalize_email(record.get("email")):
        ledger_emails[normalize_email(record["email"])].append(record)
    full_name = normalize_name(f"{record.get('first_name') or ''} {record.get('last_name') or ''}")
    if full_name:
        ledger_names[name_tokens(full_name)].append(record)

def current_match(email, name):
    email_matches = current_emails.get(normalize_email(email), [])
    if len(email_matches) == 1:
        return True
    exact_name_matches = current_names.get(name_tokens(name), [])
    if len(exact_name_matches) == 1:
        return True
    normalized = normalize_name(name)
    if not normalized:
        return False
    scores = []
    for contact, aliases in current_name_strings:
        score = max((SequenceMatcher(None, normalized, alias).ratio() for alias in aliases), default=0)
        if score >= 0.82:
            scores.append(score)
    scores.sort(reverse=True)
    return bool(scores and scores[0] >= 0.90 and (len(scores) == 1 or scores[0] - scores[1] >= 0.08))

def historic_match(email, name):
    return len(ledger_emails.get(normalize_email(email), [])) == 1 or len(ledger_names.get(name_tokens(name), [])) == 1

source_rows = []
workbook = load_workbook("/Users/vMac/Downloads/chargebacks.xlsx", read_only=True, data_only=True)
sheet = workbook["chargebacks"]
headers = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
for values in sheet.iter_rows(min_row=2, values_only=True):
    row = dict(zip(headers, values))
    source_rows.append({
        "source_document": "chargebacks.xlsx",
        "payment_reference": row.get("charge_id_or_payment_id", ""),
        "payment_date": row.get("created_at", ""),
        "amount": row.get("amount", ""),
        "currency": row.get("currency", ""),
        "customer_name": row.get("customer_name", ""),
        "customer_email": row.get("email", ""),
        "description_or_dispute_status": row.get("description", "")
    })
with open("/Users/vMac/Downloads/unified_payments.csv", newline="", encoding="utf-8-sig") as handle:
    for row in csv.DictReader(handle):
        disputed_amount = str(row.get("Disputed Amount") or "").strip()
        dispute_date = str(row.get("Dispute Date (UTC)") or "").strip()
        dispute_status = str(row.get("Dispute Status") or "").strip()
        if disputed_amount not in ("", "0", "0.0", "0.00") or dispute_date or dispute_status:
            source_rows.append({
                "source_document": "unified_payments.csv",
                "payment_reference": row.get("PaymentIntent ID") or row.get("id", ""),
                "payment_date": dispute_date or row.get("Created date (UTC)", ""),
                "amount": row.get("Disputed Amount") or row.get("Amount", ""),
                "currency": row.get("Currency", ""),
                "customer_name": row.get("Shipping Name") or row.get("Card Name", ""),
                "customer_email": row.get("Customer Email", ""),
                "description_or_dispute_status": dispute_status or row.get("Dispute Reason", "")
            })

unmatched = [row for row in source_rows if not current_match(row["customer_email"], row["customer_name"]) and not historic_match(row["customer_email"], row["customer_name"])]
for row in unmatched:
    row["hubspot_match_result"] = "no match in current portal or historic exports after email, aliases, normalized-name, and fuzzy-name checks"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
headers = ["source_document", "payment_reference", "payment_date", "amount", "currency", "customer_name", "customer_email", "description_or_dispute_status", "hubspot_match_result"]
with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
    writer = csv.DictWriter(handle, fieldnames=headers)
    writer.writeheader()
    writer.writerows(unmatched)
print(json.dumps({"output": str(OUTPUT), "unmatched_payment_rows": len(unmatched)}))
