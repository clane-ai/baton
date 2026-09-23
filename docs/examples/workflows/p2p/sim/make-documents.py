"""Generates the sample documents for the procure-to-pay simulation.

Writes, under the target directory (default: ./p2p-run):
  masterdata/vendors.csv, catalogue.csv, policy.md
  inbox/requisitions/PR-2026-nnn.pdf + .txt + .eml   (one per scenario)
  .sim/scenarios.json                                 (what the supplier ERP and the human simulator do per requisition)

Usage: python make-documents.py [target-dir]
Needs reportlab (pip install reportlab). pdftotext is used for the .txt extracts when present, else reportlab text.
"""
import csv, json, os, subprocess, sys
from datetime import date, timedelta
from email.message import EmailMessage
from email.utils import formatdate
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

TARGET = sys.argv[1] if len(sys.argv) > 1 else "p2p-run"
TODAY = date(2026, 9, 23)

VENDORS = [
    # id, name, email, approved, terms, iban
    ("V-1001", "Nordlicht Computing GmbH", "orders@nordlicht-computing.example", "yes", "30 days", "DE89370400440532013000"),
    ("V-1002", "Atlantic Office Supplies Ltd", "sales@atlantic-office.example", "yes", "30 days", "IE29AIBK93115212345678"),
    ("V-1003", "Meridian Cloud Services", "billing@meridian-cloud.example", "yes", "14 days", "GB29NWBK60161331926819"),
    ("V-1004", "Brightpath Consulting", "accounts@brightpath.example", "yes", "30 days", "IE64IRCE92050112345678"),
    ("V-2001", "QuickParts Trading", "hello@quickparts.example", "no", "prepaid", "LT121000011101001000"),
]

CATALOGUE = [
    # vendor, sku, item, unit, unit_price, currency
    ("V-1001", "NL-LT14", "Nordlicht Pro 14 laptop, 32 GB, 1 TB", "each", 1200.00, "EUR"),
    ("V-1001", "NL-DOCK", "USB-C docking station", "each", 180.00, "EUR"),
    ("V-1001", "NL-MON27", "27-inch 4K monitor", "each", 410.00, "EUR"),
    ("V-1001", "NL-SRV2U", "Rack server 2U, 2x CPU, 256 GB", "each", 8400.00, "EUR"),
    ("V-1002", "AO-CHAIR", "Ergonomic task chair", "each", 340.00, "EUR"),
    ("V-1002", "AO-DESK", "Sit-stand desk 160 cm", "each", 620.00, "EUR"),
    ("V-1002", "AO-PAPER", "Copy paper A4, box of 5 reams", "box", 24.50, "EUR"),
    ("V-1003", "MC-VM8", "Cloud VM 8 vCPU, monthly", "month", 310.00, "USD"),
    ("V-1003", "MC-STOR", "Object storage 10 TB, monthly", "month", 230.00, "USD"),
    ("V-1004", "BP-DAY", "Senior consultant day", "day", 1150.00, "EUR"),
    ("V-2001", "QP-SSD2", "2 TB NVMe SSD", "each", 149.00, "EUR"),
]

POLICY = """# Purchasing policy (extract)

## Approval levels (per purchase order, excluding VAT)
| Order total | Approver |
|---|---|
| up to 2,000 | none (buyer may release) |
| 2,000.01 to 10,000 | manager |
| 10,000.01 to 50,000 | director |
| above 50,000 | CFO |

Every purchase order in this process goes to the approval step regardless of amount; the
approver's authority is manager level (limit 10,000). Orders above the approver's authority
must be rejected with the reason "escalate" so the requester can route them to the right level.

## Vendors
- Only vendors marked approved=yes in the vendor master may receive a purchase order.
- A requisition naming a non-approved vendor is raised as a PO with vendor_approved=false and
  must be rejected by the approver until the vendor is onboarded.

## Prices
- The contracted price in the catalogue is binding. A requisition quoting another price is
  ordered at the catalogue price and the difference is noted.

## Matching tolerances (three-way match)
- Unit price: an invoice line may exceed the PO unit price by at most 1 percent.
- Quantity: invoiced quantity must equal the quantity received in good condition. No tolerance.
- The invoice total must equal the sum of matched lines. No tolerance.
- An invoice that fails the match is disputed with the supplier; nothing is paid until a credit
  note or a corrected invoice arrives.

## Payment
- Payment is scheduled on the invoice due date according to the vendor's terms.
"""

