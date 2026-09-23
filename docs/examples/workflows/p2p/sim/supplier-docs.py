"""Supplier-side and bank-side documents for the P2P simulation. Called by integrations/worker.mjs.

  python supplier-docs.py ship  <run-dir> <purchase_order.json> <scenario.json>  -> prints JSON {delivery_note, invoice}
  python supplier-docs.py pay   <run-dir> <invoice.json> <invoice_match.json>     -> prints JSON {payment}

"ship" writes: outbox/<PO>.eml (our PO email to the vendor), inbox/deliveries/<PO>-ack.eml (their acknowledgement),
inbox/deliveries/DN-<n>.pdf + .txt + .eml (delivery note), inbox/deliveries/count-<PO>.txt (warehouse scanner count),
inbox/invoices/INV-<n>.pdf + .txt + .eml (the invoice). Everything is deterministic for a given PO, so a re-run
after a crash produces the same documents (idempotent).
"""
import json, os, sys
from datetime import date, timedelta
from email.message import EmailMessage
from email.utils import formatdate
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

TODAY = date(2026, 9, 23)
VENDOR_BANK = {"V-1001": ("DE89370400440532013000", "COBADEFFXXX"), "V-1002": ("IE29AIBK93115212345678", "AIBKIE2D"),
               "V-1003": ("GB29NWBK60161331926819", "NWBKGB2L"), "V-1004": ("IE64IRCE92050112345678", "IRCEIE2D"), "V-2001": ("LT121000011101001000", "LIABLT2X")}
TERMS_DAYS = {"V-1003": 14}

def money(v): return f"{v:,.2f}"

def eml(path, frm, to, subject, body, attach=None):
    m = EmailMessage(); m["From"] = frm; m["To"] = to; m["Subject"] = subject; m["Date"] = formatdate(localtime=True)
    m.set_content(body)
    if attach:
        with open(attach, "rb") as f: m.add_attachment(f.read(), maintype="application", subtype="pdf", filename=os.path.basename(attach))
    with open(path, "wb") as f: f.write(bytes(m))

def doc_pdf(path, title, header_rows, table_rows, footer, col_widths):
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Title"], fontSize=16, spaceAfter=6)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=16*mm, bottomMargin=16*mm)
    t = Table(table_rows, colWidths=col_widths)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e9ecef")), ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                           ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("ALIGN", (2, 1), (-1, -1), "RIGHT")]))
    hdr = Table(header_rows, colWidths=[34*mm, 60*mm, 30*mm, 56*mm], style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"), ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.lightgrey)]))
    doc.build([Paragraph(title, h), Spacer(1, 6), hdr, Spacer(1, 10), t, Spacer(1, 10)] + [Paragraph(x, styles["Normal"] if i == 0 else small) for i, x in enumerate(footer)])

def ship(run, po, sc):
    erp = sc.get("erp", {})
    n = po["po_number"].split("-")[-1]
    vendor = po["vendor"]; vid = vendor["id"]; vname = vendor["name"]; vemail = vendor.get("email", f"orders@{vid.lower()}.example")
    cur = po["currency"]
    dn_no, inv_no = f"DN-2026-{n}", f"INV-2026-{n}"
    deliveries, invoices, outbox = (os.path.join(run, "inbox", "deliveries"), os.path.join(run, "inbox", "invoices"), os.path.join(run, "outbox"))
    for d in (deliveries, invoices, outbox): os.makedirs(d, exist_ok=True)

    # 1. our PO email to the vendor
    lines_txt = "\n".join(f"  {l['line']}. {l.get('sku','')} {l['item']}: {l['quantity']} x {money(l['unit_price'])} {cur}" for l in po["lines"])
    eml(os.path.join(outbox, f"{po['po_number']}.eml"), "purchasing@zeus.example", vemail, f"Purchase order {po['po_number']} from Zeus Ireland Ltd",
        f"Dear {vname},\n\nPlease supply the following against purchase order {po['po_number']} (requisition {po['requisition']}):\n{lines_txt}\nTotal: {money(po['total'])} {cur}\nDeliver to: Goods-in, Unit 4, Northwest Business Park, Dublin 15\nNeeded by: {po.get('needed_by','asap')}\n\nQuote the PO number on the delivery note and the invoice.\n\nPurchasing, Zeus Ireland Ltd\n")
    # 2. their acknowledgement
    eml(os.path.join(deliveries, f"{po['po_number']}-ack.eml"), vemail, "purchasing@zeus.example", f"RE: Purchase order {po['po_number']} - acknowledged",
        f"Thank you for your order {po['po_number']}. Sales order reference SO-{n}-{vid[-4:]}. Goods will ship within 3 working days.\n\n{vname}\n")

    # 3. delivery note (what they say they shipped) and the warehouse count sheet (what actually arrived)
    ship_qty = erp.get("ship_qty", {}); damaged = erp.get("damaged", {})
    shipped_at = (TODAY + timedelta(days=3)).isoformat()
    dn_lines, count_lines = [], []
    for l in po["lines"]:
        q = ship_qty.get(l.get("sku"), l["quantity"])
        dn_lines.append({"line": l["line"], "sku": l.get("sku", ""), "item": l["item"], "quantity_shipped": q})
        dmg = damaged.get(l.get("sku"), 0)
        count_lines.append((l["line"], l.get("sku", ""), l["item"], q, dmg))
    rows = [["Line", "SKU", "Description", "Qty shipped"]] + [[str(x["line"]), x["sku"], x["item"], str(x["quantity_shipped"])] for x in dn_lines]
    dn_pdf = os.path.join(deliveries, f"{dn_no}.pdf")
    doc_pdf(dn_pdf, f"DELIVERY NOTE {dn_no}", [["Supplier", vname, "Delivery note", dn_no], ["Customer PO", po["po_number"], "Shipped", shipped_at],
            ["Carrier", "DHL Freight", "Tracking", f"DHL{n}0042IE"], ["Deliver to", "Goods-in, Unit 4, Northwest Business Park, Dublin 15", "Sales order", f"SO-{n}-{vid[-4:]}"]],
            rows, ["Please check the goods on arrival and report shortages within 5 working days.", "This is not an invoice."], [14*mm, 26*mm, 100*mm, 30*mm])
    with open(os.path.join(deliveries, f"{dn_no}.txt"), "w") as f:
        f.write(f"DELIVERY NOTE {dn_no}\nSupplier: {vname} ({vid})\nCustomer PO: {po['po_number']}\nShipped: {shipped_at}\nCarrier: DHL Freight, tracking DHL{n}0042IE\n\nLine | SKU | Description | Qty shipped\n")
        for x in dn_lines: f.write(f"{x['line']} | {x['sku']} | {x['item']} | {x['quantity_shipped']}\n")
    eml(os.path.join(deliveries, f"{dn_no}.eml"), vemail, "goods-in@zeus.example", f"Shipment for PO {po['po_number']}: delivery note {dn_no}",
        f"Your order {po['po_number']} has shipped. Delivery note {dn_no} attached. Tracking DHL{n}0042IE.\n", dn_pdf)
    with open(os.path.join(deliveries, f"count-{po['po_number']}.txt"), "w") as f:
        f.write(f"WAREHOUSE COUNT SHEET (scanner export)\nPO: {po['po_number']}   Delivery note: {dn_no}   Counted: {(TODAY + timedelta(days=4)).isoformat()} 09:40   Bay: 3   Operator badge: 2231\n\nLine | SKU | Description | Counted | Damaged | Note\n")
        for (ln, sku, item, q, dmg) in count_lines:
            note = "short against delivery note" if q < next(l["quantity"] for l in po["lines"] if l["line"] == ln) else ("damaged carton" if dmg else "ok")
            f.write(f"{ln} | {sku} | {item} | {q} | {dmg} | {note}\n")
    delivery_note = {"delivery_note_number": dn_no, "po_number": po["po_number"], "vendor": vname, "shipped_at": shipped_at, "carrier": "DHL Freight",
                     "tracking": f"DHL{n}0042IE", "lines": dn_lines, "document_path": f"inbox/deliveries/{dn_no}.pdf", "email_path": f"inbox/deliveries/{dn_no}.eml"}

    # 4. invoice (what they bill)
    inv_price = erp.get("invoice_price", {}); inv_qty = erp.get("invoice_qty", {})
    issued = TODAY + timedelta(days=4); due = issued + timedelta(days=TERMS_DAYS.get(vid, 30))
    inv_lines, subtotal = [], 0.0
    for l in po["lines"]:
        q = inv_qty.get(l.get("sku"), ship_qty.get(l.get("sku"), l["quantity"]))
        up = inv_price.get(l.get("sku"), l["unit_price"])
        lt = round(q * up, 2); subtotal += lt
        inv_lines.append({"line": l["line"], "sku": l.get("sku", ""), "item": l["item"], "quantity": q, "unit_price": up, "line_total": lt})
    subtotal = round(subtotal, 2); tax = 0.0; total = subtotal
    iban, bic = VENDOR_BANK.get(vid, ("XX00", "XXXX"))
    rows = [["Line", "SKU", "Description", "Qty", "Unit price", "Line total"]] + [[str(x["line"]), x["sku"], x["item"], str(x["quantity"]), money(x["unit_price"]), money(x["line_total"])] for x in inv_lines]
    rows += [["", "", "", "", "Subtotal", money(subtotal)], ["", "", "", "", "VAT (reverse charge)", money(tax)], ["", "", "", "", f"TOTAL {cur}", money(total)]]
    inv_pdf = os.path.join(invoices, f"{inv_no}.pdf")
    doc_pdf(inv_pdf, f"INVOICE {inv_no}", [["Supplier", vname, "Invoice no.", inv_no], ["Customer PO", po["po_number"], "Invoice date", issued.isoformat()],
            ["Bill to", "Zeus Ireland Ltd, 12 Docklands Quay, Dublin 1", "Due date", due.isoformat()], ["Bank", f"IBAN {iban}", "BIC", bic]],
            rows, [f"Payment terms: {(due - issued).days} days net. Please quote {inv_no} with your remittance.", "VAT reverse charge applies (intra-EU B2B)."], [12*mm, 24*mm, 78*mm, 14*mm, 24*mm, 24*mm])
    with open(os.path.join(invoices, f"{inv_no}.txt"), "w") as f:
        f.write(f"INVOICE {inv_no}\nSupplier: {vname} ({vid})\nCustomer PO: {po['po_number']}\nInvoice date: {issued.isoformat()}\nDue date: {due.isoformat()}\nBank: IBAN {iban} BIC {bic}\n\nLine | SKU | Description | Qty | Unit price | Line total\n")
        for x in inv_lines: f.write(f"{x['line']} | {x['sku']} | {x['item']} | {x['quantity']} | {money(x['unit_price'])} | {money(x['line_total'])}\n")
        f.write(f"Subtotal: {money(subtotal)}\nVAT (reverse charge): {money(tax)}\nTOTAL {cur}: {money(total)}\n")
    eml(os.path.join(invoices, f"{inv_no}.eml"), vemail.replace("orders@", "billing@").replace("sales@", "billing@"), "ap@zeus.example", f"Invoice {inv_no} for PO {po['po_number']}",
        f"Please find attached invoice {inv_no} for your order {po['po_number']}, total {money(total)} {cur}, due {due.isoformat()}.\n\n{vname} accounts\n", inv_pdf)
    invoice = {"invoice_number": inv_no, "po_number": po["po_number"], "vendor": vname, "issued_at": issued.isoformat(), "due_at": due.isoformat(), "currency": cur,
               "lines": inv_lines, "subtotal": subtotal, "tax": tax, "total": total, "bank": {"iban": iban, "bic": bic},
               "document_path": f"inbox/invoices/{inv_no}.pdf", "email_path": f"inbox/invoices/{inv_no}.eml"}
    return {"delivery_note": delivery_note, "invoice": invoice}

def pay(run, inv, match):
    n = inv["invoice_number"].split("-")[-1]
    ref = f"PAY-2026-{n}"
    outbox = os.path.join(run, "outbox"); os.makedirs(outbox, exist_ok=True)
    amount = float(match.get("amount_payable") or inv["total"])
    path = os.path.join(outbox, f"remittance-{inv['invoice_number']}.eml")
    eml(path, "ap@zeus.example", f"billing@{inv['vendor'].split()[0].lower()}.example", f"Remittance advice {ref}: invoice {inv['invoice_number']}",
        f"We have scheduled payment of {money(amount)} {inv['currency']} for invoice {inv['invoice_number']} (PO {inv['po_number']}) on {inv['due_at']} to IBAN {inv.get('bank',{}).get('iban','')}. Reference {ref}.\n\nAccounts payable, Zeus Ireland Ltd\n")
    return {"payment": {"payment_ref": ref, "invoice_number": inv["invoice_number"], "po_number": inv["po_number"], "vendor": inv["vendor"], "amount": amount, "currency": inv["currency"],
                        "beneficiary": {"name": inv["vendor"], "iban": inv.get("bank", {}).get("iban", "")}, "status": "scheduled", "scheduled_for": inv["due_at"], "remittance_path": f"outbox/remittance-{inv['invoice_number']}.eml"}}

if __name__ == "__main__":
    cmd, run = sys.argv[1], sys.argv[2]
    a = json.load(open(sys.argv[3])); b = json.load(open(sys.argv[4]))
    print(json.dumps(ship(run, a, b) if cmd == "ship" else pay(run, a, b)))