# One scenario per requisition. "erp" tells the supplier-ERP integration what to do; "expect" is the end state
# the simulation scores against; "human" is a hint for the human simulator (it decides by policy, not by this).
SCENARIOS = [
    dict(pr="PR-2026-101", requester="Maeve Doyle", dept="Engineering", cost_center="CC-410", vendor="V-1001", currency="EUR",
         lines=[("NL-LT14", 4), ("NL-DOCK", 4)], justification="Laptops and docks for four new engineers starting 12 October.",
         needed_by="2026-10-09", erp=dict(), expect="paid", label="clean order, under limit"),
    dict(pr="PR-2026-102", requester="Tomasz Nowak", dept="Facilities", cost_center="CC-120", vendor="V-1002", currency="EUR",
         lines=[("AO-CHAIR", 6), ("AO-PAPER", 10)], justification="Chairs for the new meeting room and paper stock for Q4.",
         needed_by="2026-10-15", erp=dict(), expect="paid", label="clean order, two lines"),
    dict(pr="PR-2026-103", requester="Priya Raman", dept="Platform", cost_center="CC-430", vendor="V-1001", currency="EUR",
         lines=[("NL-SRV2U", 3)], justification="Three rack servers for the on-prem build cluster (25,200 EUR).",
         needed_by="2026-11-01", erp=dict(), expect="rejected", label="over the approver limit (director level)"),
    dict(pr="PR-2026-104", requester="Sean Byrne", dept="Design", cost_center="CC-220", vendor="V-1001", currency="EUR",
         lines=[("NL-MON27", 5)], justification="Monitors for the design team.",
         needed_by="2026-10-10", erp=dict(invoice_price={"NL-MON27": 455.00}), expect="disputed", label="supplier overbills unit price (+11%)"),
    dict(pr="PR-2026-105", requester="Aoife Kelly", dept="Support", cost_center="CC-310", vendor="V-1002", currency="EUR",
         lines=[("AO-DESK", 10)], justification="Sit-stand desks for the support floor.",
         needed_by="2026-10-20", erp=dict(ship_qty={"AO-DESK": 8}, invoice_qty={"AO-DESK": 10}), expect="disputed", label="short delivery (8 of 10), invoiced for 10"),
    dict(pr="PR-2026-106", requester="Liam Walsh", dept="Engineering", cost_center="CC-410", vendor="V-2001", currency="EUR",
         lines=[("QP-SSD2", 12)], justification="Fast SSDs for the CI runners; QuickParts is cheapest online.",
         needed_by="2026-10-05", erp=dict(), expect="rejected", label="vendor not approved"),
    dict(pr="PR-2026-107", requester="Hannah Murphy", dept="Data", cost_center="CC-440", vendor="V-1003", currency="USD",
         lines=[("MC-VM8", 3), ("MC-STOR", 1)], justification="Three analytics VMs and storage for Q4, monthly.",
         needed_by="2026-10-01", erp=dict(fail_first=True), expect="paid", label="clean order in USD; supplier ERP times out once"),
    dict(pr="PR-2026-108", requester="Conor Fitzgerald", dept="Operations", cost_center="CC-150", vendor="V-1004", currency="EUR",
         lines=[("BP-DAY", 6)], justification="Six consultant days for the warehouse process review.",
         needed_by="2026-10-31", erp=dict(damaged={"BP-DAY": 0}), expect="paid", label="services order, one damaged-flag noise line (0 damaged)"),
]

def money(v): return f"{v:,.2f}"

def write_masterdata(root):
    md = os.path.join(root, "masterdata"); os.makedirs(md, exist_ok=True)
    with open(os.path.join(md, "vendors.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["vendor_id", "name", "email", "approved", "payment_terms", "iban"]); w.writerows(VENDORS)
    with open(os.path.join(md, "catalogue.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["vendor_id", "sku", "item", "unit", "unit_price", "currency"]); w.writerows(CATALOGUE)
    with open(os.path.join(md, "policy.md"), "w") as f: f.write(POLICY)

def requisition_pdf(path, sc):
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Title"], fontSize=16, spaceAfter=6)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=16*mm, bottomMargin=16*mm)
    vend = next(v for v in VENDORS if v[0] == sc["vendor"])
    cat = {c[1]: c for c in CATALOGUE}
    rows = [["Line", "SKU", "Description", "Qty", "Unit", "Est. unit price", "Est. total"]]
    total = 0
    for i, (sku, qty) in enumerate(sc["lines"], 1):
        c = cat[sku]; lt = qty * c[4]; total += lt
        rows.append([str(i), sku, c[2], str(qty), c[3], money(c[4]), money(lt)])
    rows.append(["", "", "", "", "", "Estimated total", money(total) + " " + sc["currency"]])
    t = Table(rows, colWidths=[12*mm, 22*mm, 66*mm, 12*mm, 14*mm, 26*mm, 28*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e9ecef")), ("GRID", (0, 0), (-1, -2), 0.4, colors.grey),
                           ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("ALIGN", (3, 1), (-1, -1), "RIGHT"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold")]))
    story = [Paragraph("PURCHASE REQUISITION", h),
             Paragraph("Zeus Ireland Ltd, 12 Docklands Quay, Dublin 1", small), Spacer(1, 6),
             Table([["Requisition no.", sc["pr"], "Date", TODAY.isoformat()],
                    ["Requester", sc["requester"], "Department", sc["dept"]],
                    ["Cost centre", sc["cost_center"], "Needed by", sc["needed_by"]],
                    ["Preferred vendor", f"{vend[1]} ({vend[0]})", "Vendor email", vend[2]],
                    ["Deliver to", "Goods-in, Unit 4, Northwest Business Park, Dublin 15", "Currency", sc["currency"]]],
                   colWidths=[30*mm, 70*mm, 26*mm, 54*mm], style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"), ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.lightgrey)])),
             Spacer(1, 10), t, Spacer(1, 10),
             Paragraph("<b>Business justification</b><br/>" + sc["justification"], styles["Normal"]), Spacer(1, 14),
             Paragraph("Requester signature: ____________________ &nbsp;&nbsp; Budget holder: ____________________", styles["Normal"]), Spacer(1, 8),
             Paragraph("Prices are estimates from the requester; purchasing orders at contracted catalogue prices. This form is an internal request, not an order.", small)]
    doc.build(story)
    return total

def requisition_txt(path, sc, total):
    """A faithful plain-text rendering of the form (pdftotext scrambles the two-column header)."""
    vend = next(v for v in VENDORS if v[0] == sc["vendor"])
    cat = {c[1]: c for c in CATALOGUE}
    out = ["PURCHASE REQUISITION", "Zeus Ireland Ltd, 12 Docklands Quay, Dublin 1", "",
           f"Requisition no.: {sc['pr']}", f"Date: {TODAY.isoformat()}", f"Requester: {sc['requester']}", f"Department: {sc['dept']}",
           f"Cost centre: {sc['cost_center']}", f"Needed by: {sc['needed_by']}", f"Preferred vendor: {vend[1]} ({vend[0]})", f"Vendor email: {vend[2]}",
           "Deliver to: Goods-in, Unit 4, Northwest Business Park, Dublin 15", f"Currency: {sc['currency']}", "",
           "Line | SKU | Description | Qty | Unit | Est. unit price | Est. total"]
    for i, (sku, qty) in enumerate(sc["lines"], 1):
        c = cat[sku]; out.append(f"{i} | {sku} | {c[2]} | {qty} | {c[3]} | {money(c[4])} | {money(qty * c[4])}")
    out += [f"Estimated total: {money(total)} {sc['currency']}", "", "Business justification: " + sc["justification"], "",
            "Prices are estimates from the requester; purchasing orders at contracted catalogue prices. This form is an internal request, not an order."]
    with open(path, "w") as f: f.write(chr(10).join(out) + chr(10))

def eml(path, frm, to, subject, body, attach=None):
    m = EmailMessage(); m["From"] = frm; m["To"] = to; m["Subject"] = subject; m["Date"] = formatdate(localtime=True)
    m.set_content(body)
    if attach:
        with open(attach, "rb") as f: m.add_attachment(f.read(), maintype="application", subtype="pdf", filename=os.path.basename(attach))
    with open(path, "wb") as f: f.write(bytes(m))

def txt_extract(pdf, txt):
    try:
        subprocess.run(["pdftotext", "-layout", pdf, txt], check=True, capture_output=True)
    except Exception:
        from pypdf import PdfReader
        with open(txt, "w") as f: f.write("\n".join(p.extract_text() or "" for p in PdfReader(pdf).pages))

def main():
    root = TARGET
    for d in ("inbox/requisitions", "inbox/deliveries", "inbox/invoices", "outbox", ".sim"): os.makedirs(os.path.join(root, d), exist_ok=True)
    write_masterdata(root)
    index = []
    for sc in SCENARIOS:
        base = os.path.join(root, "inbox", "requisitions", sc["pr"])
        total = requisition_pdf(base + ".pdf", sc)
        requisition_txt(base + ".txt", sc, total)
        vend = next(v for v in VENDORS if v[0] == sc["vendor"])
        eml(base + ".eml", f"{sc['requester']} <{sc['requester'].lower().replace(' ', '.')}@zeus.example>", "purchasing@zeus.example",
            f"Requisition {sc['pr']}: {sc['label'].split(',')[0]} for {sc['dept']}",
            f"Hi purchasing,\n\nPlease raise a PO for the attached requisition {sc['pr']} with {vend[1]}. {sc['justification']}\nNeeded by {sc['needed_by']}.\n\nThanks,\n{sc['requester']}\n{sc['dept']} ({sc['cost_center']})\n", base + ".pdf")
        index.append(dict(pr=sc["pr"], vendor=sc["vendor"], currency=sc["currency"], lines=sc["lines"], estimated_total=total, erp=sc["erp"], expect=sc["expect"], label=sc["label"], cost_center=sc["cost_center"], requester=sc["requester"]))
    with open(os.path.join(root, ".sim", "scenarios.json"), "w") as f: json.dump(index, f, indent=2)
    with open(os.path.join(root, ".gitignore"), "w") as f: f.write(".claude/settings.local.json\n.clane/\n")
    print(f"wrote {len(SCENARIOS)} requisitions under {root}")

if __name__ == "__main__":
    main()
